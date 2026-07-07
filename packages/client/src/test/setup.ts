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
// hasPointerCapture, but RotationHandle (P4-T24, ported from the prototype's
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

// ── EventSource polyfill ─────────────────────────────────────────────────────
//
// jsdom doesn't implement `EventSource`, but hooks/useAiLock.ts (P5-T31)
// constructs one unconditionally whenever an editable BoardCanvas mounts with
// a `slug` (e.g. App.test.tsx's board-route tests, which mock `lib/realtime.js`
// but not `hooks/useAiLock.js`) — without this stub, that constructor throws
// `ReferenceError: EventSource is not defined` as an uncaught exception outside
// any single test's own try/catch (React commits the effect asynchronously).
// A minimal no-op-transport stub (never calls its own listeners; nothing ever
// arrives) is enough for tests that don't specifically exercise the AI lock
// (those install their own richer fake — see hooks/useAiLock.test.ts /
// canvas/BoardCanvas.test.tsx's `useAiLock` mock) — we only need `new
// EventSource(url)` to not throw and to expose `close()`.
if (typeof globalThis.EventSource === 'undefined') {
  class EventSourceStub {
    url: string;
    onerror: ((ev: Event) => void) | null = null;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    constructor(url: string) {
      this.url = url;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  globalThis.EventSource = EventSourceStub as unknown as typeof EventSource;
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
