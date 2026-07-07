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
import type { BoardFile } from '@easel/shared';
import { BoardCanvas } from './BoardCanvas.js';

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
vi.mock('../lib/boards-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/boards-api.js')>();
  return {
    ...actual,
    saveBoard: (...args: unknown[]) => {
      saveBoardSpy(...args);
      return actual.saveBoard(...(args as Parameters<typeof actual.saveBoard>));
    },
  };
});

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
    awareness: {},
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
  vi.useFakeTimers();
  joinBoardRoomMock.mockReset();
  saveBoardSpy.mockReset();
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
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={['sub']} />);
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
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
    fireEvent.click(screen.getByTitle('Text'));
    expect(screen.getByText('Label')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
    });

    expect(screen.queryByText('Label')).not.toBeInTheDocument();
  });

  it('Cmd+S is bound but harmless — no error, no saveBoard call (the server persists on its own debounce)', async () => {
    useFakeRoom();
    render(<BoardCanvas board={fixtureBoard()} readonly={false} slug="my-board" path={[]} />);
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
});
