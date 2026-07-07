// The description badge: shown when `data.description` exists (or, for an
// editable node, when `hovered`); clicking it calls
// `data.onOpenDescription?.(id)`. No modal here — P3-T19 is render-only, the
// TipTap description modal is a later task. This badge is just the seam.
//
// `hovered` is a plain prop, not internal state: an earlier version tracked
// hover itself via a `pointer-events: none` wrapper div + local state, which
// only ever worked with jsdom's synthetic `fireEvent.mouseEnter` (which
// bypasses CSS pointer-events) — a REAL browser mouse can never trigger
// `onMouseEnter` on a `pointer-events: none` element, so that hover-reveal
// was unreachable for real users. Hover detection now lives in the caller
// (`BaseNode`, on its rotation wrapper, a real pointer-events-auto element)
// and is passed in here — see BaseNode.test.tsx for the hover-reveal
// coverage and BaseNode.tsx's module doc for the full rationale.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DescriptionBadge } from './DescriptionBadge.js';

afterEach(() => {
  cleanup();
});

describe('DescriptionBadge', () => {
  it('renders when a description is present', () => {
    render(
      <DescriptionBadge nodeId="n1" description="Some notes" editable={false} hovered={false} />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not render when there is no description and the node is read-only', () => {
    render(
      <DescriptionBadge nodeId="n1" description={undefined} editable={false} hovered={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render without a description when editable but not hovered', () => {
    render(<DescriptionBadge nodeId="n1" description={undefined} editable hovered={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders without a description when editable and hovered', () => {
    render(<DescriptionBadge nodeId="n1" description={undefined} editable hovered />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not render without a description when hovered but not editable (read-only)', () => {
    render(<DescriptionBadge nodeId="n1" description={undefined} editable={false} hovered />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onOpenDescription with the node id when clicked', () => {
    const onOpenDescription = vi.fn();
    render(
      <DescriptionBadge
        nodeId="n42"
        description="notes"
        editable={false}
        hovered={false}
        onOpenDescription={onOpenDescription}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDescription).toHaveBeenCalledWith('n42');
  });
});
