// ── /api/comments handlers ───────────────────────────────────────────────────
//
// GET  /api/comments?board=&draft=  — read a version's comments.json (missing ->
//                                     `{ comments: [] }`). `draft` omitted = Live.
// POST /api/comments                — validate + write a version's comments.json
//                                     (body `{ board, draft?, data }`).
//
// Comments are stored separately from board.json (so the AI loop can rewrite
// the board wholesale without touching human discussion) and are NOT snapshotted
// into board history. They are version-scoped: prod's `<slug>/comments.json`
// vs. a draft's `<slug>/.drafts/<draftId>/comments.json` (see repository/paths.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, PathSegmentSchema, parseCommentsFile } from '@figemite/shared';
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

/**
 * Optional draft scope (undefined = prod/Live). Accepts a query-string value or
 * a JSON-body value; `null`/`''`/absent -> undefined. Mirrors the same helper in
 * handlers/history.ts so comments scope by version exactly like history does.
 */
function optionalDraftId(raw: unknown): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !PathSegmentSchema.safeParse(raw).success) {
    throw new ValidationError('Invalid draft id');
  }
  return raw;
}

/** GET /api/comments — the board version's comments file (`?board=&draft=`). */
export function handleGetComments(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = requireSlug(query.get('board') ?? '');
  const draftId = optionalDraftId(query.get('draft'));
  sendJson(res, 200, readComments(ctx.config.boardsRoot, slug, draftId));
}

/** POST /api/comments — body `{ board, draft?, data }`. Validates via parseCommentsFile. */
export async function handleSaveComments(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as { board?: unknown; draft?: unknown; data?: unknown };
  const slug = requireSlug(body.board);
  const draftId = optionalDraftId(body.draft);
  let file;
  try {
    file = parseCommentsFile(body.data);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }
  writeComments(ctx.config.boardsRoot, slug, file, draftId);
  sendJson(res, 200, { ok: true });
}
