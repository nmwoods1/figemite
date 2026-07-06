// StickyNode: a colored note with editable text. Ported from figmalade's
// StickyNode.tsx — markup/styling close to legacy, minus resize/rotate
// handlers (Phase 4) and the drill-in sub-board badge (out of scope here;
// only the description badge seam is built in P3-T19).

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NodeResizer } from '@xyflow/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { StickyNode } from './StickyNode.js';
import type { StickyNodeData } from './StickyNode.js';

// Capture the props StickyNode passes to <NodeResizer> — the real component
// needs a full <ReactFlow> node registration to render its handle DOM (see
// canvas/BoardCanvas.test.tsx's identical technique for <ReactFlow> itself),
// so unit-testing the WIRING (isVisible/minWidth/minHeight/onResizeEnd) here
// is done by intercepting props rather than asserting rendered handle divs.
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

function renderSticky(data: Partial<StickyNodeData> = {}, selected = false) {
  const fullData: StickyNodeData = {
    text: 'Hello sticky',
    color: '#fef3c7',
    width: 200,
    height: 160,
    ...data,
  };
  const props = makeNodeProps('sticky', { id: 's1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <StickyNode {...props} />
    </RfTestHarness>,
  );
}

describe('StickyNode', () => {
  it('renders its text', () => {
    renderSticky({ text: 'Buy milk' });
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('applies the fill color', () => {
    const { container } = renderSticky({ color: '#dbeafe' });
    const fill = container.querySelector('[data-testid="sticky-body"]') as HTMLElement;
    // jsdom normalizes hex -> rgb() when read back through `.style`.
    expect(fill.style.background).toBe('rgb(219, 234, 254)');
  });

  it('shows the description badge when data.description is set', () => {
    renderSticky({ description: 'notes' });
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show the description badge when data.description is unset', () => {
    renderSticky({ description: undefined });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not enter edit mode on double-click when no onTextChange is provided (read-only)', () => {
    renderSticky({ text: 'Buy milk' });
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onTextChange is provided', () => {
    renderSticky({ text: 'Buy milk', onTextChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new text via onTextChange on blur', () => {
    const onTextChange = vi.fn();
    renderSticky({ text: 'Buy milk', onTextChange });
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Buy bread' } });
    fireEvent.blur(textarea);
    expect(onTextChange).toHaveBeenCalledWith('s1', 'Buy bread');
  });

  it('always renders 4 connection handles, even read-only, so edges to/from it route', () => {
    // A read-only sticky (no onTextChange) is still an edge endpoint in real
    // boards (the kitchen-sink fixture's `sticky1 -> sticky2` edge). Handles
    // must exist in the DOM for ReactFlow to measure them and route the edge.
    const { container } = renderSticky();
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });

  // ── P4-T24: resize ───────────────────────────────────────────────────────

  it('renders NodeResizer visible when selected and editable (has onResizeEnd)', () => {
    renderSticky({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().isVisible).toBe(true);
  });

  it('renders NodeResizer NOT visible when not selected', () => {
    renderSticky({ onResizeEnd: vi.fn() }, false);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('renders NodeResizer NOT visible when read-only (no onResizeEnd), even if selected', () => {
    renderSticky({}, true);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('applies the ported legacy min size (120x80)', () => {
    renderSticky({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().minWidth).toBe(120);
    expect(lastResizerProps().minHeight).toBe(80);
  });

  it('commits the new size via onResizeEnd on resize end', () => {
    const onResizeEnd = vi.fn();
    renderSticky({ onResizeEnd }, true);
    lastResizerProps().onResizeEnd?.({} as never, { x: 0, y: 0, width: 250, height: 190 });
    expect(onResizeEnd).toHaveBeenCalledWith('s1', { width: 250, height: 190 });
  });
});
