// ── MultiSelectResizer ────────────────────────────────────────────────────────
//
// Ported from figmalade's src/components/MultiSelectResizer.tsx: when 2+
// board nodes are selected, overlays a single bounding-box with 8 handles
// (4 corners + 4 edges) that scale the WHOLE group as one object. This
// component is pure UI/geometry (mouse tracking + screen projection via the
// live RF viewport) — the actual per-node-type scale math lives in
// multi-select-scale.ts (already unit-tested there) and the store commit in
// the caller (BoardCanvas/useEditableCanvas), so here we only assert:
//   - it renders nothing with < 2 nodes;
//   - it renders the bbox + 8 handles with 2+ nodes;
//   - dragging a handle calls onStart once and onScale with sx/sy/anchor.

import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import type { BoardNode } from '@easel/shared';
import { MultiSelectResizer } from './MultiSelectResizer.js';

afterEach(() => {
  cleanup();
});

function sticky(id: string, x: number, y: number, width = 100, height = 80): BoardNode {
  return {
    id,
    type: 'sticky',
    pos: { x, y },
    order: 0,
    size: { width, height },
    text: '',
    color: '#fff',
  };
}

function renderResizer(nodes: BoardNode[], onScale = vi.fn(), onStart = vi.fn()) {
  const containerRef = createRef<HTMLDivElement>();
  const utils = render(
    <div ref={containerRef} style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={[]} edges={[]} defaultViewport={{ x: 0, y: 0, zoom: 1 }}>
        <MultiSelectResizer
          selectedNodes={nodes}
          containerRef={containerRef}
          onStart={onStart}
          onScale={onScale}
        />
      </ReactFlow>
    </div>,
  );
  vi.spyOn(containerRef.current as HTMLDivElement, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON() {},
  });
  return { ...utils, containerRef, onScale, onStart };
}

describe('MultiSelectResizer', () => {
  it('renders nothing with fewer than 2 selected nodes', () => {
    const { container } = renderResizer([sticky('a', 0, 0)]);
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(0);
  });

  it('renders nothing with zero selected nodes', () => {
    const { container } = renderResizer([]);
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(0);
  });

  it('renders a bounding box and 8 handles with 2+ selected nodes', () => {
    const { container } = renderResizer([sticky('a', 0, 0), sticky('b', 200, 0)]);
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(8);
    expect(container.querySelector('[data-testid="multi-resize-bbox"]')).toBeTruthy();
  });

  it('calls onStart once when a handle drag begins', () => {
    const { container, onStart } = renderResizer([sticky('a', 0, 0), sticky('b', 200, 0)]);
    const handle = container.querySelector('[data-handle-id="br"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 300, clientY: 80 });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('dragging the bottom-right handle outward scales sx/sy > 1 anchored at the top-left', () => {
    const { container, onScale } = renderResizer([sticky('a', 0, 0), sticky('b', 200, 0, 100, 80)]);
    // Group bbox: x=0,y=0,width=300,height=80 (a: 0..100, b: 200..300).
    const handle = container.querySelector('[data-handle-id="br"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 300, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 160 });
    expect(onScale).toHaveBeenCalled();
    const spec = onScale.mock.calls[onScale.mock.calls.length - 1][0];
    expect(spec.sx).toBeGreaterThan(1);
    expect(spec.sy).toBeGreaterThan(1);
    expect(spec.anchor).toEqual({ x: 0, y: 0 });
  });

  it('dragging the top-left handle anchors at the bottom-right corner', () => {
    const { container, onScale } = renderResizer([sticky('a', 0, 0), sticky('b', 200, 0, 100, 80)]);
    const handle = container.querySelector('[data-handle-id="tl"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: -50, clientY: -20 });
    expect(onScale).toHaveBeenCalled();
    const spec = onScale.mock.calls[onScale.mock.calls.length - 1][0];
    expect(spec.anchor).toEqual({ x: 300, y: 80 });
  });

  it('stops calling onScale after mouseup', () => {
    const { container, onScale } = renderResizer([sticky('a', 0, 0), sticky('b', 200, 0)]);
    const handle = container.querySelector('[data-handle-id="br"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 300, clientY: 80 });
    fireEvent.mouseUp(window);
    onScale.mockClear();
    fireEvent.mouseMove(window, { clientX: 600, clientY: 160 });
    expect(onScale).not.toHaveBeenCalled();
  });

  it('passes each selected node id -> its pre-drag rect via originalRects', () => {
    const { container, onScale } = renderResizer([
      sticky('a', 0, 0, 100, 80),
      sticky('b', 200, 0, 100, 80),
    ]);
    const handle = container.querySelector('[data-handle-id="br"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 300, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 160 });
    const spec = onScale.mock.calls[onScale.mock.calls.length - 1][0];
    expect(spec.originalRects.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(spec.originalRects.get('b')).toEqual({ x: 200, y: 0, width: 100, height: 80 });
  });
});
