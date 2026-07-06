// ── READONLY mode flag ───────────────────────────────────────────────────────
//
// Ported from the figmalade prototype's `src/lib/mode.ts`. Set VITE_READONLY=1
// at build time to produce a read-only static bundle suitable for static
// hosting (e.g. GitLab/GitHub Pages). All write operations (save board, save
// comments/tags, create/delete board) are disabled and the app fetches board/
// comment/tag JSON directly from the built `boards/` directory instead of
// hitting the local dev-server `/api/*` backend.
export const READONLY = import.meta.env.VITE_READONLY === '1';
