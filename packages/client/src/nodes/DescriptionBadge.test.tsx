// The description badge: shown when `data.description` exists (or, for an
// editable node, on hover); clicking it calls `data.onOpenDescription?.(id)`.
// No modal here — P3-T19 is render-only, the TipTap description modal is a
// later task. This badge is just the seam.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DescriptionBadge } from './DescriptionBadge.js';

afterEach(() => {
  cleanup();
});

describe('DescriptionBadge', () => {
  it('renders when a description is present', () => {
    render(<DescriptionBadge nodeId="n1" description="Some notes" editable={false} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not render when there is no description and the node is read-only', () => {
    render(<DescriptionBadge nodeId="n1" description={undefined} editable={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render without a description when editable but not hovered', () => {
    render(<DescriptionBadge nodeId="n1" description={undefined} editable />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders without a description when editable and hovered', () => {
    const { container } = render(<DescriptionBadge nodeId="n1" description={undefined} editable />);
    const wrapper = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onOpenDescription with the node id when clicked', () => {
    const onOpenDescription = vi.fn();
    render(
      <DescriptionBadge
        nodeId="n42"
        description="notes"
        editable={false}
        onOpenDescription={onOpenDescription}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDescription).toHaveBeenCalledWith('n42');
  });
});
