// ── persistBoard — THE single write funnel ───────────────────────────────────
//
// Every board write to disk goes through here. `POST /api/board` (trigger
// 'save') and `POST /api/create` (seeding a sub-board, trigger 'save') are the
// callers that supply new board *data*. This is what makes "single writer" true
// at the disk level: one funnel, one order of operations, so the watcher-
// suppression / atomic-write / snapshot sequence can never drift between call
// sites.
//
// NOTE on `/api/ai/end`: its request body carries no board payload (the AI's
// edits reach disk out-of-band during the locked session — via the Yjs relay /
// a direct file write, deferred to a later phase). So `/api/ai/end` does NOT
// call this funnel; it snapshots the *current* on-disk state with trigger 'ai'
// directly (`history.snapshot(..., 'ai')`). It therefore never writes new bytes
// through here, which is consistent with "this funnel is the only path that
// writes board *data*".
//
// Order of operations (all synchronous — see BoardRepository's note on why sync
// I/O is the right call for these small files):
//   1. Suppress the file watcher for this key, so the atomic write we're about
//      to do isn't reported back to us as an *external* change (which would
//      trigger a redundant snapshot + external-change broadcast).
//   2. Write the board atomically via the repository (temp file + rename). The
//      repo runs `serialise` (canonical) before writing, so the on-disk file is
//      always valid, always canonical, and readers never see a partial write.
//   3. Snapshot the just-written file into history with `trigger`. The history
//      service dedupes by content hash, so a no-op save doesn't spam history.
//
// LOCK POLICY (documented decision): this funnel does NOT check the AI lock.
// The caller is responsible for that gate. `POST /api/board` checks
// `ai.isLocked` and returns 409 *before* calling here; `POST /api/ai/end`
// legitimately writes as part of releasing the lock. Centralising the lock
// check here would break the /ai/end path (which must write while the session
// is being torn down). The router still maps a `LockedError` to 409 if any
// future caller chooses to throw one, but persistBoard never throws it itself.

import type { BoardFile } from '@figemite/shared';
import type { BoardRepository } from '../repository/board-repo.js';
import type { SnapshotHistoryService, SnapshotTrigger } from '../services/snapshot-history.js';

/** The structural slice of the request context that `persistBoard` needs. */
export interface PersistContext {
  repo: BoardRepository;
  history: SnapshotHistoryService;
  watcher: { suppress(slug: string, subPath: string[], draftId?: string): void };
  ai: { isLocked(slug: string, subPath: string[]): boolean };
}

/**
 * The sole disk-write path for a board or sub-board (or a draft, when `draftId`
 * is given). See the module doc for the ordering guarantees and the lock policy
 * (the caller gates the lock; this does not). `data` MUST already be a validated
 * `BoardFile` — the repo re-serialises it canonically, but callers should have
 * parsed untrusted input through the shared schema first so an invalid payload
 * surfaces as a 400, not a write.
 */
export function persistBoard(
  ctx: PersistContext,
  slug: string,
  subPath: string[],
  data: BoardFile,
  trigger: SnapshotTrigger,
  draftId?: string,
): void {
  ctx.watcher.suppress(slug, subPath, draftId);
  ctx.repo.write(slug, subPath, data, draftId);
  ctx.history.snapshot(slug, subPath, trigger, draftId);
}
