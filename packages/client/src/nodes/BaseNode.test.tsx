// BaseNode is the shared chrome every node component composes: a rotation
// wrapper (applies `data.rotation` deg as a CSS transform), the description
// badge slot, and the double-click-to-edit affordance (only active when
// `onDoubleClick` is actually provided — the seam for read-only boards).

import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { BaseNode } from './BaseNode.js';

afterEach(() => {
  cleanup();
});

describe('BaseNode', () => {
  it('renders its children', () => {
    render(
      <BaseNode nodeId="n1">
        <div>content</div>
      </BaseNode>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('applies a rotation transform when data.rotation is set', () => {
    const { container } = render(
      <BaseNode nodeId="n1" rotation={45}>
        <div>content</div>
      </BaseNode>,
    );
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.style.transform).toBe('rotate(45deg)');
  });

  it('applies no rotation transform when rotation is absent', () => {
    const { container } = render(
      <BaseNode nodeId="n1">
        <div>content</div>
      </BaseNode>,
    );
    const rotated = container.querySelector('[data-testid="base-node-rotation"]') as HTMLElement;
    expect(rotated.style.transform).toBe('');
  });

  it('shows the description badge when a description is present', () => {
    render(
      <BaseNode nodeId="n1" description="notes">
        <div>content</div>
      </BaseNode>,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not show the description badge when there is none and the node is not editable', () => {
    render(
      <BaseNode nodeId="n1">
        <div>content</div>
      </BaseNode>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('invokes onOpenDescription with the node id when the badge is clicked', () => {
    const onOpenDescription = vi.fn();
    render(
      <BaseNode nodeId="n7" description="notes" onOpenDescription={onOpenDescription}>
        <div>content</div>
      </BaseNode>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDescription).toHaveBeenCalledWith('n7');
  });

  it('calls onDoubleClick when double-clicked and the handler is provided (editable seam)', () => {
    const onDoubleClick = vi.fn();
    render(
      <BaseNode nodeId="n1" onDoubleClick={onDoubleClick}>
        <div>content</div>
      </BaseNode>,
    );
    fireEvent.doubleClick(screen.getByText('content'));
    expect(onDoubleClick).toHaveBeenCalled();
  });

  it('does nothing on double-click when no onDoubleClick handler is provided (read-only)', () => {
    render(
      <BaseNode nodeId="n1">
        <div>content</div>
      </BaseNode>,
    );
    // Should not throw, and no editable affordance is invoked.
    expect(() => fireEvent.doubleClick(screen.getByText('content'))).not.toThrow();
  });

  it('renders a selection ring styling hook when selected', () => {
    const { container } = render(
      <BaseNode nodeId="n1" selected>
        <div>content</div>
      </BaseNode>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.selected).toBe('true');
  });

  it('forwards rotationRef to the rotation wrapper div (so RotationHandle can measure it)', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <BaseNode nodeId="n1" rotationRef={ref}>
        <div>content</div>
      </BaseNode>,
    );
    expect(ref.current).not.toBeNull();
    expect(ref.current?.dataset.testid).toBe('base-node-rotation');
  });
});
