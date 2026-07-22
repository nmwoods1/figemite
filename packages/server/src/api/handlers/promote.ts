// ── POST /api/board/promote — approve a draft, overwriting prod ──────────────
//
// The human-only "approve" action. Body `{ board, draft, deleteDraft?,
// message? }`. There is NO MCP tool that reaches this endpoint — that omission
// is what makes promotion human-only, exactly as comments/tags stay human-owned
// by having no MCP tools (see AGENTS.md). An agent can create and edit drafts,
// but only a human, through the browser, can promote one.
//
// Flow (see the plan): gate on the prod AI-lock, copy the draft board tree over
// prod (replace semantics — prod sub-boards absent from the draft are removed),
// recording ONE labeled `promote` snapshot per board so Live's history shows a
// single "Promoted '<draft>'" entry (the draft title + optional `message`)
// rather than a bare autosave; replace prod's comment thread with the draft's
// (comments are a faithful fork, promoted like content; tags stay human-owned
// and untouched), then OPTIONALLY delete the draft. Prod content is pushed
// through the live Yjs room when one exists (so connected browsers converge
// immediately) and falls back to a direct disk write otherwise.
//
// Reversibility: we no longer snapshot the pre-promote content separately — Live
// content is frozen between promotes, so the prior history entry already IS the
// pre-promote state (restore it to undo a promote). This also removes the
// confusing "Human" + "AI" snapshot pair a promote used to leave in history.
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
import { readComments, writeComments } from '../../repository/comments-repo.js';
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
    message?: unknown;
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

  // The promoted version's history label: the draft's title (a human-facing
  // name like "Draft #1") plus an optional freeform message from the request
  // (git-commit style). Both ride on the single `promote` snapshot written per
  // board below, so Live's history shows one clear "Promoted '<draft>'" entry.
  const draftMeta = readDrafts(ctx.config.boardsRoot, slug).drafts.find((d) => d.id === draftId);
  const promoteMeta = {
    label: draftMeta?.title || draftId,
    message:
      typeof body.message === 'string' ? body.message.trim().slice(0, 500) || undefined : undefined,
  };

  // 1. Copy each draft board over prod. Preserve prod's own boardLabel/viewport
  //    (promotion replaces CONTENT, not the board's identity/label); a brand-new
  //    sub-board that only exists in the draft takes the draft's metadata. Each
  //    write records ONE labeled `promote` snapshot of the NEW content — the
  //    single, meaningful "Promoted '<draft>'" entry in Live's history. We do
  //    NOT also snapshot the OLD pre-promote content: Live content is frozen
  //    between promotes (only promote/AI/restore change it, and AI records its
  //    own boundary snapshot), so the prior history entry already IS the
  //    pre-promote state — restoring it reverses a promote, without the
  //    confusing "Human" + "AI" pair a promote used to leave behind.
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
    persistBoard(ctx, slug, subPath, merged, 'promote', undefined, promoteMeta);

    // Best-effort: converge any OPEN prod browsers on the new content in memory
    // (this only mutates the live doc; it does not — and must not — persist).
    ctx.yjs.replaceRoomContent(slug, subPath, { nodes: merged.nodes, edges: merged.edges });
  }

  // 2. Replace semantics: remove prod sub-boards the draft no longer has. Each
  //    removed sub-board's last saved state remains in its own history, so this
  //    stays reversible.
  for (const subPath of prodPaths) {
    if (subPath.length > 0 && !draftKeys.has(pathKey(subPath))) {
      ctx.repo.delete(slug, subPath);
    }
  }

  // 3. Replace prod's comment thread with the draft's — promotion carries the
  //    draft's discussion over Live, mirroring the replace-semantics used for
  //    board content above (a draft is a faithful fork: its comments were seeded
  //    from Live at creation, so this promotes the draft's edits/resolves/replies
  //    back onto Live). Prod tags.json is still left untouched (human-owned).
  writeComments(ctx.config.boardsRoot, slug, readComments(ctx.config.boardsRoot, slug, draftId));

  // Nudge connected Live clients to re-fetch comments. The comment layer is not
  // in the Yjs doc (so it doesn't converge with the content push above) and the
  // file-watcher deliberately ignores comments.json (see file-watcher.ts), so
  // without this a promoter watching Live would keep seeing the pre-promote
  // thread until a manual reload. `external-change` is exactly the frame the
  // client's useAiLock turns into a comments reload (see BoardCanvas.tsx).
  ctx.sse.broadcast(slug, [], 'external-change', { board: slug });

  // 4. Optionally delete the now-merged draft and de-index it. Default is to
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
