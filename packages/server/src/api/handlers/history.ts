// ── /api/history handlers ────────────────────────────────────────────────────
//
// GET /api/history?board=&path=          — list snapshot metadata (newest-first).
// GET /api/history/version?board=&path=&id= — read one snapshot's raw JSON.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, PathSegmentSchema } from '@easel/shared';
import { getQuery, parsePathParam, sendJson } from '../../http/body.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

function requireSlug(query: URLSearchParams): string {
  const slug = query.get('board') ?? '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  return slug;
}

/** Rejects any traversal-shaped path segment with a safe 400 (see board.ts). */
function requireSubPath(subPath: string[]): string[] {
  for (const seg of subPath) {
    if (!PathSegmentSchema.safeParse(seg).success) {
      throw new ValidationError('Invalid sub-board path segment');
    }
  }
  return subPath;
}

/** GET /api/history — `{ versions: SnapshotMeta[] }`. */
export function handleListHistory(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = requireSlug(query);
  const subPath = requireSubPath(parsePathParam(query));
  const versions = ctx.history.list(slug, subPath);
  sendJson(res, 200, { versions });
}

/** GET /api/history/version — returns the snapshot's board JSON, or 404. */
export function handleReadHistoryVersion(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = requireSlug(query);
  const subPath = requireSubPath(parsePathParam(query));
  const id = query.get('id') ?? '';
  if (!id) {
    throw new ValidationError('Missing id parameter');
  }
  // `history.read` throws exactly two message-typed errors we can classify as
  // client errors: "Snapshot not found: ..." (ENOENT -> 404) and "Invalid
  // snapshot id ..." (bad id shape -> 400). ANY other error (e.g. an EACCES /
  // EIO fs fault whose message can contain an absolute path) is re-thrown RAW
  // so the router's classifyError sanitizes it to a 500 "Internal server error"
  // — we never echo an arbitrary fs error message back to the client.
  let raw: string;
  try {
    raw = ctx.history.read(slug, subPath, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/^Snapshot not found/.test(message)) {
      throw new NotFoundError('Snapshot not found');
    }
    if (/^Invalid snapshot id/.test(message)) {
      throw new ValidationError('Invalid snapshot id');
    }
    throw err; // unknown fault -> sanitized 500 (no message leak)
  }
  // The snapshot content is already canonical board JSON on disk — pass it
  // through verbatim rather than re-parsing/re-serialising.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(raw);
}
