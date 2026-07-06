// EmojiNode: a single emoji glyph rendered at a pixel size. Ported from
// figmalade's EmojiNode.tsx — connection handles, rotation, editable glyph
// text, and the description badge all carry over; resize/rotate
// interaction HANDLERS are Phase 4 (only the `data.rotation` CSS transform
// is applied here, not a drag-to-rotate affordance).

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NodeResizer } from '@xyflow/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { EmojiNode } from './EmojiNode.js';
import type { EmojiNodeData } from './EmojiNode.js';

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

function renderEmoji(data: Partial<EmojiNodeData> = {}, selected = false) {
  const fullData: EmojiNodeData = { text: '🎉', size: 64, ...data };
  const props = makeNodeProps('emoji', { id: 'e1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <EmojiNode {...props} />
    </RfTestHarness>,
  );
}

describe('EmojiNode', () => {
  it('renders the glyph', () => {
    renderEmoji({ text: '🎉' });
    expect(screen.getByText('🎉')).toBeInTheDocument();
  });

  it('sizes the glyph relative to data.size', () => {
    renderEmoji({ text: '🎉', size: 100 });
    const glyph = screen.getByText('🎉');
    expect(glyph.style.fontSize).toBe(`${Math.min(100 * 0.85, 320)}px`);
  });

  it('applies a rotation transform when data.rotation is set', () => {
    const { container } = renderEmoji({ rotation: 30 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.style.transform).toBe('rotate(30deg)');
  });

  it('shows the description badge when data.description is set', () => {
    renderEmoji({ description: 'party time' });
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show the description badge when data.description is unset', () => {
    renderEmoji({ description: undefined });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not enter edit mode on double-click when no onTextChange is provided (read-only)', () => {
    renderEmoji({ text: '🎉' });
    fireEvent.doubleClick(screen.getByText('🎉'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onTextChange is provided', () => {
    renderEmoji({ text: '🎉', onTextChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('🎉'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new glyph via onTextChange on Enter', () => {
    const onTextChange = vi.fn();
    renderEmoji({ text: '🎉', onTextChange });
    fireEvent.doubleClick(screen.getByText('🎉'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '🚀' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTextChange).toHaveBeenCalledWith('e1', '🚀');
  });

  it('renders 4 connectable connection handles when editable', () => {
    const { container } = renderEmoji({ onTextChange: vi.fn() });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) expect(handle.classList.contains('connectable')).toBe(true);
  });

  it('still renders 4 handles when read-only, but non-connectable (so edges route)', () => {
    const { container } = renderEmoji();
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) expect(handle.classList.contains('connectable')).toBe(false);
  });

  it('nests connection handles inside the rotation wrapper (handles rotate with the glyph)', () => {
    const { container } = renderEmoji({ onTextChange: vi.fn(), rotation: 45 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });

  // ── P4-T24: resize (aspect-ratio-locked) ────────────────────────────────

  it('renders NodeResizer visible when selected and editable (has onResizeEnd)', () => {
    renderEmoji({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().isVisible).toBe(true);
  });

  it('renders NodeResizer NOT visible when read-only (no onResizeEnd)', () => {
    renderEmoji({}, true);
    expect(lastResizerProps().isVisible).toBe(false);
  });

  it('keeps aspect ratio (keepAspectRatio=true) so the glyph always stays square', () => {
    renderEmoji({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().keepAspectRatio).toBe(true);
  });

  it('applies the ported legacy min size (32x32)', () => {
    renderEmoji({ onResizeEnd: vi.fn() }, true);
    expect(lastResizerProps().minWidth).toBe(32);
    expect(lastResizerProps().minHeight).toBe(32);
  });

  it('commits the resize as a single numeric size (max of width/height, matching legacy)', () => {
    const onResizeEnd = vi.fn();
    renderEmoji({ onResizeEnd }, true);
    lastResizerProps().onResizeEnd?.({} as never, { x: 0, y: 0, width: 96, height: 90 });
    expect(onResizeEnd).toHaveBeenCalledWith('e1', 96);
  });

  // ── P4-T24: rotation ─────────────────────────────────────────────────────

  it('renders a rotation handle when selected, editable, and onRotate is provided', () => {
    renderEmoji({ onRotate: vi.fn() }, true);
    expect(screen.getByTitle(/Rotate/)).toBeInTheDocument();
  });

  it('does not render a rotation handle when read-only (no onRotate)', () => {
    renderEmoji({}, true);
    expect(screen.queryByTitle(/Rotate/)).not.toBeInTheDocument();
  });

  it('commits a rotation via onRotate on drag', () => {
    const onRotate = vi.fn();
    const { container } = renderEmoji({ rotation: 0, onRotate }, true);
    const handle = screen.getByTitle(/Rotate/);
    const wrapper = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 64,
      bottom: 64,
      width: 64,
      height: 64,
      x: 0,
      y: 0,
      toJSON() {},
    });
    fireEvent.pointerDown(handle, { clientX: 32, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 32, pointerId: 1 });
    expect(onRotate).toHaveBeenCalled();
    const [id, deg] = onRotate.mock.calls[onRotate.mock.calls.length - 1] as [string, number];
    expect(id).toBe('e1');
    expect(deg).not.toBe(0);
  });
});
