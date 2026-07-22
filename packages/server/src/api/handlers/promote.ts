// ── POST /api/board/promote — approve a draft, overwriting prod ──────────────
//
// The human-only "approve" action. Body `{ board, draft }`. There is NO MCP
// tool that reaches this endpoint — that omission is what makes promotion
// human-only, exactly as comments/tags stay human-owned by having no MCP tools
// (see AGENTS.md). An agent can create and edit drafts, but only a human,
// through the browser, can promote one.
//
// Flow (see the plan): gate on the prod AI-lock, snapshot prod first for
// rollback, copy the draft board tree over prod (replace semantics — prod
// sub-boards absent from the draft are removed), preserve prod's human-owned
// comments/tags, then OPTIONALLY delete the draft. Prod content is pushed
// through the live Yjs room when one exists (so connected browsers converge
// immediately) and falls back to a direct disk write otherwise.
//
// `deleteDraft` (body flag, default false) controls whether the draft is
// removed after a successful promote. The browser surfaces this as an
// unchecked-by-default "Delete this draft after promotion" checkbox, so by
// default a promoted draft is KEPT (the user can keep iterating on it, or
// discard it later); only an explicit opt-in deletes it.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, PathSegmentSchema, type BoardFile } from '@figemite/shared';
import { readJsonBody, sendJson } from '../../http/body.js';
import { readDrafts, writeDrafts } from '../../repository/drafts-repo.js';
import { persistBoard } from '../persist.js';
import { LockedError, NotFoundError, ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

/** Joins a sub-path to a stable string key for set membership. */
function pathKey(subPath: string[]): string {
  return subPath.join('.');
}

/** POST /api/board/promote — body `{ board, draft }`. */
export async function handlePromoteDraft(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    board?: unknown;
    draft?: unknown;
    deleteDraft?: unknown;
  };
  const slug = typeof body.board === 'string' ? body.board : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid board: ${JSON.stringify(slug)}`);
  }
  const draftId = typeof body.draft === 'string' ? body.draft : '';
  if (!PathSegmentSchema.safeParse(draftId).success) {
    throw new ValidationError(`Invalid draft id: ${JSON.stringify(draftId)}`);
  }
  // Default: keep the draft after promotion. Only an explicit `deleteDraft:
  // true` removes it (the browser's opt-in "delete after promotion" checkbox).
  const deleteDraft = body.deleteDraft === true;

  // The draft must exist (its root board.json).
  if (!ctx.repo.exists(slug, [], draftId)) {
    throw new NotFoundError('not_found');
  }

  // Don't overwrite prod out from under an active AI session on the prod board.
  // Mirrors the write-guard precedent in handlers/board.ts.
  if (ctx.ai.isLocked(slug, [])) {
    throw new LockedError('locked');
  }

  const draftPaths: string[][] = [[], ...ctx.repo.listSubBoardPaths(slug, draftId)];
  const prodPaths: string[][] = ctx.repo.exists(slug, [])
    ? [[], ...ctx.repo.listSubBoardPaths(slug)]
    : ctx.repo.listSubBoardPaths(slug);
  const draftKeys = new Set(draftPaths.map(pathKey));

  // 1. Snapshot every existing prod board (root + sub-boards) BEFORE we touch
  //    it, so a promote is fully reversible from history.
  for (const subPath of prodPaths) {
    ctx.history.snapshot(slug, subPath, 'promote');
  }

  // 2. Copy each draft board over prod. Preserve prod's own boardLabel/viewport
  //    (promotion replaces CONTENT, not the board's identity/label); a brand-new
  //    sub-board that only exists in the draft takes the draft's metadata.
  for (const subPath of draftPaths) {
    const draftBoard = ctx.repo.read(slug, subPath, draftId);
    const merged: BoardFile = ctx.repo.exists(slug, subPath)
      ? { ...ctx.repo.read(slug, subPath), nodes: draftBoard.nodes, edges: draftBoard.edges }
      : draftBoard;

    // Write prod to disk DIRECTLY — the durable source of truth. Prod rooms are
    // frozen and never persist themselves (see services/yjs-ws.ts), so this is
    // the only path that changes prod on disk. Doing it here (rather than
    // relying on a live prod room's debounced persist) makes promotion correct
    // regardless of whether a prod room is connected: a stale/lingering prod
    // connection can otherwise revert an in-memory `replaceRoomContent` before
    // any debounce fires, so the promoted content would never reach disk.
    persistBoard(ctx, slug, subPath, merged, 'save');

    // Best-effort: converge any OPEN prod browsers on the new content in memory
    // (this only mutates the live doc; it does not — and must not — persist).
    ctx.yjs.replaceRoomContent(slug, subPath, { nodes: merged.nodes, edges: merged.edges });
  }

  // 3. Replace semantics: remove prod sub-boards the draft no longer has. Each
  //    was already snapshotted in step 1, so this is reversible.
  for (const subPath of prodPaths) {
    if (subPath.length > 0 && !draftKeys.has(pathKey(subPath))) {
      ctx.repo.delete(slug, subPath);
    }
  }

  // 4. Prod comments.json / tags.json are never touched (human-owned).

  // 5. Optionally delete the now-merged draft and de-index it. Default is to
  //    KEEP it (deleteDraft === false); only an explicit opt-in removes it.
  if (deleteDraft) {
    ctx.repo.delete(slug, [], draftId);
    const remaining = readDrafts(ctx.config.boardsRoot, slug).drafts.filter(
      (d) => d.id !== draftId,
    );
    writeDrafts(ctx.config.boardsRoot, slug, { drafts: remaining });
  }

  sendJson(res, 200, { ok: true, deletedDraft: deleteDraft });
}
