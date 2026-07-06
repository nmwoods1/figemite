// FrameNode: a titled container. Ported from figmalade's FrameNode.tsx.
// Legacy FrameNode has no description badge and no connection handles (it's
// a container, not an edge endpoint) and no rotation — none of those are
// added here either, matching legacy behaviour faithfully.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { FrameNode } from './FrameNode.js';
import type { FrameNodeData } from './FrameNode.js';

afterEach(() => {
  cleanup();
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
});
