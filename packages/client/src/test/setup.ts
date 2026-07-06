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

// ── Range.getClientRects/getBoundingClientRect polyfill ─────────────────────
//
// jsdom implements no layout engine, so `Range` doesn't have
// `getClientRects`/`getBoundingClientRect` at all (P4-T25's DescriptionModal,
// backed by TipTap/ProseMirror: `EditorView.dispatch`'s focus/selection
// handling calls `view.coordsAtPos`, which calls these on a Range, to decide
// whether to scroll the caret into view). Zero-rect stubs are enough for
// tests: we assert the editor's resulting document content/markdown, not
// real caret geometry.
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON() {},
    }) as DOMRect;
}
