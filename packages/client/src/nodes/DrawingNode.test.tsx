// DrawingNode: a persistent freehand pencil stroke, rendered as an SVG path
// via smoothPath(points). Ported from the prototype's DrawingNode.tsx — no
// editing, no connection handles, no rotation (none exist in the legacy
// component either).

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NodeResizer } from '@xyflow/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { DrawingNode } from './DrawingNode.js';
import type { DrawingNodeData } from './DrawingNode.js';

// See StickyNode.test.tsx's identical technique/rationale.
const resizerCalls: ComponentProps<typeof NodeResizer>[] = [];
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  const Wrapped = (props: ComponentProps<typeof actual.NodeResizer>) => {
    resizerCalls.push(props);
    return createElement(actual.NodeResizer, props);
  };
  return { ...actual, NodeResizer: Wrapped };
});

function lastResizerProps(): ComponentProps<typeof NodeResizer> {
  return resizerCalls[resizerCalls.length - 1];
}

afterEach(() => {
  cleanup();
  resizerCalls.length = 0;
});

function renderDrawing(data: Partial<DrawingNodeData> = {}, selected = false) {
  const fullData: DrawingNodeData = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    color: '#1e293b',
    strokeWidth: 3,
    width: 100,
    height: 80,
    ...data,
  };
  const props = makeNodeProps('drawing', { id: 'd1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <DrawingNode {...props} />
    </RfTestHarness>,
  );
}

describe('DrawingNode', () => {
  it('renders an SVG path built from the given points', () => {
    const { container } = renderDrawing({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toBe('M 0 0 L 10 10');
  });

  it('applies the stroke color and width', () => {
    const { container } = renderDrawing({ color: '#ff0000', strokeWidth: 5 });
    const path = container.querySelector('path[stroke="#ff0000"]');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke-width')).toBe('5');
  });

  it('sizes the svg to the node bbox', () => {
    const { container } = renderDrawing({ width: 200, height: 150 });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('150');
  });

  // ── P4-T24: resize ───────────────────────────────────────────────────────

  it('renders NodeResizer visible when selected and editable (has onResizeEnd)', () => {
    renderDrawing({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().isVisible).toBe(true);
  });

  it('renders NodeResizer NOT visible when not selected', () => {
    renderDrawing({ onResizeEnd: vi.fn() }, false);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('renders NodeResizer NOT visible when read-only (no onResizeEnd)', () => {
    renderDrawing({}, true);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('applies a minimum size floor (matching the legacy multi-select MIN_BBOX)', () => {
    renderDrawing({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().minWidth).toBe(20);
    expect(lastResizerProps().minHeight).toBe(20);
  });

  it('commits the new size via onResizeEnd on resize end', () => {
    const onResizeEnd = vi.fn();
    renderDrawing({ onResizeEnd }, true);
    lastResizerProps().onResizeEnd?.({} as never, { x: 0, y: 0, width: 240, height: 160 });
    expect(onResizeEnd).toHaveBeenCalledWith('d1', { width: 240, height: 160 });
  });
});
