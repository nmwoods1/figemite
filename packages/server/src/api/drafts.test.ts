// ── /api/drafts + /api/board/promote integration tests ───────────────────────
//
// Drives the real request handler over HTTP (via startTestServer). The harness
// wires a stub Yjs replacer that reports "no live room", so promotion falls
// back to a direct disk write — exactly what we want to assert here (there is
// no relay running). A separate test overrides the replacer to prove the
// live-room path is taken when a room exists.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyBoard,
  makeStickyNode,
  type BoardFile,
  type BoardNode,
  type BoardEdge,
} from '@figemite/shared';
import { startTestServer, type TestHarness } from './test-server.js';

let h: TestHarness;

beforeEach(async () => {
  h = await startTestServer({ debounceMs: 20, suppressMs: 50 });
});

afterEach(async () => {
  await h.close();
});

function boardWith(label: string, sticky: string): BoardFile {
  return { ...emptyBoard(label), nodes: [makeStickyNode(sticky, { x: 0, y: 0 }, '#fef3c7', 0)] };
}

async function createDraft(slug: string, title?: string): Promise<string> {
  const res = await fetch(`${h.url}/api/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, title, createdBy: 'agent' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).draftId as string;
}

describe('POST /api/drafts (create)', () => {
  it('copies current prod into a new hidden draft dir, leaving prod & listing untouched', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 's1'));

    const draftId = await createDraft('spend', 'My draft');

    // Draft is a full copy nested under .drafts/, hidden from the board list.
    expect(h.ctx.repo.exists('spend', [], draftId)).toBe(true);
    expect(h.ctx.repo.read('spend', [], draftId).nodes).toHaveLength(1);
    expect(h.ctx.repo.listSlugs()).toEqual(['spend']);

    // GET /api/drafts surfaces it with metadata.
    const list = await (await fetch(`${h.url}/api/drafts?board=spend`)).json();
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ id: draftId, title: 'My draft', createdBy: 'agent' });
  });

  it("copies Live's comment thread into the new draft (faithful fork)", async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const liveComments = {
      comments: [
        {
          id: 'live1',
          target: { type: 'canvas', pos: { x: 1, y: 1 } },
          author: 'nick',
          createdAt: '2026-07-06T00:00:00.000Z',
          text: 'on live',
          replies: [],
        },
      ],
    };
    await fetch(`${h.url}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', data: liveComments }),
    });

    const draftId = await createDraft('spend');

    // The draft opens with a snapshot of Live's thread...
    const draftComments = await (
      await fetch(`${h.url}/api/comments?board=spend&draft=${draftId}`)
    ).json();
    expect(draftComments).toEqual(liveComments);

    // ...but the two are now independent: editing the draft never touches Live.
    await fetch(`${h.url}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId, data: { comments: [] } }),
    });
    const liveAfter = await (await fetch(`${h.url}/api/comments?board=spend`)).json();
    expect(liveAfter).toEqual(liveComments);
  });

  it('404s when the board does not exist', async () => {
    const res = await fetch(`${h.url}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('defaults an untitled draft to "Draft #N" numbered by the current draft count', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');

    // Create a draft with the given body; return the parsed response.
    const create = async (body: Record<string, unknown>) => {
      const res = await fetch(`${h.url}/api/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', ...body }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { draftId: string; draft: { title: string } };
    };

    const first = await create({ createdBy: 'human' });
    expect(first.draft.title).toBe('Draft #1');

    const second = await create({ createdBy: 'human' });
    expect(second.draft.title).toBe('Draft #2');

    // A provided title still wins over the default.
    const named = await create({ title: 'My own name' });
    expect(named.draft.title).toBe('My own name');

    // The number reflects the count AT THAT MOMENT: discard one, and the next
    // untitled draft reuses that number (2 drafts remain → "Draft #3").
    await fetch(`${h.url}/api/drafts?board=spend&draft=${second.draftId}`, { method: 'DELETE' });
    const afterDiscard = await create({ createdBy: 'human' });
    expect(afterDiscard.draft.title).toBe('Draft #3');
  });
});

describe('PATCH /api/drafts (rename)', () => {
  async function rename(slug: string, draft: string, title: unknown): Promise<Response> {
    return fetch(`${h.url}/api/drafts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: slug, draft, title }),
    });
  }

  it('updates a draft title in the index without touching its content', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 's1'));
    const draftId = await createDraft('spend', 'Old name');

    const res = await rename('spend', draftId, '  New name  ');
    expect(res.status).toBe(200);
    expect((await res.json()).draft).toMatchObject({ id: draftId, title: 'New name' });

    // The listing reflects the trimmed new title; content is untouched.
    const list = await (await fetch(`${h.url}/api/drafts?board=spend`)).json();
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ id: draftId, title: 'New name', createdBy: 'agent' });
    expect(h.ctx.repo.read('spend', [], draftId).nodes).toHaveLength(1);
  });

  it('400s on an empty (whitespace-only) title', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const draftId = await createDraft('spend', 'Keep me');
    const res = await rename('spend', draftId, '   ');
    expect(res.status).toBe(400);
    // Title is unchanged.
    const list = await (await fetch(`${h.url}/api/drafts?board=spend`)).json();
    expect(list.drafts[0]).toMatchObject({ id: draftId, title: 'Keep me' });
  });

  it('404s when the draft does not exist', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const res = await rename('spend', 'draft-nope', 'whatever');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/board?draft=', () => {
  it('reads the draft copy, not prod', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const draftId = await createDraft('spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 'draftOnly'), draftId);

    const draftBoard = await (
      await fetch(`${h.url}/api/board?board=spend&draft=${draftId}`)
    ).json();
    expect(draftBoard.nodes.map((n: BoardNode) => n.id)).toEqual(['draftOnly']);
    // Prod is still empty.
    const prod = await (await fetch(`${h.url}/api/board?board=spend`)).json();
    expect(prod.nodes).toEqual([]);
  });
});

describe('POST /api/board/promote', () => {
  it('overwrites prod content with the draft, snapshots prod first, and KEEPS the draft by default', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 'prodNode'));

    const draftId = await createDraft('spend');
    // Edit the draft (simulating live edits) directly on disk.
    h.ctx.repo.write('spend', [], boardWith('Draft label', 'draftNode'), draftId);

    const res = await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).deletedDraft).toBe(false);

    // Prod now has the draft's CONTENT but keeps its own label.
    const prod = h.ctx.repo.read('spend');
    expect(prod.nodes.map((n) => n.id)).toEqual(['draftNode']);
    expect(prod.boardLabel).toBe('Spend');

    // A 'promote' snapshot of the pre-promote prod state exists.
    const versions = h.ctx.history.list('spend', []);
    expect(versions.some((v) => v.trigger === 'promote')).toBe(true);

    // The draft is KEPT by default (dir + index entry both survive).
    expect(h.ctx.repo.exists('spend', [], draftId)).toBe(true);
    const list = await (await fetch(`${h.url}/api/drafts?board=spend`)).json();
    expect(list.drafts.map((d: { id: string }) => d.id)).toEqual([draftId]);
  });

  it('deletes the draft after promotion when deleteDraft is true', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const draftId = await createDraft('spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 'draftNode'), draftId);

    const res = await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId, deleteDraft: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).deletedDraft).toBe(true);

    // The draft is gone (dir + index entry).
    expect(h.ctx.repo.exists('spend', [], draftId)).toBe(false);
    const list = await (await fetch(`${h.url}/api/drafts?board=spend`)).json();
    expect(list.drafts).toEqual([]);
  });

  it('copies draft sub-boards and removes prod sub-boards absent from the draft', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    h.ctx.repo.write('spend', ['keep'], emptyBoard('Keep'));
    h.ctx.repo.write('spend', ['stale'], emptyBoard('Stale'));

    const draftId = await createDraft('spend'); // copies keep + stale
    // In the draft: modify keep, add a new sub-board, drop stale.
    h.ctx.repo.write('spend', ['keep'], boardWith('Keep', 'k1'), draftId);
    h.ctx.repo.write('spend', ['fresh'], emptyBoard('Fresh'), draftId);
    h.ctx.repo.delete('spend', ['stale'], draftId);

    const res = await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId }),
    });
    expect(res.status).toBe(200);

    expect(h.ctx.repo.read('spend', ['keep']).nodes.map((n) => n.id)).toEqual(['k1']);
    expect(h.ctx.repo.exists('spend', ['fresh'])).toBe(true);
    expect(h.ctx.repo.exists('spend', ['stale'])).toBe(false); // stale prod sub-board removed
  });

  it('replaces prod comments with the draft thread, but leaves prod tags untouched', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    // Seed human-owned sidecars via their endpoints.
    await fetch(`${h.url}/api/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', tags: ['keepme'] }),
    });
    const liveComments = {
      comments: [
        {
          id: 'live1',
          target: { type: 'canvas', pos: { x: 1, y: 1 } },
          author: 'nick',
          createdAt: '2026-07-06T00:00:00.000Z',
          text: 'on live',
          replies: [],
        },
      ],
    };
    await fetch(`${h.url}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', data: liveComments }),
    });

    const draftId = await createDraft('spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 'x'), draftId);
    // Replace the draft's (copied) thread with a draft-only comment.
    const draftComments = {
      comments: [
        {
          id: 'draft1',
          target: { type: 'canvas', pos: { x: 2, y: 2 } },
          author: 'nick',
          createdAt: '2026-07-06T00:00:00.000Z',
          text: 'on draft',
          replies: [],
        },
      ],
    };
    await fetch(`${h.url}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId, data: draftComments }),
    });

    await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId }),
    });

    // Comments: prod now carries the draft's thread (replace semantics).
    const prodComments = await (await fetch(`${h.url}/api/comments?board=spend`)).json();
    expect(prodComments).toEqual(draftComments);
    // Tags: still human-owned and untouched by promotion.
    const tags = await (await fetch(`${h.url}/api/tags?board=spend`)).json();
    expect(tags.tags).toEqual(['keepme']);
  });

  it('broadcasts external-change on Live so connected clients re-fetch comments', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const draftId = await createDraft('spend');

    // comments.json is not in the Yjs doc and the file-watcher ignores it, so
    // promote must explicitly nudge Live subscribers to reload the new thread.
    const broadcast = vi.spyOn(h.ctx.sse, 'broadcast');
    await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId }),
    });

    expect(broadcast).toHaveBeenCalledWith('spend', [], 'external-change', { board: 'spend' });
    broadcast.mockRestore();
  });

  it('409s when prod has an active AI lock', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const draftId = await createDraft('spend');
    h.ctx.ai.begin('spend', []); // lock prod

    const res = await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId }),
    });
    expect(res.status).toBe(409);
  });

  it('404s for a missing draft', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    const res = await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: 'draftNope' }),
    });
    expect(res.status).toBe(404);
  });

  it('writes prod to disk directly AND converges the live room when a prod room is connected', async () => {
    const calls: Array<{ subPath: string[]; snapshot: { nodes: BoardNode[]; edges: BoardEdge[] } }> =
      [];
    const live = await startTestServer({
      yjs: {
        replaceRoomContent(_slug, subPath, snapshot) {
          calls.push({ subPath, snapshot });
          return true; // pretend a live room exists and was updated
        },
      },
    });
    try {
      live.ctx.repo.seedBoard('spend', 'Spend');
      const draftId = (
        await (
          await fetch(`${live.url}/api/drafts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ board: 'spend' }),
          })
        ).json()
      ).draftId as string;
      live.ctx.repo.write('spend', [], boardWith('Spend', 'liveNode'), draftId);

      const res = await fetch(`${live.url}/api/board/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', draft: draftId }),
      });
      expect(res.status).toBe(200);

      // REGRESSION: prod DISK must be written by the handler itself — NOT left
      // to the live room's debounce. A prod room being connected (a stale
      // client) must not stop the promoted content from reaching disk.
      expect(live.ctx.repo.read('spend').nodes.map((n) => n.id)).toEqual(['liveNode']);

      // The live-room replacer was also invoked (best-effort browser convergence).
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].snapshot.nodes.map((n) => n.id)).toEqual(['liveNode']);
    } finally {
      await live.close();
    }
  });
});
