export const PACKAGE_NAME = '@easel/server';

export * from './config.js';
export * from './repository/paths.js';
export * from './repository/board-repo.js';
export * from './repository/comments-repo.js';
export * from './repository/tags-repo.js';
export * from './services/snapshot-history.js';
export * from './services/session-key.js';
export * from './services/ai-session.js';
export * from './services/sse-hub.js';
export * from './services/file-watcher.js';
export * from './services/yjs-ws.js';
export * from './services/mdns.js';

// ── HTTP API layer (P1-T12) ──────────────────────────────────────────────────
export * from './http/body.js';
export * from './api/errors.js';
export * from './api/persist.js';
export * from './api/ai-broadcast.js';
export * from './api/router.js';
