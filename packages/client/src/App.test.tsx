import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.js';
import { FakeAwareness } from './test/fake-awareness.js';
import { hasStoredUser, setLocalUser } from './lib/identity.js';

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

// The (non-READONLY) board route always supplies a `slug`, so BoardCanvas
// always joins a realtime room (P5-T29) — mocked here so these App-level
// routing/rendering tests stay fast, deterministic, and network-free (they're
// not exercising the realtime wiring itself: that's lib/realtime.test.ts and
// board-store.test.ts's "realtime room integration" describe block). The fake
// room starts pre-synced (`synced: true`) so BoardCanvas's connecting
// placeholder never blocks these tests' assertions on the rendered canvas.
const joinBoardRoomMock = vi.hoisted(() => vi.fn());
vi.mock('./lib/realtime.js', () => ({
  joinBoardRoom: joinBoardRoomMock,
}));

function fakeSyncedProvider() {
  return { synced: true, on: vi.fn(), off: vi.fn() };
}

function fakeRoom(roomName = 'spend') {
  return {
    roomName,
    provider: fakeSyncedProvider(),
    // P5-T30: a real (structural) awareness double rather than `{}` — the
    // editable canvas's presence wiring (usePresence/useFollowMode) now
    // calls real methods (getStates/on/off/setLocalStateField) on
    // `store.room.awareness`.
    awareness: new FakeAwareness(1),
    synced: true,
    onSyncedChange: vi.fn(() => vi.fn()),
    destroy: vi.fn(),
  };
}

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
    joinBoardRoomMock.mockReset().mockImplementation((_doc, slug: string) => fakeRoom(slug));
    setHash('');
    localStorage.clear();
    // P5-T30: IdentityPrompt (gated on `!hasStoredUser()`) is wired into App
    // now — default every test in this describe block to a "returning user"
    // (a name already stored) so the prompt doesn't intrude on assertions
    // that predate presence and aren't about identity. The dedicated
    // "IdentityPrompt wiring" describe block below clears storage again to
    // test the first-time-user path specifically.
    setLocalUser('Returning User');
  });

  afterEach(() => {
    cleanup();
    setHash('');
    localStorage.clear();
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

  // P5-T29: the editable board route joins the realtime room for the routed
  // slug/path — this is the whole point of the board route wiring (App.tsx
  // fetches the BoardFile for metadata/existence, then BoardCanvas's store
  // joins the room for content).
  it('an editable board route joins the realtime room for the routed slug/path', async () => {
    setHash('#/spend/nodeA');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.react-flow')).toBeInTheDocument());
    expect(joinBoardRoomMock).toHaveBeenCalledTimes(1);
    const [, slug, path] = joinBoardRoomMock.mock.calls[0]!;
    expect(slug).toBe('spend');
    expect(path).toEqual(['nodeA']);
  });

  // P5-T29: an EDITABLE board route no longer seeds rendered content from the
  // fetched BoardFile at all — it joins the realtime room instead (see
  // board-store.ts's module doc), so a fixture node from `getBoard` never
  // appears here unless the (mocked) room actually delivers it. That path is
  // covered by board-store.test.ts's "realtime room integration" describe
  // block and the E2E gate; this test instead proves the OTHER hydration
  // path App.tsx still uses verbatim — READONLY mode, which DOES seed
  // directly from the fetched BoardFile (no room joined at all).
  it('renders a fixture board node inside the canvas in READONLY mode (fetched-board hydration)', async () => {
    modeMock.READONLY = true;
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
    // READONLY never joins a room.
    expect(joinBoardRoomMock).not.toHaveBeenCalled();
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

  // ── P5-T30: IdentityPrompt wiring ────────────────────────────────────────
  // A first-time user (no stored name — `lib/identity.ts`'s `hasStoredUser()`
  // is false) is prompted to set a display name before presence can publish
  // anything meaningful; a returning user (a name already stored) is never
  // prompted. Presence itself needs SOME name to publish, so the prompt must
  // appear before/alongside the board canvas, not block it structurally.
  describe('IdentityPrompt wiring', () => {
    beforeEach(() => {
      // Override this file's default "returning user" seed (see the outer
      // beforeEach) — these tests specifically exercise the first-time-user
      // gate, so they need a genuinely empty identity store.
      localStorage.clear();
    });

    it('prompts a first-time user (no stored name) for a display name', async () => {
      setHash('#/');
      render(<App />);
      await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());
      expect(screen.getByText(/who are you/i)).toBeInTheDocument();
    });

    it('does not prompt a returning user (a name already stored)', async () => {
      setLocalUser('Ada Lovelace');
      setHash('#/');
      render(<App />);
      await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());
      expect(screen.queryByText(/who are you/i)).not.toBeInTheDocument();
    });

    it('submitting a name in the prompt persists it and dismisses the prompt', async () => {
      setHash('#/');
      render(<App />);
      await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());
      expect(screen.getByText(/who are you/i)).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(/your name/i), {
        target: { value: 'Grace Hopper' },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      expect(screen.queryByText(/who are you/i)).not.toBeInTheDocument();
      expect(hasStoredUser()).toBe(true);
    });

    it('canceling the prompt dismisses it without persisting a name', async () => {
      setHash('#/');
      render(<App />);
      await waitFor(() => expect(boardsApiMock.listBoards).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      expect(screen.queryByText(/who are you/i)).not.toBeInTheDocument();
      expect(hasStoredUser()).toBe(false);
    });

    it('never prompts in READONLY mode', async () => {
      modeMock.READONLY = true;
      setHash('#/spend');
      render(<App />);
      await waitFor(() => expect(document.querySelector('.react-flow')).toBeInTheDocument());
      expect(screen.queryByText(/who are you/i)).not.toBeInTheDocument();
    });
  });
});
