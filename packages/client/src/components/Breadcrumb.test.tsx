import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import Breadcrumb from './Breadcrumb.js';

afterEach(() => {
  cleanup();
});

describe('Breadcrumb', () => {
  it('renders the board slug/label as the current crumb when path is empty', () => {
    render(
      <Breadcrumb
        boardLabel="Spend"
        path={[]}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={false}
      />,
    );
    expect(screen.getByText('Spend')).toBeInTheDocument();
  });

  it('renders sub-board path segments as crumbs', () => {
    render(
      <Breadcrumb
        boardLabel="Spend"
        pathLabels={['Node A', 'Sub B']}
        path={['nodeA', 'subB']}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={false}
      />,
    );
    expect(screen.getByText('Node A')).toBeInTheDocument();
    expect(screen.getByText('Sub B')).toBeInTheDocument();
  });

  it('clicking a non-current crumb calls onNavigate with the crumb path', () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        boardLabel="Spend"
        pathLabels={['Node A', 'Sub B']}
        path={['nodeA', 'subB']}
        onNavigate={onNavigate}
        onGoHome={vi.fn()}
        isDirty={false}
      />,
    );
    fireEvent.click(screen.getByText('Node A'));
    expect(onNavigate).toHaveBeenCalledWith(['nodeA']);
  });

  it('the "← Back" button goes up exactly one level (not straight to the root)', () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        boardLabel="Spend"
        pathLabels={['Node A', 'Sub B']}
        path={['nodeA', 'subB']}
        onNavigate={onNavigate}
        onGoHome={vi.fn()}
        isDirty={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /← back/i }));
    expect(onNavigate).toHaveBeenCalledWith(['nodeA']);
  });

  it('clicking "Boards" calls onGoHome', () => {
    const onGoHome = vi.fn();
    render(
      <Breadcrumb
        boardLabel="Spend"
        path={[]}
        onNavigate={vi.fn()}
        onGoHome={onGoHome}
        isDirty={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /boards/i }));
    expect(onGoHome).toHaveBeenCalled();
  });

  it('shows a delete-sub-board affordance only when path is non-empty and onDelete is provided', () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <Breadcrumb
        boardLabel="Spend"
        path={[]}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.queryByRole('button', { name: /delete sub-board/i })).not.toBeInTheDocument();

    rerender(
      <Breadcrumb
        boardLabel="Spend"
        path={['nodeA']}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={false}
        onDelete={onDelete}
      />,
    );
    const delBtn = screen.getByRole('button', { name: /delete sub-board/i });
    fireEvent.click(delBtn);
    expect(onDelete).toHaveBeenCalled();
  });

  it('does not show the delete affordance when onDelete is omitted, even with a non-empty path', () => {
    render(
      <Breadcrumb
        boardLabel="Spend"
        path={['nodeA']}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /delete sub-board/i })).not.toBeInTheDocument();
  });

  it('renders a dirty indicator when isDirty is true', () => {
    render(
      <Breadcrumb
        boardLabel="Spend"
        path={[]}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={true}
      />,
    );
    expect(screen.getByTitle(/unsaved/i)).toBeInTheDocument();
  });

  it('does not render a dirty indicator when isDirty is false', () => {
    render(
      <Breadcrumb
        boardLabel="Spend"
        path={[]}
        onNavigate={vi.fn()}
        onGoHome={vi.fn()}
        isDirty={false}
      />,
    );
    expect(screen.queryByTitle(/unsaved/i)).not.toBeInTheDocument();
  });
});
