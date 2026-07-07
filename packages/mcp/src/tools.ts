// ── Tool → shared-op wiring ──────────────────────────────────────────────────
//
// The pure logic behind every board-editing MCP tool: validates/normalizes
// input, builds a node/edge via the `@easel/shared` factories
// (`makeStickyNode`/`makeDrawingNode`/`makeEdge`/etc.) + `generateId`/
// `nextOrder`, and applies it to the connected `BoardPeer`'s doc via the
// SHARED `crdt/ops` — the exact same ops the browser client uses. Kept
// separate from `server.ts` (the MCP tool *registration* — zod schemas,
// descriptions, cursor-lead niceties) so this file is testable directly
// against a real in-memory Y.Doc, with no MCP transport involved.
//
// Deliberately no disk I/O here: the server (P5-T28) is the sole persister
// of room content, so every function below only ever touches `peer.doc`.

import {
  type BoardNode,
  type BoardEdge,
  type XY,
  type WH,
  type ShapeKind,
  type LineStyle,
  type EdgeKind,
  type ArrowStyle,
  type Cardinality,
  getSnapshot,
  addNode as addNodeOp,
  updateNode as updateNodeOp,
  moveNode as moveNodeOp,
  deleteNode as deleteNodeOp,
  setNodeText as setNodeTextOp,
  addDrawing as addDrawingOp,
  addEdge as addEdgeOp,
  updateEdge as updateEdgeOp,
  deleteEdge as deleteEdgeOp,
  generateId,
  nextOrder,
  makeStickyNode,
  makeTextNode,
  makeShapeNode,
  makeFrameNode,
  makeEmojiNode,
  makeIconNode,
  makeDrawingNode,
  makeEdge,
} from '@easel/shared';
import type { BoardPeer } from './peer.js';

// ── Reads ─────────────────────────────────────────────────────────────────────

export function getBoard(peer: BoardPeer): { nodes: BoardNode[]; edges: BoardEdge[] } {
  return getSnapshot(peer.doc);
}

export function getNode(peer: BoardPeer, id: string): BoardNode | null {
  return getSnapshot(peer.doc).nodes.find((n) => n.id === id) ?? null;
}

export function listNodes(peer: BoardPeer, type?: string): BoardNode[] {
  const { nodes } = getSnapshot(peer.doc);
  return type ? nodes.filter((n) => n.type === type) : nodes;
}

// ── add_node ──────────────────────────────────────────────────────────────────

export interface AddNodeInput {
  type: string;
  pos: XY;
  id?: string;
  size?: WH;
  color?: string;
  shape?: ShapeKind;
  text?: string;
  title?: string;
  name?: string;
  rotation?: number;
  description?: string;
}

/** Builds the node via the matching `@easel/shared` factory, then applies any extra fields (text/rotation/description) the factory doesn't take directly. */
function buildNode(input: AddNodeInput, id: string, order: number): BoardNode {
  let node: BoardNode;
  switch (input.type) {
    case 'sticky':
      node = makeStickyNode(id, input.pos, input.color ?? '#fef3c7', order, input.size);
      if (input.text !== undefined) node = { ...node, text: input.text } as BoardNode;
      break;
    case 'text':
      node = makeTextNode(id, input.pos, order);
      if (input.text !== undefined) node = { ...node, text: input.text } as BoardNode;
      break;
    case 'shape':
      node = makeShapeNode(
        id,
        input.pos,
        order,
        input.shape ?? 'rect',
        input.size,
        input.color ?? '#e2e8f0',
      );
      if (input.text !== undefined) node = { ...node, text: input.text } as BoardNode;
      if (input.rotation !== undefined) node = { ...node, rotation: input.rotation } as BoardNode;
      break;
    case 'frame':
      node = makeFrameNode(id, input.pos, order, input.size, input.color, input.title);
      break;
    case 'emoji':
      node = makeEmojiNode(id, input.pos, order, input.text ?? '❓', input.size?.width);
      if (input.rotation !== undefined) node = { ...node, rotation: input.rotation } as BoardNode;
      break;
    case 'icon':
      node = makeIconNode(
        id,
        input.pos,
        order,
        input.name ?? 'star',
        input.size?.width,
        input.color,
      );
      if (input.rotation !== undefined) node = { ...node, rotation: input.rotation } as BoardNode;
      break;
    default:
      throw new Error(
        `add_node: unknown node type ${JSON.stringify(input.type)}. Expected one of: ` +
          'sticky, text, shape, frame, emoji, icon, drawing (use add_drawing for drawing).',
      );
  }
  if (input.description !== undefined) node = { ...node, description: input.description };
  return node;
}

/** Adds a node built from `input` and returns its id. */
export function addNode(peer: BoardPeer, input: AddNodeInput): string {
  const { nodes } = getSnapshot(peer.doc);
  const existingIds = new Set(nodes.map((n) => n.id));
  const id = input.id ?? generateId(input.type, existingIds);
  const order = nextOrder(nodes);
  const node = buildNode(input, id, order);
  addNodeOp(peer.doc, node);
  return id;
}

export function updateNode(peer: BoardPeer, id: string, patch: Record<string, unknown>): void {
  updateNodeOp(peer.doc, id, patch);
}

export function moveNode(peer: BoardPeer, id: string, pos: XY): void {
  moveNodeOp(peer.doc, id, pos);
}

export function deleteNode(peer: BoardPeer, id: string): void {
  deleteNodeOp(peer.doc, id);
}

export function setNodeText(peer: BoardPeer, id: string, text: string): void {
  setNodeTextOp(peer.doc, id, text);
}

export function setDescription(peer: BoardPeer, id: string, description: string): void {
  updateNodeOp(peer.doc, id, { description });
}

// ── add_drawing ───────────────────────────────────────────────────────────────

export interface AddDrawingInput {
  points: XY[];
  id?: string;
  color?: string;
  strokeWidth?: number;
  description?: string;
}

export function addDrawing(peer: BoardPeer, input: AddDrawingInput): string {
  if (!input.points || input.points.length === 0) {
    throw new Error('add_drawing requires at least one point');
  }
  const { nodes } = getSnapshot(peer.doc);
  const existingIds = new Set(nodes.map((n) => n.id));
  const id = input.id ?? generateId('drawing', existingIds);
  const order = nextOrder(nodes);
  let node = makeDrawingNode(id, input.points, order, input.color, input.strokeWidth);
  if (input.description !== undefined) node = { ...node, description: input.description };
  addDrawingOp(peer.doc, node as Extract<BoardNode, { type: 'drawing' }>);
  return id;
}

// ── Edge ops ──────────────────────────────────────────────────────────────────

export interface AddEdgeInput {
  source: string;
  target: string;
  id?: string;
  style?: LineStyle;
  kind?: EdgeKind;
  arrow?: ArrowStyle;
  cardinality?: Cardinality;
  label?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function addEdge(peer: BoardPeer, input: AddEdgeInput): string {
  const { edges } = getSnapshot(peer.doc);
  const existingIds = new Set(edges.map((e) => e.id));
  const id = input.id ?? generateId('edge', existingIds);
  let edge = makeEdge(
    id,
    input.source,
    input.target,
    input.style,
    input.kind,
    input.arrow,
    input.cardinality,
  );
  if (input.label !== undefined) edge = { ...edge, label: input.label };
  if (input.sourceHandle !== undefined) edge = { ...edge, sourceHandle: input.sourceHandle };
  if (input.targetHandle !== undefined) edge = { ...edge, targetHandle: input.targetHandle };
  addEdgeOp(peer.doc, edge);
  return id;
}

export function updateEdge(peer: BoardPeer, id: string, patch: Record<string, unknown>): void {
  updateEdgeOp(peer.doc, id, patch);
}

export function deleteEdge(peer: BoardPeer, id: string): void {
  deleteEdgeOp(peer.doc, id);
}
