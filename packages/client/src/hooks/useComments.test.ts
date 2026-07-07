// ── useComments tests ─────────────────────────────────────────────────────────
//
// Comments live in boards/<slug>/comments.json — a file SEPARATE from the Yjs
// board doc (the AI/CRDT loop never touches it; see @easel/shared's
// model/comments.ts module doc). This hook is the one place that loads that
// file for a board and exposes mutations that update local state AND persist
// via `lib/boards-api.ts`'s `saveComments`.
//
// Ported semantics from the legacy figmalade prototype's `src/lib/
// comment-io.ts` (addComment/addReply/toggleResolved/deleteComment), but
// ids now come from `@easel/shared`'s `generateId` (not a bespoke `c-<ts>-
// <rand>` uid) and identity from `lib/identity.ts`'s `getLocalUser`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CommentsFile } from '@easel/shared';
import { useComments } from './useComments.js';

const boardsApiMock = vi.hoisted(() => ({
  fetchComments: vi.fn(),
  saveComments: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => boardsApiMock);

const identityMock = vi.hoisted(() => ({
  getLocalUser: vi.fn(),
}));
vi.mock('../lib/identity.js', () => identityMock);

function emptyFile(): CommentsFile {
  return { comments: [] };
}

function fileWithOneComment(): CommentsFile {
  return {
    comments: [
      {
        id: 'comment1',
        target: { type: 'canvas', pos: { x: 10, y: 20 } },
        author: 'Ada',
        createdAt: '2024-01-01T00:00:00.000Z',
        text: 'hello',
        resolved: false,
        replies: [],
      },
    ],
  };
}

describe('useComments', () => {
  beforeEach(() => {
    boardsApiMock.fetchComments.mockReset().mockResolvedValue(emptyFile());
    boardsApiMock.saveComments.mockReset().mockResolvedValue(undefined);
    identityMock.getLocalUser.mockReset().mockReturnValue({ name: 'Ada', color: '#6366f1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads comments for the given slug via fetchComments', async () => {
    boardsApiMock.fetchComments.mockResolvedValue(fileWithOneComment());

    const { result } = renderHook(() => useComments('spend', { readonly: false }));

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));
    expect(boardsApiMock.fetchComments).toHaveBeenCalledWith('spend');
    expect(result.current.comments[0].text).toBe('hello');
  });

  it('addComment with a canvas target updates state and persists via saveComments', async () => {
    const { result } = renderHook(() => useComments('spend', { readonly: false }));
    await vi.waitFor(() => expect(boardsApiMock.fetchComments).toHaveBeenCalled());

    act(() => {
      result.current.addComment({ type: 'canvas', pos: { x: 5, y: 6 } }, 'a new comment');
    });

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));
    const added = result.current.comments[0];
    expect(added.target).toEqual({ type: 'canvas', pos: { x: 5, y: 6 } });
    expect(added.text).toBe('a new comment');
    expect(added.author).toBe('Ada');
    expect(added.replies).toEqual([]);
    expect(added.resolved).toBeFalsy();

    await vi.waitFor(() =>
      expect(boardsApiMock.saveComments).toHaveBeenCalledWith(
        'spend',
        expect.objectContaining({ comments: [expect.objectContaining({ text: 'a new comment' })] }),
      ),
    );
  });

  it('addComment with a node target persists the node target shape', async () => {
    const { result } = renderHook(() => useComments('spend', { readonly: false }));
    await vi.waitFor(() => expect(boardsApiMock.fetchComments).toHaveBeenCalled());

    act(() => {
      result.current.addComment(
        { type: 'node', nodeId: 'sticky1', offset: { x: 1, y: 2 } },
        'on a node',
      );
    });

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));
    expect(result.current.comments[0].target).toEqual({
      type: 'node',
      nodeId: 'sticky1',
      offset: { x: 1, y: 2 },
    });
  });

  it('generates comment ids that do not collide with existing ones', async () => {
    boardsApiMock.fetchComments.mockResolvedValue(fileWithOneComment());
    const { result } = renderHook(() => useComments('spend', { readonly: false }));
    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => {
      result.current.addComment({ type: 'canvas', pos: { x: 0, y: 0 } }, 'second');
    });

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(2));
    const ids = result.current.comments.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('addReply appends a reply to the target comment and persists', async () => {
    boardsApiMock.fetchComments.mockResolvedValue(fileWithOneComment());
    const { result } = renderHook(() => useComments('spend', { readonly: false }));
    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => {
      result.current.addReply('comment1', 'a reply');
    });

    await vi.waitFor(() => expect(result.current.comments[0].replies).toHaveLength(1));
    const reply = result.current.comments[0].replies[0];
    expect(reply.text).toBe('a reply');
    expect(reply.author).toBe('Ada');
    expect(boardsApiMock.saveComments).toHaveBeenCalledWith(
      'spend',
      expect.objectContaining({
        comments: [
          expect.objectContaining({ replies: [expect.objectContaining({ text: 'a reply' })] }),
        ],
      }),
    );
  });

  it('toggleResolved flips the resolved flag and persists', async () => {
    boardsApiMock.fetchComments.mockResolvedValue(fileWithOneComment());
    const { result } = renderHook(() => useComments('spend', { readonly: false }));
    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => {
      result.current.toggleResolved('comment1');
    });
    await vi.waitFor(() => expect(result.current.comments[0].resolved).toBe(true));

    act(() => {
      result.current.toggleResolved('comment1');
    });
    await vi.waitFor(() => expect(result.current.comments[0].resolved).toBe(false));

    expect(boardsApiMock.saveComments).toHaveBeenCalled();
  });

  it('deleteComment removes the comment and persists', async () => {
    boardsApiMock.fetchComments.mockResolvedValue(fileWithOneComment());
    const { result } = renderHook(() => useComments('spend', { readonly: false }));
    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => {
      result.current.deleteComment('comment1');
    });

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(0));
    expect(boardsApiMock.saveComments).toHaveBeenCalledWith('spend', { comments: [] });
  });

  it('refetches comments when the external-change signal fires', async () => {
    boardsApiMock.fetchComments.mockResolvedValueOnce(emptyFile());
    let externalChangeHandler: (() => void) | undefined;
    const onExternalChange = (cb: () => void) => {
      externalChangeHandler = cb;
    };

    const { result } = renderHook(() =>
      useComments('spend', { readonly: false, onExternalChange }),
    );
    await vi.waitFor(() => expect(result.current.comments).toHaveLength(0));

    boardsApiMock.fetchComments.mockResolvedValueOnce(fileWithOneComment());
    act(() => {
      externalChangeHandler?.();
    });

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));
    expect(boardsApiMock.fetchComments).toHaveBeenCalledTimes(2);
  });

  it('read-only mode loads comments but disables mutations', async () => {
    boardsApiMock.fetchComments.mockResolvedValue(fileWithOneComment());
    const { result } = renderHook(() => useComments('spend', { readonly: true }));

    await vi.waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => {
      result.current.addComment({ type: 'canvas', pos: { x: 0, y: 0 } }, 'nope');
      result.current.addReply('comment1', 'nope');
      result.current.toggleResolved('comment1');
      result.current.deleteComment('comment1');
    });

    // Nothing changed and nothing was persisted.
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0].replies).toHaveLength(0);
    expect(result.current.comments[0].resolved).toBeFalsy();
    expect(boardsApiMock.saveComments).not.toHaveBeenCalled();
  });

  it('does not fetch or expose mutations when slug is undefined', () => {
    const { result } = renderHook(() => useComments(undefined, { readonly: false }));
    expect(result.current.comments).toEqual([]);
    expect(boardsApiMock.fetchComments).not.toHaveBeenCalled();
  });
});
