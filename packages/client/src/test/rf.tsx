// ── Minimal ReactFlow test harness ───────────────────────────────────────────
//
// Node components (ConnectionHandles, and every node in src/nodes/) use
// `@xyflow/react`'s `<Handle>`, which throws ("Handle: no context provided")
// unless it's rendered inside a `<ReactFlowProvider>`. Real usage also
// renders inside `<ReactFlow>` (BoardCanvas, P3-T20), but for unit-testing a
// single node component in isolation the provider alone is enough — it's
// the store context Handle reads, not the full pane/viewport machinery.

import type { ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';

export function RfTestHarness({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
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
