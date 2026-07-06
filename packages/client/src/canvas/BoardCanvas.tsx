// ── BoardCanvas: the thin canvas orchestrator ────────────────────────────────
//
// Hydrates a `BoardStore` (doc-first, `store/board-store.ts`) from the given
// `BoardFile` and renders it with ReactFlow. Two paths share one store:
//
//   - READ-ONLY (`readonly`): the P3-T20 path, unchanged. Subscribes to the
//     store, adapts the snapshot via `boardToRf`, and renders it with every
//     mutating/selecting RF interaction prop turned OFF. No interaction
//     handlers are wired.
//
//   - EDITABLE (`!readonly`): the P4-T22 path. `useEditableCanvas` owns RF's
//     controlled node/edge state, reconciles doc→RF (preserving selection and
//     in-flight drags), and exposes the interaction handlers that COMMIT to the
//     doc via the store's mutation API (drag-stop → moveNode, connect → addEdge,
//     delete → deleteNodes/deleteEdges). BoardCanvas stays thin — it just spreads
//     the hook's props onto `<ReactFlow>` and flips the interaction booleans on.
//
// Viewport: `board.viewport` seeds RF's *uncontrolled* `defaultViewport` (RF
// owns pan/zoom state internally from then on — a later phase wires viewport
// changes back to the store via `setViewport`). A board with no meaningful
// viewport (all-zero, the BoardFile default for a freshly created board) gets
// `fitView` instead, so an empty/fresh board doesn't render pinned at (0,0)
// zoom 1 regardless of where its content actually is.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, ConnectionMode, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
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
import { boardToRf } from './rf-adapters.js';
import { MultiSelectResizer } from './MultiSelectResizer.js';
import { nodeTypes } from '../nodes/index.js';
import { edgeTypes } from '../edges/index.js';
import { Toolbar } from '../components/Toolbar.js';
import { DescriptionModal } from '../components/DescriptionModal.js';
import { nodeLabel } from './node-label.js';
import type { SaveStatus } from '../hooks/useAutosave.js';

export interface BoardCanvasProps {
  board: BoardFile;
  readonly: boolean;
  onNavigate?: (nodeId: string) => void;
  /** Reflected by the Toolbar's save-status indicator. The autosave hook
   * itself is owned by the caller (e.g. the board route) — BoardCanvas only
   * renders whatever status it's given. Defaults to 'idle' for callers that
   * don't wire autosave (e.g. every current test). */
  saveStatus?: SaveStatus;
  /** Retry a failed save — passed straight through to the Toolbar. */
  onRetrySave?: () => void;
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
 * commits via `store.updateNode(id, { description })`. */
function EditableCanvas({ store, fitView, viewport, saveStatus, onRetrySave }: EditablePaneProps) {
  const [descNodeId, setDescNodeId] = useState<string | null>(null);
  const openDescription = useCallback((id: string) => setDescNodeId(id), []);
  const editable = useEditableCanvas(store, { onOpenDescription: openDescription });
  const multiSelect = useMultiSelectResize(store, editable.selectedNodeIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const { nodes } = useBoardStore(store);

  const descNode = descNodeId ? nodes.find((n) => n.id === descNodeId) : undefined;

  const handleSaveDescription = useCallback(
    (md: string) => {
      if (!descNodeId) return;
      store.updateNode(descNodeId, { description: md || undefined });
    },
    [descNodeId, store],
  );

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        {...commonReactFlowProps}
        nodes={editable.nodes}
        edges={editable.edges}
        onNodesChange={editable.onNodesChange}
        onEdgesChange={editable.onEdgesChange}
        onNodeDragStop={editable.onNodeDragStop}
        onNodesDelete={editable.onNodesDelete}
        onConnect={editable.onConnect}
        onEdgesDelete={editable.onEdgesDelete}
        onSelectionChange={editable.onSelectionChange}
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
        saveStatus={saveStatus ?? 'idle'}
        readonly={false}
        onRetrySave={onRetrySave}
      />
      {descNode && (
        <DescriptionModal
          nodeLabel={nodeLabel(descNode)}
          initialText={descNode.description ?? ''}
          onSave={handleSaveDescription}
          onClose={() => setDescNodeId(null)}
        />
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
  saveStatus?: SaveStatus;
  onRetrySave?: () => void;
}

export function BoardCanvas({ board, readonly, saveStatus, onRetrySave }: BoardCanvasProps) {
  const store = useMemo(() => createBoardStore(board, { readonly }), [board, readonly]);

  useEffect(() => {
    return () => store.destroy();
  }, [store]);

  const fitView = isDefaultViewport(board.viewport);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        {readonly ? (
          <ReadOnlyCanvas store={store} fitView={fitView} viewport={board.viewport} />
        ) : (
          <EditableCanvas
            store={store}
            fitView={fitView}
            viewport={board.viewport}
            saveStatus={saveStatus}
            onRetrySave={onRetrySave}
          />
        )}
      </ReactFlowProvider>
    </div>
  );
}
