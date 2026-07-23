// ── /api/drafts handlers ─────────────────────────────────────────────────────
//
// GET    /api/drafts?board=        — list a board's drafts (id, title, provenance).
// POST   /api/drafts               — create a draft (copy current prod into a
//                                    new .drafts/<id>/ and index it). Body
//                                    `{ board, title?, createdBy?, fromVersion? }`.
//                                    `fromVersion` seeds the root board from a
//                                    history snapshot instead of current Live.
// PATCH  /api/drafts               — rename a draft (update its title in the
//                                    index). Body `{ board, draft, title }`.
// DELETE /api/drafts?board=&draft= — discard a draft (delete its dir + de-index).
//
// A draft is a full board copy nested at boards/<slug>/.drafts/<id>/; the human-
// owned drafts.json sidecar (drafts-repo.ts) indexes titles + provenance. There
// is deliberately NO promote handler here — promotion lives in promote.ts and
// has no MCP tool, which is what keeps "approve" human-only (see promote.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SlugSchema,
  PathSegmentSchema,
  generateId,
  deserialise,
  type BoardFile,
  type DraftMeta,
} from '@figemite/shared';
import { getQuery, readJsonBody, sendJson } from '../../http/body.js';
import { readDrafts, writeDrafts } from '../../repository/drafts-repo.js';
import { readComments, writeComments } from '../../repository/comments-repo.js';
import { persistBoard } from '../persist.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

function requireSlug(raw: unknown): string {
  const slug = typeof raw === 'string' ? raw : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  return slug;
}

function requireDraftId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw : '';
  if (!PathSegmentSchema.safeParse(id).success) {
    throw new ValidationError(`Invalid or missing draft id: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Reconciles the drafts.json index with the drafts that physically exist under
 * `.drafts/`. Physical existence is the source of truth for *which* drafts are
 * real; the sidecar carries metadata (title, provenance). Drops index entries
 * whose dir is gone, and surfaces any physical draft missing from the index
 * with a fallback title (self-healing against a manual dir add / partial write).
 */
function reconcileDrafts(ctx: RequestContext, slug: string): DraftMeta[] {
  const indexed = new Map(readDrafts(ctx.config.boardsRoot, slug).drafts.map((d) => [d.id, d]));
  const physical = ctx.repo.listDrafts(slug);
  return physical.map(
    (id) =>
      indexed.get(id) ?? { id, title: id, createdBy: 'human', createdAt: new Date(0).toISOString() },
  );
}

/**
 * The default draft number: one past the largest existing `Draft #N`, so
 * auto-generated titles stay unique and only climb — even after a discard.
 * (The old count-based scheme repeated a number after a discard: discard #1 of
 * {#1, #2} left one draft named "Draft #2", and the next draft became "Draft
 * #2" again.) Titles that aren't the exact `Draft #<n>` shape are ignored, so a
 * user's custom names never perturb the sequence.
 */
function nextDraftNumber(existingTitles: string[]): number {
  let max = 0;
  for (const title of existingTitles) {
    const m = /^Draft #(\d+)$/.exec(title.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Reads a history snapshot (of the root board) as a validated `BoardFile`, used
 * to seed a draft forked from an old version. Maps the two message-typed errors
 * `history.read` throws to client errors, exactly like `handleReadHistoryVersion`.
 */
function readVersionBoard(ctx: RequestContext, slug: string, versionId: string): BoardFile {
  try {
    return deserialise(ctx.history.read(slug, [], versionId));
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/^Snapshot not found/.test(message)) throw new NotFoundError('Snapshot not found');
    if (/^Invalid snapshot id/.test(message)) throw new ValidationError('Invalid snapshot id');
    throw err;
  }
}

/** GET /api/drafts?board=slug → `{ drafts: DraftMeta[] }`. */
export function handleListDrafts(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const slug = requireSlug(getQuery(req).get('board'));
  sendJson(res, 200, { drafts: reconcileDrafts(ctx, slug) });
}

/** POST /api/drafts — create a new draft by copying current prod. */
export async function handleCreateDraft(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    board?: unknown;
    title?: unknown;
    createdBy?: unknown;
    fromVersion?: unknown;
  };
  const slug = requireSlug(body.board);
  if (!ctx.repo.exists(slug, [])) {
    throw new NotFoundError('not_found');
  }

  const createdBy = body.createdBy === 'agent' ? 'agent' : 'human';
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  // When set, the caller is forking an OLD root version they're viewing in
  // history (rather than current Live) — see the root-board seed below.
  const fromVersion = typeof body.fromVersion === 'string' ? body.fromVersion : undefined;

  // Default title: one past the largest existing "Draft #N" so auto-names stay
  // unique and monotonic (see `nextDraftNumber`). Computed against the CURRENT
  // drafts, before this one's dir is created below.
  const nextNumber = nextDraftNumber(reconcileDrafts(ctx, slug).map((d) => d.title));

  // A fresh id, unique against both the index and any physical draft dir.
  const existing = new Set<string>([
    ...ctx.repo.listDrafts(slug),
    ...readDrafts(ctx.config.boardsRoot, slug).drafts.map((d) => d.id),
  ]);
  const draftId = generateId('draft', existing);

  // Copy the board tree into the draft, each write routed through the single
  // funnel so the draft gets its own history + suppression like a normal write.
  // The ROOT board is seeded from current Live by default, or from the given
  // `fromVersion` history snapshot when forking an old version. Sub-boards (and
  // comments, below) always come from current Live — matching how single-board
  // history Restore replaces only the root doc, not the sub-board tree.
  const rootBoard = fromVersion !== undefined ? readVersionBoard(ctx, slug, fromVersion) : ctx.repo.read(slug, []);
  persistBoard(ctx, slug, [], rootBoard, 'save', draftId);
  for (const subPath of ctx.repo.listSubBoardPaths(slug)) {
    persistBoard(ctx, slug, subPath, ctx.repo.read(slug, subPath), 'save', draftId);
  }

  // Snapshot Live's comment thread into the draft so it opens as a faithful fork
  // (matching how the board content above is copied). From here the two threads
  // are independent: editing the draft's comments never touches Live's.
  writeComments(ctx.config.boardsRoot, slug, readComments(ctx.config.boardsRoot, slug), draftId);

  const meta: DraftMeta = {
    id: draftId,
    title: rawTitle || `Draft #${nextNumber}`,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  const current = readDrafts(ctx.config.boardsRoot, slug).drafts.filter((d) => d.id !== draftId);
  writeDrafts(ctx.config.boardsRoot, slug, { drafts: [...current, meta] });

  sendJson(res, 200, { ok: true, draftId, draft: meta });
}

/** PATCH /api/drafts — rename a draft. Body `{ board, draft, title }`.
 *
 * Human-owned, like create/discard/promote — updates only the draft's title in
 * the drafts.json index (never its content). Writes back the reconciled index
 * so a physical-but-unindexed draft self-heals into a real entry on rename. */
export async function handleRenameDraft(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as { board?: unknown; draft?: unknown; title?: unknown };
  const slug = requireSlug(body.board);
  const draftId = requireDraftId(body.draft);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    throw new ValidationError('Draft title must not be empty');
  }

  if (!ctx.repo.exists(slug, [], draftId)) {
    throw new NotFoundError('not_found');
  }

  const drafts = reconcileDrafts(ctx, slug).map((d) => (d.id === draftId ? { ...d, title } : d));
  writeDrafts(ctx.config.boardsRoot, slug, { drafts });

  const updated = drafts.find((d) => d.id === draftId);
  sendJson(res, 200, { ok: true, draft: updated });
}

/** DELETE /api/drafts?board=&draft= — discard a draft (dir + index entry). */
export function handleDiscardDraft(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const query = getQuery(req);
  const slug = requireSlug(query.get('board'));
  const draftId = requireDraftId(query.get('draft'));

  ctx.repo.delete(slug, [], draftId);
  const remaining = readDrafts(ctx.config.boardsRoot, slug).drafts.filter((d) => d.id !== draftId);
  writeDrafts(ctx.config.boardsRoot, slug, { drafts: remaining });

  sendJson(res, 200, { ok: true });
}
