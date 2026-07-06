import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Dashboard from './Dashboard.js';
import type { BoardListItem } from '../lib/boards-api.js';

const boardsApiMock = vi.hoisted(() => ({
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  saveTags: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => boardsApiMock);

const modeMock = vi.hoisted(() => ({ READONLY: false }));
vi.mock('../app/mode.js', () => modeMock);

function makeBoard(overrides: Partial<BoardListItem> & { slug: string }): BoardListItem {
  return {
    label: overrides.slug,
    tags: [],
    subBoardPaths: [],
    lastModifiedMs: Date.now(),
    ...overrides,
  };
}

describe('Dashboard', () => {
  const onPick = vi.fn();
  const onGoHome = vi.fn();

  beforeEach(() => {
    modeMock.READONLY = false;
    boardsApiMock.listBoards.mockReset();
    boardsApiMock.createBoard.mockReset().mockResolvedValue(undefined);
    onPick.mockReset();
    onGoHome.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading state before boards resolve', () => {
    boardsApiMock.listBoards.mockReturnValue(new Promise(() => {}));
    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders boards matching the tag filter, with label, tags, and last-modified', async () => {
    boardsApiMock.listBoards.mockResolvedValue([
      makeBoard({
        slug: 'spend',
        label: 'Spend Tracker',
        tags: ['roadmap'],
        lastModifiedMs: Date.now(),
      }),
      makeBoard({ slug: 'other', label: 'Other board', tags: ['q3'] }),
    ]);

    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );

    await waitFor(() => expect(screen.getByText('Spend Tracker')).toBeInTheDocument());
    expect(screen.queryByText('Other board')).not.toBeInTheDocument();
    expect(screen.getByText('roadmap')).toBeInTheDocument();
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
  });

  it('renders untagged boards when filter kind is untagged', async () => {
    boardsApiMock.listBoards.mockResolvedValue([
      makeBoard({ slug: 'tagged', tags: ['roadmap'] }),
      makeBoard({ slug: 'bare', label: 'Bare board', tags: [] }),
    ]);

    render(<Dashboard filter={{ kind: 'untagged' }} onPick={onPick} onGoHome={onGoHome} />);

    await waitFor(() => expect(screen.getByText('Bare board')).toBeInTheDocument());
    expect(screen.queryByText('tagged')).not.toBeInTheDocument();
  });

  it('clicking a board card calls onPick with its slug', async () => {
    boardsApiMock.listBoards.mockResolvedValue([
      makeBoard({ slug: 'spend', label: 'Spend Tracker', tags: ['roadmap'] }),
    ]);

    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );

    await waitFor(() => expect(screen.getByText('Spend Tracker')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spend Tracker'));
    expect(onPick).toHaveBeenCalledWith('spend');
  });

  it('renders an empty state when no boards match the filter', async () => {
    boardsApiMock.listBoards.mockResolvedValue([]);
    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );
    await waitFor(() => expect(screen.getByText(/no boards/i)).toBeInTheDocument());
  });

  it('renders an error state when listBoards rejects', async () => {
    boardsApiMock.listBoards.mockRejectedValue(new Error('boom'));
    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
  });

  it('shows a "New board" button in dev mode and opens the modal on click', async () => {
    boardsApiMock.listBoards.mockResolvedValue([]);
    render(<Dashboard filter={{ kind: 'untagged' }} onPick={onPick} onGoHome={onGoHome} />);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /new board/i }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /new board/i })[0]);
    expect(screen.getByRole('heading', { name: /new board/i })).toBeInTheDocument();
  });

  it('hides the "New board" button in READONLY mode', async () => {
    modeMock.READONLY = true;
    boardsApiMock.listBoards.mockResolvedValue([makeBoard({ slug: 'spend', tags: ['roadmap'] })]);
    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );
    await waitFor(() => expect(screen.getByText('spend')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new board/i })).not.toBeInTheDocument();
  });

  it('hides the tag-edit affordance on board cards in READONLY mode', async () => {
    modeMock.READONLY = true;
    boardsApiMock.listBoards.mockResolvedValue([makeBoard({ slug: 'spend', tags: ['roadmap'] })]);
    render(
      <Dashboard filter={{ kind: 'tag', name: 'roadmap' }} onPick={onPick} onGoHome={onGoHome} />,
    );
    await waitFor(() => expect(screen.getByText('spend')).toBeInTheDocument());
    fireEvent.mouseEnter(screen.getByText('spend'));
    expect(screen.queryByTitle(/edit tags/i)).not.toBeInTheDocument();
  });

  it('clicking "All tags" / go-home control calls onGoHome', async () => {
    boardsApiMock.listBoards.mockResolvedValue([]);
    render(<Dashboard filter={{ kind: 'untagged' }} onPick={onPick} onGoHome={onGoHome} />);
    await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /all tags/i }));
    expect(onGoHome).toHaveBeenCalled();
  });
});
