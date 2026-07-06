// ── sessionKey ───────────────────────────────────────────────────────────────
//
// Shared key format for the three live-sync services (AiSessionManager,
// SseHub, FileWatcher) so that a board and each of its sub-boards get a
// distinct, stable key. Ported from the figmalade prototype's
// `` `${slug}|${subPath.join('.')}` `` convention (vite.config.ts ~357, ~378,
// ~593), but simplified for the root board: the legacy key for the root was
// `<slug>|` (trailing pipe, empty join). This rewrite uses a bare `<slug>`
// for the root instead — still unique per board/sub-board, and avoids a
// trailing-pipe artifact leaking into logs/tests. Every service in this
// phase is new (no existing on-disk or wire format depends on the legacy
// exact string), so this is a safe simplification, not a compatibility break.

/** The shared per-board/sub-board key used by AiSessionManager, SseHub, and FileWatcher. */
export function sessionKey(slug: string, subPath: string[]): string {
  return subPath.length ? `${slug}|${subPath.join('.')}` : slug;
}
