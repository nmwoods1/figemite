import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import TagList from './TagList.js';
import type { BoardListItem } from '../lib/boards-api.js';

const boardsApiMock = vi.hoisted(() => ({
  listBoards: vi.fn(),
  createBoard: vi.fn(),
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

describe('TagList', () => {
  const onPickTag = vi.fn();
  const onPickUntagged = vi.fn();
  const onPickBoard = vi.fn();

  beforeEach(() => {
    modeMock.READONLY = false;
    boardsApiMock.listBoards.mockReset();
    boardsApiMock.createBoard.mockReset().mockResolvedValue(undefined);
    onPickTag.mockReset();
    onPickUntagged.mockReset();
    onPickBoard.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading state before boards resolve', () => {
    boardsApiMock.listBoards.mockReturnValue(new Promise(() => {}));
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders a card per distinct tag, plus an untagged card', async () => {
    boardsApiMock.listBoards.mockResolvedValue([
      makeBoard({ slug: 'a', tags: ['roadmap'] }),
      makeBoard({ slug: 'b', tags: ['roadmap', 'q3'] }),
      makeBoard({ slug: 'c', tags: [] }),
    ]);

    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );

    await waitFor(() => expect(screen.getByText('roadmap')).toBeInTheDocument());
    expect(screen.getByText('q3')).toBeInTheDocument();
    expect(screen.getByText('Untagged')).toBeInTheDocument();
  });

  it('clicking a tag card calls onPickTag with the tag name', async () => {
    boardsApiMock.listBoards.mockResolvedValue([makeBoard({ slug: 'a', tags: ['roadmap'] })]);
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    await waitFor(() => expect(screen.getByText('roadmap')).toBeInTheDocument());
    fireEvent.click(screen.getByText('roadmap'));
    expect(onPickTag).toHaveBeenCalledWith('roadmap');
  });

  it('clicking the untagged card calls onPickUntagged', async () => {
    boardsApiMock.listBoards.mockResolvedValue([makeBoard({ slug: 'a', tags: [] })]);
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    await waitFor(() => expect(screen.getByText('Untagged')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Untagged'));
    expect(onPickUntagged).toHaveBeenCalled();
  });

  it('renders an empty state with no tags and no boards', async () => {
    boardsApiMock.listBoards.mockResolvedValue([]);
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    await waitFor(() => expect(screen.getByText(/no boards yet/i)).toBeInTheDocument());
  });

  it('renders an error state when listBoards rejects', async () => {
    boardsApiMock.listBoards.mockRejectedValue(new Error('boom'));
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
  });

  it('shows a "New board" button in dev mode', async () => {
    boardsApiMock.listBoards.mockResolvedValue([]);
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /new board/i }).length).toBeGreaterThan(0),
    );
  });

  it('hides the "New board" button in READONLY mode', async () => {
    modeMock.READONLY = true;
    boardsApiMock.listBoards.mockResolvedValue([makeBoard({ slug: 'a', tags: ['roadmap'] })]);
    render(
      <TagList onPickTag={onPickTag} onPickUntagged={onPickUntagged} onPickBoard={onPickBoard} />,
    );
    await waitFor(() => expect(screen.getByText('roadmap')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new board/i })).not.toBeInTheDocument();
  });
});
