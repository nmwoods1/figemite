// ShapeNode: the 12 ShapeKinds rendered as scalable SVG (rect/roundRect/
// ellipse/diamond/triangle/parallelogram/hexagon/pentagon/star/cylinder/
// cloud/arrow), + centered text + rotation. Ported from the prototype's (428-line)
// ShapeNode.tsx — the biggest port in this task. Resize/rotate interaction
// HANDLERS are Phase 4; `data.rotation` is applied as a static CSS transform.

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NodeResizer } from '@xyflow/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { ShapeNode } from './ShapeNode.js';
import type { ShapeNodeData } from './ShapeNode.js';
import type { ShapeKind } from '@figemite/shared';

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

function renderShape(data: Partial<ShapeNodeData> = {}, selected = false) {
  const fullData: ShapeNodeData = {
    shape: 'rect',
    color: '#e2e8f0',
    width: 160,
    height: 100,
    ...data,
  };
  const props = makeNodeProps('shape', { id: 'sh1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <ShapeNode {...props} />
    </RfTestHarness>,
  );
}

describe('ShapeNode — the 12 shape kinds', () => {
  it('renders a <rect> for rect', () => {
    const { container } = renderShape({ shape: 'rect' });
    expect(container.querySelector('svg > rect')).toBeTruthy();
  });

  it('renders a rounded <rect> (rx set) for roundRect', () => {
    const { container } = renderShape({ shape: 'roundRect' });
    const rect = container.querySelector('svg > rect');
    expect(rect).toBeTruthy();
    expect(Number(rect?.getAttribute('rx'))).toBeGreaterThan(0);
  });

  it('renders an <ellipse> for ellipse', () => {
    const { container } = renderShape({ shape: 'ellipse' });
    expect(container.querySelector('svg > ellipse')).toBeTruthy();
  });

  it('renders a 4-point <polygon> for diamond', () => {
    const { container } = renderShape({ shape: 'diamond' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon).toBeTruthy();
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(4);
  });

  it('renders a 3-point <polygon> for triangle', () => {
    const { container } = renderShape({ shape: 'triangle' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(3);
  });

  it('renders a 4-point <polygon> for parallelogram', () => {
    const { container } = renderShape({ shape: 'parallelogram' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(4);
  });

  it('renders a 6-point <polygon> for hexagon', () => {
    const { container } = renderShape({ shape: 'hexagon' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(6);
  });

  it('renders a 5-point <polygon> for pentagon', () => {
    const { container } = renderShape({ shape: 'pentagon' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(5);
  });

  it('renders a 10-point <polygon> for star', () => {
    const { container } = renderShape({ shape: 'star' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(10);
  });

  it('renders a <path> (body + rim) for cylinder', () => {
    const { container } = renderShape({ shape: 'cylinder' });
    expect(container.querySelectorAll('svg > path').length).toBeGreaterThanOrEqual(2);
  });

  it('renders a single closed <path> for cloud', () => {
    const { container } = renderShape({ shape: 'cloud' });
    const path = container.querySelector('svg > path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toMatch(/Z$/);
  });

  it('renders a 7-point <polygon> for arrow', () => {
    const { container } = renderShape({ shape: 'arrow' });
    const polygon = container.querySelector('svg > polygon');
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(7);
  });

  it('covers exactly the 12 documented ShapeKinds', () => {
    const kinds: ShapeKind[] = [
      'rect',
      'roundRect',
      'ellipse',
      'diamond',
      'triangle',
      'parallelogram',
      'hexagon',
      'pentagon',
      'star',
      'cylinder',
      'cloud',
      'arrow',
    ];
    expect(kinds).toHaveLength(12);
    for (const shape of kinds) {
      cleanup();
      const { container } = renderShape({ shape });
      expect(container.querySelector('svg')).toBeTruthy();
    }
  });
});

describe('ShapeNode — text, rotation, description, editing', () => {
  it('renders centered text', () => {
    renderShape({ text: 'Decision' });
    expect(screen.getByText('Decision')).toBeInTheDocument();
  });

  it('applies a rotation transform when data.rotation is set', () => {
    const { container } = renderShape({ rotation: 60 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.style.transform).toBe('rotate(60deg)');
  });

  it('shows the description badge when data.description is set', () => {
    renderShape({ description: 'notes' });
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show the description badge when data.description is unset', () => {
    renderShape({ description: undefined });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not enter edit mode on double-click when no onTextChange is provided (read-only)', () => {
    renderShape({ text: 'Decision' });
    fireEvent.doubleClick(screen.getByText('Decision'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onTextChange is provided', () => {
    renderShape({ text: 'Decision', onTextChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('Decision'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new text via onTextChange on Enter', () => {
    const onTextChange = vi.fn();
    renderShape({ text: 'Decision', onTextChange });
    fireEvent.doubleClick(screen.getByText('Decision'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Outcome' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onTextChange).toHaveBeenCalledWith('sh1', 'Outcome');
  });
});

describe('ShapeNode — connection handles', () => {
  it('renders 4 connectable handles when editable, at bbox-edge midpoints for non-diamond shapes', () => {
    const { container } = renderShape({ shape: 'rect', onTextChange: vi.fn() });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) {
      expect((handle as HTMLElement).style.left).toBe('');
      expect(handle.classList.contains('connectable')).toBe(true);
    }
  });

  it('still renders 4 handles when read-only, but non-connectable (so edges route)', () => {
    const { container } = renderShape({ shape: 'rect' });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) expect(handle.classList.contains('connectable')).toBe(false);
  });

  it("anchors the diamond's handles at its 4 visual vertices, not the bbox edge midpoints", () => {
    const { container } = renderShape({
      shape: 'diamond',
      width: 160,
      height: 100,
      onTextChange: vi.fn(),
    });
    const top = container.querySelector('[data-handleid="t"]') as HTMLElement;
    const right = container.querySelector('[data-handleid="r"]') as HTMLElement;
    const bottom = container.querySelector('[data-handleid="b"]') as HTMLElement;
    const left = container.querySelector('[data-handleid="l"]') as HTMLElement;
    // Matches legacy's getDiamondAnchors(w, h): t=(w/2,1) r=(w-1,h/2) b=(w/2,h-1) l=(1,h/2)
    expect(top.style.left).toBe('80px');
    expect(top.style.top).toBe('1px');
    expect(right.style.left).toBe('159px');
    expect(right.style.top).toBe('50px');
    expect(bottom.style.left).toBe('80px');
    expect(bottom.style.top).toBe('99px');
    expect(left.style.left).toBe('1px');
    expect(left.style.top).toBe('50px');
  });
});

describe('ShapeNode — resize', () => {
  it('renders NodeResizer visible when selected and editable (has onResizeEnd)', () => {
    renderShape({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().isVisible).toBe(true);
  });

  it('renders NodeResizer NOT visible when read-only (no onResizeEnd)', () => {
    renderShape({}, true);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('applies the ported legacy min size (60x40)', () => {
    renderShape({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().minWidth).toBe(60);
    expect(lastResizerProps().minHeight).toBe(40);
  });

  it('commits the new size via onResizeEnd on resize end', () => {
    const onResizeEnd = vi.fn();
    renderShape({ onResizeEnd }, true);
    lastResizerProps().onResizeEnd?.({} as never, { x: 0, y: 0, width: 200, height: 130 });
    expect(onResizeEnd).toHaveBeenCalledWith('sh1', { width: 200, height: 130 });
  });
});

describe('ShapeNode — rotation', () => {
  it('renders a rotation handle when selected, editable, and onRotate is provided', () => {
    renderShape({ onRotate: vi.fn() }, true);
    expect(screen.getByTitle(/Rotate/)).toBeInTheDocument();
  });

  it('does not render a rotation handle when not selected', () => {
    renderShape({ onRotate: vi.fn() }, false);
    expect(screen.queryByTitle(/Rotate/)).not.toBeInTheDocument();
  });

  it('does not render a rotation handle when read-only (no onRotate)', () => {
    renderShape({}, true);
    expect(screen.queryByTitle(/Rotate/)).not.toBeInTheDocument();
  });

  it('commits a rotation via onRotate on drag', () => {
    const onRotate = vi.fn();
    const { container } = renderShape({ rotation: 0, onRotate }, true);
    const handle = screen.getByTitle(/Rotate/);
    const wrapper = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 160,
      bottom: 100,
      width: 160,
      height: 100,
      x: 0,
      y: 0,
      toJSON() {},
    });
    fireEvent.pointerDown(handle, { clientX: 80, clientY: 0, pointerId: 1 });
    // Pointer moved to the right of center -> rotates clockwise from 0deg.
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 50, pointerId: 1 });
    expect(onRotate).toHaveBeenCalled();
    const [id, deg] = onRotate.mock.calls[onRotate.mock.calls.length - 1] as [string, number];
    expect(id).toBe('sh1');
    expect(deg).not.toBe(0);
  });
});
