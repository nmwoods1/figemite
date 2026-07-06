// ── BoardCanvas: the thin, READ-ONLY canvas orchestrator ─────────────────────
//
// Hydrates a `BoardStore` (doc-first, `store/board-store.ts`) from the given
// `BoardFile`, subscribes to it via `useBoardStore`, adapts the snapshot to
// ReactFlow shape via `canvas/rf-adapters.ts`'s `boardToRf`, and renders it.
//
// Deliberately thin — this is P3-T20's scope, not Phase 4's:
//   - no drag/connect/select/keyboard interaction handlers (`onNodesChange`,
//     `onConnect`, etc.) — the board renders but nothing is wired to mutate
//     the store yet;
//   - no autosave, no undo/redo;
//   - every RF interaction prop that could mutate or select is turned off
//     (`nodesDraggable`/`nodesConnectable`/`elementsSelectable`, each
//     additionally gated on `readonly` — though Phase 3 has no write path
//     regardless, so both branches currently render identically; the
//     `readonly` prop is threaded through now so Phase 4 only has to flip
//     these booleans on, not add the plumbing). Viewing gestures (pan/zoom)
//     stay on — those aren't edits.
//
// Viewport: `board.viewport` seeds RF's *uncontrolled* `defaultViewport` (RF
// owns pan/zoom state internally from then on — Phase 4/5 is what would wire
// viewport changes back to the store via `setViewport`). A board with no
// meaningful viewport (all-zero, the BoardFile default for a freshly created
// board) gets `fitView` instead, so an empty/fresh board doesn't render
// pinned at (0,0) zoom 1 regardless of where its content actually is.
import { useEffect, useMemo } from 'react';
import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { BoardFile } from '@easel/shared';
import { createBoardStore } from '../store/board-store.js';
import { useBoardStore } from '../store/use-board-store.js';
import { boardToRf } from './rf-adapters.js';
import { nodeTypes } from '../nodes/index.js';
import { edgeTypes } from '../edges/index.js';

export interface BoardCanvasProps {
  board: BoardFile;
  readonly: boolean;
  onNavigate?: (nodeId: string) => void;
}

/** True when a viewport is just the BoardFile zero-value default — i.e. not
 * meaningfully set by anything (a fresh board, or one predating viewport
 * persistence) — in which case `fitView` gives a more useful initial framing
 * than pinning the camera at the origin. */
function isDefaultViewport(vp: BoardFile['viewport']): boolean {
  return vp.x === 0 && vp.y === 0 && vp.zoom === 1;
}

export function BoardCanvas({ board, readonly }: BoardCanvasProps) {
  const store = useMemo(() => createBoardStore(board, { readonly }), [board, readonly]);

  useEffect(() => {
    return () => store.destroy();
  }, [store]);

  const { nodes, edges } = useBoardStore(store);
  const rf = useMemo(() => boardToRf({ nodes, edges }, readonly), [nodes, edges, readonly]);

  const useFitView = isDefaultViewport(board.viewport);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        <ReactFlow
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodes={rf.nodes}
          edges={rf.edges}
          defaultViewport={useFitView ? undefined : board.viewport}
          fitView={useFitView}
          nodesDraggable={!readonly}
          nodesConnectable={!readonly}
          elementsSelectable={!readonly}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
