export const PACKAGE_NAME = '@figemite/client';

// ── Hash router + READONLY mode (P2-T15) ─────────────────────────────────────
export * from './app/mode.js';
export * from './app/router.js';

// ── Data-access layer: dev vs READONLY (P2-T15) ──────────────────────────────
export * from './lib/boards-api.js';

// ── Canvas state foundation: coords, RF adapters, doc-first store (P3-T18) ───
export * from './canvas/coords.js';
export * from './canvas/rf-adapters.js';
export * from './store/board-store.js';
export * from './store/use-board-store.js';
