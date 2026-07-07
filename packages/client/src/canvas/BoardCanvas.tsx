// ── BoardCanvas: the thin canvas orchestrator ────────────────────────────────
//
// Hydrates a `BoardStore` (doc-first, `store/board-store.ts`) from the given
// `BoardFile` and renders it with ReactFlow. Two paths share one store:
//
//   - READ-ONLY (`readonly`): the P3-T20 path, unchanged. Subscribes to the
//     store, adapts the snapshot via `boardToRf`, and renders it with every
//     mutating/selecting RF interaction prop turned OFF. No interaction
//     handlers are wired, and the store hydrates immediately (synchronously)
//     from the fetched `BoardFile` via `loadBoardIntoDoc` — no provider, no
//     network.
//
//   - EDITABLE (`!readonly`): the P4-T22 path. `useEditableCanvas` owns RF's
//     controlled node/edge state, reconciles doc→RF (preserving selection and
//     in-flight drags), and exposes the interaction handlers that COMMIT to the
//     doc via the store's mutation API (drag-stop → moveNode, connect → addEdge,
//     delete → deleteNodes/deleteEdges). BoardCanvas stays thin — it just spreads
//     the hook's props onto `<ReactFlow>` and flips the interaction booleans on.
//
//     P5-T29: when `slug` is given, the store joins the server's realtime room
//     (`lib/realtime.ts`'s `joinBoardRoom`, via `board-store.ts`'s `room`
//     option) instead of seeding content from the fetched `BoardFile` — the
//     server is the single content writer (P5-T28 seeds/persists the room from
//     disk). The editable pane shows a small "connecting" placeholder until the
//     room's provider reports `synced`, then renders the real canvas. Content
//     no longer flows client -> server via POST at all: `useAutosave` is gone,
//     and the save-status indicator (`Toolbar`'s `syncStatus`) now reflects the
//     provider's connection/sync state via `useSyncStatus`, not a save result.
//     (Callers that omit `slug` — most unit tests — get the OLD synchronous
//     local-seed behaviour with no network involved; see `board-store.ts`'s
//     module doc for that fallback path's rationale.)
//
// Viewport: `board.viewport` seeds RF's *uncontrolled* `defaultViewport` (RF
// owns pan/zoom state internally from then on — a later phase wires viewport
// changes back to the store via `setViewport`). A board with no meaningful
// viewport (all-zero, the BoardFile default for a freshly created board) gets
// `fitView` instead, so an empty/fresh board doesn't render pinned at (0,0)
// zoom 1 regardless of where its content actually is.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
// RF's base stylesheet — without this, ReactFlow renders unstyled (its own
// `#013` "The React Flow parent container needs a width and a height..."-
// adjacent "styles not loaded" warning) and node/edge layout fidelity suffers
// (e.g. `.react-flow__handle` has no default position/size, panes have no
// dimensions). Flagged in P3-T20 (warning #013); fixed here so the P3-T21
// structural-parity gate measures a correctly-styled canvas.
import '@xyflow/react/dist/style.css';
import type { BoardFile } from '@easel/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { useBoardStore } from '../store/use-board-store.js';
import { useEditableCanvas } from '../hooks/useEditableCanvas.js';
import { useMultiSelectResize } from '../hooks/useMultiSelectResize.js';
import { useUndoRedo } from '../hooks/useUndoRedo.js';
import { useSyncStatus } from '../hooks/useSyncStatus.js';
import { useBoardInteractions } from '../hooks/useBoardInteractions.js';
import { usePresence } from '../hooks/usePresence.js';
import type { PresenceAwareness } from '../hooks/usePresence.js';
import { useFollowMode } from '../hooks/useFollowMode.js';
import { useEditingNodeTracker } from '../hooks/useEditingNodeTracker.js';
import { boardToRf } from './rf-adapters.js';
import { MultiSelectResizer } from './MultiSelectResizer.js';
import { nodeTypes } from '../nodes/index.js';
import { edgeTypes } from '../edges/index.js';
import { Toolbar } from '../components/Toolbar.js';
import { DescriptionModal } from '../components/DescriptionModal.js';
import { PresenceLayer } from '../components/PresenceLayer.js';
import { ActiveUsersPanel } from '../components/ActiveUsersPanel.js';
import { nodeLabel } from './node-label.js';
import { getFlowPointer } from './coords.js';
import { getLocalUser } from '../lib/identity.js';

export interface BoardCanvasProps {
  board: BoardFile;
  readonly: boolean;
  onNavigate?: (nodeId: string) => void;
  /** The board's slug + sub-board path. In editable mode, GIVEN a `slug` means
   * "join the server's realtime room for this board" (P5-T29) — content
   * syncs from the room instead of being seeded from `board`/POSTed back.
   * Omitted (or read-only mode) means no room: read-only never joins one; an
   * editable board without a `slug` falls back to the old synchronous
   * local-seed behaviour (a convenience most unit tests rely on). */
  slug?: string;
  path?: string[];
}

/** True when a viewport is just the BoardFile zero-value default — i.e. not
 * meaningfully set by anything (a fresh board, or one predating viewport
 * persistence) — in which case `fitView` gives a more useful initial framing
 * than pinning the camera at the origin. */
function isDefaultViewport(vp: BoardFile['viewport']): boolean {
  return vp.x === 0 && vp.y === 0 && vp.zoom === 1;
}

// Props common to both the read-only and editable panes (everything that
// doesn't depend on the interaction wiring). Kept in one place so the two
// branches can't drift on the shared config (node/edge types, connection mode).
const commonReactFlowProps = {
  nodeTypes,
  edgeTypes,
  // Loose connection mode: every node handle is `type="source"` (see
  // ConnectionHandles), so an edge whose endpoint targets one of them only
  // resolves if a source handle may also act as a target — which is exactly
  // what Loose allows. The default (Strict) rejects a source handle as an edge
  // target, so `getEdgePosition` fails (error #008) and edges never paint.
  // Matches the legacy prototype, which set `ConnectionMode.Loose` for the same
  // reason.
  connectionMode: ConnectionMode.Loose,
} as const;

/** Read-only pane (P3-T20): store snapshot → boardToRf → render, no handlers. */
function ReadOnlyCanvas({ store, fitView, viewport }: PaneProps) {
  const { nodes, edges } = useBoardStore(store);
  const rf = useMemo(() => boardToRf({ nodes, edges }, true), [nodes, edges]);

  return (
    <ReactFlow
      {...commonReactFlowProps}
      nodes={rf.nodes}
      edges={rf.edges}
      defaultViewport={fitView ? undefined : viewport}
      fitView={fitView}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}

/** A small full-pane placeholder shown while an editable board's realtime
 * room is still connecting/syncing (P5-T29) — the doc has no content yet in
 * this state (a room-joined store starts empty; see board-store.ts's module
 * doc), so rendering `<ReactFlow>` before `synced` would flash an empty
 * canvas rather than the board's actual content arriving moments later. */
function ConnectingPlaceholder() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <p style={{ color: '#94a3b8', fontSize: 14 }}>Connecting…</p>
    </div>
  );
}

/** Editable pane (P4-T22): interaction handlers commit to the doc via the store.
 * P4-T24 adds the multi-select group-resize overlay: `MultiSelectResizer`
 * renders (as a sibling of `<ReactFlow>`, inside the same measured
 * container) whenever 2+ nodes are selected, and `useMultiSelectResize`
 * commits its scale events to the doc. Individual nodes' own `NodeResizer`s
 * self-suppress via `useIsMultiSelected` (nodes/use-is-multi-selected.ts)
 * reading RF's own selection store directly, so no extra wiring is needed
 * here to hide them.
 *
 * P4-T25 adds the DescriptionModal: this component OWNS "which node's
 * description is open" state (`descNodeId`, mirroring the legacy
 * BoardCanvas.tsx's own `descNodeId` state) and passes the opener into
 * `useEditableCanvas`'s `onOpenDescription` option, which wires it through to
 * every describable node's `data.onOpenDescription` seam (P4-T24). Saving
 * commits via `store.updateNode(id, { description })`.
 *
 * P4-T27 wired the undo hook + `useBoardInteractions` (keyboard shortcuts,
 * internal clipboard, layer reorder, alt-drag duplicate) alongside a
 * content-autosave hook. P5-T29 REMOVES that content-autosave: the server is
 * now the single content writer (P5-T28's `YjsWebsocketService` seeds/
 * persists the room from disk on its own debounce), so there is nothing left
 * for the client to POST. `useUndoRedo` is still only ever constructed here,
 * in the EDITABLE pane — the read-only pane never mounts this component, so
 * a read-only board never gets an undo manager.
 *
 * `useSyncStatus(store.room?.provider ?? null)` replaces the old
 * `useAutosave`'s `saveStatus` for the Toolbar's indicator — it reflects the
 * REALTIME PROVIDER's connection/sync state, not a save result (there is no
 * client save to report on anymore). `useBoardInteractions`'s `flushNow` is
 * kept bound to Cmd/Ctrl+S (so the shortcut stays harmless rather than
 * dead/removed) but is now a no-op: the server already persists on its own
 * debounce, so there is nothing left to flush from the client.
 *
 * P5-T30 adds live presence (remote cursors, editing outlines, an
 * active-users panel) + follow-mode, gated entirely on `store.room` — a
 * room-joined store has a real awareness to publish/subscribe through; a
 * store with no room (read-only-equivalent local-seed convenience path, most
 * unit tests) has none, so `awareness` is `null` and every presence hook is a
 * safe no-op / renders nothing (see usePresence.ts/useFollowMode.ts's own
 * null-awareness handling). Cursor publishing is wired to the measured
 * container's `pointermove` (throttled inside `usePresence`, not here);
 * `editingNodeId` is wired via `useEditingNodeTracker`'s DOM focus tracking —
 * the existing edit seam every text-bearing node type already provides for
 * free via RF's own `.react-flow__node[data-id]` wrapper, requiring no
 * changes to any node component. Follow-mode's `setViewport` targets RF's own
 * imperative viewport setter (`useReactFlow()`), and `onMoveStart` reports
 * every viewport change (including follow's own) to `useFollowMode`, which
 * tells its own programmatic moves apart from a real manual pan/zoom. */
function EditableCanvas({ store, fitView, viewport }: EditablePaneProps) {
  const [descNodeId, setDescNodeId] = useState<string | null>(null);
  const openDescription = useCallback((id: string) => setDescNodeId(id), []);
  const editable = useEditableCanvas(store, { onOpenDescription: openDescription });
  const multiSelect = useMultiSelectResize(store, editable.selectedNodeIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const { nodes } = useBoardStore(store);

  const undoRedo = useUndoRedo(store);
  const syncStatus = useSyncStatus(store.room?.provider ?? null);
  // Cmd/Ctrl+S stays bound (useBoardInteractions calls it unconditionally on
  // the shortcut) but is now a harmless no-op — the server persists content
  // on its own debounce, so there's nothing left for the client to flush.
  const flushNow = useCallback(() => {}, []);
  const interactions = useBoardInteractions({
    store,
    selectedNodeIds: editable.selectedNodeIds,
    selectedEdgeIds: editable.selectedEdgeIds,
    readonly: false,
    undo: undoRedo.undo,
    redo: undoRedo.redo,
    flushNow,
    onEscape: () => setDescNodeId(null),
  });

  const descNode = descNodeId ? nodes.find((n) => n.id === descNodeId) : undefined;

  const handleSaveDescription = useCallback(
    (md: string) => {
      if (!descNodeId) return;
      store.updateNode(descNodeId, { description: md || undefined });
    },
    [descNodeId, store],
  );

  // ── P5-T30: live presence + follow-mode (realtime-mode only) ──────────────
  const awareness = (store.room?.awareness as PresenceAwareness | undefined) ?? null;
  const localUser = useMemo(() => getLocalUser(), []);
  const presence = usePresence(awareness, localUser);
  const { setViewport } = useReactFlow();
  const followMode = useFollowMode(awareness, setViewport);
  const liveViewport = useViewport();

  // Track which node the LOCAL user is editing (DOM focus tracking — see
  // this component's module doc) and publish it.
  useEditingNodeTracker(containerRef, presence.setEditingNodeId);

  // Publish the local viewport continuously (RF re-renders `useViewport()` on
  // every pan/zoom tick during a gesture) so remote followers track it live.
  useEffect(() => {
    presence.publishViewport(liveViewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `presence.publishViewport` is stable per `awareness` identity (usePresence.ts); depending on the individual x/y/zoom fields (not the whole `liveViewport` object, a fresh reference every tick) avoids re-running this effect's body more than the viewport itself actually changed.
  }, [liveViewport.x, liveViewport.y, liveViewport.zoom]);

  // `liveViewport` read through a ref so the pointer-listener effect below
  // can mount its DOM listeners ONCE (not re-bind them on every viewport
  // tick, which `useViewport()` produces a fresh object reference for even
  // when x/y/zoom are numerically unchanged) while still reading the CURRENT
  // viewport at move time.
  const liveViewportRef = useRef(liveViewport);
  useEffect(() => {
    liveViewportRef.current = liveViewport;
  }, [liveViewport]);

  // Publish the local cursor (flow-space) on pointer move over the measured
  // container; clear it when the pointer leaves. Throttled inside
  // usePresence's publishCursor, not here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      presence.publishCursor(getFlowPointer(e, rect, liveViewportRef.current));
    };
    const handleLeave = () => presence.publishCursor(null);

    container.addEventListener('pointermove', handleMove);
    container.addEventListener('pointerleave', handleLeave);
    return () => {
      container.removeEventListener('pointermove', handleMove);
      container.removeEventListener('pointerleave', handleLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `presence.publishCursor` is stable per `awareness` identity; the live viewport is read via `liveViewportRef` (see above) precisely so this effect mounts its DOM listeners once rather than re-binding on every viewport tick.
  }, []);

  // A room-joined store (P5-T29) starts with an EMPTY doc until the
  // provider's first sync completes — show a placeholder rather than an
  // empty canvas flash. A store with no room (read-only-equivalent local
  // seed, e.g. most unit tests) has no `room` at all and renders immediately.
  if (store.room && syncStatus === 'connecting') {
    return <ConnectingPlaceholder />;
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        {...commonReactFlowProps}
        nodes={editable.nodes}
        edges={editable.edges}
        onNodesChange={editable.onNodesChange}
        onEdgesChange={editable.onEdgesChange}
        onNodeDragStart={interactions.onNodeDragStart}
        onNodeDragStop={editable.onNodeDragStop}
        onNodesDelete={editable.onNodesDelete}
        onConnect={editable.onConnect}
        onEdgesDelete={editable.onEdgesDelete}
        onSelectionChange={editable.onSelectionChange}
        onMoveStart={followMode.notifyManualViewportChange}
        defaultViewport={fitView ? undefined : viewport}
        fitView={fitView}
        nodesDraggable
        nodesConnectable
        elementsSelectable
      >
        <Background />
        <Controls />
      </ReactFlow>
      <MultiSelectResizer
        selectedNodes={multiSelect.selectedNodes}
        containerRef={containerRef}
        onStart={multiSelect.onScaleStart}
        onScale={multiSelect.onScale}
      />
      <Toolbar
        store={store}
        selectedNodeIds={editable.selectedNodeIds}
        selectedEdgeIds={editable.selectedEdgeIds}
        syncStatus={syncStatus}
        readonly={false}
      />
      {descNode && (
        <DescriptionModal
          nodeLabel={nodeLabel(descNode)}
          initialText={descNode.description ?? ''}
          onSave={handleSaveDescription}
          onClose={() => setDescNodeId(null)}
        />
      )}
      {store.room && (
        <>
          <PresenceLayer remotes={presence.remotes} nodes={nodes} />
          <ActiveUsersPanel
            localUser={localUser}
            remotes={presence.remotes}
            followClientId={followMode.followClientId}
            onFollow={(clientId) =>
              clientId === null ? followMode.stopFollowing() : followMode.follow(clientId)
            }
          />
        </>
      )}
    </div>
  );
}

interface PaneProps {
  store: BoardStore;
  fitView: boolean;
  viewport: BoardFile['viewport'];
}

type EditablePaneProps = PaneProps;

/**
 * `store`'s construction is INTENTIONALLY NOT a `useMemo` (a past version of
 * this component used one, paired with a `useEffect(() => () =>
 * store.destroy(), [store])` cleanup — a real bug, only visible under
 * `<StrictMode>` in a real browser, that the render-only jsdom test suite
 * structurally could not catch: React does not guarantee a `useMemo` value is
 * computed exactly once per mount (the docs explicitly call this out; dev
 * `<StrictMode>` deliberately double-invokes it to surface exactly this
 * class of bug), so pairing a `useMemo`-sourced value with a teardown in an
 * effect cleanup is unsound whenever the memo callback runs more than once
 * for what the effect treats as "one mount." Concretely, `<StrictMode>`'s
 * mount -> cleanup -> re-mount cycle called `store.destroy()` (which calls
 * `doc.destroy()`, per board-store.ts) after the FIRST of the two `useMemo`
 * calls, but the SECOND `useMemo` call's result — the one React actually
 * kept — was never told about that teardown and went on being used for the
 * rest of the component's real lifetime with an already-destroyed `Y.Doc`.
 * The doc still silently accepted further writes (`Y.Doc.transact`/`.set`
 * don't hard-fail post-destroy) and the (since-removed, P5-T29) content-
 * autosave hook's OWN independent `doc.on('update', ...)` listener (attached
 * in a later-mounting effect, i.e. after the premature destroy) kept firing —
 * so autosave/persistence looked like it worked. But `board-store.ts`'s OWN internal `onDocUpdate`
 * listener (which refreshes `getSnapshot()`'s cache and notifies
 * `useSyncExternalStore` subscribers) had been `doc.off()`'d by that same
 * `destroy()` call and never re-registered — so every toolbar-created node,
 * drag, resize, etc. after mount silently stopped reaching the rendered
 * ReactFlow canvas even though it kept landing in the doc and on disk. This
 * is exactly the gap `e2e/interaction.spec.ts` (P4-T26, the Phase-4 gate)
 * exists to catch: `render(<BoardCanvas />)` under vitest+jsdom never wraps
 * in `<StrictMode>`, so no unit/component test could have caught this — a
 * real browser mounting the REAL `main.tsx` (which does wrap in
 * `<StrictMode>`) was required.
 *
 * The fix: construct AND tear down the store from the SAME effect, so
 * StrictMode's double-invocation reliably reconstructs a fresh store on its
 * simulated re-mount instead of reusing a torn-down one. `useState`'s lazy
 * initializer seeds the FIRST store synchronously (so render never sees a
 * null store); the effect then re-derives the correct store for the current
 * `board`/`readonly`/`room` deps, replacing + destroying the previous one on
 * a dependency change and destroying (without replacing) on unmount.
 *
 * `room` (P5-T29): identifies which server room an editable store should
 * join (`{ slug, path }`, see `board-store.ts`'s `BoardStoreOptions.room`) —
 * `undefined` for read-only stores and for the editable-without-`slug`
 * convenience path (see `BoardCanvasProps.slug`'s doc). Included in the
 * effect's dependency array (via its own `roomKey` — a plain object would
 * fail `Object.is` every render) so navigating to a different board/sub-board
 * rejoins the right room rather than keeping the previous one's.
 */
function useBoardStoreLifecycle(
  board: BoardFile,
  readonly: boolean,
  room: { slug: string; path: string[] } | undefined,
): BoardStore {
  // Lazy initializer: builds the FIRST store synchronously during render, so
  // render never sees a null/placeholder store. `initialStoreRef` remembers
  // that exact instance (a `useState` lazy initializer's result is stable —
  // even StrictMode's double-invoke of it discards one result, same as
  // `useMemo`, but here we deliberately consume it from a ref exactly once,
  // inside the paired effect below, rather than trusting `useMemo`-style
  // reuse across renders).
  const [store, setStore] = useState<BoardStore>(() => createBoardStore(board, { readonly, room }));
  const initialStoreRef = useRef<BoardStore | null>(store);

  // A stable, comparable key for `room` — `BoardCanvasProps.path` is a fresh
  // array each render (App.tsx's board route note the same caveat), so
  // depending on `room` object identity directly would rebuild the store
  // every render. `undefined` (no room) stays its own stable key.
  const roomKey = room ? `${room.slug} ${room.path.join(' ')}` : '';

  useEffect(() => {
    // Reuse the lazy-initialized store on this effect's FIRST-ever run (so a
    // fresh mount doesn't construct a redundant second `Y.Doc` for the exact
    // same `board`/`readonly`/`room` the initializer already built); every
    // subsequent run (a real deps change, OR StrictMode's simulated re-mount
    // after having destroyed the previous one) builds a genuinely fresh store
    // instead of resurrecting an already-destroyed one. This is what makes
    // construction and teardown symmetric per effect run — see this
    // function's module doc for why that symmetry is the actual fix.
    const current = initialStoreRef.current ?? createBoardStore(board, { readonly, room });
    initialStoreRef.current = null;
    setStore(current);
    return () => current.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `roomKey` is the intentional stable proxy for `room` (see above); `room` itself is deliberately excluded to avoid rebuilding on its per-render object identity.
  }, [board, readonly, roomKey]);

  return store;
}

export function BoardCanvas({ board, readonly, slug, path }: BoardCanvasProps) {
  const room = !readonly && slug ? { slug, path: path ?? [] } : undefined;
  const store = useBoardStoreLifecycle(board, readonly, room);

  const fitView = isDefaultViewport(board.viewport);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        {readonly ? (
          <ReadOnlyCanvas store={store} fitView={fitView} viewport={board.viewport} />
        ) : (
          <EditableCanvas store={store} fitView={fitView} viewport={board.viewport} />
        )}
      </ReactFlowProvider>
    </div>
  );
}
