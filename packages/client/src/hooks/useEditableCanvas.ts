// ── useEditableCanvas: doc-first store ⇄ ReactFlow editable wiring ─────────────
//
// Plan v2 §3 / P4-T22. The Y.Doc is the source of truth; ReactFlow is a
// transient interaction buffer. This hook is the whole bidirectional bridge for
// the EDITABLE canvas, kept out of BoardCanvas so that component stays a thin
// orchestrator. It hands BoardCanvas the RF props to spread.
//
// doc → RF (read side):
//   The store snapshot is reactive (`useBoardStore`, referentially stable). On
//   each change we rebuild the doc-derived RF shape (`boardToRf`) and RECONCILE
//   it into RF's controlled state (`reconcileNodes`/`reconcileEdges`) — which
//   preserves RF's transient per-node state (selection, in-flight drag,
//   measurements) and is idempotent by reference. We then re-project the
//   selection onto the reconciled nodes (`applySelection`) and prune any
//   selected id the doc no longer has. `setNodes`/`setEdges` are only called
//   when the reconciled result differs from what RF already holds, so a commit
//   that merely re-states what RF shows (the drag-stop case) does NOT re-render
//   or loop.
//
// RF → doc (write side): the interaction handlers commit through the store's
//   mutation API. We DON'T commit intermediate changes — `onNodesChange` just
//   feeds RF's local state (smooth drag/select); the doc is written once, at the
//   end of the gesture:
//     - onNodeDragStop → moveNode for each dragged node (multi-drag safe)
//     - onNodesDelete  → deleteNodes (the op also prunes dependent edges)
//     - onConnect      → addEdge (fresh id via generateId over live edge ids)
//     - onEdgesDelete  → deleteEdges
//
// Loop avoidance (the crux): commits are doc-first. A commit fires the doc
// update, which re-runs the reconcile with a `next` equal to RF's current
// state; reconcile returns the SAME references, the equality guards below skip
// `setNodes`/`setEdges`, and nothing re-renders. No op is ever called from the
// read-side effect, so there is no write→read→write cycle.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEdgesState, useNodesState } from '@xyflow/react';
import type {
  Connection,
  OnConnect,
  OnEdgesChange,
  OnEdgesDelete,
  OnNodeDrag,
  OnNodesChange,
  OnNodesDelete,
} from '@xyflow/react';
import { generateId, makeEdge } from '@easel/shared';
import type { BoardEdge } from '@easel/shared';
import type { BoardStore } from '../store/board-store.js';
import { useBoardStore } from '../store/use-board-store.js';
import { boardToRf } from '../canvas/rf-adapters.js';
import type { BoardRfEdge, BoardRfNode } from '../canvas/rf-adapters.js';
import { reconcileEdges, reconcileNodes } from '../canvas/reconcile.js';
import { useSelection } from './useSelection.js';
import type { SelectionParams } from './useSelection.js';

export interface EditableCanvasProps {
  nodes: BoardRfNode[];
  edges: BoardRfEdge[];
  onNodesChange: OnNodesChange<BoardRfNode>;
  onEdgesChange: OnEdgesChange<BoardRfEdge>;
  onNodeDragStop: OnNodeDrag<BoardRfNode>;
  onNodesDelete: OnNodesDelete<BoardRfNode>;
  onConnect: OnConnect;
  onEdgesDelete: OnEdgesDelete<BoardRfEdge>;
  onSelectionChange(params: SelectionParams): void;
  /** Exposed for tests/consumers that want to read selection state. */
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
}

export function useEditableCanvas(store: BoardStore): EditableCanvasProps {
  const snapshot = useBoardStore(store);
  const selection = useSelection();

  // Doc-derived RF shape (rebuilt only when the doc snapshot changes). Editable,
  // so `readonly=false` → nodes come back draggable/selectable.
  const docRf = useMemo(() => boardToRf(snapshot, false), [snapshot]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BoardRfNode>(docRf.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BoardRfEdge>(docRf.edges);

  // Latest RF state, read inside the reconcile effect WITHOUT making `nodes`/
  // `edges` its dependencies. That distinction is load-bearing: mid-drag,
  // `onNodesChange` mutates `nodes` every tick but `docRf` has NOT changed (no
  // commit yet) — if the reconcile re-ran on those ticks it would snap the
  // dragged node back to its pre-drag doc position. Keyed on `docRf` alone, it
  // runs only when the doc actually changes. The refs are written in their own
  // post-render effect (never during render — see react-hooks/refs).
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  const { setSelection, pruneSelection, applySelection, selectedNodeIds, selectedEdgeIds } =
    selection;

  // ── doc → RF reconcile ──────────────────────────────────────────────────────
  // Runs when the doc snapshot or the selection changes. Reconcile first (doc
  // authority + transient preservation), then stamp selection flags, then only
  // commit to RF state if the reference actually changed.
  useEffect(() => {
    const reconciledNodes = reconcileNodes(nodesRef.current, docRf.nodes);
    const reconciledEdges = reconcileEdges(edgesRef.current, docRf.edges);
    const withSelection = applySelection(reconciledNodes, reconciledEdges);

    if (withSelection.nodes !== nodesRef.current) {
      nodesRef.current = withSelection.nodes;
      setNodes(withSelection.nodes);
    }
    if (withSelection.edges !== edgesRef.current) {
      edgesRef.current = withSelection.edges;
      setEdges(withSelection.edges);
    }

    // Drop any selected id the doc no longer contains (e.g. a deleted node).
    pruneSelection(new Set(docRf.nodes.map((n) => n.id)), new Set(docRf.edges.map((e) => e.id)));
  }, [docRf, applySelection, pruneSelection, setNodes, setEdges]);

  // ── RF → doc handlers (commit at gesture end, never mid-gesture) ────────────

  const onNodeDragStop = useCallback<OnNodeDrag<BoardRfNode>>(
    (_event, _node, draggedNodes) => {
      for (const n of draggedNodes) {
        store.moveNode(n.id, { x: n.position.x, y: n.position.y });
      }
    },
    [store],
  );

  const onNodesDelete = useCallback<OnNodesDelete<BoardRfNode>>(
    (deleted) => {
      store.deleteNodes(deleted.map((n) => n.id));
    },
    [store],
  );

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const existingIds = new Set(store.getSnapshot().edges.map((e) => e.id));
      const id = generateId('e', existingIds);
      const edge: BoardEdge = {
        ...makeEdge(id, connection.source, connection.target),
        ...(connection.sourceHandle != null ? { sourceHandle: connection.sourceHandle } : {}),
        ...(connection.targetHandle != null ? { targetHandle: connection.targetHandle } : {}),
      };
      store.addEdge(edge);
    },
    [store],
  );

  const onEdgesDelete = useCallback<OnEdgesDelete<BoardRfEdge>>(
    (deleted) => {
      store.deleteEdges(deleted.map((e) => e.id));
    },
    [store],
  );

  const onSelectionChange = useCallback(
    (params: SelectionParams) => {
      setSelection(params);
    },
    [setSelection],
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onNodeDragStop,
    onNodesDelete,
    onConnect,
    onEdgesDelete,
    onSelectionChange,
    selectedNodeIds,
    selectedEdgeIds,
  };
}
