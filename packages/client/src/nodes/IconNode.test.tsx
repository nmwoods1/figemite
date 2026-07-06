// IconNode: a registry icon (lib/icons.ts) rendered at a color + size, with
// rotation. Ported from figmalade's IconNode.tsx — no editable text (icons
// have no text to edit), connection handles + description badge carry over.

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NodeResizer } from '@xyflow/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { IconNode } from './IconNode.js';
import type { IconNodeData } from './IconNode.js';

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

function renderIcon(data: Partial<IconNodeData> = {}, selected = false) {
  const fullData: IconNodeData = { name: 'star', color: '#0f172a', size: 48, ...data };
  const props = makeNodeProps('icon', { id: 'i1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <IconNode {...props} />
    </RfTestHarness>,
  );
}

describe('IconNode', () => {
  it('renders the registry icon svg', () => {
    const { container } = renderIcon({ name: 'star' });
    const svg = container.querySelector('svg[aria-label="star"]');
    expect(svg).toBeTruthy();
  });

  it('sizes the svg to data.size', () => {
    const { container } = renderIcon({ name: 'star', size: 64 });
    const svg = container.querySelector('svg[aria-label="star"]');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
  });

  it('colors the icon stroke with data.color', () => {
    const { container } = renderIcon({ name: 'star', color: '#ff0000' });
    const svg = container.querySelector('svg[aria-label="star"]');
    expect(svg?.getAttribute('stroke')).toBe('#ff0000');
  });

  it('renders a fallback placeholder for an unknown icon name', () => {
    renderIcon({ name: 'not-a-real-icon' });
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('applies a rotation transform when data.rotation is set', () => {
    const { container } = renderIcon({ rotation: 90 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.style.transform).toBe('rotate(90deg)');
  });

  it('shows the description badge when data.description is set', () => {
    renderIcon({ description: 'important' });
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show the description badge when data.description is unset', () => {
    renderIcon({ description: undefined });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders 4 connectable handles when an onOpenDescription (editable) callback is present', () => {
    const { container } = renderIcon({ onOpenDescription: vi.fn() });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) expect(handle.classList.contains('connectable')).toBe(true);
  });

  it('still renders 4 handles when fully read-only, but non-connectable (so edges route)', () => {
    const { container } = renderIcon();
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) expect(handle.classList.contains('connectable')).toBe(false);
  });

  it('nests connection handles inside the rotation wrapper (handles rotate with the icon)', () => {
    const { container } = renderIcon({ onOpenDescription: vi.fn(), rotation: 45 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });

  // ── P4-T24: resize (aspect-ratio-locked) ────────────────────────────────

  it('renders NodeResizer visible when selected and editable (has onResizeEnd)', () => {
    renderIcon({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().isVisible).toBe(true);
  });

  it('renders NodeResizer NOT visible when read-only (no onResizeEnd)', () => {
    renderIcon({}, true);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('keeps aspect ratio (keepAspectRatio=true)', () => {
    renderIcon({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().keepAspectRatio).toBe(true);
  });

  it('applies the ported legacy min size (24x24)', () => {
    renderIcon({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().minWidth).toBe(24);
    expect(lastResizerProps().minHeight).toBe(24);
  });

  it('commits the resize as a single numeric size (max of width/height, matching legacy)', () => {
    const onResizeEnd = vi.fn();
    renderIcon({ onResizeEnd }, true);
    lastResizerProps().onResizeEnd?.({} as never, { x: 0, y: 0, width: 72, height: 68 });
    expect(onResizeEnd).toHaveBeenCalledWith('i1', 72);
  });

  // ── P4-T24: rotation ─────────────────────────────────────────────────────

  it('renders a rotation handle when selected and onRotate is provided', () => {
    renderIcon({ onRotate: vi.fn() }, true);
    expect(screen.getByTitle(/Rotate/)).toBeInTheDocument();
  });

  it('does not render a rotation handle when read-only (no onRotate)', () => {
    renderIcon({}, true);
    expect(screen.queryByTitle(/Rotate/)).not.toBeInTheDocument();
  });

  it('commits a rotation via onRotate on drag', () => {
    const onRotate = vi.fn();
    const { container } = renderIcon({ rotation: 0, onRotate }, true);
    const handle = screen.getByTitle(/Rotate/);
    const wrapper = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 48,
      bottom: 48,
      width: 48,
      height: 48,
      x: 0,
      y: 0,
      toJSON() {},
    });
    fireEvent.pointerDown(handle, { clientX: 24, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 45, clientY: 24, pointerId: 1 });
    expect(onRotate).toHaveBeenCalled();
    const [id, deg] = onRotate.mock.calls[onRotate.mock.calls.length - 1] as [string, number];
    expect(id).toBe('i1');
    expect(deg).not.toBe(0);
  });
});
