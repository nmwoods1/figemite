import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard, makeStickyNode, type BoardFile } from '@figemite/shared';
import { startTestServer, type TestHarness } from './test-server.js';

let h: TestHarness;

beforeEach(async () => {
  h = await startTestServer();
});

afterEach(async () => {
  await h.close();
});

// ── helpers ──────────────────────────────────────────────────────────────────

function boardWithSticky(label = 'My Board'): BoardFile {
  return { ...emptyBoard(label), nodes: [makeStickyNode('s1', { x: 10, y: 20 }, '#fef3c7', 0)] };
}

async function getJson(pathAndQuery: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${h.url}${pathAndQuery}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function postJson(
  p: string,
  data: unknown,
  method = 'POST',
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${h.url}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

// ── Board lifecycle (the Phase-1 gate matrix) ────────────────────────────────

describe('board lifecycle', () => {
  it('create -> get seeded -> list -> save -> get saved -> history -> version -> delete', async () => {
    // POST /api/boards
    const created = await postJson('/api/boards', { slug: 'my-board', label: 'My Board' });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ ok: true, slug: 'my-board' });

    // GET /api/board -> the seeded empty board
    const seeded = await getJson('/api/board?board=my-board');
    expect(seeded.status).toBe(200);
    expect(seeded.body).toEqual(emptyBoard('My Board'));

    // GET /api/boards -> lists it
    const list = await getJson('/api/boards');
    expect(list.status).toBe(200);
    const boards = (
      list.body as {
        boards: Array<{
          slug: string;
          label: string;
          tags: string[];
          subBoardPaths: string[][];
          lastModifiedMs: number;
        }>;
      }
    ).boards;
    const info = boards.find((b) => b.slug === 'my-board');
    expect(info).toBeDefined();
    expect(info!.label).toBe('My Board');
    expect(info!.tags).toEqual([]);
    expect(info!.subBoardPaths).toEqual([]);
    expect(typeof info!.lastModifiedMs).toBe('number');

    // POST /api/board -> save nodes/edges
    const board = boardWithSticky();
    const saved = await postJson('/api/board', { board: 'my-board', data: board });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ok: true });

    // GET /api/board -> returns saved
    const readBack = await getJson('/api/board?board=my-board');
    expect(readBack.status).toBe(200);
    expect(readBack.body).toEqual(board);

    // GET /api/history -> a `save` snapshot exists
    const history = await getJson('/api/history?board=my-board');
    expect(history.status).toBe(200);
    const versions = (history.body as { versions: Array<{ id: string; trigger: string }> })
      .versions;
    expect(versions.some((v) => v.trigger === 'save')).toBe(true);

    // GET /api/history/version -> returns it
    const id = versions.find((v) => v.trigger === 'save')!.id;
    const version = await getJson(
      `/api/history/version?board=my-board&id=${encodeURIComponent(id)}`,
    );
    expect(version.status).toBe(200);
    expect(version.body).toEqual(board);

    // DELETE /api/board with NO path (root) is refused (data-loss guard) and
    // the board remains intact.
    const rootDelete = await postJson('/api/board?board=my-board', undefined, 'DELETE');
    expect(rootDelete.status).toBe(400);
    const stillThere = await getJson('/api/board?board=my-board');
    expect(stillThere.status).toBe(200);
    expect(stillThere.body).toEqual(board);
  });

  it('records an initial `save` snapshot on board creation (funnel, not seedBoard)', async () => {
    await postJson('/api/boards', { slug: 'my-board', label: 'My Board' });
    const history = await getJson('/api/history?board=my-board');
    const versions = (history.body as { versions: Array<{ trigger: string }> }).versions;
    // Creation went through persistBoard -> a `save` snapshot exists immediately.
    expect(versions.some((v) => v.trigger === 'save')).toBe(true);
  });
});

// ── Sub-boards ───────────────────────────────────────────────────────────────

describe('sub-boards', () => {
  it('create -> get/save/delete at a dotted path; deleting a parent removes descendants', async () => {
    await postJson('/api/boards', { slug: 'my-board', label: 'Root' });

    // POST /api/create — seed a sub-board
    const createSub = await postJson('/api/create', {
      board: 'my-board',
      path: ['Node1'],
      label: 'Child',
    });
    expect(createSub.status).toBe(200);
    expect(createSub.body).toEqual({ ok: true, existed: false });

    // Creating again is idempotent
    const again = await postJson('/api/create', { board: 'my-board', path: ['Node1'] });
    expect(again.body).toEqual({ ok: true, existed: true });

    // GET the sub-board
    const sub = await getJson('/api/board?board=my-board&path=Node1');
    expect(sub.status).toBe(200);
    expect(sub.body).toEqual(emptyBoard('Child'));

    // Save a grandchild sub-board
    const grand = boardWithSticky('Grandchild');
    await postJson('/api/board', { board: 'my-board', path: ['Node1', 'Node2'], data: grand });
    const readGrand = await getJson('/api/board?board=my-board&path=Node1.Node2');
    expect(readGrand.body).toEqual(grand);

    // The boards listing reports both sub-board paths
    const list = await getJson('/api/boards');
    const info = (
      list.body as { boards: Array<{ slug: string; subBoardPaths: string[][] }> }
    ).boards.find((b) => b.slug === 'my-board')!;
    expect(info.subBoardPaths).toEqual(expect.arrayContaining([['Node1'], ['Node1', 'Node2']]));

    // DELETE the parent sub-board -> descendants go too, and the response
    // reports the removed filenames (legacy `deleted` field).
    const del = await postJson('/api/board?board=my-board&path=Node1', undefined, 'DELETE');
    expect(del.status).toBe(200);
    const delBody = del.body as { ok: boolean; deleted: string[] };
    expect(delBody.ok).toBe(true);
    expect(delBody.deleted).toEqual(
      expect.arrayContaining(['board.Node1.json', 'board.Node1.Node2.json']),
    );
    expect((await getJson('/api/board?board=my-board&path=Node1')).status).toBe(404);
    expect((await getJson('/api/board?board=my-board&path=Node1.Node2')).status).toBe(404);
    // Root board is untouched
    expect((await getJson('/api/board?board=my-board')).status).toBe(200);
  });
});

// ── Comments & tags ──────────────────────────────────────────────────────────

describe('comments', () => {
  it('GET empty -> POST -> GET returns saved; invalid payload -> 400', async () => {
    await postJson('/api/boards', { slug: 'my-board' });

    const empty = await getJson('/api/comments?board=my-board');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ comments: [] });

    const commentsFile = {
      comments: [
        {
          id: 'c1',
          target: { type: 'canvas', pos: { x: 1, y: 2 } },
          author: 'nick',
          createdAt: '2026-07-06T00:00:00.000Z',
          text: 'hi',
          replies: [],
        },
      ],
    };
    const saved = await postJson('/api/comments', { board: 'my-board', data: commentsFile });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ok: true });

    const readBack = await getJson('/api/comments?board=my-board');
    expect(readBack.status).toBe(200);
    expect(readBack.body).toEqual(commentsFile);

    // Invalid payload (comments must be an array of the right shape) -> 400
    const bad = await postJson('/api/comments', { board: 'my-board', data: { comments: 'nope' } });
    expect(bad.status).toBe(400);
  });

  it('scopes comments by version — a draft thread is independent of Live', async () => {
    await postJson('/api/boards', { slug: 'my-board' });

    const live = {
      comments: [
        {
          id: 'live1',
          target: { type: 'canvas' as const, pos: { x: 1, y: 1 } },
          author: 'nick',
          createdAt: '2026-07-06T00:00:00.000Z',
          text: 'on live',
          replies: [],
        },
      ],
    };
    const draft = {
      comments: [
        {
          id: 'draft1',
          target: { type: 'canvas' as const, pos: { x: 2, y: 2 } },
          author: 'nick',
          createdAt: '2026-07-06T00:00:00.000Z',
          text: 'on draft',
          replies: [],
        },
      ],
    };

    // Write Live and a draft thread; each POST targets a different version.
    expect((await postJson('/api/comments', { board: 'my-board', data: live })).status).toBe(200);
    expect(
      (await postJson('/api/comments', { board: 'my-board', draft: 'd1', data: draft })).status,
    ).toBe(200);

    // Each GET reads only its own version — no leak either direction.
    expect((await getJson('/api/comments?board=my-board')).body).toEqual(live);
    expect((await getJson('/api/comments?board=my-board&draft=d1')).body).toEqual(draft);

    // A traversal-shaped draft id is rejected.
    expect((await getJson('/api/comments?board=my-board&draft=..')).status).toBe(400);
  });
});

describe('tags', () => {
  it('GET empty -> POST -> GET returns saved; invalid payload -> 400', async () => {
    await postJson('/api/boards', { slug: 'my-board' });

    const empty = await getJson('/api/tags?board=my-board');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ tags: [] });

    const saved = await postJson('/api/tags', { board: 'my-board', tags: ['alpha', 'beta'] });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ok: true });

    const readBack = await getJson('/api/tags?board=my-board');
    expect(readBack.body).toEqual({ tags: ['alpha', 'beta'] });

    // Invalid payload (tags must be string[]) -> 400
    const bad = await postJson('/api/tags', { board: 'my-board', tags: [1, 2, 3] });
    expect(bad.status).toBe(400);
  });
});

// ── AI lock lifecycle ────────────────────────────────────────────────────────

describe('AI lock lifecycle', () => {
  it('begin -> status locked -> save 409 -> end -> status unlocked -> ai snapshot exists', async () => {
    await postJson('/api/boards', { slug: 'my-board', label: 'My Board' });

    // begin
    const begin = await postJson('/api/ai/begin', { board: 'my-board' });
    expect(begin.status).toBe(200);
    expect(begin.body).toEqual({ locked: true, epoch: 1 });

    // status -> locked, epoch 1
    const statusLocked = await getJson('/api/ai/status?board=my-board');
    expect(statusLocked.body).toEqual({ locked: true, epoch: 1 });

    // POST /api/board while locked -> 409, and does NOT write
    const blocked = await postJson('/api/board', { board: 'my-board', data: boardWithSticky() });
    expect(blocked.status).toBe(409);
    // still the seeded empty board
    expect((await getJson('/api/board?board=my-board')).body).toEqual(emptyBoard('My Board'));

    // Simulate the AI's out-of-band write to disk (during the lock).
    await fs.writeFile(
      path.join(h.boardsRoot, 'my-board', 'board.json'),
      JSON.stringify(boardWithSticky('My Board')),
      'utf-8',
    );

    // end
    const end = await postJson('/api/ai/end', { board: 'my-board' });
    expect(end.status).toBe(200);
    expect(end.body).toEqual(boardWithSticky('My Board'));

    // status -> unlocked, epoch 2
    const statusUnlocked = await getJson('/api/ai/status?board=my-board');
    expect(statusUnlocked.body).toEqual({ locked: false, epoch: 2 });

    // an `ai` snapshot exists
    const history = await getJson('/api/history?board=my-board');
    const versions = (history.body as { versions: Array<{ trigger: string }> }).versions;
    expect(versions.some((v) => v.trigger === 'ai')).toBe(true);
    expect(versions.some((v) => v.trigger === 'preai')).toBe(true);

    // saving is allowed again post-unlock
    const savedAfter = await postJson('/api/board', { board: 'my-board', data: boardWithSticky() });
    expect(savedAfter.status).toBe(200);
  });
});

// ── Hostile input ────────────────────────────────────────────────────────────

describe('hostile input', () => {
  it('rejects a traversal slug and never reads a file outside the temp root', async () => {
    const res = await getJson('/api/board?board=' + encodeURIComponent('../../../etc/passwd'));
    expect([400, 404]).toContain(res.status);
    // No board directory was created outside the root (we can only assert the
    // temp root has no unexpected entries beyond what tests made).
    const entries = await fs.readdir(h.boardsRoot);
    expect(entries).not.toContain('..');
  });

  it('rejects a path param containing traversal segments', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    const res = await getJson('/api/board?board=my-board&path=' + encodeURIComponent('../secret'));
    expect([400, 404]).toContain(res.status);
  });

  it('rejects a save whose path array contains a slash/dot-dot segment', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    const res = await postJson('/api/board', {
      board: 'my-board',
      path: ['../../etc'],
      data: boardWithSticky(),
    });
    expect(res.status).toBe(400);
  });

  it('404s an unmatched route', async () => {
    const res = await getJson('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('400s a malformed JSON body', async () => {
    const res = await fetch(`${h.url}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

// ── fs failure modes ─────────────────────────────────────────────────────────

describe('fs failure modes', () => {
  it('returns a clean 500 (no stack/path leak) for a corrupt board file', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    // Corrupt the file on disk.
    await fs.writeFile(path.join(h.boardsRoot, 'my-board', 'board.json'), '{ truncated', 'utf-8');
    const res = await getJson('/api/board?board=my-board');
    expect(res.status).toBe(500);
    // The message must not leak the absolute path or internal detail.
    const message = (res.body as { error: string }).error;
    expect(message).toBe('Internal server error');
    expect(message).not.toContain(h.boardsRoot);
  });

  it('404s a missing board', async () => {
    const res = await getJson('/api/board?board=does-not-exist');
    expect(res.status).toBe(404);
  });

  it('a rejected save leaves the previous file parseable', async () => {
    await postJson('/api/boards', { slug: 'my-board', label: 'My Board' });
    // A save with an invalid board payload -> 400, no write.
    const bad = await postJson('/api/board', {
      board: 'my-board',
      data: { nodes: 'not-an-array' },
    });
    expect(bad.status).toBe(400);
    // The file is still the seeded empty board, still parseable.
    const res = await getJson('/api/board?board=my-board');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(emptyBoard('My Board'));
  });

  it('rejects creating a reserved slug', async () => {
    const res = await postJson('/api/boards', { slug: 'tag' });
    expect(res.status).toBe(400);
  });

  it('rejects creating a duplicate board with 409', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    const dup = await postJson('/api/boards', { slug: 'my-board' });
    expect(dup.status).toBe(409);
  });
});

// ── Error paths (explicit) ───────────────────────────────────────────────────

describe('error paths', () => {
  it('DELETE /api/board with no path -> 400 and the board is untouched', async () => {
    await postJson('/api/boards', { slug: 'my-board', label: 'My Board' });
    const res = await postJson('/api/board?board=my-board', undefined, 'DELETE');
    expect(res.status).toBe(400);
    const still = await getJson('/api/board?board=my-board');
    expect(still.status).toBe(200);
    expect(still.body).toEqual(emptyBoard('My Board'));
  });

  it('POST /api/create with an empty path -> 400', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    const res = await postJson('/api/create', { board: 'my-board', path: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/ai/end for a never-created board -> 404', async () => {
    const res = await postJson('/api/ai/end', { board: 'ghost-board' });
    expect(res.status).toBe(404);
  });

  it('GET /api/ai/status with an invalid slug -> 400', async () => {
    const res = await getJson('/api/ai/status?board=' + encodeURIComponent('../evil'));
    expect(res.status).toBe(400);
  });

  it('GET /api/history/version with no id -> 400', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    const res = await getJson('/api/history/version?board=my-board');
    expect(res.status).toBe(400);
  });

  it('GET /api/history/version with a bogus id -> 404', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    // A well-formed-but-nonexistent snapshot id (valid shape, no such file).
    const bogus = '2020-01-01T00-00-00-000Z__save';
    const res = await getJson(
      `/api/history/version?board=my-board&id=${encodeURIComponent(bogus)}`,
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/history/version with a malformed id -> 400 (invalid shape)', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    const res = await getJson('/api/history/version?board=my-board&id=not-a-valid-id');
    expect(res.status).toBe(400);
  });

  it('GET /api/history/version with a non-ENOENT fs fault -> sanitized 500 (no path leak)', async () => {
    await postJson('/api/boards', { slug: 'my-board' });
    // Force a non-ENOENT, non-invalid-id fs error: make the snapshot path a
    // DIRECTORY, so history.read's readFileSync throws EISDIR — whose raw
    // message contains the absolute path. The handler must NOT echo it.
    const validId = '2020-01-01T00-00-00-000Z__save';
    const histDir = path.join(h.boardsRoot, 'my-board', '.history');
    await fs.mkdir(path.join(histDir, `${validId}.json`), { recursive: true });
    const res = await getJson(
      `/api/history/version?board=my-board&id=${encodeURIComponent(validId)}`,
    );
    expect(res.status).toBe(500);
    const message = (res.body as { error: string }).error;
    expect(message).toBe('Internal server error');
    expect(message).not.toContain(h.boardsRoot);
  });
});
