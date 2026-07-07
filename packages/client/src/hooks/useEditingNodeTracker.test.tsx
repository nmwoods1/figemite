// ── useEditingNodeTracker tests ──────────────────────────────────────────────
//
// P5-T30. Determines "which board node's text is this LOCAL user currently
// editing" by watching DOM focus bubble through `document` — ported from the
// legacy figmalade prototype's BoardCanvas.tsx focus-tracking effect. This is
// the "existing edit seam" the presence wiring hooks into: every text-bearing
// node type (Sticky/Text/Shape/Frame/Emoji, via `useEditableText`) renders its
// `<textarea>` inside RF's own `.react-flow__node[data-id="..."]` wrapper —
// a structural fact of ReactFlow itself, true regardless of node type — so
// tracking focus this way needs no changes to any of the 5 node components
// or their existing tests.
//
// `setTimeout(update, 0)` (matching the legacy) lets `document.activeElement`
// reflect the POST-event state before reading it, since `focusin`/`focusout`
// fire before the browser finishes updating `activeElement` in some cases.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { useEditingNodeTracker } from './useEditingNodeTracker.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({
  containerRef,
  onChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (id: string | null) => void;
}) {
  useEditingNodeTracker(containerRef, onChange);
  return (
    <div ref={containerRef}>
      <div className="react-flow__node" data-id="node-a">
        <textarea data-testid="ta-a" />
      </div>
      <div className="react-flow__node" data-id="node-b">
        <textarea data-testid="ta-b" />
      </div>
      <input data-testid="outside-input" />
    </div>
  );
}

describe('useEditingNodeTracker', () => {
  it('reports null when nothing is focused', () => {
    const containerRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    render(<Harness containerRef={containerRef} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/.+/));
  });

  it('reports the node id when a textarea inside a react-flow__node gains focus', () => {
    vi.useFakeTimers();
    const containerRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const { getByTestId } = render(<Harness containerRef={containerRef} onChange={onChange} />);

    act(() => {
      (getByTestId('ta-a') as HTMLTextAreaElement).focus();
      vi.runAllTimers();
    });

    expect(onChange).toHaveBeenCalledWith('node-a');
  });

  it('reports null when focus leaves the container entirely', () => {
    vi.useFakeTimers();
    const containerRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const { getByTestId } = render(<Harness containerRef={containerRef} onChange={onChange} />);

    act(() => {
      (getByTestId('ta-a') as HTMLTextAreaElement).focus();
      vi.runAllTimers();
    });
    onChange.mockClear();

    act(() => {
      (getByTestId('ta-a') as HTMLTextAreaElement).blur();
      vi.runAllTimers();
    });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('switches to the new node id when focus moves directly between two nodes', () => {
    vi.useFakeTimers();
    const containerRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const { getByTestId } = render(<Harness containerRef={containerRef} onChange={onChange} />);

    act(() => {
      (getByTestId('ta-a') as HTMLTextAreaElement).focus();
      vi.runAllTimers();
    });
    act(() => {
      (getByTestId('ta-b') as HTMLTextAreaElement).focus();
      vi.runAllTimers();
    });

    expect(onChange).toHaveBeenLastCalledWith('node-b');
  });

  it('reports null when focus moves to something inside the container but outside any node', () => {
    vi.useFakeTimers();
    const containerRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const { getByTestId } = render(<Harness containerRef={containerRef} onChange={onChange} />);

    act(() => {
      (getByTestId('ta-a') as HTMLTextAreaElement).focus();
      vi.runAllTimers();
    });
    onChange.mockClear();

    act(() => {
      (getByTestId('outside-input') as HTMLInputElement).focus();
      vi.runAllTimers();
    });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('cleans up its document listeners on unmount', () => {
    const containerRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Harness containerRef={containerRef} onChange={onChange} />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('focusout', expect.any(Function));
  });
});
