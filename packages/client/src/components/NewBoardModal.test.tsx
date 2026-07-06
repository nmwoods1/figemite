import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NewBoardModal from './NewBoardModal.js';

const boardsApiMock = vi.hoisted(() => ({
  createBoard: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => boardsApiMock);

describe('NewBoardModal', () => {
  const onCreated = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    boardsApiMock.createBoard.mockReset().mockResolvedValue(undefined);
    onCreated.mockReset();
    onClose.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('submitting a valid name/slug calls createBoard and reports the created slug', async () => {
    render(<NewBoardModal onCreated={onCreated} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Product Brainstorm' } });
    fireEvent.click(screen.getByRole('button', { name: /create board/i }));

    await vi.waitFor(() => expect(boardsApiMock.createBoard).toHaveBeenCalled());
    expect(boardsApiMock.createBoard).toHaveBeenCalledWith(
      'product-brainstorm',
      'Product Brainstorm',
    );
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('product-brainstorm'));
  });

  it('shows a validation message for an invalid slug and does not call createBoard', () => {
    render(<NewBoardModal onCreated={onCreated} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Valid Name' } });
    fireEvent.change(screen.getByLabelText(/slug/i), { target: { value: '!!!' } });
    fireEvent.click(screen.getByRole('button', { name: /create board/i }));

    expect(screen.getByText(/letters, digits/i)).toBeInTheDocument();
    expect(boardsApiMock.createBoard).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('clicking cancel calls onClose without calling createBoard', () => {
    render(<NewBoardModal onCreated={onCreated} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(boardsApiMock.createBoard).not.toHaveBeenCalled();
  });

  it('pressing Escape calls onClose', () => {
    render(<NewBoardModal onCreated={onCreated} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
