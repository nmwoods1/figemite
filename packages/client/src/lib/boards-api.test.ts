import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardFile, CommentsFile, TagsFile } from '@figemite/shared';

// `boards-api.ts` branches on `READONLY` from `../app/mode.js`. Mocking that
// module lets each test flip the flag independently of Vite's env handling
// (which is baked in at build time for the real flag) — this is the seam the
// task spec calls out for testing "the branch is taken".
const modeMock = vi.hoisted(() => ({ READONLY: false }));
vi.mock('../app/mode.js', () => modeMock);

import {
  listBoards,
  getBoard,
  saveBoard,
  createBoard,
  createDraft,
  createSubBoard,
  deleteSubBoard,
  fetchComments,
  saveComments,
  fetchTags,
  saveTags,
  fetchHistory,
  fetchVersion,
  ReadOnlyError,
} from './boards-api.js';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

function makeBoardFile(label = 'Test board'): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: label,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

describe('boards-api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    modeMock.READONLY = false;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── dev mode: listBoards ────────────────────────────────────────────────

  describe('dev mode', () => {
    beforeEach(() => {
      modeMock.READONLY = false;
    });

    it('listBoards calls GET /api/boards and returns the boards array', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          boards: [
            { slug: 'spend', label: 'Spend', tags: [], subBoardPaths: [], lastModifiedMs: 123 },
          ],
        }),
      );

      const boards = await listBoards();

      expect(fetchMock).toHaveBeenCalledWith('/api/boards', undefined);
      expect(boards).toEqual([
        { slug: 'spend', label: 'Spend', tags: [], subBoardPaths: [], lastModifiedMs: 123 },
      ]);
    });

    it('getBoard calls GET /api/board?board=&path= and validates via parseBoardFile', async () => {
      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse(board));

      const result = await getBoard('spend', ['nodeA', 'subB']);

      expect(fetchMock).toHaveBeenCalledWith('/api/board?board=spend&path=nodeA.subB', undefined);
      expect(result).toEqual(board);
    });

    it('getBoard omits the path param when path is empty', async () => {
      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse(board));

      await getBoard('spend', []);

      expect(fetchMock).toHaveBeenCalledWith('/api/board?board=spend', undefined);
    });

    it('getBoard throws a typed error when the server returns a malformed board', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ not: 'a board' }));

      await expect(getBoard('spend', [])).rejects.toThrow(/Invalid board file/);
    });

    it('getBoard throws a typed ApiError on a non-ok response, surfacing the server error message', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: 'not_found' }, { ok: false, status: 404 }),
      );

      await expect(getBoard('missing', [])).rejects.toMatchObject({
        name: 'ApiError',
        status: 404,
        message: 'not_found',
      });
    });

    it('saveBoard calls POST /api/board with the board/path/data body', async () => {
      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await saveBoard('spend', ['nodeA'], board);

      expect(fetchMock).toHaveBeenCalledWith('/api/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', path: ['nodeA'], data: board }),
      });
    });

    it('createDraft calls POST /api/drafts, threading fromVersion when given', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ draftId: 'd2' }));

      const id = await createDraft('spend', undefined, 'v-1');

      expect(id).toBe('d2');
      // title is undefined (omitted by JSON.stringify); fromVersion is carried.
      expect(fetchMock).toHaveBeenCalledWith('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', createdBy: 'human', fromVersion: 'v-1' }),
      });
    });

    it('createDraft omits fromVersion when not given (copies current Live)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ draftId: 'd3' }));

      await createDraft('spend');

      expect(fetchMock).toHaveBeenCalledWith('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', createdBy: 'human' }),
      });
    });

    it('createBoard calls POST /api/boards with slug/label', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, slug: 'spend' }));

      await createBoard('spend', 'Spend');

      expect(fetchMock).toHaveBeenCalledWith('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'spend', label: 'Spend' }),
      });
    });

    it('createSubBoard calls POST /api/create with board/path/label', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, existed: false }));

      await createSubBoard('spend', ['nodeA'], 'Node A');

      expect(fetchMock).toHaveBeenCalledWith('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', path: ['nodeA'], label: 'Node A' }),
      });
    });

    it('createSubBoard threads the draft id into the POST /api/create body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, existed: false }));

      await createSubBoard('spend', ['nodeA'], 'Node A', 'draft1');

      expect(fetchMock).toHaveBeenCalledWith('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', path: ['nodeA'], label: 'Node A', draft: 'draft1' }),
      });
    });

    it('deleteSubBoard calls DELETE /api/board?board=&path=', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, deleted: [] }));

      await deleteSubBoard('spend', ['nodeA']);

      expect(fetchMock).toHaveBeenCalledWith('/api/board?board=spend&path=nodeA', {
        method: 'DELETE',
      });
    });

    it('fetchComments calls GET /api/comments?board= and validates via parseCommentsFile', async () => {
      const data: CommentsFile = { comments: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse(data));

      const result = await fetchComments('spend');

      expect(fetchMock).toHaveBeenCalledWith('/api/comments?board=spend', undefined);
      expect(result).toEqual(data);
    });

    it('fetchComments throws a typed error on a malformed comments file', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ comments: [{ bogus: true }] }));

      await expect(fetchComments('spend')).rejects.toThrow(/Invalid comments file/);
    });

    it('saveComments calls POST /api/comments with board/data', async () => {
      const data: CommentsFile = { comments: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await saveComments('spend', data);

      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', data }),
      });
    });

    it('fetchComments scopes to a draft via the draft query param', async () => {
      const data: CommentsFile = { comments: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse(data));

      await fetchComments('spend', 'draft1');

      expect(fetchMock).toHaveBeenCalledWith('/api/comments?board=spend&draft=draft1', undefined);
    });

    it('saveComments includes the draft id in the POST body', async () => {
      const data: CommentsFile = { comments: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await saveComments('spend', data, 'draft1');

      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', draft: 'draft1', data }),
      });
    });

    it('fetchTags calls GET /api/tags?board= and validates via parseTagsFile', async () => {
      const data: TagsFile = { tags: ['roadmap'] };
      fetchMock.mockResolvedValueOnce(jsonResponse(data));

      const result = await fetchTags('spend');

      expect(fetchMock).toHaveBeenCalledWith('/api/tags?board=spend', undefined);
      expect(result).toEqual(['roadmap']);
    });

    it('fetchTags throws a typed error on a malformed tags file', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ tags: 'not-an-array' }));

      await expect(fetchTags('spend')).rejects.toThrow(/Invalid tags file/);
    });

    it('saveTags calls POST /api/tags with board/tags', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await saveTags('spend', ['roadmap', 'q3']);

      expect(fetchMock).toHaveBeenCalledWith('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'spend', tags: ['roadmap', 'q3'] }),
      });
    });

    it('fetchHistory calls GET /api/history?board=&path=', async () => {
      const versions = [
        {
          id: '2026-07-06T12-00-00-000Z__save',
          timestamp: '2026-07-06T12:00:00.000Z',
          trigger: 'save',
        },
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse({ versions }));

      const result = await fetchHistory('spend', ['nodeA']);

      expect(fetchMock).toHaveBeenCalledWith('/api/history?board=spend&path=nodeA', undefined);
      expect(result).toEqual(versions);
    });

    it('fetchVersion calls GET /api/history/version?board=&path=&id=', async () => {
      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse(board));

      const result = await fetchVersion('spend', [], 'abc123');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/history/version?board=spend&id=abc123',
        undefined,
      );
      expect(result).toEqual(board);
    });

    it('threads a draftId as the `draft` query param (draft-scoped history)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ versions: [] }));
      await fetchHistory('spend', ['nodeA'], 'draft-x');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/history?board=spend&path=nodeA&draft=draft-x',
        undefined,
      );

      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse(board));
      await fetchVersion('spend', [], 'abc123', 'draft-x');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/history/version?board=spend&id=abc123&draft=draft-x',
        undefined,
      );
    });
  });

  // ── READONLY mode ────────────────────────────────────────────────────────

  describe('READONLY mode', () => {
    beforeEach(() => {
      modeMock.READONLY = true;
    });

    it('listBoards fetches the static boards/index.json manifest', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          boards: [
            { slug: 'spend', label: 'Spend', tags: [], subBoardPaths: [], lastModifiedMs: 456 },
          ],
        }),
      );

      const boards = await listBoards();

      expect(fetchMock).toHaveBeenCalledWith('boards/index.json', undefined);
      expect(boards).toEqual([
        { slug: 'spend', label: 'Spend', tags: [], subBoardPaths: [], lastModifiedMs: 456 },
      ]);
    });

    it('getBoard fetches the static root board.json', async () => {
      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse(board));

      const result = await getBoard('spend', []);

      expect(fetchMock).toHaveBeenCalledWith('boards/spend/board.json', undefined);
      expect(result).toEqual(board);
    });

    it('getBoard fetches the static dotted sub-board file for a nested path', async () => {
      const board = makeBoardFile();
      fetchMock.mockResolvedValueOnce(jsonResponse(board));

      await getBoard('spend', ['nodeA', 'subB']);

      expect(fetchMock).toHaveBeenCalledWith('boards/spend/board.nodeA.subB.json', undefined);
    });

    it('getBoard migrates a legacy v0 static board file through parseBoardFile', async () => {
      // No formatVersion, no `order` on the node — the v0 shape parseBoardFile migrates.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          boardLabel: 'Legacy',
          nodes: [{ id: 'n1', type: 'text', pos: { x: 0, y: 0 }, text: 'hi' }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
      );

      const result = await getBoard('spend', []);

      expect(result.formatVersion).toBe(1);
      expect(result.nodes[0]).toMatchObject({ id: 'n1', order: 0 });
    });

    it('fetchComments fetches the static comments.json', async () => {
      const data: CommentsFile = { comments: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse(data));

      await fetchComments('spend');

      expect(fetchMock).toHaveBeenCalledWith('boards/spend/comments.json', undefined);
    });

    it('fetchTags fetches the static tags.json', async () => {
      const data: TagsFile = { tags: [] };
      fetchMock.mockResolvedValueOnce(jsonResponse(data));

      await fetchTags('spend');

      expect(fetchMock).toHaveBeenCalledWith('boards/spend/tags.json', undefined);
    });

    it('saveBoard throws ReadOnlyError and never calls fetch', async () => {
      await expect(saveBoard('spend', [], makeBoardFile())).rejects.toThrow(ReadOnlyError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('createBoard throws ReadOnlyError and never calls fetch', async () => {
      await expect(createBoard('spend', 'Spend')).rejects.toThrow(ReadOnlyError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('createSubBoard throws ReadOnlyError and never calls fetch', async () => {
      await expect(createSubBoard('spend', ['nodeA'])).rejects.toThrow(ReadOnlyError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deleteSubBoard throws ReadOnlyError and never calls fetch', async () => {
      await expect(deleteSubBoard('spend', ['nodeA'])).rejects.toThrow(ReadOnlyError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('saveComments throws ReadOnlyError and never calls fetch', async () => {
      await expect(saveComments('spend', { comments: [] })).rejects.toThrow(ReadOnlyError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('saveTags throws ReadOnlyError and never calls fetch', async () => {
      await expect(saveTags('spend', ['a'])).rejects.toThrow(ReadOnlyError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchHistory throws (history is not part of the static build) and never calls fetch', async () => {
      await expect(fetchHistory('spend', [])).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchVersion throws (history is not part of the static build) and never calls fetch', async () => {
      await expect(fetchVersion('spend', [], 'abc')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
