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

// ── Pointer Capture polyfill ─────────────────────────────────────────────────
//
// jsdom doesn't implement Element.setPointerCapture/releasePointerCapture/
// hasPointerCapture, but RotationHandle (P4-T24, ported from figmalade's
// RotationHandle.tsx) calls `setPointerCapture` on pointerdown so the drag
// keeps tracking even if the cursor leaves the small handle. No-op stubs are
// enough for tests: we assert the resulting rotation math, not real OS-level
// pointer capture semantics.
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false;
}
