// ── Minimal ReactFlow test harness ───────────────────────────────────────────
//
// Node components (ConnectionHandles, and every node in src/nodes/) use
// `@xyflow/react`'s `<Handle>`, which throws ("Handle: no context provided")
// unless it's rendered inside a `<ReactFlowProvider>`. Real usage also
// renders inside `<ReactFlow>` (BoardCanvas, P3-T20), but for unit-testing a
// single node component in isolation the provider alone is enough — it's
// the store context Handle reads, not the full pane/viewport machinery.

import type { ReactNode } from 'react';
import { Position, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react';

export function RfTestHarness({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

/**
 * Test harness for a single custom EDGE component. Edge components (this
 * project's ArrowEdge/CardinalityEdge) use `<EdgeLabelRenderer>`, which
 * portals into the store's `domNode` — a ref only ever populated by a real
 * `<ReactFlow>` mount (see its module doc / `useStore(s => s.domNode)`), not
 * by `<ReactFlowProvider>` alone. But rendering the edge via RF's normal
 * `nodes`/`edges` props doesn't work in jsdom either: RF only renders an edge
 * once both endpoint nodes are "measured" (`node.internals.handleBounds` is
 * set by a `ResizeObserver` callback reading `getBoundingClientRect`), and
 * jsdom has no layout engine — dimensions are always 0, so nodes never
 * initialize and edges never mount.
 *
 * The fix: mount a real (empty) `<ReactFlow>` for its `domNode`/portal
 * target, and render the edge component directly as a child instead of
 * through the `edges` prop — this skips RF's measurement gate entirely.
 * `BaseEdge`/`getBezierPath` are plain functions with no store dependency, so
 * this is sufficient for every edge-component assertion this project needs.
 */
export function RfEdgeTestHarness({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: 400, height: 400 }}>
      <ReactFlow nodes={[]} edges={[]}>
        <svg>{children}</svg>
      </ReactFlow>
    </div>
  );
}

/**
 * Build a complete `EdgeProps<Edge<TData, TType>>` for unit-testing a single
 * edge component in isolation (paired with {@link RfEdgeTestHarness}). Fills
 * in the geometry/identity fields real usage gets for free from `<ReactFlow>`
 * with inert defaults so tests only need to specify what they care about
 * (`id`, `data`, `selected`, and the endpoint coordinates when geometry
 * matters, e.g. CardinalityEdge's auto-detected pill side).
 */
export function makeEdgeProps<TData extends Record<string, unknown>, TType extends string>(
  type: TType,
  overrides: Partial<EdgeProps<Edge<TData, TType>>> & { id: string; data: TData },
): EdgeProps<Edge<TData, TType>> {
  const defaults = {
    type,
    source: 'source-node',
    target: 'target-node',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    selectable: true,
    deletable: true,
    selected: false,
  };
  return { ...defaults, ...overrides } as EdgeProps<Edge<TData, TType>>;
}

/**
 * Build a complete `NodeProps<Node<TData, TType>>` for unit-testing a single
 * node component in isolation. RF's `NodeProps` requires a long list of
 * fields (`dragging`, `zIndex`, `isConnectable`, `positionAbsoluteX/Y`, …)
 * that real usage gets for free from `<ReactFlow>` — this factory fills them
 * with inert defaults so tests only need to specify what they care about
 * (`id`, `data`, `selected`).
 */
export function makeNodeProps<TData extends Record<string, unknown>, TType extends string>(
  type: TType,
  overrides: Partial<NodeProps<Node<TData, TType>>> & { id: string; data: TData },
): NodeProps<Node<TData, TType>> {
  const defaults = {
    type,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
  return { ...defaults, ...overrides } as NodeProps<Node<TData, TType>>;
}
