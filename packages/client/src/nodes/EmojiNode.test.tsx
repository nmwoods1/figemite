// EmojiNode: a single emoji glyph rendered at a pixel size. Ported from
// figmalade's EmojiNode.tsx — connection handles, rotation, editable glyph
// text, and the description badge all carry over; resize/rotate
// interaction HANDLERS are Phase 4 (only the `data.rotation` CSS transform
// is applied here, not a drag-to-rotate affordance).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { EmojiNode } from './EmojiNode.js';
import type { EmojiNodeData } from './EmojiNode.js';

afterEach(() => {
  cleanup();
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

  it('renders 4 connection handles when editable', () => {
    const { container } = renderEmoji({ onTextChange: vi.fn() });
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });

  it('renders no connection handles when read-only', () => {
    const { container } = renderEmoji();
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(0);
  });

  it('nests connection handles inside the rotation wrapper (handles rotate with the glyph)', () => {
    const { container } = renderEmoji({ onTextChange: vi.fn(), rotation: 45 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });
});
