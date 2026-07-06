import { describe, it, expect } from 'vitest';
import type { BoardEdge, BoardNode } from '@easel/shared';
import { boardNodeToRf, boardEdgeToRf, boardToRf } from './rf-adapters.js';

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
