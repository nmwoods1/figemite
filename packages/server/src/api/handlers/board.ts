// ── /api/board + /api/create handlers ────────────────────────────────────────
//
// GET    /api/board?board=&path=  — read a board/sub-board (validated+migrated).
// POST   /api/board               — save a board through the single write funnel.
// DELETE /api/board?board=&path=  — delete a sub-board (and descendants). An
//   empty path (root) is REJECTED with 400 — deleting an entire board over the
//   LAN API would be irreversible data loss (board.json, every sub-board,
//   comments, tags, and all history), so the API refuses it. Legacy refused it
//   too. (The repo primitive `BoardRepository.delete([])` can still clear a
//   board for admin/tooling; the API just doesn't expose that.)
// POST   /api/create              — seed a new sub-board file if absent.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SlugSchema,
  PathSegmentSchema,
  emptyBoard,
  parseBoardFile,
  type BoardFile,
} from '@figemite/shared';
import { getQuery, parsePathParam, readJsonBody, sendJson } from '../../http/body.js';
import { persistBoard } from '../persist.js';
import { LockedError, NotFoundError, ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

/** Validates and returns the `board` slug query param (throws ValidationError). */
function requireSlug(query: URLSearchParams): string {
  const slug = query.get('board') ?? '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  return slug;
}

/**
 * Validates every sub-board path segment against the shared id grammar, as a
 * 400 (client error) — BEFORE the repo/path layer would throw the same rejection
 * as a generic Error (which the router would otherwise map to 500). Returns the
 * segments unchanged. Rejects with a safe message that does NOT echo the
 * offending segment (which could contain traversal/path text).
 */
function requireSubPath(subPath: string[]): string[] {
  for (const seg of subPath) {
    if (!PathSegmentSchema.safeParse(seg).success) {
      throw new ValidationError('Invalid sub-board path segment');
    }
  }
  return subPath;
}

/**
 * Validates an optional draft id (from a query param or request body). Returns
 * `undefined` when absent (= prod), or throws a 400 for a malformed value.
 */
function optionalDraftId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !PathSegmentSchema.safeParse(raw).success) {
    throw new ValidationError('Invalid draft id');
  }
  return raw;
}

/** GET /api/board — returns the board JSON, or 404 if missing. */
export function handleGetBoard(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = requireSlug(query);
  const subPath = requireSubPath(parsePathParam(query));
  const draftId = optionalDraftId(query.get('draft'));
  if (!ctx.repo.exists(slug, subPath, draftId)) {
    throw new NotFoundError('not_found');
  }
  // `read` validates + migrates; a corrupt file throws and the router maps it
  // to 500 with a safe message.
  const board = ctx.repo.read(slug, subPath, draftId);
  sendJson(res, 200, board);
}

/** POST /api/board — save a board. Body `{ board, path?, data }`. 409 if locked. */
export async function handleSaveBoard(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as { board?: unknown; path?: unknown; data?: unknown };
  const slug = typeof body.board === 'string' ? body.board : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid board: ${JSON.stringify(slug)}`);
  }
  const subPath = requireSubPath(Array.isArray(body.path) ? (body.path as string[]) : []);

  if (ctx.ai.isLocked(slug, subPath)) {
    throw new LockedError('locked');
  }

  // Validate the payload BEFORE writing — an invalid board is a 400, and never
  // reaches the disk. `parseBoardFile` migrates legacy payloads too.
  let data: BoardFile;
  try {
    data = parseBoardFile(body.data);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }

  persistBoard(ctx, slug, subPath, data, 'save');
  sendJson(res, 200, { ok: true });
}

/**
 * DELETE /api/board — delete a sub-board and its descendants. Rejects an empty
 * path (root board) with 400: wiping a whole board over the API is irreversible
 * data loss and is not exposed here (see module doc). Returns the relative
 * filenames removed as `{ ok: true, deleted }` (legacy shape).
 */
export function handleDeleteBoard(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = requireSlug(query);
  const subPath = requireSubPath(parsePathParam(query));
  if (subPath.length === 0) {
    throw new ValidationError('Cannot delete root board');
  }
  const deleted = ctx.repo.delete(slug, subPath);
  sendJson(res, 200, { ok: true, deleted });
}

/** POST /api/create — seed a new sub-board file if it doesn't already exist. */
export async function handleCreateSubBoard(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    board?: unknown;
    path?: unknown;
    label?: unknown;
    draft?: unknown;
  };
  const slug = typeof body.board === 'string' ? body.board : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid board: ${JSON.stringify(slug)}`);
  }
  const segments = requireSubPath(Array.isArray(body.path) ? (body.path as string[]) : []);
  if (segments.length === 0) {
    throw new ValidationError('path must have at least one segment');
  }
  const draftId = optionalDraftId(body.draft);

  if (ctx.repo.exists(slug, segments, draftId)) {
    sendJson(res, 200, { ok: true, existed: true });
    return;
  }

  const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
  const label = rawLabel || segments[segments.length - 1];
  // Route the seed through the funnel so it snapshots + suppresses like any
  // other write. `emptyBoard` produces a valid, canonical board.
  persistBoard(ctx, slug, segments, emptyBoard(label), 'save', draftId);
  sendJson(res, 200, { ok: true, existed: false });
}
