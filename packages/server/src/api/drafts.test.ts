// ── /api/drafts + /api/board/promote integration tests ───────────────────────
//
// Drives the real request handler over HTTP (via startTestServer). The harness
// wires a stub Yjs replacer that reports "no live room", so promotion falls
// back to a direct disk write — exactly what we want to assert here (there is
// no relay running). A separate test overrides the replacer to prove the
// live-room path is taken when a room exists.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('404s when the board does not exist', async () => {
    const res = await fetch(`${h.url}/api/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'nope' }),
    });
    expect(res.status).toBe(404);
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
  it('overwrites prod content with the draft, snapshots prod first, and deletes the draft', async () => {
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

    // Prod now has the draft's CONTENT but keeps its own label.
    const prod = h.ctx.repo.read('spend');
    expect(prod.nodes.map((n) => n.id)).toEqual(['draftNode']);
    expect(prod.boardLabel).toBe('Spend');

    // A 'promote' snapshot of the pre-promote prod state exists.
    const versions = h.ctx.history.list('spend', []);
    expect(versions.some((v) => v.trigger === 'promote')).toBe(true);

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

  it('leaves prod comments/tags untouched', async () => {
    h.ctx.repo.seedBoard('spend', 'Spend');
    // Seed human-owned sidecars via their endpoints.
    await fetch(`${h.url}/api/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', tags: ['keepme'] }),
    });

    const draftId = await createDraft('spend');
    h.ctx.repo.write('spend', [], boardWith('Spend', 'x'), draftId);
    await fetch(`${h.url}/api/board/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'spend', draft: draftId }),
    });

    const tags = await (await fetch(`${h.url}/api/tags?board=spend`)).json();
    expect(tags.tags).toEqual(['keepme']);
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

  it('uses the live room path when a prod room is connected', async () => {
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
      // The live-room replacer was invoked with the draft's content.
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].snapshot.nodes.map((n) => n.id)).toEqual(['liveNode']);
    } finally {
      await live.close();
    }
  });
});
