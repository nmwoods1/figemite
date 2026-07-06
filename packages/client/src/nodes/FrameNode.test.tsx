// FrameNode: a titled container. Ported from figmalade's FrameNode.tsx.
// Legacy FrameNode has no description badge and no connection handles (it's
// a container, not an edge endpoint) and no rotation — none of those are
// added here either, matching legacy behaviour faithfully.

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NodeResizer } from '@xyflow/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { FrameNode } from './FrameNode.js';
import type { FrameNodeData } from './FrameNode.js';

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

function renderFrame(data: Partial<FrameNodeData> = {}, selected = false) {
  const fullData: FrameNodeData = {
    title: 'My Frame',
    color: '#fef3c7',
    width: 480,
    height: 320,
    ...data,
  };
  const props = makeNodeProps('frame', { id: 'f1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <FrameNode {...props} />
    </RfTestHarness>,
  );
}

describe('FrameNode', () => {
  it('renders its title', () => {
    renderFrame({ title: 'Phase 1' });
    expect(screen.getByText('Phase 1')).toBeInTheDocument();
  });

  it('falls back to "Frame" when title is empty', () => {
    renderFrame({ title: '' });
    expect(screen.getByText('Frame')).toBeInTheDocument();
  });

  it('does not enter edit mode on double-click when no onTitleChange is provided (read-only)', () => {
    renderFrame({ title: 'Phase 1' });
    fireEvent.doubleClick(screen.getByText('Phase 1'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onTitleChange is provided', () => {
    renderFrame({ title: 'Phase 1', onTitleChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('Phase 1'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new title via onTitleChange on Enter', () => {
    const onTitleChange = vi.fn();
    renderFrame({ title: 'Phase 1', onTitleChange });
    fireEvent.doubleClick(screen.getByText('Phase 1'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Phase 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTitleChange).toHaveBeenCalledWith('f1', 'Phase 2');
  });

  // ── P4-T24: resize ───────────────────────────────────────────────────────

  it('renders NodeResizer visible when selected and editable (has onResizeEnd)', () => {
    renderFrame({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().isVisible).toBe(true);
  });

  it('renders NodeResizer NOT visible when read-only (no onResizeEnd)', () => {
    renderFrame({}, true);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('applies the ported legacy min size (120x80)', () => {
    renderFrame({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().minWidth).toBe(120);
    expect(lastResizerProps().minHeight).toBe(80);
  });

  it('commits the new size via onResizeEnd on resize end', () => {
    const onResizeEnd = vi.fn();
    renderFrame({ onResizeEnd }, true);
    lastResizerProps().onResizeEnd?.({} as never, { x: 0, y: 0, width: 520, height: 360 });
    expect(onResizeEnd).toHaveBeenCalledWith('f1', { width: 520, height: 360 });
  });
});
