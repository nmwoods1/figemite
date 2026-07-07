// ── Toolbar ───────────────────────────────────────────────────────────────────
//
// Ported from the legacy figmalade prototype's Toolbar.tsx (node-creation +
// styling controls), wired to the new doc-first store's mutation API instead
// of the legacy's `commit`. Node-creation buttons compute the new node's
// position at the current ReactFlow view center (canvas/coords.ts's
// `viewCenter`), build it via the shared `@easel/shared` factories with a
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
import type { BoardFile } from '@easel/shared';
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
    commentMode: boolean;
    onToggleCommentMode: () => void;
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
        commentMode={overrides.commentMode ?? false}
        onToggleCommentMode={overrides.onToggleCommentMode ?? (() => {})}
      />
    </ReactFlowProvider>,
  );
}

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
});

describe('Toolbar — comment-mode toggle', () => {
  it('renders a comment-mode toggle button', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store);
    expect(screen.getByRole('button', { name: /comment/i })).toBeInTheDocument();
  });

  it('calls onToggleCommentMode when clicked', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    const onToggleCommentMode = vi.fn();
    renderToolbar(store, { onToggleCommentMode });
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(onToggleCommentMode).toHaveBeenCalled();
  });

  it('shows the toggle as active when commentMode is true', () => {
    const store = createBoardStore(emptyBoard(), { readonly: false });
    renderToolbar(store, { commentMode: true });
    const btn = screen.getByRole('button', { name: /comment/i });
    // ICON_BTN_ACTIVE styling (see components/toolbar/styles.tsx) sets a dark
    // background — asserting the computed background is the simplest way to
    // check "looks active" without depending on a CSS class name.
    expect(btn.style.background).toBe('rgb(30, 41, 59)'); // #1e293b
  });
});
