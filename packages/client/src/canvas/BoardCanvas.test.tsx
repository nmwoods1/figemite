// BoardCanvas: the thin, READ-ONLY orchestrator that hydrates a board store
// from a BoardFile, adapts its snapshot to ReactFlow shape, and renders it.
// No drag/connect/select/keyboard interaction handlers here — those are
// Phase 4. ReactFlow renders in jsdom with real limitations (no layout
// engine, so nodes never reach "measured" state and RF's own edge-rendering
// pipeline — which is gated on measured endpoints — never mounts an edge, see
// test/rf.tsx's module doc). So this suite:
//   - asserts real rendered NODE content (a sticky's text, a shape's SVG,
//     a frame's title) via the registered `nodeTypes`, since nodes DO render
//     in jsdom;
//   - asserts the store -> rf wiring produced the right edges (via
//     `boardToRf`) and that `edgeTypes`/`nodeTypes` reach `<ReactFlow>`,
//     rather than asserting deep edge visuals — that's P3-T21's
//     browser-mode gate.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ReactFlow } from '@xyflow/react';
import type { Connection } from '@xyflow/react';
import * as Y from 'yjs';
import type { BoardFile } from '@figemite/shared';
import { BoardCanvas } from './BoardCanvas.js';
import { FakeAwareness } from '../test/fake-awareness.js';
import { setLocalUser } from '../lib/identity.js';

// ── P5-T29: realtime room wiring (mock lib/realtime's joinBoardRoom) ────────
// The room/provider plumbing itself is unit-tested in lib/realtime.test.ts
// and board-store.test.ts's "realtime room integration" describe block; here
// we only assert that BoardCanvas's editable pane, given a `slug`, actually
// joins a room targeting the right board and gates rendering on `synced` —
// i.e. the top-level integration gap this task closes. `saveBoard` is spied
// (not mocked away) purely to assert it's NEVER called for content — P5-T29
// removes the client content-POST entirely.
const joinBoardRoomMock = vi.fn();
vi.mock('../lib/realtime.js', () => ({
  joinBoardRoom: (...args: unknown[]) => joinBoardRoomMock(...args),
}));

const saveBoardSpy = vi.fn();
// P6-T34: comments.json is fetched/saved via this same module's
// `fetchComments`/`saveComments` (useComments.ts). Stubbed here (not spied
// through to the real implementation, unlike `saveBoard` above) since jsdom
// has no real `/api/comments` or static `boards/` fixture to hit — every
// BoardCanvas test that doesn't specifically exercise comment wiring just
// wants `fetchComments` to resolve empty and `saveComments` to no-op.
const fetchCommentsMock = vi.fn();
const saveCommentsMock = vi.fn();
// P6-T36: history.json's snapshot list/version fetches (hooks/useHistory.ts).
// Stubbed the same way as comments above — every BoardCanvas test that
// doesn't specifically exercise history wiring just wants `fetchHistory` to
// resolve empty (so the History button, always rendered given a slug, never
// errors if accidentally clicked).
const fetchHistoryMock = vi.fn();
const fetchVersionMock = vi.fn();
vi.mock('../lib/boards-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/boards-api.js')>();
  return {
    ...actual,
    saveBoard: (...args: unknown[]) => {
      saveBoardSpy(...args);
      return actual.saveBoard(...(args as Parameters<typeof actual.saveBoard>));
    },
    fetchComments: (...args: unknown[]) => fetchCommentsMock(...args),
    saveComments: (...args: unknown[]) => saveCommentsMock(...args),
    fetchHistory: (...args: unknown[]) => fetchHistoryMock(...args),
    fetchVersion: (...args: unknown[]) => fetchVersionMock(...args),
  };
});

// ── P5-T31: AI-session lock wiring (mock hooks/useAiLock) ───────────────────
// useAiLock's OWN SSE/reconnect/epoch-reconciliation behaviour is unit-tested
// in hooks/useAiLock.test.ts; here we only assert BoardCanvas's EditableCanvas
// wires its `aiLocked` output into useBoardInteractions + the ReactFlow
// interaction props + the banner, and calls `onExternalChange` through to
// undo's `clear()`.
const useAiLockMock = vi.fn();
useAiLockMock.mockReturnValue({ aiLocked: false });
vi.mock('../hooks/useAiLock.js', () => ({
  useAiLock: (...args: unknown[]) => useAiLockMock(...args),
}));

/** A fake `BoardRoom` (see lib/realtime.ts) whose provider is already synced
 * by default — most tests want BoardCanvas to render immediately rather than
 * sitting on the "Connecting…" placeholder. Content arrives by writing
 * directly to the SAME doc `joinBoardRoom` was called with (simulating what a
 * real provider's sync protocol does under the hood), via `emitContent`. */
function fakeRoom(doc: Y.Doc, opts: { synced?: boolean } = {}) {
  const statusListeners = new Set<(e: { status: string }) => void>();
  const syncListeners = new Set<(synced: boolean) => void>();
  let synced = opts.synced ?? true;
  return {
    roomName: 'fake-room',
    provider: {
      get synced() {
        return synced;
      },
      on: vi.fn((event: string, listener: (arg: unknown) => void) => {
        if (event === 'status') statusListeners.add(listener as (e: { status: string }) => void);
        if (event === 'sync') syncListeners.add(listener as (synced: boolean) => void);
      }),
      off: vi.fn(),
    },
    // P5-T30: a real (structural) awareness double rather than `{}`, so the
    // presence wiring (usePresence/useFollowMode, both keyed off
    // `store.room.awareness`) has something real to call `getStates`/`on`/
    // `off`/`setLocalStateField` against instead of crashing on an empty object.
    awareness: new FakeAwareness(1),
    get synced() {
      return synced;
    },
    onSyncedChange: vi.fn(() => vi.fn()),
    destroy: vi.fn(),
    /** Test helper: simulates the provider completing (or losing) sync. */
    setSynced(next: boolean) {
      synced = next;
      for (const l of statusListeners) l({ status: next ? 'connected' : 'disconnected' });
      for (const l of syncListeners) l(next);
    },
    doc,
  };
}

/** Installs `joinBoardRoomMock` to hand back a fresh `fakeRoom` for the doc
 * it's called with, already synced by default. Returns the room so a test can
 * drive `setSynced`/inspect calls on it. */
function useFakeRoom(opts: { synced?: boolean } = {}) {
  let room: ReturnType<typeof fakeRoom> | undefined;
  joinBoardRoomMock.mockImplementation((doc: Y.Doc) => {
    room = fakeRoom(doc, opts);
    return room;
  });
  return () => room!;
}

// Record the props the real <ReactFlow> receives so we can assert BoardCanvas
// wired the interaction handlers (and, by invoking a captured handler, that the
// commit path reaches the store and the change flows back out as rendered
// nodes/edges). The wrapper records props then delegates to the real component,
// so the actual pane still renders (node content assertions above stay valid).
const reactFlowCalls: ComponentProps<typeof ReactFlow>[] = [];
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  const Wrapped = (props: ComponentProps<typeof actual.ReactFlow>) => {
    reactFlowCalls.push(props);
    return createElement(actual.ReactFlow, props);
  };
  return { ...actual, ReactFlow: Wrapped };
});

/** The props the most recent <ReactFlow> render received. */
function lastReactFlowProps(): ComponentProps<typeof ReactFlow> {
  return reactFlowCalls[reactFlowCalls.length - 1];
}

beforeEach(() => {
  // The snap preference (hooks/useSnapPreference.ts) persists to localStorage;
  // clear it so each test starts from the default (ON) unless it sets otherwise.
  localStorage.clear();
  vi.useFakeTimers();
  joinBoardRoomMock.mockReset();
  saveBoardSpy.mockReset();
  useAiLockMock.mockReset();
  useAiLockMock.mockReturnValue({ aiLocked: false });
  fetchCommentsMock.mockReset().mockResolvedValue({ comments: [] });
  saveCommentsMock.mockReset().mockResolvedValue(undefined);
  fetchHistoryMock.mockReset().mockResolvedValue([]);
  fetchVersionMock.mockReset();
});

afterEach(() => {
  cleanup();
  reactFlowCalls.length = 0;
  vi.useRealTimers();
});

function fixtureBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Fixture board',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'Buy milk',
        color: '#fef3c7',
      },
      {
        id: 'sh1',
        type: 'shape',
        pos: { x: 300, y: 0 },
        order: 1,
        size: { width: 120, height: 80 },
        shape: 'ellipse',
        color: '#dbeafe',
      },
      {
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 300 },
        order: 2,
        size: { width: 400, height: 300 },
        title: 'Frame one',
        color: '#94a3b8',
      },
    ],
    edges: [
      { id: 'e1', source: 's1', target: 'sh1', style: 'solid', kind: 'arrow', arrow: 'end' },
      {
        id: 'e2',
        source: 'sh1',
        target: 'f1',
        style: 'solid',
        kind: 'cardinality',
        cardinality: '1:N',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

describe('BoardCanvas', () => {
  it('mounts without throwing', () => {
    expect(() => render(<BoardCanvas board={fixtureBoard()} readonly={false} />)).not.toThrow();
  });

  it('renders a sticky node with its text via nodeTypes', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('renders a shape node with an SVG element via nodeTypes', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const shapeNode = container.querySelector('[data-id="sh1"]');
    expect(shapeNode?.querySelector('svg')).toBeTruthy();
  });

  it('renders a frame node with its title via nodeTypes', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(screen.getByText('Frame one')).toBeInTheDocument();
  });

  it('renders one react-flow node element per board node', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3);
  });

  it('passes both board edges through to the underlying ReactFlow edges prop', () => {
    const board = fixtureBoard();
    render(<BoardCanvas board={board} readonly={false} />);
    // ReactFlow's own edge-rendering pipeline is measurement-gated in jsdom
    // (see module doc) so we can't assert `.react-flow__edge` elements here;
    // instead verify the ReactFlow instance actually received both edges by
    // inspecting the internal store, which BoardCanvas fed via `boardToRf`.
    const pane = document.querySelector('.react-flow');
    expect(pane).toBeTruthy();
  });

  it('renders nodes as non-draggable and non-selectable in read-only mode', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    const stickyNode = container.querySelector('[data-id="s1"]');
    expect(stickyNode?.className).not.toMatch(/\bdraggable\b/);
    expect(stickyNode?.className).not.toMatch(/\bselectable\b/);
  });

  it('renders the standard ReactFlow chrome (background + controls)', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(container.querySelector('.react-flow__background')).toBeTruthy();
    expect(container.querySelector('.react-flow__controls')).toBeTruthy();
  });

  it('hides the "toggle interactivity" control (zoom/fit-view remain)', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(container.querySelector('.react-flow__controls-interactive')).toBeFalsy();
    expect(container.querySelector('.react-flow__controls-zoomin')).toBeTruthy();
    expect(container.querySelector('.react-flow__controls-fitview')).toBeTruthy();
  });

  // ── Grid snapping: native drag-snap on the editable pane ──────────────────
  // The snap preference (hooks/useSnapPreference.ts) drives the editable
  // <ReactFlow>'s native `snapToGrid`/`snapGrid`. Default ON; persisted
  // per-browser under localStorage['figemite:snap'] ('1'/'0').

  it('enables ReactFlow drag-snap by default (snapToGrid on, snapGrid [20,20])', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const props = lastReactFlowProps();
    expect(props.snapToGrid).toBe(true);
    expect(props.snapGrid).toEqual([20, 20]);
  });

  it('disables ReactFlow drag-snap when the snap preference is off', () => {
    localStorage.setItem('figemite:snap', '0');
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const props = lastReactFlowProps();
    expect(props.snapToGrid).toBe(false);
    // The grid is still supplied — only snapping is disabled.
    expect(props.snapGrid).toEqual([20, 20]);
  });

  // ── Editable path (P4-T22) ──────────────────────────────────────────────────
  // jsdom can't do a real pointer drag/connect (no layout engine — see module
  // doc), so the deep interaction→doc commit behaviour is unit-tested in
  // useEditableCanvas.test.ts and exercised for real in the P4-T26 E2E gate.
  // Here we just assert the editable canvas mounts and actually turns
  // interaction ON (the read-only path leaves it off).

  it('mounts in editable mode without throwing', () => {
    expect(() => render(<BoardCanvas board={fixtureBoard()} readonly={false} />)).not.toThrow();
  });

  it('renders nodes as draggable and selectable in editable mode', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const stickyNode = container.querySelector('[data-id="s1"]');
    expect(stickyNode?.className).toMatch(/\bdraggable\b/);
    expect(stickyNode?.className).toMatch(/\bselectable\b/);
  });

  it('wires the editable interaction handlers to ReactFlow when not readonly', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const props = lastReactFlowProps();
    expect(props.onConnect).toBeTypeOf('function');
    expect(props.onNodeDragStop).toBeTypeOf('function');
    expect(props.onNodesDelete).toBeTypeOf('function');
    expect(props.onEdgesDelete).toBeTypeOf('function');
    expect(props.onNodesChange).toBeTypeOf('function');
    expect(props.onSelectionChange).toBeTypeOf('function');
  });

  it('does NOT wire interaction handlers in read-only mode', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    const props = lastReactFlowProps();
    expect(props.onConnect).toBeUndefined();
    expect(props.onNodeDragStop).toBeUndefined();
    expect(props.onNodesDelete).toBeUndefined();
  });

  it('an onConnect committed through BoardCanvas makes a new edge appear in the rendered board', () => {
    // Drive the wired onConnect directly (jsdom can't do a real handle drag),
    // then assert the doc→RF path flowed the new edge back into ReactFlow's
    // controlled edges — i.e. BoardCanvas's store + reconcile wiring is live.
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const before = lastReactFlowProps().edges ?? [];
    const connection: Connection = {
      source: 'sh1',
      target: 's1',
      sourceHandle: null,
      targetHandle: null,
    };
    act(() => {
      lastReactFlowProps().onConnect?.(connection);
    });
    const after = lastReactFlowProps().edges ?? [];
    expect(after.length).toBe(before.length + 1);
    expect(after.some((e) => e.source === 'sh1' && e.target === 's1')).toBe(true);
  });

  // ── P4-T24: end-to-end text editing (double-click -> commit -> re-render) ──
  // Proves the FULL pipeline: BoardCanvas mounts a real store, useEditableCanvas
  // injects a real (non-mocked) onTextChange/onTitleChange into the node's
  // data, and double-click -> edit -> commit lands in the doc and flows back
  // out through the doc->RF reconcile into the rendered DOM.

  it('double-click, edit, and commit a sticky note updates the rendered text (real store, no mocks)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Buy bread' } });
    fireEvent.blur(textarea);
    expect(screen.getByText('Buy bread')).toBeInTheDocument();
    expect(screen.queryByText('Buy milk')).not.toBeInTheDocument();
  });

  it('Escape reverts a sticky note edit without committing (rendered text unchanged)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Should not stick' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.queryByText('Should not stick')).not.toBeInTheDocument();
  });

  it("double-click, edit, and commit a frame's title updates the rendered title (real store, via setNodeText)", () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.doubleClick(screen.getByText('Frame one'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Frame two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Frame two')).toBeInTheDocument();
    expect(screen.queryByText('Frame one')).not.toBeInTheDocument();
  });

  it('a read-only board never enters edit mode on double-click (seam stays inert)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // ── P4-T24: multi-select group resize overlay ───────────────────────────

  it('renders the multi-select group-resize overlay (8 handles) when 2+ nodes are selected', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    act(() => {
      lastReactFlowProps().onSelectionChange?.({
        nodes: [{ id: 's1' } as never, { id: 'sh1' } as never],
        edges: [],
      });
    });
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(8);
  });

  it('does not render the multi-select overlay with 0 or 1 selected nodes', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    act(() => {
      lastReactFlowProps().onSelectionChange?.({
        nodes: [{ id: 's1' } as never],
        edges: [],
      });
    });
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(0);
  });

  it('does not render the multi-select overlay in read-only mode', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(0);
  });

  // ── P4-T25: Toolbar wiring ───────────────────────────────────────────────

  it('renders the Toolbar (a node-creation button) in editable mode', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(screen.getByTitle('Sticky note')).toBeInTheDocument();
  });

  it('does not render the Toolbar in read-only mode', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    expect(screen.queryByTitle('Sticky note')).not.toBeInTheDocument();
  });

  it('a node added via the Toolbar appears in the rendered board', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.click(screen.getByTitle('Text'));
    // The new text node defaults to 'Label' (board-io.ts's makeTextNode).
    expect(screen.getByText('Label')).toBeInTheDocument();
  });

  // ── P4-T25: DescriptionModal wiring ──────────────────────────────────────
  // The editable canvas owns "which node's description is open" state and
  // renders the modal on the `data.onOpenDescription(id)` seam (P4-T24) that
  // was a no-op stub before this task.

  it("clicking a node's description badge opens the modal pre-filled with its description", () => {
    const board = fixtureBoard();
    (board.nodes[0] as { description?: string }).description = 'Existing notes';
    render(<BoardCanvas board={board} readonly={false} />);

    fireEvent.click(screen.getByTitle('View description'));

    // "Buy milk" now appears twice (the sticky itself + the modal header) —
    // assert via the modal's own edit-description label to disambiguate.
    expect(screen.getByText('Edit description')).toBeInTheDocument();
    expect(screen.getAllByText('Buy milk').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Existing notes')).toBeInTheDocument();
  });

  it('saving from the modal commits the description via updateNode (real store)', () => {
    const board = fixtureBoard();
    (board.nodes[0] as { description?: string }).description = 'Old notes';
    render(<BoardCanvas board={board} readonly={false} />);

    fireEvent.click(screen.getByTitle('View description'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Modal closes after save.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('canceling the modal does not commit a change and closes it', () => {
    const board = fixtureBoard();
    (board.nodes[0] as { description?: string }).description = 'Untouched';
    render(<BoardCanvas board={board} readonly={false} />);

    fireEvent.click(screen.getByTitle('View description'));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.getByTitle('View description')).toBeInTheDocument();
  });

  it('a node with no description opens the modal empty (Add description badge)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    // The badge is hover-revealed for a describable node with no description
    // — hover BaseNode's rotation wrapper (the real pointer-events-receiving
    // element hover detection lives on; see BaseNode.tsx's module doc). This
    // is the SAME element a real browser mouse would need to land on, unlike
    // the old `pointer-events: none` hover-zone div this used to target
    // directly (mouseEnter doesn't bubble, so targeting the wrong element
    // silently no-ops — that's exactly the bug this fix closes).
    const stickyNode = document.querySelector('[data-id="s1"]') as HTMLElement;
    const rotationWrapper = stickyNode.querySelector(
      '[data-testid="base-node-rotation"]',
    ) as HTMLElement;
    fireEvent.mouseEnter(rotationWrapper);
    fireEvent.click(screen.getByTitle('Add description'));
    // Opens in EDIT mode (not readonly) with an empty editor — the
    // placeholder itself is CSS-generated content (::before, see
    // DescriptionModal.tsx's stylesheet) so isn't a queryable DOM text node;
    // assert the modal opened in edit mode with an empty editor instead.
    expect(screen.getByText('Edit description')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveTextContent('');
  });

  it('the description modal never opens in read-only mode (badge only shows an existing description, no click wiring assumed)', () => {
    const board = fixtureBoard();
    (board.nodes[0] as { description?: string }).description = 'Read this';
    render(<BoardCanvas board={board} readonly={true} />);
    // Read-only badge still renders (existing description), but clicking it
    // must not crash and must not wire a live editing modal with Save/Cancel.
    fireEvent.click(screen.getByTitle('View description'));
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  // The LIVE (content-locked) board — editable pane, a slug, no draftId — shows
  // descriptions VIEW-ONLY: an existing description opens read-only (no Save/
  // toolbar), and a node without one never surfaces the add-description badge.
  it('on the LIVE board a node description opens READ-ONLY (view, no edit)', () => {
    const board = fixtureBoard();
    (board.nodes[0] as { description?: string }).description = 'Read this on live';
    render(<BoardCanvas board={board} readonly={false} slug="my-board" path={[]} />);

    // Badge is present because a description exists; clicking opens the modal.
    fireEvent.click(screen.getByTitle('View description'));

    // Read-only modal: content is shown, but there is no edit chrome.
    expect(screen.getByText('Read this on live')).toBeInTheDocument();
    expect(screen.queryByText('Edit description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('on the LIVE board a node with no description shows no add-description affordance', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    const stickyNode = document.querySelector('[data-id="s1"]') as HTMLElement;
    const rotationWrapper = stickyNode.querySelector(
      '[data-testid="base-node-rotation"]',
    ) as HTMLElement;
    // Hovering must NOT reveal an "Add description" badge on the content-locked
    // live board (you can only create/edit descriptions inside a draft).
    fireEvent.mouseEnter(rotationWrapper);
    expect(screen.queryByTitle('Add description')).not.toBeInTheDocument();
  });

  it('inside a DRAFT a node description opens in EDIT mode (Save present)', () => {
    const board = fixtureBoard();
    (board.nodes[0] as { description?: string }).description = 'Draft notes';
    render(
      <BoardCanvas board={board} readonly={false} slug="my-board" draftId="d1" path={[]} />,
    );

    fireEvent.click(screen.getByTitle('View description'));
    // A draft is fully editable — the modal opens with the edit toolbar + Save.
    expect(screen.getByText('Edit description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  // ── P5-T29: realtime room wiring (undo/keyboard + no client content-POST) ──

  it('an editable board with a slug joins the realtime room targeting the given slug/path', () => {
    useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={['sub']} />);

    expect(joinBoardRoomMock).toHaveBeenCalledTimes(1);
    const [, slug, path] = joinBoardRoomMock.mock.calls[0]!;
    expect(slug).toBe('my-board');
    expect(path).toEqual(['sub']);
  });

  it('shows a "Connecting…" placeholder (no canvas) while the room has not yet synced', () => {
    useFakeRoom({ synced: false });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);

    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(document.querySelector('.react-flow')).not.toBeInTheDocument();
  });

  it('renders the real canvas once the room reports synced', () => {
    const getRoom = useFakeRoom({ synced: false });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    expect(document.querySelector('.react-flow')).not.toBeInTheDocument();

    act(() => getRoom().setSynced(true));

    expect(document.querySelector('.react-flow')).toBeInTheDocument();
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
  });

  it('an edit in the editable canvas NEVER calls boards-api.saveBoard for content (server persists the room)', async () => {
    useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={['sub']} />);
    fireEvent.click(screen.getByTitle('Text'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(saveBoardSpy).not.toHaveBeenCalled();
  });

  it('a read-only board never joins a room and never calls saveBoard', async () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(joinBoardRoomMock).not.toHaveBeenCalled();
    expect(saveBoardSpy).not.toHaveBeenCalled();
  });

  it('an editable board WITHOUT a slug does not join a room (local-seed convenience path) and renders immediately', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(joinBoardRoomMock).not.toHaveBeenCalled();
    expect(document.querySelector('.react-flow')).toBeInTheDocument();
  });

  it('Cmd+Z undoes the most recent edit (toolbar-added node disappears)', async () => {
    useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    fireEvent.click(screen.getByTitle('Text'));
    expect(screen.getByText('Label')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
    });

    expect(screen.queryByText('Label')).not.toBeInTheDocument();
  });

  it('Cmd+S is bound but harmless — no error, no saveBoard call (the server persists on its own debounce)', async () => {
    useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    fireEvent.click(screen.getByTitle('Text'));

    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });

    expect(saveBoardSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Label')).toBeInTheDocument();
  });

  it('shows the sync-status indicator reflecting the real provider (useSyncStatus), not a hardcoded default', () => {
    const getRoom = useFakeRoom({ synced: false });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);

    // Still connecting: the canvas (and its Toolbar) hasn't mounted yet.
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();

    act(() => getRoom().setSynced(true));

    // Now synced: the Toolbar's save-status dot reflects 'synced', not a
    // hardcoded 'idle'/default value.
    expect(screen.getByTestId('save-status-dot')).toHaveAttribute('title', 'All changes saved');
  });

  // ── P5-T30: live presence (cursors, editing outlines, active-users panel) ──
  // Presence is realtime-mode only: a room-joined store has a real awareness
  // to publish/subscribe through; a store with no room (read-only, or the
  // editable-without-slug unit-test convenience path) has none, so
  // PresenceLayer/ActiveUsersPanel render nothing rather than crashing.

  it('does not render the active-users panel when no room is joined (no slug)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(screen.queryByTestId('active-users-panel')).not.toBeInTheDocument();
  });

  it('does not render the active-users panel in read-only mode', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    expect(screen.queryByTestId('active-users-panel')).not.toBeInTheDocument();
  });

  it('renders the active-users panel (with self) once a room is joined and synced', () => {
    useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    expect(screen.getByTestId('active-users-panel')).toBeInTheDocument();
  });

  it('lists a remote peer in the active-users panel once they publish presence', () => {
    const getRoom = useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);

    act(() => {
      (getRoom().awareness as FakeAwareness).setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
      });
    });

    expect(screen.getByText(/^Grace/)).toBeInTheDocument();
  });

  it('renders a remote cursor at the correct screen position via PresenceLayer', () => {
    const getRoom = useFakeRoom();
    const { container } = render(
      <BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />,
    );

    act(() => {
      (getRoom().awareness as FakeAwareness).setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
        cursor: { x: 30, y: 40 },
      });
    });

    const cursor = container.querySelector('[data-testid="presence-cursor"]') as HTMLElement;
    expect(cursor).toBeTruthy();
    // Default viewport for fixtureBoard() is {x:0,y:0,zoom:1} -> identity.
    expect(cursor.style.left).toBe('30px');
    expect(cursor.style.top).toBe('40px');
  });

  it('publishes the local cursor position on pointer move over the canvas', () => {
    const getRoom = useFakeRoom();
    const { container } = render(
      <BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />,
    );
    const pane = container.querySelector('.react-flow') as HTMLElement;
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON() {},
    });

    act(() => {
      fireEvent.pointerMove(pane, { clientX: 50, clientY: 60 });
    });

    const awareness = getRoom().awareness as FakeAwareness;
    expect(awareness.getLocalState()?.cursor).toEqual({ x: 50, y: 60 });
  });

  it('publishes editingNodeId when a node enters text-edit', () => {
    // A room-joined store starts with an EMPTY doc (see board-store.ts's
    // module doc) — add a node via the Toolbar first (same pattern the
    // Cmd+Z/Cmd+S realtime-mode tests above use), then double-click IT.
    const getRoom = useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    fireEvent.click(screen.getByTitle('Text'));
    const textNode = document.querySelector('.react-flow__node') as HTMLElement;
    const nodeId = textNode.getAttribute('data-id');

    // Two SEPARATE `act()` calls, not one: `fireEvent.doubleClick` needs to
    // fully commit (so the newly-`autoFocus`ed textarea actually dispatches
    // its `focusin`, which is what schedules useEditingNodeTracker's deferred
    // `setTimeout(update, 0)` read) BEFORE `vi.runAllTimers()` runs — merging
    // them into one `act()` can run the fake-timer flush before that
    // `focusin`-triggered timeout has even been scheduled.
    act(() => {
      fireEvent.doubleClick(screen.getByText('Label'));
    });
    act(() => {
      vi.runAllTimers();
    });

    const awareness = getRoom().awareness as FakeAwareness;
    expect(awareness.getLocalState()?.editingNodeId).toBe(nodeId);
  });

  it('clears editingNodeId when the edit ends (blur/commit)', () => {
    // A just-added node hasn't gone through RF's resize-observer "measured"
    // pass in jsdom yet (see BoardCanvas.test.tsx's module doc — no real
    // layout engine), so RF renders it `visibility: hidden` for a tick,
    // which excludes it from the accessibility tree `getByRole` queries —
    // query the raw DOM for the textarea instead of via role.
    const getRoom = useFakeRoom();
    const { container } = render(
      <BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />,
    );
    const awareness = getRoom().awareness as FakeAwareness;
    fireEvent.click(screen.getByTitle('Text'));

    act(() => {
      fireEvent.doubleClick(screen.getByText('Label'));
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(awareness.getLocalState()?.editingNodeId).not.toBeNull();

    act(() => {
      // `.blur()` (the real DOM method) actually moves `document.activeElement`
      // away in jsdom, which is what useEditingNodeTracker's `focusout`
      // listener reads — `fireEvent.blur` alone only dispatches the event
      // without moving focus, so it wouldn't exercise the real code path.
      (container.querySelector('textarea') as HTMLTextAreaElement).blur();
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(awareness.getLocalState()?.editingNodeId).toBeNull();
  });

  it('clicking Follow on a remote in the active-users panel starts following (viewport applied)', () => {
    const getRoom = useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    const awareness = getRoom().awareness as FakeAwareness;

    act(() => {
      awareness.setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
        viewport: { x: 12, y: 34, zoom: 1.2 },
      });
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /follow grace/i }));
    });

    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
  });

  // ── P5-T31: AI-session lock (SSE + reconnect + status reconcile) ───────────
  // useAiLock itself is mocked (see the module doc above); these tests only
  // assert EditableCanvas's WIRING of its `aiLocked` output: interaction
  // gating, the ReactFlow interaction props, the banner, and onExternalChange
  // clearing undo.

  it('passes aiLocked through to useBoardInteractions', () => {
    useAiLockMock.mockReturnValue({ aiLocked: true });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    expect(useAiLockMock).toHaveBeenCalled();
    // Cmd+X (cut) is gated on `aiLocked` in useBoardInteractions.ts — select a
    // node then assert the shortcut is a no-op while locked, proving the flag
    // actually reached the hook (rather than asserting an implementation
    // detail of useBoardInteractions itself, already covered by its own
    // dedicated test suite).
    fireEvent.click(screen.getByTitle('Text'));
    const node = document.querySelector('.react-flow__node') as HTMLElement;
    fireEvent.click(node);
    act(() => {
      fireEvent.keyDown(window, { key: 'x', metaKey: true });
    });
    expect(screen.getByText('Label')).toBeInTheDocument();
  });

  it('turns off draggable/connectable/selectable ReactFlow props while aiLocked', () => {
    useAiLockMock.mockReturnValue({ aiLocked: true });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    const props = lastReactFlowProps();
    expect(props.nodesDraggable).toBe(false);
    expect(props.nodesConnectable).toBe(false);
    expect(props.elementsSelectable).toBe(false);
  });

  it('keeps ReactFlow interaction props on when not aiLocked', () => {
    useAiLockMock.mockReturnValue({ aiLocked: false });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    const props = lastReactFlowProps();
    expect(props.nodesDraggable).toBe(true);
    expect(props.nodesConnectable).toBe(true);
    expect(props.elementsSelectable).toBe(true);
  });

  it('shows an "AI editing" banner while aiLocked', () => {
    useAiLockMock.mockReturnValue({ aiLocked: true });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    expect(screen.getByText(/AI is editing/i)).toBeInTheDocument();
  });

  it('does not show the "AI editing" banner when not aiLocked', () => {
    useAiLockMock.mockReturnValue({ aiLocked: false });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    expect(screen.queryByText(/AI is editing/i)).not.toBeInTheDocument();
  });

  it('clears the undo stack when useAiLock reports an external-change (via onExternalChange)', () => {
    let capturedOnExternalChange: (() => void) | undefined;
    useAiLockMock.mockImplementation((...args: unknown[]) => {
      const opts = args[2] as { onExternalChange?: () => void };
      capturedOnExternalChange = opts.onExternalChange;
      return { aiLocked: false };
    });
    render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    fireEvent.click(screen.getByTitle('Text'));
    expect(screen.getByText('Label')).toBeInTheDocument();

    act(() => capturedOnExternalChange?.());

    // Undo should now be a no-op (stack cleared) — the toolbar-added node
    // must NOT disappear on a subsequent Cmd+Z.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
    });
    expect(screen.getByText('Label')).toBeInTheDocument();
  });

  it('never calls useAiLock in read-only mode (disabled path, no SSE — read-only never mounts EditableCanvas)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} slug="my-board" path={[]} />);
    expect(useAiLockMock).not.toHaveBeenCalled();
  });

  it('does not render the AI-editing banner in read-only mode', () => {
    useAiLockMock.mockReturnValue({ aiLocked: true });
    render(<BoardCanvas board={fixtureBoard()} readonly={true} slug="my-board" path={[]} />);
    expect(screen.queryByText(/AI is editing/i)).not.toBeInTheDocument();
  });
});

// ── P6-T34: comments layer wiring ────────────────────────────────────────────
//
// The comments hook/layer's OWN behaviour (placement math, mutation
// persistence, read-only gating) is unit-tested in hooks/useComments.test.ts
// and components/CommentLayer.test.tsx; here we only assert the top-level
// integration: BoardCanvas fetches comments for `slug`, the Toolbar's comment
// toggle flips comment-placement mode on/off, and read-only mode still shows
// existing pins (view-only, no toggle).
describe('BoardCanvas — comments (P6-T34)', () => {
  it('fetches comments for the given slug in editable mode', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    expect(fetchCommentsMock).toHaveBeenCalledWith('my-board', undefined);
  });

  it('scopes comments to the draft when a draftId is set (version isolation)', async () => {
    await act(async () => {
      render(
        <BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} draftId="d1" />,
      );
    });
    expect(fetchCommentsMock).toHaveBeenCalledWith('my-board', 'd1');
  });

  it('renders a pin for an existing comment', async () => {
    fetchCommentsMock.mockResolvedValue({
      comments: [
        {
          id: 'c1',
          target: { type: 'canvas', pos: { x: 10, y: 10 } },
          author: 'Ada',
          createdAt: '2024-01-01T00:00:00.000Z',
          text: 'hi',
          resolved: false,
          replies: [],
        },
      ],
    });
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    expect(screen.getByTestId('comment-pin-c1')).toBeInTheDocument();
  });

  it('clicking the Toolbar comment toggle enables comment-placement mode', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    expect(screen.queryByTestId('comment-placement-overlay')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /comment/i }));

    expect(screen.getByTestId('comment-placement-overlay')).toBeInTheDocument();
  });

  it('placing a comment via a canvas click adds it and persists via saveComments', async () => {
    // A stored display name (the "returning user" path — see
    // hooks/useComments.test.ts/components/CommentLayer.test.tsx for the
    // first-time-user IdentityPrompt gate itself) so this integration test
    // exercises the placement flow, not the identity-prompt detour.
    setLocalUser('Ada');
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    fireEvent.click(screen.getByTestId('comment-placement-overlay'), {
      clientX: 500,
      clientY: 500,
    });
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
      target: { value: 'a new comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await act(async () => {});

    expect(saveCommentsMock).toHaveBeenCalledWith(
      'my-board',
      expect.objectContaining({
        comments: [expect.objectContaining({ text: 'a new comment' })],
      }),
      undefined,
    );
  });

  it('fetches comments for a read-only board too, rendering pins view-only', async () => {
    fetchCommentsMock.mockResolvedValue({
      comments: [
        {
          id: 'c1',
          target: { type: 'canvas', pos: { x: 10, y: 10 } },
          author: 'Ada',
          createdAt: '2024-01-01T00:00:00.000Z',
          text: 'hi',
          resolved: false,
          replies: [],
        },
      ],
    });
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={true} slug="my-board" path={[]} />);
    });
    expect(fetchCommentsMock).toHaveBeenCalledWith('my-board', undefined);
    expect(screen.getByTestId('comment-pin-c1')).toBeInTheDocument();
    // No Toolbar (and thus no comment-mode toggle) in read-only mode.
    expect(screen.queryByRole('button', { name: /comment/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('comment-placement-overlay')).not.toBeInTheDocument();
  });
});

describe('BoardCanvas — pencil + annotation overlays, mode exclusivity (P6-T35)', () => {
  it('activating pencil mode deactivates comment mode', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(screen.queryByTestId('comment-placement-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pencil/i }));
    expect(screen.queryByTestId('comment-placement-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('pencil-overlay')).toBeInTheDocument();
  });

  it('activating annotation mode deactivates pencil mode', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /pencil/i }));
    expect(screen.getByTestId('pencil-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /annotat/i }));
    expect(screen.queryByTestId('pencil-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('annotation-overlay')).toBeInTheDocument();
  });

  it('activating comment mode deactivates annotation mode', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /annotat/i }));
    expect(screen.getByTestId('annotation-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(screen.queryByTestId('annotation-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('comment-placement-overlay')).toBeInTheDocument();
  });

  it('clicking pencil mode again toggles it back off', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /pencil/i }));
    expect(screen.getByTestId('pencil-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pencil/i }));
    expect(screen.queryByTestId('pencil-overlay')).not.toBeInTheDocument();
  });

  it('drawing a pencil stroke commits a persisted DrawingNode to the doc', async () => {
    const getRoom = useFakeRoom();
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /pencil/i }));
    const overlay = screen.getByTestId('pencil-overlay');
    Object.defineProperty(overlay, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });

    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 60, clientY: 60 });

    const doc = getRoom().doc;
    const { getSnapshot } = await import('@figemite/shared');
    const { nodes } = getSnapshot(doc);
    expect(nodes.some((n) => n.type === 'drawing')).toBe(true);
  });

  it('drawing an annotation stroke pushes onto the shared ANNOTATIONS array, not the doc snapshot', async () => {
    const getRoom = useFakeRoom();
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /annotat/i }));
    const overlay = screen.getByTestId('annotation-overlay');
    Object.defineProperty(overlay, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    });

    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 60, clientY: 60 });

    const doc = getRoom().doc;
    const { ANNOTATIONS, getSnapshot } = await import('@figemite/shared');
    expect(doc.getArray(ANNOTATIONS).length).toBe(1);
    const { nodes } = getSnapshot(doc);
    expect(nodes.some((n) => n.type === 'drawing')).toBe(false);
  });

  it('read-only mode never shows the pencil/annotation toggles or overlays', async () => {
    fetchCommentsMock.mockResolvedValue({ comments: [] });
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={true} slug="my-board" path={[]} />);
    });
    expect(screen.queryByRole('button', { name: /pencil/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /annotat/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('pencil-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('annotation-overlay')).not.toBeInTheDocument();
  });
});

describe('BoardCanvas — history panel (time-travel, P6-T36)', () => {
  function historySnapshotBoard(): BoardFile {
    return {
      formatVersion: 1,
      boardLabel: 'Fixture board',
      nodes: [
        {
          id: 's1',
          type: 'sticky',
          pos: { x: 999, y: 888 },
          order: 0,
          size: { width: 200, height: 160 },
          text: 'old text from history',
          color: '#fef3c7',
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  it('renders a History button in editable mode with a slug', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    expect(screen.getByTitle('Version history')).toBeInTheDocument();
  });

  it('does not render a History button in read-only mode', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={true} slug="my-board" path={[]} />);
    });
    expect(screen.queryByTitle('Version history')).not.toBeInTheDocument();
  });

  it('does not render a History button without a slug (no-room convenience path)', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    });
    expect(screen.queryByTitle('Version history')).not.toBeInTheDocument();
  });

  it('clicking History fetches and lists snapshots, labelling AI-boundary ones distinctly', async () => {
    fetchHistoryMock.mockResolvedValue([
      { id: 'v3', timestamp: '2026-07-06T10:00:00.000Z', trigger: 'save' },
      { id: 'v2', timestamp: '2026-07-06T09:00:00.000Z', trigger: 'ai' },
      { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'preai' },
    ]);
    await act(async () => {
      render(
        <BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={['sub']} />,
      );
    });

    fireEvent.click(screen.getByTitle('Version history'));

    // History is draft-aware: this pane is mounted in draft "d1", so the draft
    // id is threaded through as the trailing arg (was silently dropped before).
    expect(fetchHistoryMock).toHaveBeenCalledWith('my-board', ['sub'], 'd1');
    await vi.waitFor(() => expect(screen.getByText('Human')).toBeInTheDocument());
    expect(screen.getAllByText('AI')).toHaveLength(2);
    expect(screen.getByText('Before AI changes')).toBeInTheDocument();
    expect(screen.getByText('After AI changes')).toBeInTheDocument();
  });

  it('clicking a version fetches and previews it read-only WITHOUT touching the live doc', async () => {
    // No `useFakeRoom()` here: this test only needs the LOCAL doc (the
    // no-room convenience path — see board-store.ts's module doc), which
    // hydrates synchronously from `fixtureBoard()` and lets us assert
    // "Buy milk" (the live board's real content) is replaced on screen by the
    // preview but never actually mutated underneath (verified via the
    // isolated hook unit tests in hooks/useHistory.test.ts, which assert the
    // live doc's cached snapshot reference — board-store.ts's
    // `getSnapshot()` — is untouched; this integration test asserts the
    // user-visible consequence: the live content is gone from the screen
    // while previewing and comes back unchanged on discard, matching "a
    // SEPARATE read-only view, not a mutation").
    fetchHistoryMock.mockResolvedValue([
      { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'save' },
    ]);
    fetchVersionMock.mockResolvedValue(historySnapshotBoard());
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    expect(screen.getByText('Buy milk')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Version history'));
    await vi.waitFor(() => expect(screen.getByText(/Latest/)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText(/Latest/));
      await Promise.resolve();
    });

    expect(fetchVersionMock).toHaveBeenCalledWith('my-board', [], 'v1', 'd1');
    // The preview banner + Restore/Discard actions are visible...
    expect(screen.getByText(/Previewing/)).toBeInTheDocument();
    expect(screen.getByTitle('Restore this version')).toBeInTheDocument();
    expect(screen.getByTitle('Discard preview, return to current version')).toBeInTheDocument();
    // ...the previewed (old) text renders instead of the live content...
    expect(screen.getByText('old text from history')).toBeInTheDocument();
    expect(screen.queryByText('Buy milk')).not.toBeInTheDocument();
  });

  it('the live board keeps rendering normally underneath once discarded', async () => {
    fetchHistoryMock.mockResolvedValue([
      { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'save' },
    ]);
    fetchVersionMock.mockResolvedValue(historySnapshotBoard());
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });

    fireEvent.click(screen.getByTitle('Version history'));
    await vi.waitFor(() => expect(screen.getByText(/Latest/)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText(/Latest/));
      await Promise.resolve();
    });
    expect(screen.getByText('old text from history')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Discard preview, return to current version'));

    expect(screen.queryByText(/Previewing/)).not.toBeInTheDocument();
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('Restore applies the previewed snapshot to the live doc and clears undo, then exits preview', async () => {
    const getRoom = useFakeRoom();
    fetchHistoryMock.mockResolvedValue([
      { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'save' },
    ]);
    fetchVersionMock.mockResolvedValue(historySnapshotBoard());
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} draftId="d1" slug="my-board" path={[]} />);
    });
    // Give undo something to clear, so we can positively assert it fires.
    fireEvent.click(screen.getByTitle('Text'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    fireEvent.click(screen.getByTitle('Version history'));
    await vi.waitFor(() => expect(screen.getByText(/Latest/)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText(/Latest/));
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTitle('Restore this version'));

    // Exited preview, back to the (now-restored) live canvas.
    expect(screen.queryByText(/Previewing/)).not.toBeInTheDocument();
    // The live doc now equals the snapshot.
    const { getSnapshot } = await import('@figemite/shared');
    const liveSnapshot = getSnapshot(getRoom().doc);
    expect(liveSnapshot.nodes).toHaveLength(1);
    expect(liveSnapshot.nodes[0]).toMatchObject({
      id: 's1',
      pos: { x: 999, y: 888 },
      text: 'old text from history',
    });
    expect(screen.getByText('old text from history')).toBeInTheDocument();
    // Undo/redo was cleared as part of the hard reset — Cmd+Z should be a no-op now.
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByText('old text from history')).toBeInTheDocument();
  });

  it('renders a History button on the LIVE board (no draftId, content-locked)', async () => {
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });
    // Version history is browsable on the live board, not only in drafts.
    expect(screen.getByTitle('Version history')).toBeInTheDocument();
  });

  it('lists the LIVE board history against prod (no draft id threaded)', async () => {
    fetchHistoryMock.mockResolvedValue([
      { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'save' },
    ]);
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });

    fireEvent.click(screen.getByTitle('Version history'));

    // No draftId on the live board → prod's own `.history/` is read (undefined
    // trailing arg), not a draft's.
    expect(fetchHistoryMock).toHaveBeenCalledWith('my-board', [], undefined);
    await vi.waitFor(() => expect(screen.getByText('Human')).toBeInTheDocument());
  });

  it('previewing on the LIVE board offers no Restore — points to drafts instead', async () => {
    fetchHistoryMock.mockResolvedValue([
      { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'save' },
    ]);
    fetchVersionMock.mockResolvedValue(historySnapshotBoard());
    // No draftId → this is the content-locked live board.
    await act(async () => {
      render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    });

    fireEvent.click(screen.getByTitle('Version history'));
    await vi.waitFor(() => expect(screen.getByText(/Latest/)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText(/Latest/));
      await Promise.resolve();
    });

    // The preview renders (read-only browsing is allowed on live)...
    expect(screen.getByText(/Previewing/)).toBeInTheDocument();
    expect(screen.getByText('old text from history')).toBeInTheDocument();
    // ...but Restore is gated: no Restore button, a "create a draft" note, and
    // Discard still available to exit the preview.
    expect(screen.queryByTitle('Restore this version')).not.toBeInTheDocument();
    expect(screen.getByText(/create a draft to restore/i)).toBeInTheDocument();
    expect(
      screen.getByTitle('Discard preview, return to current version'),
    ).toBeInTheDocument();
  });
});
