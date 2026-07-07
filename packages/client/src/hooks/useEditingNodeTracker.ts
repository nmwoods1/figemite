// ── useEditingNodeTracker: "which node is the local user editing?" ──────────
//
// P5-T30. Ported from the original prototype's BoardCanvas.tsx focus-
// tracking effect. Watches DOM focus bubbling through `document` and, on
// every change, reports the id of the ReactFlow node that currently contains
// `document.activeElement` (via `.closest('.react-flow__node')` +
// `data-id`), or `null` when focus is elsewhere (including outside
// `containerRef` entirely).
//
// This is the "existing edit seam" for presence: every text-bearing node type
// (Sticky/Text/Shape/Frame/Emoji, all via `nodes/useEditableText.ts`) renders
// its `<textarea>` inside RF's OWN `.react-flow__node[data-id="..."]`
// wrapper — a structural fact of ReactFlow itself (see its
// `NodeWrapper`/`GraphViewComponent` internals), true regardless of node
// type — so this hook needs no changes to any node component to know which
// node owns the currently-focused input.
//
// `setTimeout(update, 0)`, matching the legacy: `focusin`/`focusout` can fire
// before `document.activeElement` has settled to its post-event value, so the
// read is deferred a tick.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useEditingNodeTracker(
  containerRef: RefObject<HTMLElement | null>,
  onChange: (nodeId: string | null) => void,
): void {
  // `onChange` read through a ref (updated in its own effect, never during
  // render) so the DOM-listener effect below never needs to re-subscribe
  // just because the caller passed a fresh closure — same technique
  // useEditableCanvas.ts's `useNodeCallbacks` uses for its
  // `onOpenDescription` seam.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const update = () => {
      const container = containerRef.current;
      const active = document.activeElement;
      if (!container || !active || !container.contains(active)) {
        onChangeRef.current(null);
        return;
      }
      const nodeEl = active.closest('.react-flow__node');
      const nodeId = nodeEl?.getAttribute('data-id') ?? null;
      onChangeRef.current(nodeId);
    };

    const onFocusChange = () => setTimeout(update, 0);

    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
    return () => {
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
    };
  }, [containerRef]);
}
