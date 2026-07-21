// ── sessionKey ───────────────────────────────────────────────────────────────
//
// Shared key format for the three live-sync services (AiSessionManager,
// SseHub, FileWatcher) so that a board and each of its sub-boards get a
// distinct, stable key. Ported from the original prototype's
// `` `${slug}|${subPath.join('.')}` `` convention (vite.config.ts ~357, ~378,
// ~593), but simplified for the root board: the legacy key for the root was
// `<slug>|` (trailing pipe, empty join). This rewrite uses a bare `<slug>`
// for the root instead — still unique per board/sub-board, and avoids a
// trailing-pipe artifact leaking into logs/tests. Every service in this
// phase is new (no existing on-disk or wire format depends on the legacy
// exact string), so this is a safe simplification, not a compatibility break.

/**
 * The shared per-board/sub-board key used by AiSessionManager, SseHub, and
 * FileWatcher. When `draftId` is given the key is scoped to that draft
 * (`<draftId>~<slug>[|<subPath>]`) so a draft's live-sync state (AI lock, SSE
 * room, self-write suppression) is distinct from prod's and from other drafts'.
 * Omitting `draftId` yields exactly the legacy prod key — backward-compatible.
 */
export function sessionKey(slug: string, subPath: string[], draftId?: string): string {
  const base = subPath.length ? `${slug}|${subPath.join('.')}` : slug;
  return draftId ? `${draftId}~${base}` : base;
}
