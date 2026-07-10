// The drill-in badge: shown always when the node already has a sub-board
// (navigate-in, even in read-only mode); shown on hover for an editable node
// with no sub-board yet (create-one affordance). Clicking calls
// `onDrillIn(id)`. Hover is a plain prop owned by the caller (BaseNode) — see
// DescriptionBadge.test.tsx / BaseNode.tsx for that rationale.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DrillInBadge } from './DrillInBadge.js';

afterEach(() => {
  cleanup();
});

describe('DrillInBadge', () => {
  it('renders when the node has a sub-board (even when read-only / not hovered)', () => {
    render(<DrillInBadge nodeId="n1" hasSubBoard canCreate={false} hovered={false} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Open sub-board');
  });

  it('does not render without a sub-board when not creatable (read-only) even if hovered', () => {
    render(<DrillInBadge nodeId="n1" hasSubBoard={false} canCreate={false} hovered />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render without a sub-board when creatable but not hovered', () => {
    render(<DrillInBadge nodeId="n1" hasSubBoard={false} canCreate hovered={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a "create" affordance without a sub-board when creatable and hovered', () => {
    render(<DrillInBadge nodeId="n1" hasSubBoard={false} canCreate hovered />);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('title', 'Create sub-board');
  });

  it('calls onDrillIn with the node id when clicked', () => {
    const onDrillIn = vi.fn();
    render(
      <DrillInBadge
        nodeId="n42"
        hasSubBoard
        canCreate={false}
        hovered={false}
        onDrillIn={onDrillIn}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onDrillIn).toHaveBeenCalledWith('n42');
  });
});
