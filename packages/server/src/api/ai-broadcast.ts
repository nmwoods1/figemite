// ── AI lock-state → SSE broadcast bridge ─────────────────────────────────────
//
// `AiSessionManager` is transport-agnostic: it reports every begin/end/auto-end
// transition through an `onChange(key, state)` callback and knows nothing about
// SSE. This module builds the callback that turns those transitions into SSE
// frames, so composition (P1-T13) can wire it at construction:
//
//   const sse = new SseHub({});
//   const repo = new BoardRepository(root);
//   const ai = new AiSessionManager({ onChange: makeAiBroadcast(sse, repo) });
//
// It is the SINGLE broadcaster of `locked` / `unlocked` frames, covering all
// three transition sources uniformly — `POST /api/ai/begin`, `POST /api/ai/end`,
// and the auto-end safety timer (which has no HTTP handler). Because every
// transition flows through `onChange`, the HTTP handlers themselves never
// broadcast lock state; this is what prevents a double `unlocked` on an
// explicit end (handler + timer) — see the ai handlers module doc.
//
// Frame payloads:
//   - locked:   `{ epoch }`
//   - unlocked: `{ epoch, board }` — the board JSON is read fresh from disk so
//     reconnecting clients get the post-AI state in the same frame. If the
//     board can't be read (e.g. it was deleted), `board` is omitted rather than
//     failing the broadcast.

import type { AiSessionState } from '../services/ai-session.js';
import type { SseHub } from '../services/sse-hub.js';
import type { BoardRepository } from '../repository/board-repo.js';

/** The `read`-only slice of the repository the bridge needs. */
interface BoardReader {
  read: BoardRepository['read'];
  exists: BoardRepository['exists'];
}

/**
 * Decodes a `sessionKey` back into `{ slug, subPath, draftId? }`. The key format
 * (`session-key.ts`) is `<slug>` for the root, `<slug>|<seg1>.<seg2>` for a
 * sub-board, and a `<draftId>~` prefix when the key is scoped to a draft. A
 * slug/segment/draftId can never contain `~`, `|`, or `.` (the id grammar is
 * `[A-Za-z0-9_-]+`), so these splits are unambiguous.
 */
export function decodeSessionKey(key: string): {
  slug: string;
  subPath: string[];
  draftId?: string;
} {
  let draftId: string | undefined;
  let rest = key;
  const tilde = key.indexOf('~');
  if (tilde !== -1) {
    draftId = key.slice(0, tilde);
    rest = key.slice(tilde + 1);
  }
  const pipe = rest.indexOf('|');
  if (pipe === -1) return { slug: rest, subPath: [], draftId };
  const slug = rest.slice(0, pipe);
  const sub = rest.slice(pipe + 1);
  return { slug, subPath: sub ? sub.split('.') : [], draftId };
}

/**
 * Builds the `onChange` callback for `AiSessionManager` that broadcasts lock
 * transitions over `sse`. On unlock, reads the current board via `repo` and
 * includes it in the frame.
 */
export function makeAiBroadcast(
  sse: SseHub,
  repo: BoardReader,
): (key: string, state: AiSessionState) => void {
  return (key, state) => {
    const { slug, subPath, draftId } = decodeSessionKey(key);
    if (state.locked) {
      sse.broadcast(slug, subPath, 'locked', { epoch: state.epoch }, draftId);
      return;
    }
    let board: unknown;
    try {
      if (repo.exists(slug, subPath, draftId)) board = repo.read(slug, subPath, draftId);
    } catch {
      board = undefined; // unreadable/corrupt — broadcast the unlock without it
    }
    sse.broadcast(
      slug,
      subPath,
      'unlocked',
      board === undefined ? { epoch: state.epoch } : { epoch: state.epoch, board },
      draftId,
    );
  };
}
