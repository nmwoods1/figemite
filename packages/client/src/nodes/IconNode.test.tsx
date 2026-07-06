// IconNode: a registry icon (lib/icons.ts) rendered at a color + size, with
// rotation. Ported from figmalade's IconNode.tsx — no editable text (icons
// have no text to edit), connection handles + description badge carry over.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { IconNode } from './IconNode.js';
import type { IconNodeData } from './IconNode.js';

afterEach(() => {
  cleanup();
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

  it('renders 4 connection handles when an onOpenDescription (editable) callback is present', () => {
    const { container } = renderIcon({ onOpenDescription: vi.fn() });
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });

  it('renders no connection handles when fully read-only', () => {
    const { container } = renderIcon();
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(0);
  });

  it('nests connection handles inside the rotation wrapper (handles rotate with the icon)', () => {
    const { container } = renderIcon({ onOpenDescription: vi.fn(), rotation: 45 });
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  });
});
