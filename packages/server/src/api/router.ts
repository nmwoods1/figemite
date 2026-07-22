// ── HTTP API router ──────────────────────────────────────────────────────────
//
// Ported from the original prototype's `server.middlewares.use(...)` chain of
// `if (pathname === ... && req.method === ...)` blocks (vite.config.ts ~446-768)
// into a dispatch table + a single `createRequestHandler(ctx)` factory. This is
// the one function the composition layer (P1-T13) and the Phase-2 Vite
// middleware mount onto a real `http.Server`.
//
// Error mapping is centralised here (the legacy code repeated a per-block
// try/catch that mapped every failure to 400). This router wraps EVERY handler
// in one try/catch and maps by error type:
//   - LockedError            -> 409  (AI lock conflict)
//   - ValidationError / Zod  -> 400  (bad client input)
//   - NotFoundError          -> 404  (missing board/sub-board/snapshot)
//   - a repo "not found" read -> 404 (fallback: matched by message)
//   - anything else          -> 500  with a SAFE generic message — the real
//     error is never serialised to the client (no stack, no filesystem paths),
//     only logged-shaped intent. This closes the legacy leak where
//     `json({ error: String(err) }, ...)` echoed absolute paths and stack text
//     straight back to the caller.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BoardRepository } from '../repository/board-repo.js';
import type { SnapshotHistoryService } from '../services/snapshot-history.js';
import type { AiSessionManager } from '../services/ai-session.js';
import type { SseHub } from '../services/sse-hub.js';
import type { FileWatcher } from '../services/file-watcher.js';
import type { ServerConfig } from '../config.js';
import { sendError } from '../http/body.js';
import { LockedError, NotFoundError, ValidationError } from './errors.js';
import { handleListBoards, handleCreateBoard } from './handlers/boards.js';
import {
  handleGetBoard,
  handleSaveBoard,
  handleDeleteBoard,
  handleCreateSubBoard,
} from './handlers/board.js';
import {
  handleListDrafts,
  handleCreateDraft,
  handleRenameDraft,
  handleDiscardDraft,
} from './handlers/drafts.js';
import { handlePromoteDraft } from './handlers/promote.js';
import { handleAiBegin, handleAiEnd, handleAiStatus } from './handlers/ai.js';
import { handleEvents } from './handlers/events.js';
import { handleListHistory, handleReadHistoryVersion } from './handlers/history.js';
import { handleGetComments, handleSaveComments } from './handlers/comments.js';
import { handleGetTags, handleSaveTags } from './handlers/tags.js';
import { handleGetInstance } from './handlers/instance.js';

/**
 * Everything an endpoint handler needs. Assembled by the composition layer
 * (P1-T13) from live service instances and passed to `createRequestHandler`.
 * `ai.onChange` should already be wired to `sse` (see `makeAiBroadcast`) so lock
 * transitions broadcast; the router does not wire it.
 */
/**
 * The narrow slice of `YjsWebsocketService` the promote handler needs: push new
 * content into a live prod room so connected browsers converge. Kept as an
 * interface (not the concrete service) so the router/handlers don't depend on
 * the whole Yjs stack and tests can supply a fake.
 */
export interface RoomContentReplacer {
  replaceRoomContent(
    slug: string,
    subPath: string[],
    snapshot: { nodes: import('@figemite/shared').BoardNode[]; edges: import('@figemite/shared').BoardEdge[] },
    draftId?: string,
  ): boolean;
}

/**
 * This instance's advertised identity, surfaced by `GET /api/instance` and the
 * mDNS TXT record. `url` is mutable: it starts empty and is filled in by
 * `ServerHandle.advertise(...)` once the HTTP server is bound and its real URL
 * is known (see `startServer`).
 */
export interface InstanceIdentity {
  id: string;
  name: string;
  version: string;
  url: string;
}

export interface RequestContext {
  repo: BoardRepository;
  history: SnapshotHistoryService;
  ai: AiSessionManager;
  sse: SseHub;
  watcher: FileWatcher;
  config: ServerConfig;
  /** This server instance's advertised identity (see `InstanceIdentity`). */
  instance: InstanceIdentity;
  /** Live-room content replacement, used by draft promotion. */
  yjs: RoomContentReplacer;
}

type Handler = (
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

// The dispatch table: `${METHOD} ${pathname}` -> handler. An unmatched key 404s.
const ROUTES: Record<string, Handler> = {
  'GET /api/instance': handleGetInstance,
  'GET /api/boards': handleListBoards,
  'POST /api/boards': handleCreateBoard,
  'GET /api/board': handleGetBoard,
  'POST /api/board': handleSaveBoard,
  'DELETE /api/board': handleDeleteBoard,
  'POST /api/board/promote': handlePromoteDraft,
  'POST /api/create': handleCreateSubBoard,
  'GET /api/drafts': handleListDrafts,
  'POST /api/drafts': handleCreateDraft,
  'PATCH /api/drafts': handleRenameDraft,
  'DELETE /api/drafts': handleDiscardDraft,
  'POST /api/ai/begin': handleAiBegin,
  'POST /api/ai/end': handleAiEnd,
  'GET /api/ai/status': handleAiStatus,
  'GET /api/events': handleEvents,
  'GET /api/history': handleListHistory,
  'GET /api/history/version': handleReadHistoryVersion,
  'GET /api/comments': handleGetComments,
  'POST /api/comments': handleSaveComments,
  'GET /api/tags': handleGetTags,
  'POST /api/tags': handleSaveTags,
};

/** Extracts the pathname (no query string) from a request url. */
function pathnameOf(req: IncomingMessage): string {
  const url = req.url ?? '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Maps a thrown error to an HTTP status + safe client-facing message. */
function classifyError(err: unknown): { status: number; message: string } {
  if (err instanceof LockedError) return { status: 409, message: err.message || 'locked' };
  if (err instanceof NotFoundError) return { status: 404, message: err.message || 'not_found' };
  if (err instanceof ValidationError) return { status: 400, message: err.message };

  // A raw ZodError (defensive — most validation is already wrapped by the
  // shared parse helpers into plain Errors, but a direct schema call could
  // surface one). Detect by name to avoid importing zod here.
  if (err instanceof Error && err.name === 'ZodError') {
    return { status: 400, message: 'Invalid request payload' };
  }

  // Body helpers throw plain Errors for malformed/oversized/empty JSON — those
  // are client errors (400), not server faults.
  if (
    err instanceof Error &&
    /malformed json|empty request body|request body too large/i.test(err.message)
  ) {
    return { status: 400, message: err.message };
  }

  // The repository throws "Board not found: ..." / "Snapshot not found: ..."
  // (message includes an absolute path). Map to 404 but DO NOT leak the path.
  if (err instanceof Error && /not found/i.test(err.message)) {
    return { status: 404, message: 'not_found' };
  }

  // Anything else is an unexpected server fault. Never echo the real message
  // (it can contain absolute paths / stack text) — return a fixed safe string.
  return { status: 500, message: 'Internal server error' };
}

/**
 * Builds the `(req, res) => void` request handler. This is the sole export the
 * composition layer and the Phase-2 Vite middleware mount. Unmatched routes 404;
 * every handler runs inside one try/catch that maps thrown errors to statuses
 * via `classifyError` — but only if the response hasn't already started (SSE
 * has written headers), in which case the error is swallowed (the connection is
 * simply closed by the caller/stream).
 */
export function createRequestHandler(
  ctx: RequestContext,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const key = `${req.method ?? 'GET'} ${pathnameOf(req)}`;
    const handler = ROUTES[key];
    if (!handler) {
      sendError(res, 404, 'not_found');
      return;
    }

    const onError = (err: unknown): void => {
      if (res.headersSent) {
        // A streaming response (SSE) already committed headers — we can't send
        // a JSON error now. End the response so the socket doesn't hang.
        try {
          res.end();
        } catch {
          /* already destroyed */
        }
        return;
      }
      const { status, message } = classifyError(err);
      sendError(res, status, message);
    };

    try {
      const result = handler(ctx, req, res);
      if (result && typeof result.then === 'function') {
        result.catch(onError);
      }
    } catch (err) {
      onError(err);
    }
  };
}
