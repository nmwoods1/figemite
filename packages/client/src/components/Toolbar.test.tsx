// ── Toolbar ───────────────────────────────────────────────────────────────────
//
// Ported from the original prototype's Toolbar.tsx (node-creation +
// styling controls), wired to the new doc-first store's mutation API instead
// of the legacy's `commit`. Node-creation buttons compute the new node's
// position at the current ReactFlow view center (canvas/coords.ts's
// `viewCenter`), build it via the shared `@figemite/shared` factories with a
// fresh id (`generateId` over existing ids) and `order = nextOrder(...)`, and
// commit via `store.addNode` (the P4-T24 mutation API doesn't have a bespoke
// `addNode` yet — see module doc in Toolbar.tsx for how it's added here).
//
// Tests render `<Toolbar>` inside a real `<ReactFlowProvider>` (needed for
// `useReactFlow().getViewport()`) with a REAL `BoardStore` (not a mock) so
// assertions read the resulting doc snapshot directly — matching this
// codebase's existing preference for exercising the real store over mocking
// its mutation API (see BoardCanvas.test.tsx's module doc).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { Toolbar } from './Toolbar.js';

afterEach(() => {
  cleanup();
});

function emptyBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Test board',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function boardWithEdge(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Test board',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 200, height: 160 },
        text: '',
        color: '#fef3c7',
      },
      {
        id: 's2',
        type: 'sticky',
        pos: { x: 300, y: 0 },
        order: 1,
        size: { width: 200, height: 160 },
        text: '',
        color: '#fef3c7',
      },
    ],
    edges: [{ id: 'e1', source: 's1', target: 's2', style: 'solid', kind: 'arrow', arrow: 'end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function renderToolbar(
  store: BoardStore,
  overrides: Partial<{
    selectedNodeIds: Set<string>;
    selectedEdgeIds: Set<string>;
    syncStatus: 'connecting' | 'synced' | 'offline';
    readonly: boolean;
    activeMode: 'none' | 'comment' | 'pencil' | 'annotation';
    onSetActiveMode: (mode: 'none' | 'comment' | 'pencil' | 'annotation') => void;
    hasAnnotations: boolean;
    onWipeAnnotations: () => void;
    snapEnabled: boolean;
    onToggleSnap: () => void;
    onOpenHistory: (() => void) | undefined;
    contentLocked: boolean;
  }> = {},
) {
  return render(
    <ReactFlowProvider>
      <Toolbar
        store={store}
        selectedNodeIds={overrides.selectedNodeIds ?? new Set()}
        selectedEdgeIds={overrides.selectedEdgeIds ?? new Set()}
        syncStatus={overrides.syncStatus ?? 'connecting'}
        readonly={overrides.readonly ?? false}
        contentLocked={overrides.contentLocked ?? false}
        activeMode={overrides.activeMode ?? 'none'}
        onSetActiveMode={overrides.onSetActiveMode ?? (() => {})}
        hasAnnotations={overrides.hasAnnotations ?? false}
        onWipeAnnotations={overrides.onWipeAnnotations ?? (() => {})}
        snapEnabled={overrides.snapEnabled ?? true}
        onToggleSnap={overrides.onToggleSnap ?? (() => {})}
        onOpenHistory={overrides.onOpenHistory}
      />
    </ReactFlowProvider>,
  );
}

describe('Toolbar — content-locked (live board)', () => {
  it('hides content tools and shows only comment + annotation', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { contentLocked: true });

    // Node/edge creation + styling affordances are gone.
    expect(screen.queryByTitle('Sticky note')).toBeNull();
    expect(screen.queryByRole('button', { name: /^text$/i })).toBeNull();
    expect(screen.queryByTitle('Shape')).toBeNull();
    expect(screen.queryByTitle('Frame / group')).toBeNull();
    expect(screen.queryByTitle('Pencil')).toBeNull();

    // The two allowed collaboration modes remain.
    expect(screen.getByTitle('Comment')).toBeInTheDocument();
    expect(screen.getByTitle('Annotation')).toBeInTheDocument();
  });

  it('still shows all content tools when not locked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { contentLocked: false });
    expect(screen.getByTitle('Sticky note')).toBeInTheDocument();
    expect(screen.getByTitle('Pencil')).toBeInTheDocument();
  });

  it('still shows the Version history button when locked (live board)', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { contentLocked: true, onOpenHistory: vi.fn() });
    // Version history is browsable on the live board; only its Restore action
    // is gated (in the preview banner, not the toolbar).
    expect(screen.getByTitle('Version history')).toBeInTheDocument();
  });

  it('calls onOpenHistory when the history button is clicked on a locked board', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onOpenHistory = vi.fn();
    renderToolbar(store, { contentLocked: true, onOpenHistory });
    fireEvent.click(screen.getByTitle('Version history'));
    expect(onOpenHistory).toHaveBeenCalled();
  });
});

describe('Toolbar — add-node buttons', () => {
  it('adds a sticky node at the view center when a sticky color is picked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByTitle('Sticky note'));
    const swatch = screen.getAllByTitle('#fef3c7')[0];
    fireEvent.click(swatch);

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: 'sticky',
      color: '#fef3c7',
      pos: { x: 200, y: 200 },
      order: 0,
    });
  });

  it('adds a text node at the view center', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'text', pos: { x: 200, y: 200 } });
  });

  it('adds a shape node of the picked kind', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByTitle('Shape'));
    fireEvent.click(screen.getByTitle('Diamond'));

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'shape', shape: 'diamond' });
  });

  it('adds a frame node', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: /frame/i }));

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'frame' });
  });

  it('adds an emoji node from the curated picker', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByTitle('Emoji'));
    fireEvent.click(screen.getByTitle('🚀'));

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'emoji', text: '🚀' });
  });

  it('adds a custom emoji typed into the picker input', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByTitle('Emoji'));
    const input = screen.getByPlaceholderText(/paste any emoji/i);
    fireEvent.change(input, { target: { value: '🐙' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const { nodes } = store.getSnapshot();
    expect(nodes[0]).toMatchObject({ type: 'emoji', text: '🐙' });
  });

  it('adds an icon node from the icon picker', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByTitle('Icon'));
    fireEvent.click(screen.getByTitle('star'));

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'icon', name: 'star' });
  });

  it('assigns fresh, non-colliding ids and increasing order to successive new nodes', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    const { nodes } = store.getSnapshot();
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).not.toBe(nodes[1].id);
    expect(nodes[1].order).toBeGreaterThan(nodes[0].order);
  });

  it('places a new node at the current (panned) view center', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    // Custom viewport isn't directly settable via the store (RF owns pan/zoom
    // internally — see BoardCanvas.tsx's module doc) so this exercises the
    // default/identity viewport case; a panned case is covered by
    // canvas/coords.test.ts's `viewCenter` unit tests directly.
    renderToolbar(store);
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    const { nodes } = store.getSnapshot();
    expect(nodes[0].pos).toEqual({ x: 200, y: 200 });
  });
});

describe('Toolbar — color picker', () => {
  it('applies a picked color to a selected sticky via updateNode', () => {
    const board = boardWithEdge();
    const store = createBoardStore(board, { readonly: false });
    renderToolbar(store, { selectedNodeIds: new Set(['s1']) });

    fireEvent.click(screen.getByRole('button', { name: /cycle colour/i }));

    const { nodes } = store.getSnapshot();
    const s1 = nodes.find((n) => n.id === 's1');
    expect(s1).toMatchObject({ color: '#dbeafe' }); // next color after #fef3c7
  });

  it('does not show the color-cycle control when nothing is selected', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);
    expect(screen.queryByRole('button', { name: /cycle colour/i })).not.toBeInTheDocument();
  });
});

describe('Toolbar — edge-style controls', () => {
  it('are hidden when no edge is selected', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store);
    expect(screen.queryByRole('group', { name: /edge kind/i })).not.toBeInTheDocument();
  });

  it('are hidden when a node (not an edge) is selected', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedNodeIds: new Set(['s1']) });
    expect(screen.queryByRole('group', { name: /edge kind/i })).not.toBeInTheDocument();
  });

  it('shows edge-style controls when an edge is selected', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });
    expect(screen.getByRole('group', { name: /edge kind/i })).toBeInTheDocument();
  });

  it('sets the arrow style on the selected edge', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });

    const select = screen.getByTitle(/arrow direction/i);
    fireEvent.change(select, { target: { value: 'both' } });

    const { edges } = store.getSnapshot();
    expect(edges[0]).toMatchObject({ arrow: 'both' });
  });

  it('offers a "Back" arrow direction and sets it on the selected edge', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });

    const select = screen.getByTitle(/arrow direction/i);
    expect(screen.getByRole('option', { name: /back/i })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'start' } });

    const { edges } = store.getSnapshot();
    expect(edges[0]).toMatchObject({ arrow: 'start' });
  });

  it('sets the line style (dashed) on the selected edge', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });

    fireEvent.click(screen.getByTitle('Dashed line'));

    const { edges } = store.getSnapshot();
    expect(edges[0]).toMatchObject({ style: 'dashed' });
  });

  it('switches the edge kind to cardinality', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });

    fireEvent.click(screen.getByTitle(/cardinality edge/i));

    const { edges } = store.getSnapshot();
    expect(edges[0]).toMatchObject({ kind: 'cardinality', cardinality: '1:N' });
  });

  it('hides the routing control when no edge is selected', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store);
    expect(screen.queryByRole('group', { name: /edge routing/i })).not.toBeInTheDocument();
  });

  it('shows the routing control when an edge is selected', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });
    expect(screen.getByRole('group', { name: /edge routing/i })).toBeInTheDocument();
  });

  // Routing applies to both edge kinds, so the control must render for a
  // cardinality edge too (guards against it being trapped inside the
  // arrow/cardinality kind ternary next to Arrow/Cardinality selects).
  it('shows the routing control for a cardinality edge too', () => {
    const board = boardWithEdge();
    board.edges[0] = {
      ...board.edges[0],
      kind: 'cardinality',
      cardinality: '1:N',
      arrow: undefined,
    };
    const store = createBoardStore(board, { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });
    expect(screen.getByRole('group', { name: /edge routing/i })).toBeInTheDocument();
  });

  it('sets the routing to elbow on the selected edge', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });

    fireEvent.click(screen.getByTitle('Elbow'));

    const { edges } = store.getSnapshot();
    expect(edges[0]).toMatchObject({ routing: 'elbow' });
  });

  it('sets the routing to straight on the selected edge', () => {
    const store = createBoardStore(boardWithEdge(), { readonly: false });
    renderToolbar(store, { selectedEdgeIds: new Set(['e1']) });

    fireEvent.click(screen.getByTitle('Straight'));

    const { edges } = store.getSnapshot();
    expect(edges[0]).toMatchObject({ routing: 'straight' });
  });
});

describe('Toolbar — sync-status indicator (P5-T29)', () => {
  it('shows an offline indicator when syncStatus is offline', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { syncStatus: 'offline' });
    expect(screen.getByTestId('save-status-dot')).toHaveAttribute(
      'title',
      expect.stringMatching(/offline/i),
    );
  });

  it('shows a synced indicator when syncStatus is synced', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { syncStatus: 'synced' });
    expect(screen.getByTestId('save-status-dot')).toHaveAttribute(
      'title',
      expect.stringMatching(/saved/i),
    );
  });

  it('shows a connecting indicator when syncStatus is connecting', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { syncStatus: 'connecting' });
    expect(screen.getByTestId('save-status-dot')).toHaveAttribute(
      'title',
      expect.stringMatching(/connecting/i),
    );
  });
});

describe('Toolbar — READONLY', () => {
  it('hides every write affordance when readonly', () => {
    const store = createBoardStore(emptyBoard(), { readonly: true });
    const { container } = renderToolbar(store, { readonly: true });
    expect(screen.queryByRole('button', { name: /sticky note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^text$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^shape$/i })).not.toBeInTheDocument();
    // The toolbar chrome itself renders nothing at all in readonly mode.
    expect(container.firstChild).toBeNull();
  });

  it('hides the comment-mode toggle when readonly', () => {
    const store = createBoardStore(emptyBoard(), { readonly: true });
    renderToolbar(store, { readonly: true });
    expect(screen.queryByRole('button', { name: /comment/i })).not.toBeInTheDocument();
  });

  it('hides the pencil and annotation toggles (and Wipe) when readonly', () => {
    const store = createBoardStore(emptyBoard(), { readonly: true });
    renderToolbar(store, {
      readonly: true,
      activeMode: 'annotation',
      hasAnnotations: true,
    });
    expect(screen.queryByRole('button', { name: /pencil/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /annotat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
  });
});

describe('Toolbar — comment-mode toggle', () => {
  it('renders a comment-mode toggle button', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);
    expect(screen.getByRole('button', { name: /comment/i })).toBeInTheDocument();
  });

  it('calls onSetActiveMode("comment") when clicked from none', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onSetActiveMode = vi.fn();
    renderToolbar(store, { onSetActiveMode });
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(onSetActiveMode).toHaveBeenCalledWith('comment');
  });

  it('calls onSetActiveMode("none") when clicked while already active (toggle off)', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onSetActiveMode = vi.fn();
    renderToolbar(store, { activeMode: 'comment', onSetActiveMode });
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(onSetActiveMode).toHaveBeenCalledWith('none');
  });

  it('shows the toggle as active when activeMode is "comment"', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { activeMode: 'comment' });
    const btn = screen.getByRole('button', { name: /comment/i });
    // ICON_BTN_ACTIVE styling (see components/toolbar/styles.tsx) sets a dark
    // background — asserting the computed background is the simplest way to
    // check "looks active" without depending on a CSS class name.
    expect(btn.style.background).toBe('rgb(30, 41, 59)'); // #1e293b
  });
});

describe('Toolbar — grid-snap toggle', () => {
  it('renders a snap-to-grid toggle button', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);
    expect(screen.getByTitle('Snap to grid')).toBeInTheDocument();
  });

  it('calls onToggleSnap when clicked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onToggleSnap = vi.fn();
    renderToolbar(store, { onToggleSnap });
    fireEvent.click(screen.getByTitle('Snap to grid'));
    expect(onToggleSnap).toHaveBeenCalled();
  });

  it('reflects snapEnabled=true via aria-pressed + active styling', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { snapEnabled: true });
    const btn = screen.getByTitle('Snap to grid');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    // ICON_BTN_ACTIVE styling (components/toolbar/styles.tsx) — same "looks
    // active" check the mode-toggle tests use.
    expect(btn.style.background).toBe('rgb(30, 41, 59)'); // #1e293b
  });

  it('reflects snapEnabled=false via aria-pressed + inactive styling', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { snapEnabled: false });
    const btn = screen.getByTitle('Snap to grid');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.style.background).not.toBe('rgb(30, 41, 59)');
  });

  it('is hidden on the content-locked live board (drag/resize disabled there)', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { contentLocked: true });
    expect(screen.queryByTitle('Snap to grid')).not.toBeInTheDocument();
  });

  it('is hidden when readonly', () => {
    const store = createBoardStore(emptyBoard(), { readonly: true });
    renderToolbar(store, { readonly: true });
    expect(screen.queryByTitle('Snap to grid')).not.toBeInTheDocument();
  });
});

describe('Toolbar — pencil-mode toggle', () => {
  it('renders a pencil-mode toggle button', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);
    expect(screen.getByRole('button', { name: /pencil/i })).toBeInTheDocument();
  });

  it('calls onSetActiveMode("pencil") when clicked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onSetActiveMode = vi.fn();
    renderToolbar(store, { onSetActiveMode });
    fireEvent.click(screen.getByRole('button', { name: /pencil/i }));
    expect(onSetActiveMode).toHaveBeenCalledWith('pencil');
  });

  it('shows the toggle as active when activeMode is "pencil"', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { activeMode: 'pencil' });
    const btn = screen.getByRole('button', { name: /pencil/i });
    expect(btn.style.background).toBe('rgb(30, 41, 59)');
  });
});

describe('Toolbar — annotation-mode toggle + Wipe', () => {
  it('renders an annotation-mode toggle button', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);
    expect(screen.getByRole('button', { name: /annotat/i })).toBeInTheDocument();
  });

  it('calls onSetActiveMode("annotation") when clicked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onSetActiveMode = vi.fn();
    renderToolbar(store, { onSetActiveMode });
    fireEvent.click(screen.getByRole('button', { name: /annotat/i }));
    expect(onSetActiveMode).toHaveBeenCalledWith('annotation');
  });

  it('shows a Wipe button only when annotation mode is active and annotations exist', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { activeMode: 'annotation', hasAnnotations: true });
    expect(screen.getByRole('button', { name: /wipe/i })).toBeInTheDocument();
  });

  it('hides the Wipe button when annotation mode is active but there are no annotations', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { activeMode: 'annotation', hasAnnotations: false });
    expect(screen.queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
  });

  it('hides the Wipe button when annotation mode is not active, even with annotations', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { activeMode: 'none', hasAnnotations: true });
    expect(screen.queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
  });

  it('calls onWipeAnnotations when Wipe is clicked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onWipeAnnotations = vi.fn();
    renderToolbar(store, { activeMode: 'annotation', hasAnnotations: true, onWipeAnnotations });
    fireEvent.click(screen.getByRole('button', { name: /wipe/i }));
    expect(onWipeAnnotations).toHaveBeenCalled();
  });
});

describe('Toolbar — mode exclusivity', () => {
  it('only one of comment/pencil/annotation appears active at a time', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { activeMode: 'pencil' });
    const dark = 'rgb(30, 41, 59)';
    expect(screen.getByRole('button', { name: /comment/i }).style.background).not.toBe(dark);
    expect(screen.getByRole('button', { name: /pencil/i }).style.background).toBe(dark);
    expect(screen.getByRole('button', { name: /annotat/i }).style.background).not.toBe(dark);
  });
});

describe('Toolbar — history button (P6-T36)', () => {
  it('renders a History button when onOpenHistory is given', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { onOpenHistory: vi.fn() });
    expect(screen.getByTitle('Version history')).toBeInTheDocument();
  });

  it('hides the History button when onOpenHistory is omitted (history unavailable)', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { onOpenHistory: undefined });
    expect(screen.queryByTitle('Version history')).not.toBeInTheDocument();
  });

  it('calls onOpenHistory when clicked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onOpenHistory = vi.fn();
    renderToolbar(store, { onOpenHistory });
    fireEvent.click(screen.getByTitle('Version history'));
    expect(onOpenHistory).toHaveBeenCalled();
  });
});
