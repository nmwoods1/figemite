// ── /api/comments handlers ───────────────────────────────────────────────────
//
// GET  /api/comments?board=  — read comments.json (missing -> `{ comments: [] }`).
// POST /api/comments         — validate + write comments.json.
//
// Comments are stored separately from board.json (so the AI loop can rewrite
// the board wholesale without touching human discussion) and are NOT snapshotted
// into board history — matching legacy.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, parseCommentsFile } from '@easel/shared';
import { getQuery, readJsonBody, sendJson } from '../../http/body.js';
import { readComments, writeComments } from '../../repository/comments-repo.js';
import { ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

function requireSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  return slug;
}

/** GET /api/comments — the board's comments file. */
export function handleGetComments(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const slug = requireSlug(getQuery(req).get('board') ?? '');
  sendJson(res, 200, readComments(ctx.config.boardsRoot, slug));
}

/** POST /api/comments — body `{ board, data }`. Validates via parseCommentsFile. */
export async function handleSaveComments(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as { board?: unknown; data?: unknown };
  const slug = requireSlug(body.board);
  let file;
  try {
    file = parseCommentsFile(body.data);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }
  writeComments(ctx.config.boardsRoot, slug, file);
  sendJson(res, 200, { ok: true });
}
