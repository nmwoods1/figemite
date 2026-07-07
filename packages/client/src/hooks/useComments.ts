// ── useComments: comments.json state + mutations ─────────────────────────────
//
// Comments live in boards/<slug>/comments.json — a file SEPARATE from the Yjs
// board doc (@easel/shared's model/comments.ts module doc: "the AI loop can
// rewrite board.json wholesale without touching human discussion"). They do
// NOT sync via Yjs; this hook fetches the file on mount via `lib/boards-api.ts`'s
// `fetchComments` and persists every mutation immediately via `saveComments`
// (save-on-each-change, simplest correct option for a low-frequency, file-based
// resource — no debouncing needed).
//
// Ported mutation semantics from the legacy figmalade prototype's `src/lib/
// comment-io.ts` (addComment/addReply/toggleResolved/deleteComment), with two
// deviations:
//   - ids come from `@easel/shared`'s `generateId(prefix, existingIds)` (this
//     codebase's one id-generation convention — see board-io.ts) rather than
//     the legacy's bespoke `c-<timestamp>-<rand>` uid.
//   - author identity comes from `lib/identity.ts`'s `getLocalUser()` (the
//     SAME stored name that backs realtime presence in this rewrite) rather
//     than a comments-only `getStoredAuthor`.
//
// `onExternalChange` (subscription form, not a boolean flag) lets a caller —
// typically `useAiLock`'s own `onExternalChange` callback, EditableCanvas's
// existing SSE subscription — trigger a re-fetch when the server reports a
// raw on-disk change. This hook doesn't open its own SSE connection; it just
// exposes a place to plug in whatever "something changed externally" signal
// the caller already has.
//
// Read-only mode: `fetchComments` still runs (so a read-only pane can display
// existing threads — comments are view-only in that mode, never write-only),
// but every mutation becomes a no-op, mirroring `board-store.ts`'s per-method
// readonly guard.

import { useCallback, useEffect, useRef, useState } from 'react';
import { generateId } from '@easel/shared';
import type { BoardComment, CommentTarget, CommentsFile } from '@easel/shared';
import { fetchComments, saveComments } from '../lib/boards-api.js';
import { getLocalUser } from '../lib/identity.js';

export interface UseCommentsOptions {
  /** True in read-only mode — disables every mutation below (load-only). */
  readonly: boolean;
  /** Registers a callback to invoke when comments should be re-fetched (e.g.
   * wired to `useAiLock`'s `onExternalChange`). Called once per hook
   * instance; the callback identity may change across renders. */
  onExternalChange?: (cb: () => void) => void;
}

export interface UseComments {
  comments: BoardComment[];
  /** Places a new top-level comment at `target` with the given `text`. No-op
   * in read-only mode. */
  addComment(target: CommentTarget, text: string): void;
  /** Appends a reply to the comment `commentId`. No-op in read-only mode. */
  addReply(commentId: string, text: string): void;
  /** Flips the `resolved` flag on the comment `commentId`. No-op in read-only mode. */
  toggleResolved(commentId: string): void;
  /** Removes the comment `commentId` entirely (with its replies). No-op in read-only mode. */
  deleteComment(commentId: string): void;
}

function allCommentIds(file: CommentsFile): Set<string> {
  const ids = new Set<string>();
  for (const c of file.comments) {
    ids.add(c.id);
    for (const r of c.replies) ids.add(r.id);
  }
  return ids;
}

export function useComments(slug: string | undefined, opts: UseCommentsOptions): UseComments {
  const [file, setFile] = useState<CommentsFile>({ comments: [] });

  // Read through a ref so `mutate` always persists the LATEST state without
  // needing to be recreated every time `file` changes (same technique as
  // board-store.ts's mutation methods reading the cached `snapshot`).
  const fileRef = useRef(file);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  const load = useCallback(() => {
    if (!slug) return;
    fetchComments(slug).then((next) => setFile(next));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!slug || !opts.onExternalChange) return;
    opts.onExternalChange(load);
    // `opts.onExternalChange`/`load` are re-registered whenever `slug` changes
    // (a fresh subscription target) — a caller that always passes the same
    // stable subscribe function is the expected shape (mirrors useAiLock's
    // own single-registration contract).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registering `opts.onExternalChange` on every render would re-subscribe repeatedly for callers (e.g. useAiLock) that construct a fresh subscribe function each render; `slug` is the intentional re-registration trigger.
  }, [slug]);

  const mutate = useCallback(
    (updater: (prev: CommentsFile) => CommentsFile) => {
      if (!slug || opts.readonly) return;
      const next = updater(fileRef.current);
      setFile(next);
      void saveComments(slug, next);
    },
    [slug, opts.readonly],
  );

  const addComment = useCallback(
    (target: CommentTarget, text: string) => {
      mutate((prev) => {
        const id = generateId('comment', allCommentIds(prev));
        const user = getLocalUser();
        const comment: BoardComment = {
          id,
          target,
          author: user.name,
          createdAt: new Date().toISOString(),
          text,
          resolved: false,
          replies: [],
        };
        return { comments: [...prev.comments, comment] };
      });
    },
    [mutate],
  );

  const addReply = useCallback(
    (commentId: string, text: string) => {
      mutate((prev) => {
        const id = generateId('reply', allCommentIds(prev));
        const user = getLocalUser();
        const reply = {
          id,
          author: user.name,
          createdAt: new Date().toISOString(),
          text,
        };
        return {
          comments: prev.comments.map((c) =>
            c.id === commentId ? { ...c, replies: [...c.replies, reply] } : c,
          ),
        };
      });
    },
    [mutate],
  );

  const toggleResolved = useCallback(
    (commentId: string) => {
      mutate((prev) => ({
        comments: prev.comments.map((c) =>
          c.id === commentId ? { ...c, resolved: !c.resolved } : c,
        ),
      }));
    },
    [mutate],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      mutate((prev) => ({ comments: prev.comments.filter((c) => c.id !== commentId) }));
    },
    [mutate],
  );

  return {
    comments: file.comments,
    addComment,
    addReply,
    toggleResolved,
    deleteComment,
  };
}
