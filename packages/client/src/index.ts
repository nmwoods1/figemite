export const PACKAGE_NAME = '@easel/client';

// ── Hash router + READONLY mode (P2-T15) ─────────────────────────────────────
export * from './app/mode.js';
export * from './app/router.js';

// ── Data-access layer: dev vs READONLY (P2-T15) ──────────────────────────────
export * from './lib/boards-api.js';
