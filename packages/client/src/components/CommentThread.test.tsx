// ── CommentThread tests ───────────────────────────────────────────────────────
//
// The expanded thread view: the root comment + its replies (author, time,
// text), a reply box, a resolve/unresolve toggle, and delete. Ported
// (structure/behavior) from the original prototype's
// `src/components/CommentThread.tsx`, rewired onto this rewrite's
// `useComments`-shaped callback props instead of the legacy's bespoke
// mutate-and-persist closures.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BoardComment } from '@figemite/shared';
import { CommentThread } from './CommentThread.js';

function fixtureComment(overrides: Partial<BoardComment> = {}): BoardComment {
  return {
    id: 'comment1',
    target: { type: 'canvas', pos: { x: 0, y: 0 } },
    author: 'Ada',
    createdAt: '2024-01-01T00:00:00.000Z',
    text: 'root comment text',
    resolved: false,
    replies: [],
    ...overrides,
  };
}

describe('CommentThread', () => {
  afterEach(() => cleanup());

  it('shows the root comment author and text', () => {
    render(
      <CommentThread
        comment={fixtureComment()}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readonly={false}
      />,
    );
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('root comment text')).toBeInTheDocument();
  });

  it('shows each reply with its author and text', () => {
    const comment = fixtureComment({
      replies: [
        { id: 'r1', author: 'Bob', createdAt: '2024-01-01T00:00:00.000Z', text: 'first reply' },
        { id: 'r2', author: 'Carl', createdAt: '2024-01-01T00:00:00.000Z', text: 'second reply' },
      ],
    });
    render(
      <CommentThread
        comment={comment}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readonly={false}
      />,
    );
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('first reply')).toBeInTheDocument();
    expect(screen.getByText('Carl')).toBeInTheDocument();
    expect(screen.getByText('second reply')).toBeInTheDocument();
  });

  it('submitting a reply calls onReply with the comment id and text', () => {
    const onReply = vi.fn();
    render(
      <CommentThread
        comment={fixtureComment()}
        onReply={onReply}
        onToggleResolved={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readonly={false}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/reply/i), { target: { value: 'my reply' } });
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(onReply).toHaveBeenCalledWith('comment1', 'my reply');
  });

  it('clicking resolve calls onToggleResolved with the comment id', () => {
    const onToggleResolved = vi.fn();
    render(
      <CommentThread
        comment={fixtureComment({ resolved: false })}
        onReply={vi.fn()}
        onToggleResolved={onToggleResolved}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readonly={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    expect(onToggleResolved).toHaveBeenCalledWith('comment1');
  });

  it('shows "Reopen" affordance and a RESOLVED badge when already resolved', () => {
    render(
      <CommentThread
        comment={fixtureComment({ resolved: true })}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readonly={false}
      />,
    );
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument();
  });

  it('clicking delete calls onDelete with the comment id', () => {
    const onDelete = vi.fn();
    render(
      <CommentThread
        comment={fixtureComment()}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
        readonly={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('comment1');
  });

  it('read-only mode hides reply/resolve/delete affordances', () => {
    render(
      <CommentThread
        comment={fixtureComment()}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readonly={true}
      />,
    );
    expect(screen.queryByPlaceholderText(/reply/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <CommentThread
        comment={fixtureComment()}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        onDelete={vi.fn()}
        onClose={onClose}
        readonly={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
