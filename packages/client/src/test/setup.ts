import '@testing-library/jest-dom/vitest';

// ── ResizeObserver polyfill ──────────────────────────────────────────────────
//
// jsdom doesn't implement ResizeObserver, but `<ReactFlow>` (and anything that
// mounts a real ReactFlow pane, not just a bare ReactFlowProvider) requires it
// to track container size. A no-op stub is enough for tests: we don't rely on
// real resize notifications, only on ReactFlow mounting without throwing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
