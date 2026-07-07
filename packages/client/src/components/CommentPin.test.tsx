// ── CommentPin tests ──────────────────────────────────────────────────────────
//
// A small pin/badge rendered at a screen position by CommentLayer — shows the
// reply count and dims when the comment is resolved. Ported (visual design)
// from the original prototype's `src/components/CommentPin.tsx`,
// rewired to this codebase's `@figemite/shared` `BoardComment` type.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BoardComment } from '@figemite/shared';
import { CommentPin } from './CommentPin.js';

function fixtureComment(overrides: Partial<BoardComment> = {}): BoardComment {
  return {
    id: 'comment1',
    target: { type: 'canvas', pos: { x: 0, y: 0 } },
    author: 'Ada',
    createdAt: '2024-01-01T00:00:00.000Z',
    text: 'hello',
    resolved: false,
    replies: [],
    ...overrides,
  };
}

describe('CommentPin', () => {
  afterEach(() => cleanup());

  it('renders the reply count', () => {
    const comment = fixtureComment({
      replies: [
        { id: 'r1', author: 'Bob', createdAt: '2024-01-01T00:00:00.000Z', text: 'reply1' },
        { id: 'r2', author: 'Bob', createdAt: '2024-01-01T00:00:00.000Z', text: 'reply2' },
      ],
    });
    render(<CommentPin comment={comment} screenX={10} screenY={20} onClick={vi.fn()} />);
    expect(screen.getByTestId(`comment-pin-${comment.id}`)).toHaveTextContent('2');
  });

  it('renders no count badge text when there are no replies', () => {
    const comment = fixtureComment({ replies: [] });
    render(<CommentPin comment={comment} screenX={10} screenY={20} onClick={vi.fn()} />);
    expect(screen.getByTestId(`comment-pin-${comment.id}`)).toHaveTextContent('');
  });

  it('is dimmed when resolved', () => {
    const comment = fixtureComment({ resolved: true });
    render(<CommentPin comment={comment} screenX={10} screenY={20} onClick={vi.fn()} />);
    const pin = screen.getByTestId(`comment-pin-${comment.id}`);
    expect(pin.getAttribute('data-resolved')).toBe('true');
  });

  it('is not dimmed when unresolved', () => {
    const comment = fixtureComment({ resolved: false });
    render(<CommentPin comment={comment} screenX={10} screenY={20} onClick={vi.fn()} />);
    const pin = screen.getByTestId(`comment-pin-${comment.id}`);
    expect(pin.getAttribute('data-resolved')).toBe('false');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const comment = fixtureComment();
    render(<CommentPin comment={comment} screenX={10} screenY={20} onClick={onClick} />);
    fireEvent.click(screen.getByTestId(`comment-pin-${comment.id}`));
    expect(onClick).toHaveBeenCalled();
  });

  it('positions itself at the given screen coordinates', () => {
    const comment = fixtureComment();
    render(<CommentPin comment={comment} screenX={123} screenY={456} onClick={vi.fn()} />);
    const pin = screen.getByTestId(`comment-pin-${comment.id}`);
    expect(pin.style.left).toBe('123px');
    expect(pin.style.top).toBe('456px');
  });
});
