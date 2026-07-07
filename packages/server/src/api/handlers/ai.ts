// ── /api/ai/* handlers ───────────────────────────────────────────────────────
//
// POST /api/ai/begin  — snapshot pre-AI state, engage the lock.
// POST /api/ai/end    — release the lock, snapshot the AI result.
// GET  /api/ai/status — the reconnect-reconciliation endpoint (NEW).
//
// Lock-state SSE broadcasts (`locked` / `unlocked`) are NOT emitted here — they
// flow through the `AiSessionManager.onChange` bridge (`makeAiBroadcast`) so
// that the auto-end safety timer, which has no HTTP handler, broadcasts through
// the exact same path. This is deliberate: emitting from the handlers too would
// double-broadcast on an explicit end (handler + the transition callback).
//
// Deviation from legacy: the legacy `/api/ai/begin` broadcast a `flush` event,
// slept 500ms to let open tabs push a final autosave, then snapshotted `preai`.
// That browser-flush dance is dropped here — this server has no notion of a
// pending browser autosave to flush (autosave is the client's concern and, in
// the new architecture, edits land via Yjs, not a debounced POST). We snapshot
// the current disk state directly as the pre-AI restore point.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, PathSegmentSchema } from '@figemite/shared';
import { getQuery, parsePathParam, readJsonBody, sendJson } from '../../http/body.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

/** Rejects any traversal-shaped path segment with a safe 400 (see board.ts). */
function requireSubPath(subPath: string[]): string[] {
  for (const seg of subPath) {
    if (!PathSegmentSchema.safeParse(seg).success) {
      throw new ValidationError('Invalid sub-board path segment');
    }
  }
  return subPath;
}

/** Reads `{ board, path? }` from a JSON body, validating the slug and path. */
async function readBoardRef(req: IncomingMessage): Promise<{ slug: string; subPath: string[] }> {
  const body = (await readJsonBody(req)) as { board?: unknown; path?: unknown };
  const slug = typeof body.board === 'string' ? body.board : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid board: ${JSON.stringify(slug)}`);
  }
  const subPath = requireSubPath(Array.isArray(body.path) ? (body.path as string[]) : []);
  return { slug, subPath };
}

/** POST /api/ai/begin — snapshot preai (if the board exists), then lock. */
export async function handleAiBegin(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { slug, subPath } = await readBoardRef(req);
  // Snapshot the current human state as the pre-AI restore point — only if the
  // board actually exists on disk (snapshot() itself is a no-op for a missing
  // file, but the exists check keeps intent explicit).
  if (ctx.repo.exists(slug, subPath)) {
    ctx.history.snapshot(slug, subPath, 'preai');
  }
  ctx.ai.begin(slug, subPath); // fires onChange -> SSE `locked`
  const { epoch } = ctx.ai.status(slug, subPath);
  sendJson(res, 200, { locked: true, epoch });
}

/** POST /api/ai/end — unlock, snapshot the AI result, return the board. */
export async function handleAiEnd(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { slug, subPath } = await readBoardRef(req);
  ctx.ai.end(slug, subPath); // fires onChange -> SSE `unlocked` (with board)
  ctx.history.snapshot(slug, subPath, 'ai');
  if (!ctx.repo.exists(slug, subPath)) {
    throw new NotFoundError('not_found');
  }
  const board = ctx.repo.read(slug, subPath);
  sendJson(res, 200, board);
}

/** GET /api/ai/status?board=&path= → `{ locked, epoch }`. */
export function handleAiStatus(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = query.get('board') ?? '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  const subPath = requireSubPath(parsePathParam(query));
  sendJson(res, 200, ctx.ai.status(slug, subPath));
}
