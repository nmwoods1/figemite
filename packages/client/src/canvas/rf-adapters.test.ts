import { describe, it, expect, vi } from 'vitest';
import type { BoardEdge, BoardNode } from '@figemite/shared';
import { boardNodeToRf, boardEdgeToRf, boardToRf } from './rf-adapters.js';
import type { EdgeCallbacks, NodeCallbacks } from './rf-adapters.js';

function sticky(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: 's1',
    type: 'sticky',
    pos: { x: 10, y: 20 },
    order: 0,
    size: { width: 200, height: 160 },
    text: 'hello',
    color: '#fef3c7',
    ...overrides,
  } as BoardNode;
}

describe('boardNodeToRf', () => {
  it('maps a sticky node', () => {
    const node = sticky();
    const rf = boardNodeToRf(node, false);
    expect(rf.id).toBe('s1');
    expect(rf.position).toEqual({ x: 10, y: 20 });
    expect(rf.type).toBe('sticky');
    expect(rf.width).toBe(200);
    expect(rf.height).toBe(160);
    expect(rf.data).toMatchObject({ text: 'hello', color: '#fef3c7' });
  });

  it("flattens a WH-sized node's size into data.width/data.height (what the node components read) and drops the nested data.size", () => {
    const node = sticky();
    const rf = boardNodeToRf(node, false);
    expect(rf.data.width).toBe(200);
    expect(rf.data.height).toBe(160);
    expect(rf.data.size).toBeUndefined();
  });

  it('maps a text node (no size)', () => {
    const node: BoardNode = {
      id: 't1',
      type: 'text',
      pos: { x: 1, y: 2 },
      order: 0,
      text: 'Label',
    };
    const rf = boardNodeToRf(node, false);
    expect(rf.type).toBe('text');
    expect(rf.data).toMatchObject({ text: 'Label' });
    expect(rf.width).toBeUndefined();
    expect(rf.height).toBeUndefined();
  });

  it('maps a shape node, carrying rotation', () => {
    const node: BoardNode = {
      id: 'sh1',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 160, height: 100 },
      shape: 'diamond',
      color: '#e2e8f0',
      rotation: 45,
    };
    const rf = boardNodeToRf(node, false);
    expect(rf.type).toBe('shape');
    expect(rf.data).toMatchObject({ shape: 'diamond', rotation: 45 });
    expect(rf.width).toBe(160);
    expect(rf.height).toBe(100);
  });

  it('maps a frame node with negative zIndex so it renders behind non-frames', () => {
    const node: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fef3c7',
    };
    const rf = boardNodeToRf(node, false);
    expect(rf.type).toBe('frame');
    expect(rf.zIndex).toBeLessThan(0);
    expect(rf.data).toMatchObject({ title: 'Frame', color: '#fef3c7' });
  });

  it('a frame drags only by its title bar and lets its body pan through', () => {
    const node: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fef3c7',
    };
    const rf = boardNodeToRf(node, false);
    // Only the title bar drags the frame (not the whole background).
    expect(rf.dragHandle).toBe('.frame-drag-handle');
    // Body is pointer-events:none so drags over it pan the canvas instead of
    // being swallowed; interactive parts re-enable events themselves.
    expect(rf.style).toMatchObject({ pointerEvents: 'none' });
  });

  it('a non-frame node has no dragHandle (drags by its whole body)', () => {
    const rf = boardNodeToRf(sticky(), false);
    expect(rf.dragHandle).toBeUndefined();
    expect(rf.style?.pointerEvents).toBeUndefined();
  });

  it('a non-frame node gets a zIndex >= 0 (greater than any frame zIndex)', () => {
    const frame: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fef3c7',
    };
    const nonFrame = sticky();
    const rfFrame = boardNodeToRf(frame, false);
    const rfNonFrame = boardNodeToRf(nonFrame, false);
    expect(rfFrame.zIndex!).toBeLessThan(rfNonFrame.zIndex ?? 0);
  });

  it('maps an emoji node with numeric size and rotation', () => {
    const node: BoardNode = {
      id: 'e1',
      type: 'emoji',
      pos: { x: 5, y: 5 },
      order: 0,
      text: '🎉',
      size: 64,
      rotation: 15,
    };
    const rf = boardNodeToRf(node, false);
    expect(rf.type).toBe('emoji');
    expect(rf.width).toBe(64);
    expect(rf.height).toBe(64);
    expect(rf.data).toMatchObject({ text: '🎉', size: 64, rotation: 15 });
  });

  it('maps an icon node with numeric size', () => {
    const node: BoardNode = {
      id: 'i1',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 0,
      name: 'star',
      size: 48,
      color: '#000',
    };
    const rf = boardNodeToRf(node, false);
    expect(rf.type).toBe('icon');
    expect(rf.width).toBe(48);
    expect(rf.height).toBe(48);
    expect(rf.data).toMatchObject({ name: 'star', color: '#000' });
  });

  it('maps a drawing node', () => {
    const node: BoardNode = {
      id: 'd1',
      type: 'drawing',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 100, height: 80 },
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      color: '#1e293b',
      strokeWidth: 3,
    };
    const rf = boardNodeToRf(node, false);
    expect(rf.type).toBe('drawing');
    expect(rf.width).toBe(100);
    expect(rf.height).toBe(80);
    expect(rf.data).toMatchObject({ points: node.points, strokeWidth: 3 });
  });

  it('readonly=false makes nodes draggable and selectable', () => {
    const rf = boardNodeToRf(sticky(), false);
    expect(rf.draggable).toBe(true);
    expect(rf.selectable).toBe(true);
  });

  it('readonly=true makes nodes non-draggable and non-selectable', () => {
    const rf = boardNodeToRf(sticky(), true);
    expect(rf.draggable).toBe(false);
    expect(rf.selectable).toBe(false);
  });

  // ── P4-T24: editing-callback injection (editable path only) ────────────────

  function fixtureCallbacks(): NodeCallbacks {
    return {
      onTextChange: vi.fn(),
      onTitleChange: vi.fn(),
      onOpenDescription: vi.fn(),
      onResizeEnd: vi.fn(),
      onResizeEndSquare: vi.fn(),
      onRotate: vi.fn(),
    };
  }

  it('injects onTextChange into a sticky node when callbacks are given', () => {
    const callbacks = fixtureCallbacks();
    const rf = boardNodeToRf(sticky(), false, callbacks);
    expect(rf.data.onTextChange).toBe(callbacks.onTextChange);
  });

  it('injects onTextChange (not onTitleChange) into a text/shape/emoji node', () => {
    const callbacks = fixtureCallbacks();
    const textNode: BoardNode = {
      id: 't1',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 0,
      text: 'x',
    };
    const rf = boardNodeToRf(textNode, false, callbacks);
    expect(rf.data.onTextChange).toBe(callbacks.onTextChange);
    expect(rf.data.onTitleChange).toBeUndefined();
  });

  it('injects onTitleChange (not onTextChange) into a frame node', () => {
    const callbacks = fixtureCallbacks();
    const frame: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fef3c7',
    };
    const rf = boardNodeToRf(frame, false, callbacks);
    expect(rf.data.onTitleChange).toBe(callbacks.onTitleChange);
    expect(rf.data.onTextChange).toBeUndefined();
  });

  it('injects onOpenDescription into every describable node type', () => {
    const callbacks = fixtureCallbacks();
    const rf = boardNodeToRf(sticky(), false, callbacks);
    expect(rf.data.onOpenDescription).toBe(callbacks.onOpenDescription);
  });

  it('an icon node (no text) still gets onOpenDescription but no onTextChange', () => {
    const callbacks = fixtureCallbacks();
    const icon: BoardNode = {
      id: 'i1',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 0,
      name: 'star',
      size: 48,
      color: '#000',
    };
    const rf = boardNodeToRf(icon, false, callbacks);
    expect(rf.data.onOpenDescription).toBe(callbacks.onOpenDescription);
    expect(rf.data.onTextChange).toBeUndefined();
  });

  it('a drawing node gets no editing callbacks at all (no text, no description)', () => {
    const callbacks = fixtureCallbacks();
    const drawing: BoardNode = {
      id: 'd1',
      type: 'drawing',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 100, height: 80 },
      points: [],
      color: '#000',
      strokeWidth: 2,
    };
    const rf = boardNodeToRf(drawing, false, callbacks);
    expect(rf.data.onTextChange).toBeUndefined();
    expect(rf.data.onOpenDescription).toBeUndefined();
  });

  it('read-only nodes get NO callbacks even when callbacks are passed (seams stay inert)', () => {
    const callbacks = fixtureCallbacks();
    const rf = boardNodeToRf(sticky(), true, callbacks);
    expect(rf.data.onTextChange).toBeUndefined();
    expect(rf.data.onOpenDescription).toBeUndefined();
  });

  it('omitting callbacks entirely leaves data callback-free (read-only path unaffected)', () => {
    const rf = boardNodeToRf(sticky(), false);
    expect(rf.data.onTextChange).toBeUndefined();
    expect(rf.data.onOpenDescription).toBeUndefined();
  });

  it('boardToRf forwards callbacks to every node via boardNodeToRf', () => {
    const callbacks = fixtureCallbacks();
    const { nodes } = boardToRf({ nodes: [sticky()], edges: [] }, false, callbacks);
    expect(nodes[0].data.onTextChange).toBe(callbacks.onTextChange);
  });

  // ── P4-T24: resize/rotate callback injection ────────────────────────────────

  it('injects the WH onResizeEnd into a sticky node', () => {
    const callbacks = fixtureCallbacks();
    const rf = boardNodeToRf(sticky(), false, callbacks);
    expect(rf.data.onResizeEnd).toBe(callbacks.onResizeEnd);
  });

  it('injects the WH onResizeEnd into shape/frame/drawing nodes', () => {
    const callbacks = fixtureCallbacks();
    const frame: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fef3c7',
    };
    const drawing: BoardNode = {
      id: 'd1',
      type: 'drawing',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 100, height: 80 },
      points: [],
      color: '#000',
      strokeWidth: 2,
    };
    expect(boardNodeToRf(frame, false, callbacks).data.onResizeEnd).toBe(callbacks.onResizeEnd);
    expect(boardNodeToRf(drawing, false, callbacks).data.onResizeEnd).toBe(callbacks.onResizeEnd);
  });

  it('injects the SQUARE onResizeEnd (not the WH one) into emoji/icon nodes', () => {
    const callbacks = fixtureCallbacks();
    const emoji: BoardNode = {
      id: 'em1',
      type: 'emoji',
      pos: { x: 0, y: 0 },
      order: 0,
      text: '🎉',
      size: 64,
    };
    const icon: BoardNode = {
      id: 'i1',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 0,
      name: 'star',
      size: 48,
      color: '#000',
    };
    expect(boardNodeToRf(emoji, false, callbacks).data.onResizeEnd).toBe(
      callbacks.onResizeEndSquare,
    );
    expect(boardNodeToRf(icon, false, callbacks).data.onResizeEnd).toBe(
      callbacks.onResizeEndSquare,
    );
  });

  it('does not inject any onResizeEnd into a text node (not resizable)', () => {
    const callbacks = fixtureCallbacks();
    const textNode: BoardNode = {
      id: 't1',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 0,
      text: 'x',
    };
    const rf = boardNodeToRf(textNode, false, callbacks);
    expect(rf.data.onResizeEnd).toBeUndefined();
  });

  it('injects onRotate into shape/emoji/icon nodes only', () => {
    const callbacks = fixtureCallbacks();
    const shape: BoardNode = {
      id: 'sh1',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 160, height: 100 },
      shape: 'rect',
      color: '#fff',
    };
    const emoji: BoardNode = {
      id: 'em1',
      type: 'emoji',
      pos: { x: 0, y: 0 },
      order: 0,
      text: '🎉',
      size: 64,
    };
    const icon: BoardNode = {
      id: 'i1',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 0,
      name: 'star',
      size: 48,
      color: '#000',
    };
    expect(boardNodeToRf(shape, false, callbacks).data.onRotate).toBe(callbacks.onRotate);
    expect(boardNodeToRf(emoji, false, callbacks).data.onRotate).toBe(callbacks.onRotate);
    expect(boardNodeToRf(icon, false, callbacks).data.onRotate).toBe(callbacks.onRotate);
    expect(boardNodeToRf(sticky(), false, callbacks).data.onRotate).toBeUndefined();
  });
});

describe('boardEdgeToRf', () => {
  it('maps a default (arrow) edge', () => {
    const edge: BoardEdge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      style: 'solid',
    };
    const rf = boardEdgeToRf(edge);
    expect(rf).toMatchObject({ id: 'e1', source: 'a', target: 'b', type: 'arrow' });
  });

  it('maps an explicit arrow-kind edge with handles', () => {
    const edge: BoardEdge = {
      id: 'e2',
      source: 'a',
      target: 'b',
      sourceHandle: 'right',
      targetHandle: 'left',
      style: 'dashed',
      kind: 'arrow',
      arrow: 'both',
    };
    const rf = boardEdgeToRf(edge);
    expect(rf.type).toBe('arrow');
    expect(rf.sourceHandle).toBe('right');
    expect(rf.targetHandle).toBe('left');
    expect(rf.data).toMatchObject({ style: 'dashed', arrow: 'both' });
  });

  it('maps a cardinality-kind edge', () => {
    const edge: BoardEdge = {
      id: 'e3',
      source: 'a',
      target: 'b',
      style: 'solid',
      kind: 'cardinality',
      cardinality: '1:N',
    };
    const rf = boardEdgeToRf(edge);
    expect(rf.type).toBe('cardinality');
    expect(rf.data).toMatchObject({ kind: 'cardinality', cardinality: '1:N' });
  });

  it('carries the label through to data', () => {
    const edge: BoardEdge = {
      id: 'e4',
      source: 'a',
      target: 'b',
      style: 'solid',
      label: 'flows to',
    };
    const rf = boardEdgeToRf(edge);
    expect(rf.data).toMatchObject({ label: 'flows to' });
  });

  // ── P4-T24: edge-styling callback injection (editable path only) ───────────

  function fixtureEdgeCallbacks(): EdgeCallbacks {
    return {
      onLabelChange: vi.fn(),
      onArrowChange: vi.fn(),
      onStyleChange: vi.fn(),
      onCardinalityChange: vi.fn(),
    };
  }

  it('injects onLabelChange/onArrowChange/onStyleChange into an arrow edge', () => {
    const edge: BoardEdge = { id: 'e1', source: 'a', target: 'b', style: 'solid', kind: 'arrow' };
    const callbacks = fixtureEdgeCallbacks();
    const rf = boardEdgeToRf(edge, callbacks);
    expect(rf.data?.onLabelChange).toBe(callbacks.onLabelChange);
    expect(rf.data?.onArrowChange).toBe(callbacks.onArrowChange);
    expect(rf.data?.onStyleChange).toBe(callbacks.onStyleChange);
    expect(rf.data?.onCardinalityChange).toBeUndefined();
  });

  it('injects onLabelChange/onStyleChange/onCardinalityChange (not onArrowChange) into a cardinality edge', () => {
    const edge: BoardEdge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      style: 'solid',
      kind: 'cardinality',
    };
    const callbacks = fixtureEdgeCallbacks();
    const rf = boardEdgeToRf(edge, callbacks);
    expect(rf.data?.onLabelChange).toBe(callbacks.onLabelChange);
    expect(rf.data?.onStyleChange).toBe(callbacks.onStyleChange);
    expect(rf.data?.onCardinalityChange).toBe(callbacks.onCardinalityChange);
    expect(rf.data?.onArrowChange).toBeUndefined();
  });

  it('omitting callbacks leaves edge data callback-free (read-only path)', () => {
    const edge: BoardEdge = { id: 'e1', source: 'a', target: 'b', style: 'solid' };
    const rf = boardEdgeToRf(edge);
    expect(rf.data?.onLabelChange).toBeUndefined();
    expect(rf.data?.onArrowChange).toBeUndefined();
    expect(rf.data?.onStyleChange).toBeUndefined();
    expect(rf.data?.onCardinalityChange).toBeUndefined();
  });

  it('boardToRf forwards edge callbacks to every edge via boardEdgeToRf', () => {
    const callbacks = fixtureEdgeCallbacks();
    const edges: BoardEdge[] = [{ id: 'e1', source: 'a', target: 'b', style: 'solid' }];
    const { edges: rfEdges } = boardToRf({ nodes: [], edges }, false, undefined, callbacks);
    expect(rfEdges[0].data?.onLabelChange).toBe(callbacks.onLabelChange);
  });
});

describe('boardToRf', () => {
  it('maps nodes and edges together', () => {
    const nodes: BoardNode[] = [sticky()];
    const edges: BoardEdge[] = [{ id: 'e1', source: 's1', target: 's1', style: 'solid' }];
    const { nodes: rfNodes, edges: rfEdges } = boardToRf({ nodes, edges }, false);
    expect(rfNodes).toHaveLength(1);
    expect(rfEdges).toHaveLength(1);
  });

  it('sorts frames before non-frames regardless of input order (frames render behind)', () => {
    const frame: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 5,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fef3c7',
    };
    const nonFrame = sticky({ id: 's1', order: 1 });
    // Input order deliberately has the non-frame first.
    const { nodes: rfNodes } = boardToRf({ nodes: [nonFrame, frame], edges: [] }, false);
    const frameIndex = rfNodes.findIndex((n) => n.id === 'f1');
    const nonFrameIndex = rfNodes.findIndex((n) => n.id === 's1');
    expect(frameIndex).toBeLessThan(nonFrameIndex);
  });

  it('preserves relative order (by `order`) within each of the frame/non-frame partitions', () => {
    const a = sticky({ id: 'a', order: 2 });
    const b = sticky({ id: 'b', order: 0 });
    const c = sticky({ id: 'c', order: 1 });
    const { nodes: rfNodes } = boardToRf({ nodes: [a, b, c], edges: [] }, false);
    expect(rfNodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('readonly flag propagates to every node', () => {
    const { nodes: rfNodes } = boardToRf({ nodes: [sticky()], edges: [] }, true);
    expect(rfNodes[0].draggable).toBe(false);
    expect(rfNodes[0].selectable).toBe(false);
  });
});

describe('sub-board (drill-in) injection', () => {
  const shapeNode = (overrides: Partial<BoardNode> = {}): BoardNode =>
    ({
      id: 'sh1',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 160, height: 100 },
      shape: 'rect',
      color: '#fef3c7',
      ...overrides,
    }) as BoardNode;

  const textNode = (): BoardNode => ({
    id: 't1',
    type: 'text',
    pos: { x: 0, y: 0 },
    order: 0,
    text: 'label',
  });

  const adapter = (childIds: string[], canCreate: boolean) => ({
    childIds: new Set(childIds),
    canCreate,
    onDrillIn: vi.fn(),
  });

  it('attaches drill-in data to a sticky node that has a sub-board', () => {
    const sub = adapter(['s1'], true);
    const rf = boardNodeToRf(sticky({ id: 's1' }), false, undefined, sub);
    expect(rf.data.hasSubBoard).toBe(true);
    expect(rf.data.canCreateSubBoard).toBe(true);
    expect(rf.data.onDrillIn).toBe(sub.onDrillIn);
  });

  it('attaches drill-in data to a shape node', () => {
    const sub = adapter([], true);
    const rf = boardNodeToRf(shapeNode({ id: 'sh1' }), false, undefined, sub);
    expect(rf.data.hasSubBoard).toBe(false);
    expect(rf.data.canCreateSubBoard).toBe(true);
    expect(rf.data.onDrillIn).toBe(sub.onDrillIn);
  });

  it('attaches drill-in data to a frame node (sections own sub-boards)', () => {
    const frameNode: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Section',
      color: '#fef3c7',
    };
    const sub = adapter(['f1'], true);
    const rf = boardNodeToRf(frameNode, false, undefined, sub);
    expect(rf.data.hasSubBoard).toBe(true);
    expect(rf.data.canCreateSubBoard).toBe(true);
    expect(rf.data.onDrillIn).toBe(sub.onDrillIn);
  });

  it('marks hasSubBoard false for a drillable node not in childIds', () => {
    const sub = adapter(['other'], true);
    const rf = boardNodeToRf(sticky({ id: 's1' }), false, undefined, sub);
    expect(rf.data.hasSubBoard).toBe(false);
  });

  it('injects drill-in data even in read-only mode (navigate-in must work in static builds)', () => {
    const sub = adapter(['s1'], false);
    const rf = boardNodeToRf(sticky({ id: 's1' }), true, undefined, sub);
    expect(rf.data.hasSubBoard).toBe(true);
    expect(rf.data.canCreateSubBoard).toBe(false);
    expect(rf.data.onDrillIn).toBe(sub.onDrillIn);
  });

  it('does NOT attach drill-in data to non-drillable node types (text)', () => {
    const sub = adapter(['t1'], true);
    const rf = boardNodeToRf(textNode(), false, undefined, sub);
    expect(rf.data.hasSubBoard).toBeUndefined();
    expect(rf.data.canCreateSubBoard).toBeUndefined();
    expect(rf.data.onDrillIn).toBeUndefined();
  });

  it('attaches nothing when no sub-board adapter is supplied', () => {
    const rf = boardNodeToRf(sticky({ id: 's1' }), false);
    expect(rf.data.hasSubBoard).toBeUndefined();
    expect(rf.data.onDrillIn).toBeUndefined();
  });

  it('threads the adapter through boardToRf to each drillable node', () => {
    const sub = adapter(['s1'], true);
    const { nodes } = boardToRf(
      { nodes: [sticky({ id: 's1' }), textNode()], edges: [] },
      false,
      undefined,
      undefined,
      sub,
    );
    const rfSticky = nodes.find((n) => n.id === 's1');
    const rfText = nodes.find((n) => n.id === 't1');
    expect(rfSticky?.data.hasSubBoard).toBe(true);
    expect(rfText?.data.hasSubBoard).toBeUndefined();
  });
});
