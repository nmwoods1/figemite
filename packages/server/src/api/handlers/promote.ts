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
// comments/tags, then delete the draft. Prod content is pushed through the live
// Yjs room when one exists (so connected browsers converge immediately) and
// falls back to a direct disk write otherwise.

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
  const body = (await readJsonBody(req)) as { board?: unknown; draft?: unknown };
  const slug = typeof body.board === 'string' ? body.board : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid board: ${JSON.stringify(slug)}`);
  }
  const draftId = typeof body.draft === 'string' ? body.draft : '';
  if (!PathSegmentSchema.safeParse(draftId).success) {
    throw new ValidationError(`Invalid draft id: ${JSON.stringify(draftId)}`);
  }

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

    // Push into the live prod room if one is connected (so open browsers
    // converge and the room's own debounce persists it); otherwise write disk
    // directly. `replaceRoomContent` only carries nodes/edges — the room's
    // persist preserves prod's on-disk boardLabel/viewport, matching `merged`.
    const applied = ctx.yjs.replaceRoomContent(slug, subPath, {
      nodes: merged.nodes,
      edges: merged.edges,
    });
    if (!applied) {
      persistBoard(ctx, slug, subPath, merged, 'save');
    }
  }

  // 3. Replace semantics: remove prod sub-boards the draft no longer has. Each
  //    was already snapshotted in step 1, so this is reversible.
  for (const subPath of prodPaths) {
    if (subPath.length > 0 && !draftKeys.has(pathKey(subPath))) {
      ctx.repo.delete(slug, subPath);
    }
  }

  // 4. Prod comments.json / tags.json are never touched (human-owned).

  // 5. Delete the now-merged draft and de-index it.
  ctx.repo.delete(slug, [], draftId);
  const remaining = readDrafts(ctx.config.boardsRoot, slug).drafts.filter((d) => d.id !== draftId);
  writeDrafts(ctx.config.boardsRoot, slug, { drafts: remaining });

  sendJson(res, 200, { ok: true });
}
