import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import App from './App.js';

const boardsApiMock = vi.hoisted(() => ({
  listBoards: vi.fn(),
  getBoard: vi.fn(),
  saveBoard: vi.fn(),
  createBoard: vi.fn(),
  deleteSubBoard: vi.fn(),
  saveTags: vi.fn(),
}));
vi.mock('./lib/boards-api.js', () => boardsApiMock);

const modeMock = vi.hoisted(() => ({ READONLY: false }));
vi.mock('./app/mode.js', () => modeMock);

function setHash(hash: string) {
  window.location.hash = hash;
}

describe('App view switch', () => {
  beforeEach(() => {
    modeMock.READONLY = false;
    boardsApiMock.listBoards.mockReset().mockResolvedValue([]);
    boardsApiMock.getBoard.mockReset().mockResolvedValue({
      formatVersion: 1,
      boardLabel: 'Spend Tracker',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    boardsApiMock.saveBoard.mockReset().mockResolvedValue(undefined);
    boardsApiMock.createBoard.mockReset().mockResolvedValue(undefined);
    boardsApiMock.deleteSubBoard.mockReset().mockResolvedValue(undefined);
    setHash('');
  });

  afterEach(() => {
    cleanup();
    setHash('');
  });

  it('renders TagList at the root hash (tagList view)', async () => {
    setHash('#/');
    render(<App />);
    await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Boards' })).toBeInTheDocument();
  });

  it('renders a tag-filtered board list for #/tag/<tag>', async () => {
    boardsApiMock.listBoards.mockResolvedValue([
      {
        slug: 'spend',
        label: 'Spend Tracker',
        tags: ['roadmap'],
        subBoardPaths: [],
        lastModifiedMs: Date.now(),
      },
    ]);
    setHash('#/tag/roadmap');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Spend Tracker')).toBeInTheDocument());
    expect(screen.getByText('# roadmap')).toBeInTheDocument();
  });

  it('renders an untagged board list for #/untagged', async () => {
    boardsApiMock.listBoards.mockResolvedValue([
      {
        slug: 'bare',
        label: 'Bare board',
        tags: [],
        subBoardPaths: [],
        lastModifiedMs: Date.now(),
      },
    ]);
    setHash('#/untagged');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Bare board')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Untagged' })).toBeInTheDocument();
  });

  it('renders the breadcrumb and the BoardCanvas for a board route, without crashing', async () => {
    setHash('#/spend');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Spend Tracker')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /boards/i })).toBeInTheDocument();
    expect(document.querySelector('.react-flow')).toBeInTheDocument();
    expect(screen.queryByText(/coming in phase 3/i)).not.toBeInTheDocument();
  });

  it('renders a fixture board node inside the canvas via BoardCanvas', async () => {
    boardsApiMock.getBoard.mockResolvedValue({
      formatVersion: 1,
      boardLabel: 'Spend Tracker',
      nodes: [
        {
          id: 's1',
          type: 'sticky',
          pos: { x: 0, y: 0 },
          order: 0,
          size: { width: 200, height: 160 },
          text: 'Groceries',
          color: '#fef3c7',
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    setHash('#/spend');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());
  });

  it('renders sub-board path segments in the breadcrumb for a nested board route', async () => {
    setHash('#/spend/nodeA');
    render(<App />);
    await waitFor(() => expect(boardsApiMock.getBoard).toHaveBeenCalledWith('spend', ['nodeA']));
    await waitFor(() => expect(document.querySelector('.react-flow')).toBeInTheDocument());
  });

  it('shows a delete-sub-board affordance on a nested board route in dev mode', async () => {
    setHash('#/spend/nodeA');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.react-flow')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /delete sub-board/i })).toBeInTheDocument();
  });

  describe('READONLY mode', () => {
    beforeEach(() => {
      modeMock.READONLY = true;
    });

    it('hides the delete-sub-board affordance on a nested board route', async () => {
      setHash('#/spend/nodeA');
      render(<App />);
      await waitFor(() => expect(document.querySelector('.react-flow')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /delete sub-board/i })).not.toBeInTheDocument();
    });

    it('hides the "New board" button on the tagList view', async () => {
      setHash('#/');
      render(<App />);
      await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /new board/i })).not.toBeInTheDocument();
    });
  });
});
