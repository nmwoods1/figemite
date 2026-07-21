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
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { useBoardStore } from '../store/use-board-store.js';
import { useEditableCanvas } from '../hooks/useEditableCanvas.js';
import { useMultiSelectResize } from '../hooks/useMultiSelectResize.js';
import { useUndoRedo } from '../hooks/useUndoRedo.js';
import { useSyncStatus } from '../hooks/useSyncStatus.js';
import { useBoardInteractions } from '../hooks/useBoardInteractions.js';
import { useAiLock } from '../hooks/useAiLock.js';
import { usePresence } from '../hooks/usePresence.js';
import type { PresenceAwareness } from '../hooks/usePresence.js';
import { useFollowMode } from '../hooks/useFollowMode.js';
import { useEditingNodeTracker } from '../hooks/useEditingNodeTracker.js';
import { useComments } from '../hooks/useComments.js';
import { useHistory } from '../hooks/useHistory.js';
import { boardToRf } from './rf-adapters.js';
import type { SubBoardAdapter } from './rf-adapters.js';
import { MultiSelectResizer } from './MultiSelectResizer.js';
import { nodeTypes } from '../nodes/index.js';
import { edgeTypes } from '../edges/index.js';
import { Toolbar } from '../components/Toolbar.js';
import type { ToolbarMode } from '../components/Toolbar.js';
import { DescriptionModal } from '../components/DescriptionModal.js';
import { HistoryPanel } from '../components/HistoryPanel.js';
import { PresenceLayer } from '../components/PresenceLayer.js';
import { ActiveUsersPanel } from '../components/ActiveUsersPanel.js';
import { CommentLayer } from '../components/CommentLayer.js';
import { PencilLayer } from '../components/PencilLayer.js';
import { AnnotationLayer } from '../components/AnnotationLayer.js';
import { nodeLabel } from './node-label.js';
import { getFlowPointer } from './coords.js';
import { getLocalUser } from '../lib/identity.js';
import { ANNOTATIONS } from '@figemite/shared';

export interface BoardCanvasProps {
  board: BoardFile;
  readonly: boolean;
  /** Opens (creating first, in editable mode) the sub-board of the drillable
   * node with this id. Owned by the route (App.tsx's `BoardRoute`), which holds
   * navigation + the loaded board's labels. Omitting it hides every drill
   * badge. Navigate-in works in read-only mode; only CREATE is editable-only. */
  onDrillIn?: (nodeId: string) => void;
  /** Ids of nodes at THIS board level that already have a sub-board (from
   * `listBoards()`'s `subBoardPaths`). Drives the always-visible drill badge. */
  subBoardChildIds?: Set<string>;
  /** The board's slug + sub-board path. In editable mode, GIVEN a `slug` means
   * "join the server's realtime room for this board" (P5-T29) — content
   * syncs from the room instead of being seeded from `board`/POSTed back.
   * Omitted (or read-only mode) means no room: read-only never joins one; an
   * editable board without a `slug` falls back to the old synchronous
   * local-seed behaviour (a convenience most unit tests rely on). */
  slug?: string;
  path?: string[];
  /** When set, join the DRAFT room for this board instead of prod — the store's
   * edits then persist into `boards/<slug>/.drafts/<draftId>/`, never prod. */
  draftId?: string;
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
  // Connector ergonomics. `reconnectRadius` is the grab zone around an edge's
  // endpoint (the invisible reconnect anchor) — enlarged from RF's default 10
  // so an endpoint is easy to pick up. `connectionRadius` is how close a drop
  // must land to a target handle to snap onto it — enlarged from the default 20
  // so dragging a connector's end onto a node reconnects even when the drop
  // isn't pixel-perfect on the small handle dot. Together these make
  // "drag a connector's end to a new anchor" reliably land.
  reconnectRadius: 18,
  connectionRadius: 45,
} as const;

/** Read-only pane (P3-T20): store snapshot → boardToRf → render, no handlers.
 *
 * P6-T34 adds VIEW-ONLY comments: `slug` (given by every real route — see
 * `BoardCanvasProps.slug`'s doc, `App.tsx` always passes one even in
 * read-only/static mode) fetches `comments.json` via `useComments` (in
 * read-only mode, so every mutation is a no-op) and renders existing pins —
 * comments are readable everywhere, writable only in the editable pane. No
 * comment-mode toggle exists here (no Toolbar renders in read-only mode at
 * all), so `CommentLayer`'s `commentMode` is always `false`: pins render,
 * placement never does. A `containerRef` div now wraps `<ReactFlow>` (it
 * didn't need one before this task) so `CommentLayer` has a measured element
 * to project screen coordinates against, mirroring the editable pane below. */
function ReadOnlyCanvas({
  store,
  fitView,
  viewport,
  slug,
  subBoard,
}: PaneProps & { slug?: string; subBoard?: SubBoardAdapter }) {
  const { nodes, edges } = useBoardStore(store);
  const rf = useMemo(
    () => boardToRf({ nodes, edges }, true, undefined, undefined, subBoard),
    [nodes, edges, subBoard],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const comments = useComments(slug, { readonly: true });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
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
        <Controls showInteractive={false} />
      </ReactFlow>
      {slug && (
        <CommentLayer
          comments={comments.comments}
          nodes={nodes}
          commentMode={false}
          containerRef={containerRef}
          readonly={true}
          onAddComment={() => {}}
          onReply={() => {}}
          onToggleResolved={() => {}}
          onDelete={() => {}}
        />
      )}
    </div>
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
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <p style={{ color: '#94a3b8', fontSize: 14 }}>Connecting…</p>
    </div>
  );
}

/** Renders a previewed history snapshot READ-ONLY, in place of the live
 * canvas (P6-T36). Builds its OWN, throwaway read-only `BoardStore` from the
 * previewed `BoardFile` — a separate `Y.Doc` instance entirely — so nothing
 * here ever touches the live `store`/its doc; the live board keeps syncing
 * underneath, unseen, exactly as it would if this component didn't exist (see
 * hooks/useHistory.ts's module doc for why that isolation matters). The
 * throwaway store is rebuilt whenever `board` changes (a new preview target)
 * and destroyed on unmount/change, mirroring `useBoardStoreLifecycle`'s own
 * construct-and-tear-down-together discipline (minus that hook's StrictMode
 * complications, which don't apply here — read-only stores never join a room
 * or hold a socket, so there is no non-resumable resource to protect against
 * a rehearsal double-invoke).
 *
 * "Rebuild on prop change" uses the same derived-during-render idiom as
 * `useBoardStoreLifecycle`'s own `lastBoard`/`lastDepsKey` (comparing during
 * render and calling `setState` synchronously in the render body) rather than
 * a `useRef` comparison — this codebase's `react-hooks/refs` lint rule flags
 * reading a ref's `.current` during render as unsound under React Compiler's
 * assumptions, so a plain `useState`-held "last seen board" is used instead. */
function HistoryPreviewPane({ board }: { board: BoardFile }) {
  const [previewStore, setPreviewStore] = useState(() =>
    createBoardStore(board, { readonly: true }),
  );
  const [lastBoard, setLastBoard] = useState(board);
  if (board !== lastBoard) {
    setLastBoard(board);
    setPreviewStore(createBoardStore(board, { readonly: true }));
  }
  useEffect(() => {
    return () => previewStore.destroy();
  }, [previewStore]);

  const fitView = isDefaultViewport(board.viewport);
  return <ReadOnlyCanvas store={previewStore} fitView={fitView} viewport={board.viewport} />;
}

/** The "previewing an old version" banner (P6-T36) — a clear affordance that
 * what's on screen right now is a READ-ONLY snapshot, not the live board,
 * with Restore/Discard actions. Ported layout from the legacy prototype's
 * inline preview banner (src/components/BoardCanvas.tsx ~L1728-1751). */
function HistoryPreviewBanner({
  timestamp,
  onRestore,
  onDiscard,
}: {
  timestamp: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const formatted = (() => {
    try {
      return new Date(timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  })();
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        background: '#fef3c7',
        border: '1px solid #fcd34d',
        color: '#92400e',
        padding: '7px 14px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <span>Previewing {formatted}</span>
      <button
        type="button"
        onClick={onRestore}
        style={{
          background: '#92400e',
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          color: '#fff',
          fontWeight: 600,
          padding: '3px 10px',
          borderRadius: 4,
        }}
        title="Restore this version"
      >
        Restore
      </button>
      <button
        type="button"
        onClick={onDiscard}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          color: '#92400e',
          fontWeight: 700,
          padding: '0 4px',
        }}
        title="Discard preview, return to current version"
      >
        ×
      </button>
    </div>
  );
}

/** The "AI is editing" affordance (P5-T31), shown while `aiLocked`. Mirrors
 * the legacy prototype's banner (src/components/BoardCanvas.tsx ~L1924-1938):
 * a small pill centered near the top of the canvas, non-interactive
 * (`pointerEvents: 'none'`) so it never blocks a click meant for the (now
 * gated-off) canvas beneath it. */
function AiLockBanner() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        background: '#fef3c7',
        border: '2px solid #f59e0b',
        color: '#92400e',
        padding: '8px 18px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 16 }}>🤖</span>
      AI is editing this board — your edits are paused
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
function EditableCanvas({
  store,
  fitView,
  viewport,
  slug,
  path,
  contentLocked,
  draftId,
  subBoard,
}: EditablePaneProps) {
  const [descNodeId, setDescNodeId] = useState<string | null>(null);
  const openDescription = useCallback((id: string) => setDescNodeId(id), []);
  // On the live board (content-locked) descriptions are view-frozen too — pass a
  // no-op opener so nodes never surface the edit affordance.
  const editable = useEditableCanvas(store, {
    onOpenDescription: contentLocked ? undefined : openDescription,
    subBoard,
  });
  const multiSelect = useMultiSelectResize(store, editable.selectedNodeIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const { nodes } = useBoardStore(store);

  const undoRedo = useUndoRedo(store);
  const syncStatus = useSyncStatus(store.room?.provider ?? null);

  // ── P6-T36: history (time-travel — list/preview/restore/discard) ──────────
  // See hooks/useHistory.ts's module doc for the preview-isolation and
  // restore-application contracts. `available` is false without a `slug`
  // (the no-room unit-test convenience path) — the Toolbar's History button
  // is omitted entirely in that case (and, transitively, in READONLY mode:
  // the read-only pane never mounts this component at all).
  const history = useHistory({ slug, path: path ?? [], draftId, store, undo: undoRedo });

  // ── P6-T34: comments (comments.json — separate from the Yjs doc) ───────────
  // `reloadCommentsRef` bridges useAiLock's single `onExternalChange`
  // callback (below) to useComments' own re-fetch, registered via its
  // subscription-style `onExternalChange` option — both this hook's SSE
  // subscription and useComments' consumer contract only support ONE
  // registration each, so a ref is the simplest way to compose "clear undo
  // AND reload comments" out of the one upstream signal.
  const reloadCommentsRef = useRef<() => void>(() => {});
  // ── P6-T35: single mutually-exclusive overlay mode ──────────────────────────
  // Replaces the old bare `commentMode` boolean — at most one of
  // comment-placement, pencil-drawing, or annotation-drawing is ever active
  // (see Toolbar.tsx's `ToolbarMode` doc). `commentMode` below is derived so
  // every existing comment-mode wiring (CommentLayer, useComments'
  // post-submit exit) keeps working unchanged.
  const [activeMode, setActiveMode] = useState<ToolbarMode>('none');
  const commentMode = activeMode === 'comment';
  const comments = useComments(slug, {
    readonly: false,
    onExternalChange: (reload) => {
      reloadCommentsRef.current = reload;
    },
  });

  // P6-T35: annotations live on the doc's shared `ANNOTATIONS` Y.Array (see
  // AnnotationLayer's module doc for the ephemeral-vs-persisted contrast).
  // Observed here (not inside AnnotationLayer) only so the Toolbar's Wipe
  // button visibility (`hasAnnotations`) can be computed without AnnotationLayer
  // reaching back up into the Toolbar.
  const [hasAnnotations, setHasAnnotations] = useState(
    () => store.doc.getArray(ANNOTATIONS).length > 0,
  );
  useEffect(() => {
    const arr = store.doc.getArray(ANNOTATIONS);
    const onChange = () => setHasAnnotations(arr.length > 0);
    onChange();
    arr.observe(onChange);
    return () => arr.unobserve(onChange);
  }, [store.doc]);
  const handleWipeAnnotations = useCallback(() => {
    const arr = store.doc.getArray(ANNOTATIONS);
    store.doc.transact(() => {
      arr.delete(0, arr.length);
    });
  }, [store.doc]);

  // ── P5-T31: AI-session lock (SSE + reconnect + status reconcile) ───────────
  // A UX-only affordance now that server-side doc persistence (P5-T28) + MCP
  // edits via the room (P5-T32) mean an AI session's writes CRDT-merge into
  // the room and sync live — there is nothing to re-fetch on unlock. See
  // hooks/useAiLock.ts's module doc for the reconnect-reconciliation fix and
  // the documented external-change-during-a-live-room limitation.
  const { aiLocked } = useAiLock(slug, path ?? [], {
    onExternalChange: () => {
      undoRedo.clear();
      reloadCommentsRef.current();
    },
  });

  // The live board freezes content editing exactly like an AI lock does (no
  // drag/connect/delete/select, no content shortcuts) — comments + annotations
  // ride their own overlays and stay live. `contentLocked` is a persistent
  // state (you're on prod), `aiLocked` is transient; either blocks edits.
  const editsBlocked = aiLocked || contentLocked;

  // Cmd/Ctrl+S stays bound (useBoardInteractions calls it unconditionally on
  // the shortcut) but is now a harmless no-op — the server persists content
  // on its own debounce, so there's nothing left for the client to flush.
  const flushNow = useCallback(() => {}, []);
  const interactions = useBoardInteractions({
    store,
    selectedNodeIds: editable.selectedNodeIds,
    selectedEdgeIds: editable.selectedEdgeIds,
    readonly: false,
    aiLocked: editsBlocked,
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
  //
  // P5-T33 (the Phase 5 gate) found this effect never attached its listeners
  // at all for a room-joined store: `containerRef` is only attached to a DOM
  // node on the render branch that returns the REAL canvas markup (below) —
  // the render(s) that instead return `<ConnectingPlaceholder />` (while
  // `syncStatus === 'connecting'`, which is true for every fresh room join —
  // see that branch below) mount NO such node, so `containerRef.current` is
  // still `null` the one time this effect used to run with an empty `[]` deps
  // array. Once the room finished syncing and the function started returning
  // the real markup, this effect never re-ran to pick up the now-attached
  // ref, permanently losing cursor publishing for that whole component
  // instance's lifetime (confirmed via `multiplayer.spec.ts`'s remote-cursor
  // assertion). Depending on `syncStatus` re-runs this effect exactly when
  // the rendered branch changes from the placeholder to the real canvas (or,
  // for a no-room store, `syncStatus` is stable from the first real render
  // onward, so this still attaches exactly once).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `presence.publishCursor` is stable per `awareness` identity; the live viewport is read via `liveViewportRef` (see above). `syncStatus` is the intentional re-attach trigger (see comment above) — it is NOT read inside the effect body itself.
  }, [syncStatus]);

  // A room-joined store (P5-T29) starts with an EMPTY doc until the
  // provider's first sync completes — show a placeholder rather than an
  // empty canvas flash. A store with no room (read-only-equivalent local
  // seed, e.g. most unit tests) has no `room` at all and renders immediately.
  if (store.room && syncStatus === 'connecting') {
    return <ConnectingPlaceholder />;
  }

  // ── P6-T36: history preview ─────────────────────────────────────────────
  // While previewing (`history.previewedBoard` non-null), render THAT
  // snapshot read-only INSTEAD OF the live canvas — the live doc keeps
  // syncing underneath (this component's other hooks, e.g. presence/AI-lock,
  // are all still mounted and running; only the RETURNED markup changes), but
  // nothing here mutates it (see hooks/useHistory.ts's module doc). The
  // History panel itself never shows at the same time as the preview (opening
  // a preview closes the panel — see useHistory's `preview`), so no explicit
  // guard against both being visible at once is needed here.
  if (history.previewedBoard) {
    const previewVersion = history.versions.find((v) => v.id === history.previewId);
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <HistoryPreviewPane board={history.previewedBoard} />
        <HistoryPreviewBanner
          timestamp={previewVersion?.timestamp ?? new Date().toISOString()}
          onRestore={history.restore}
          onDiscard={history.discard}
        />
      </div>
    );
  }

  // Pencil/annotation mode suppresses normal RF interaction/selection for the
  // duration (see Toolbar.tsx's `ToolbarMode` doc) — the overlay captures
  // every pointer event instead, and letting RF's own drag/connect/select
  // stay live underneath would fight the overlay for the same gesture.
  const overlayModeActive = activeMode === 'pencil' || activeMode === 'annotation';

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
        onReconnect={editable.onReconnect}
        edgesReconnectable={!editsBlocked && !overlayModeActive}
        onSelectionChange={editable.onSelectionChange}
        onMoveStart={followMode.notifyManualViewportChange}
        defaultViewport={fitView ? undefined : viewport}
        fitView={fitView}
        nodesDraggable={!editsBlocked && !overlayModeActive}
        nodesConnectable={!editsBlocked && !overlayModeActive}
        elementsSelectable={!editsBlocked && !overlayModeActive}
        panOnDrag={!overlayModeActive}
        zoomOnScroll={!overlayModeActive}
      >
        <Background />
        <Controls showInteractive={false} />
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
        contentLocked={contentLocked}
        activeMode={activeMode}
        onSetActiveMode={setActiveMode}
        hasAnnotations={hasAnnotations}
        onWipeAnnotations={handleWipeAnnotations}
        onOpenHistory={history.available ? history.openPanel : undefined}
      />
      {history.panelOpen && (
        <HistoryPanel
          versions={history.versions}
          loading={history.versionsLoading}
          error={history.versionsError}
          onSelect={(id) => void history.preview(id)}
          onClose={history.closePanel}
        />
      )}
      {slug && (
        <CommentLayer
          comments={comments.comments}
          nodes={nodes}
          commentMode={commentMode}
          containerRef={containerRef}
          readonly={false}
          onAddComment={(target, text) => {
            comments.addComment(target, text);
            setActiveMode('none');
          }}
          onReply={comments.addReply}
          onToggleResolved={comments.toggleResolved}
          onDelete={comments.deleteComment}
        />
      )}
      <PencilLayer active={activeMode === 'pencil'} containerRef={containerRef} store={store} />
      <AnnotationLayer
        active={activeMode === 'annotation'}
        containerRef={containerRef}
        doc={store.doc}
      />
      {aiLocked && <AiLockBanner />}
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

interface EditablePaneProps extends PaneProps {
  /** The board's slug (P5-T31: `useAiLock`'s SSE subscription target — see
   * BoardCanvasProps.slug's doc). `undefined` for the no-slug unit-test
   * convenience path, which never opens an AI-lock SSE connection either. */
  slug?: string;
  path?: string[];
  /** The live (prod) board is content-frozen: only comments + annotations are
   * allowed. True whenever this pane edits prod (no `draftId`). Blocks every
   * node/edge gesture + the content-creation Toolbar tools, same as `aiLocked`. */
  contentLocked: boolean;
  /** Draft scope for this editable pane — threaded into `useHistory` so the
   * History panel lists/reads the DRAFT's own `.history/` (editing, and thus
   * snapshots, happen in a draft; prod is read-only). Undefined = prod. */
  draftId?: string;
  /** Drill-in (sub-board) adapter — see BoardCanvasProps.onDrillIn's doc. */
  subBoard?: SubBoardAdapter;
}

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
 * The original fix (P4-T22): construct AND tear down the store from the SAME
 * effect, so StrictMode's double-invocation reliably reconstructs a fresh
 * store on its simulated re-mount instead of reusing a torn-down one. That
 * version seeded the FIRST store via a `useState` lazy initializer (so render
 * never sees a null store); the effect then re-derived the correct store for
 * the current `board`/`readonly`/`room` deps, replacing + destroying the
 * previous one on a dependency change and destroying (without replacing) on
 * unmount.
 *
 * P5-T33 (the Phase 5 gate) found a SECOND, related StrictMode bug in that
 * scheme: the `useState(() => createBoardStore(...))` LAZY INITIALIZER is
 * ALSO double-invoked by `<StrictMode>` (React's docs call this out
 * explicitly, same rationale as the `useMemo` bug above) — but unlike an
 * effect, a `useState` initializer's two invocations have no matched
 * "cleanup" for whichever result React discards. Concretely: the discarded
 * invocation's `createBoardStore` call still joined a REAL server room (a
 * real `Y.Doc` + `WebsocketProvider` + websocket + awareness entry, per
 * board-store.ts's `room` option) that nothing ever called `.destroy()` on —
 * the effect only ever read/consumed ONE lazy result, so the discarded one's
 * provider/socket/awareness state leaked for the lifetime of the page. Every
 * OTHER connected peer then rendered a permanent PHANTOM duplicate presence
 * entry for this same human (confirmed via `multiplayer.spec.ts`'s
 * ActiveUsersPanel assertions and a manual repro logging each
 * `joinBoardRoom` construction's `clientID`: THREE distinct clientIDs were
 * constructed for what should be ONE store lifecycle — the kept lazy result,
 * the LEAKED discarded lazy result, and the effect's own fresh
 * StrictMode-remount construction).
 *
 * The fix (below) keeps construction in a `useState` lazy initializer (safe
 * to READ during render — the problem was never that half) but closes the
 * leak with `pendingStoreByKey`, a MODULE-level `Map` (deliberately NOT a
 * `useRef` — the project's `react-hooks/refs` lint rule flags reading a REF
 * as a render return value as unsound under React Compiler's assumptions,
 * and this codebase takes that rule seriously; a plain module-level `Map` is
 * not a ref at all, so it isn't subject to that rule, and is genuinely safe
 * here since it's never read for render OUTPUT — only used as a handoff
 * between two SUCCESSIVE lazy-initializer invocations for the same instance).
 *
 * CRITICAL correction from an earlier version of this fix (caught by manual
 * repro, not by any automated test — see this function's own doc below for
 * why): React's `<StrictMode>` double-invoke of a `useState` lazy initializer
 * keeps the FIRST call's return value as the actual state and discards the
 * SECOND's — NOT the reverse. An earlier version of this code assumed "last
 * invocation wins" (destroying whatever a PRIOR invocation had built, keeping
 * its OWN result) — which meant the real, kept `store` stayed bound to the
 * FIRST invocation's store the whole time regardless, while every later
 * invocation's freshly-built store (immediately discarded by React) was the
 * one left live-but-orphaned. The fix: the SECOND invocation must return the
 * SAME value the FIRST one did — `pendingStoreByKey` here means "the store
 * already built for this instance," checked and REUSED (never rebuilt) by
 * any invocation after the first.
 *
 * Reconstruction on a REAL `board`/`readonly`/`room` change uses the
 * "derived-during-render reset on prop change" idiom this codebase already
 * relies on elsewhere (hooks/usePresence.ts's `lastAwareness`,
 * hooks/useSyncStatus.ts's `lastProvider`) — comparing the tracked deps key
 * during render and calling `setState` synchronously in the render body
 * (never inside an effect body, which `react-hooks/set-state-in-effect`
 * correctly flags: a `setState` call textually inside `useEffect` risks
 * cascading renders, even when — as an EARLIER version of this fix did —
 * it's conditioned to be a no-op on the common path). The effect below is
 * therefore pure cleanup, using a DEFERRED-DESTROY (`setTimeout(…, 0)`,
 * cancelled by the very next setup if one follows immediately) rather than
 * destroying synchronously in the cleanup itself: `store`'s underlying
 * `WebsocketProvider`+socket is NOT a resumable resource (there is no
 * "reconnect" once `destroy()` runs), so `<StrictMode>`'s OWN double-invoke
 * of effects (mount -> cleanup -> immediate re-mount of EFFECTS ONLY, no new
 * render) would otherwise destroy the store on the rehearsal cleanup and
 * never rebuild it (no new render means the render-phase reset above never
 * gets a chance to run again) — confirmed via manual repro: the
 * "Connecting…" placeholder never resolved. Deferring the real `destroy()`
 * by one macrotask means a same-tick StrictMode rehearsal reliably cancels
 * it before it ever fires, while a genuine unmount/deps-change (no matching
 * re-setup) lets it fire for real.
 *
 * `room` (P5-T29): identifies which server room an editable store should
 * join (`{ slug, path }`, see `board-store.ts`'s `BoardStoreOptions.room`) —
 * `undefined` for read-only stores and for the editable-without-`slug`
 * convenience path (see `BoardCanvasProps.slug`'s doc). Included in the
 * tracked deps key (via its own `roomKey` — a plain object would fail
 * `Object.is` every render) so navigating to a different board/sub-board
 * rejoins the right room rather than keeping the previous one's.
 */

/**
 * Module-level (NOT `useRef`) handoff between two SUCCESSIVE `useState` lazy-
 * initializer invocations for the same `useBoardStoreLifecycle` call site
 * (StrictMode's double-RENDER, if it happens) — see that function's doc
 * comment above for why this must live outside any per-instance hook state.
 * Keyed by a token minted once per component instance (via its own
 * `useState` lazy initializer, so it too survives StrictMode's double-invoke
 * instead of becoming a fresh key each time) so concurrently-mounted
 * `BoardCanvas` instances never see each other's pending store.
 */
const pendingStoreByKey = new Map<symbol, BoardStore>();

/**
 * Module-level handoff for the DEFERRED-DESTROY technique the effect below
 * uses to survive StrictMode's double-effect-invocation — see that effect's
 * comment for the full rationale. Maps an instance key to the pending
 * `setTimeout` handle for a not-yet-executed `store.destroy()` call.
 */
const pendingDestroyByKey = new Map<symbol, ReturnType<typeof setTimeout>>();

function useBoardStoreLifecycle(
  board: BoardFile,
  readonly: boolean,
  room: { slug: string; path: string[]; draftId?: string } | undefined,
): BoardStore {
  // A stable per-instance key for `pendingStoreByKey` — `Symbol()` itself has
  // no live-resource side effect (unlike `createBoardStore`), so constructing
  // it via a lazy initializer is unremarkable; StrictMode's double-invoke
  // just makes two symbols, one discarded, same as any other lazy `useState`
  // value.
  const [instanceKey] = useState(() => Symbol('board-store-lifecycle'));

  // Lazy initializer: builds a store synchronously during render (so render
  // never sees a null/placeholder store), destroying whatever a PRIOR
  // invocation (for this same `instanceKey`) left pending first. Reading/
  // returning a `useState` value during render is the well-established,
  // lint-clean pattern this restores (vs. an intermediate version of this
  // function that read a plain `useRef` as its render return value, which
  // the project's `react-hooks/refs` lint rule correctly flags as unsound).
  // This handles StrictMode's DOUBLE-RENDER (two back-to-back invocations of
  // this initializer within the same initial commit).
  const [store, setStore] = useState<BoardStore>(() => {
    // React's `<StrictMode>` double-invoke of a `useState` lazy initializer
    // keeps the FIRST call's return value as the actual state and discards
    // the SECOND's (confirmed via manual repro — an earlier version of this
    // fix wrongly assumed the reverse, which meant the REAL, kept `store`
    // silently stayed bound to the FIRST invocation's (still-connecting, or
    // already stale) provider forever, while all the "am I the latest"
    // bookkeeping below tracked the discarded second one instead). So: if a
    // store already exists for this `instanceKey`, REUSE it — a second
    // invocation must return the SAME value the first one did, not build a
    // redundant new one that React would discard anyway (which would also
    // leak an un-destroyed extra provider/socket, the original P5-T33 bug).
    const existing = pendingStoreByKey.get(instanceKey);
    if (existing) return existing;
    const created = createBoardStore(board, { readonly, room });
    pendingStoreByKey.set(instanceKey, created);
    return created;
  });

  // Derived-during-render "reset on prop change" (same idiom as
  // hooks/usePresence.ts's `lastAwareness` / hooks/useSyncStatus.ts's
  // `lastProvider`): if `board`/`readonly`/`room` genuinely changed since the
  // last render, build a fresh store and call `setState` synchronously,
  // right here in the render body — never inside an effect body (see this
  // function's doc comment for why `react-hooks/set-state-in-effect`
  // correctly rules that out). A stable, comparable `depsKey` stands in for
  // `room` (a fresh object each render — App.tsx's board route notes the
  // same caveat) so this doesn't rebuild on `room`'s per-render identity alone.
  const roomKey = room ? `${room.draftId ?? ''} ${room.slug} ${room.path.join(' ')}` : '';
  const depsKey = `${readonly} ${roomKey}`;
  const [lastBoard, setLastBoard] = useState(board);
  const [lastDepsKey, setLastDepsKey] = useState(depsKey);
  if (board !== lastBoard || depsKey !== lastDepsKey) {
    setLastBoard(board);
    setLastDepsKey(depsKey);
    setStore(createBoardStore(board, { readonly, room }));
  }

  // Pure cleanup — no `setState` anywhere in this effect. Handles
  // StrictMode's DOUBLE-EFFECT-INVOCATION (mount -> cleanup -> re-mount of
  // EFFECTS ONLY, with NO new render and thus no chance to rebuild `store`
  // via the render-phase logic above): `store`/`room-store.ts`'s underlying
  // `WebsocketProvider`+socket is NOT a resumable resource (there is no
  // "reconnect" — `destroy()` is final), so an effect that destroyed it on
  // its first (rehearsal) cleanup and then just re-ran with the SAME,
  // now-dead `store` would leave the page permanently stuck (confirmed via
  // manual repro: the "Connecting…" placeholder never resolved). Deferring
  // the actual `destroy()` by one macrotask (`setTimeout(…, 0)`) and having
  // the NEXT setup cancel that pending timer instead of re-destroying is the
  // standard technique for exactly this class of problem: StrictMode's
  // rehearsal cleanup-then-immediate-re-setup happens synchronously, in the
  // same tick, well before a `setTimeout(0)` callback ever fires, so the
  // deferred destroy is reliably cancelled for a rehearsal and only ever
  // actually runs for a REAL unmount/deps-change (where no matching re-setup
  // follows to cancel it).
  useEffect(() => {
    const pendingDestroy = pendingDestroyByKey.get(instanceKey);
    if (pendingDestroy) {
      clearTimeout(pendingDestroy);
      pendingDestroyByKey.delete(instanceKey);
    }
    pendingStoreByKey.delete(instanceKey);
    return () => {
      const timer = setTimeout(() => {
        pendingDestroyByKey.delete(instanceKey);
        store.destroy();
      }, 0);
      pendingDestroyByKey.set(instanceKey, timer);
    };
  }, [store, instanceKey]);

  return store;
}

export function BoardCanvas({
  board,
  readonly,
  slug,
  path,
  draftId,
  onDrillIn,
  subBoardChildIds,
}: BoardCanvasProps) {
  const room = !readonly && slug ? { slug, path: path ?? [], draftId } : undefined;
  const store = useBoardStoreLifecycle(board, readonly, room);

  // The live (prod) board is content-frozen: only comments + annotations are
  // allowed; every real edit happens in a draft. Editable pane, a real board
  // (`slug` given — every real route supplies one), and NOT inside a draft. A
  // slug-less board is the local-seed unit-test convenience path (no room, no
  // prod/draft identity) and stays fully editable, as before.
  const contentLocked = !readonly && !!slug && !draftId;

  const fitView = isDefaultViewport(board.viewport);

  // Drill-in adapter, orthogonal to the read-only/editable store split:
  // navigate-in works in both modes; only CREATE is editable-only (`canCreate:
  // !readonly`). Memoized on its inputs so the two panes' `boardToRf` results
  // stay reference-stable (the child-ids Set is itself stable per BoardRoute
  // mount — see App.tsx). Absent when the route supplies no `onDrillIn`.
  // Navigate-in works everywhere; CREATE is a content edit, so allowed only
  // inside a draft (never read-only, never the content-locked live board).
  const subBoard = useMemo<SubBoardAdapter | undefined>(
    () =>
      onDrillIn
        ? {
            childIds: subBoardChildIds ?? new Set<string>(),
            onDrillIn,
            canCreate: !readonly && !contentLocked,
          }
        : undefined,
    [onDrillIn, subBoardChildIds, readonly, contentLocked],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        {readonly ? (
          <ReadOnlyCanvas
            store={store}
            fitView={fitView}
            viewport={board.viewport}
            slug={slug}
            subBoard={subBoard}
          />
        ) : (
          <EditableCanvas
            store={store}
            fitView={fitView}
            viewport={board.viewport}
            slug={slug}
            path={path}
            contentLocked={contentLocked}
            draftId={draftId}
            subBoard={subBoard}
          />
        )}
      </ReactFlowProvider>
    </div>
  );
}
