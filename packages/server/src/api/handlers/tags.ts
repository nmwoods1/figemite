// ── /api/tags handlers ───────────────────────────────────────────────────────
//
// GET  /api/tags?board=  — read tags.json (missing -> `{ tags: [] }`).
// POST /api/tags         — validate + write tags.json.
//
// Tags are stored separately from board.json and are NOT snapshotted into board
// history — matching legacy.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, parseTagsFile } from '@figemite/shared';
import { getQuery, readJsonBody, sendJson } from '../../http/body.js';
import { readTags, writeTags } from '../../repository/tags-repo.js';
import { ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

function requireSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  return slug;
}

/** GET /api/tags — `{ tags: string[] }`. */
export function handleGetTags(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const slug = requireSlug(getQuery(req).get('board') ?? '');
  sendJson(res, 200, readTags(ctx.config.boardsRoot, slug));
}

/**
 * POST /api/tags — body `{ board, tags }`. Validates via parseTagsFile. Accepts
 * the legacy `{ board, tags: string[] }` shape; the `tags` array is wrapped into
 * the `{ tags }` file shape the schema expects.
 */
export async function handleSaveTags(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as { board?: unknown; tags?: unknown };
  const slug = requireSlug(body.board);
  let file;
  try {
    file = parseTagsFile({ tags: body.tags });
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }
  writeTags(ctx.config.boardsRoot, slug, file);
  sendJson(res, 200, { ok: true });
}
