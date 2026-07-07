// TextNode: a free-floating label. Ported from the prototype's TextNode.tsx —
// no connection handles (legacy TextNode never had any) and no rotation
// (labels don't rotate in the legacy model either).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { TextNode } from './TextNode.js';
import type { TextNodeData } from './TextNode.js';

afterEach(() => {
  cleanup();
});

function renderText(data: Partial<TextNodeData> = {}, selected = false) {
  const fullData: TextNodeData = { text: 'A label', ...data };
  const props = makeNodeProps('text', { id: 't1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <TextNode {...props} />
    </RfTestHarness>,
  );
}

describe('TextNode', () => {
  it('renders its label', () => {
    renderText({ text: 'Step 1' });
    expect(screen.getByText('Step 1')).toBeInTheDocument();
  });

  it('shows the description badge when data.description is set', () => {
    renderText({ description: 'notes' });
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show the description badge when data.description is unset', () => {
    renderText({ description: undefined });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not enter edit mode on double-click when no onTextChange is provided (read-only)', () => {
    renderText({ text: 'Step 1' });
    fireEvent.doubleClick(screen.getByText('Step 1'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onTextChange is provided', () => {
    renderText({ text: 'Step 1', onTextChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('Step 1'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new text via onTextChange on Enter', () => {
    const onTextChange = vi.fn();
    renderText({ text: 'Step 1', onTextChange });
    fireEvent.doubleClick(screen.getByText('Step 1'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Step 2' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onTextChange).toHaveBeenCalledWith('t1', 'Step 2');
  });
});
