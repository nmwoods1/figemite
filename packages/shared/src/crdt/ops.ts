// ── Granular CRDT ops on a Y.Doc — shared by the client AND the MCP server ────
//
// Ported from mcp/airjam-mcp-server/src/ops.ts and reconciled with the client's
// sync effects in src/components/BoardCanvas.tsx. Operates directly on a
// `Y.Doc`, using the schema constants (crdt/schema.ts) and the node↔map bridge
// (crdt/accessors.ts) — the SINGLE definition both peers now import.
//
// Two invariants carried over from the sources:
//
//   1. Granular writes. Each op writes the minimum number of Y.Map entries so
//      concurrent human+AI edits merge instead of clobbering. In particular a
//      text edit and a position drag touch different maps (nodeTexts vs
//      nodeData) and never collide; `updateNode` writes nodeData only when a
//      non-text field actually changes.
//
//   2. Tagged transactions. Every mutation runs inside `doc.transact(fn, origin)`
//      with a default of {@link LOCAL_ORIGIN}. A later phase scopes a
//      `Y.UndoManager` to local-origin changes, so keeping origins explicit here
//      is load-bearing — remote/AI writes can pass a different origin to stay
//      out of the local undo stack.

import * as Y from 'yjs';
import type { BoardEdge, BoardNode, DrawingNode, XY } from '../model/board.js';
import { EDGE_DATA, NODE_DATA, NODE_TEXTS, type SyncShape } from './schema.js';
import { nodeText, nodeToSyncShape, reconstructNode } from './accessors.js';

/**
 * Default transaction origin for a local (this-peer) mutation. A symbol so it's
 * globally unique and can't be confused with a string origin from elsewhere.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('easel.local');

/** Any value usable as a Yjs transaction origin. */
export type Origin = unknown;

// ── Map accessors ─────────────────────────────────────────────────────────────

function nodeDataMap(doc: Y.Doc): Y.Map<SyncShape> {
  return doc.getMap<SyncShape>(NODE_DATA);
}

function nodeTextsMap(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>(NODE_TEXTS);
}

function edgeDataMap(doc: Y.Doc): Y.Map<BoardEdge> {
  return doc.getMap<BoardEdge>(EDGE_DATA);
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * Reconstruct all nodes and edges from the Y.Maps. Nodes are rebuilt via
 * {@link reconstructNode}, pulling text from `nodeTexts`. Nodes are returned in
 * whatever order the map yields — canonical ordering is `serialise`'s job. This
 * intentionally does NOT synthesise persistence metadata
 * (formatVersion/boardLabel/viewport); that lives elsewhere.
 */
export function getSnapshot(doc: Y.Doc): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const ndm = nodeDataMap(doc);
  const ntm = nodeTextsMap(doc);
  const edm = edgeDataMap(doc);

  const nodes: BoardNode[] = [];
  ndm.forEach((shape, id) => {
    // Guard against a torn write where a text entry exists without its data.
    if (!shape || typeof (shape as { type?: unknown }).type !== 'string') return;
    nodes.push(reconstructNode(shape, ntm.get(id)));
  });

  const edges: BoardEdge[] = [];
  edm.forEach((edge) => edges.push({ ...edge }));

  return { nodes, edges };
}

// ── Node ops ──────────────────────────────────────────────────────────────────

/**
 * Add (or replace) a node. Splits it into its `nodeData` SyncShape and, when the
 * node carries text/title, a `nodeTexts` entry.
 */
export function addNode(doc: Y.Doc, node: BoardNode, origin: Origin = LOCAL_ORIGIN): void {
  const shape = nodeToSyncShape(node);
  const text = nodeText(node);
  doc.transact(() => {
    nodeDataMap(doc).set(node.id, shape);
    if (text !== undefined) nodeTextsMap(doc).set(node.id, text);
  }, origin);
}

/**
 * Merge a patch of non-text fields into an existing node's `nodeData`. Writes
 * nodeData only when the patch is non-empty, so an empty patch never produces a
 * spurious CRDT update. Text/title are NOT handled here — use
 * {@link setNodeText}. No-op if the node doesn't exist yet.
 */
export function updateNode(
  doc: Y.Doc,
  id: string,
  patch: Partial<SyncShape>,
  origin: Origin = LOCAL_ORIGIN,
): void {
  if (Object.keys(patch).length === 0) return;
  const ndm = nodeDataMap(doc);
  const existing = ndm.get(id);
  if (!existing) return;
  doc.transact(() => {
    ndm.set(id, { ...existing, ...patch } as SyncShape);
  }, origin);
}

/** Move a node to a new position. No-op if the node doesn't exist. */
export function moveNode(doc: Y.Doc, id: string, pos: XY, origin: Origin = LOCAL_ORIGIN): void {
  const ndm = nodeDataMap(doc);
  doc.transact(() => {
    const existing = ndm.get(id);
    if (!existing) return;
    ndm.set(id, { ...existing, pos } as SyncShape);
  }, origin);
}

/** Delete a node and its text entry. */
export function deleteNode(doc: Y.Doc, id: string, origin: Origin = LOCAL_ORIGIN): void {
  doc.transact(() => {
    nodeDataMap(doc).delete(id);
    nodeTextsMap(doc).delete(id);
  }, origin);
}

/**
 * Set a node's text/title via the `nodeTexts` map ONLY — the `nodeData`
 * SyncShape is left untouched, so a text edit and a concurrent drag merge
 * cleanly.
 */
export function setNodeText(
  doc: Y.Doc,
  id: string,
  text: string,
  origin: Origin = LOCAL_ORIGIN,
): void {
  doc.transact(() => {
    nodeTextsMap(doc).set(id, text);
  }, origin);
}

/**
 * Add a pre-built {@link DrawingNode}. Bbox/point-rebasing is `makeDrawingNode`'s
 * job (board-io) — this op just writes it. Kept as its own named op to mirror
 * the source's `addDrawing`. Drawings carry no editable text, so no `nodeTexts`
 * entry is created.
 */
export function addDrawing(doc: Y.Doc, node: DrawingNode, origin: Origin = LOCAL_ORIGIN): void {
  addNode(doc, node, origin);
}

// ── Edge ops ──────────────────────────────────────────────────────────────────

/** Add (or replace) an edge. */
export function addEdge(doc: Y.Doc, edge: BoardEdge, origin: Origin = LOCAL_ORIGIN): void {
  doc.transact(() => {
    edgeDataMap(doc).set(edge.id, { ...edge });
  }, origin);
}

/** Merge a patch into an existing edge (its `id` is preserved). No-op if absent. */
export function updateEdge(
  doc: Y.Doc,
  id: string,
  patch: Partial<BoardEdge>,
  origin: Origin = LOCAL_ORIGIN,
): void {
  const edm = edgeDataMap(doc);
  const existing = edm.get(id);
  if (!existing) return;
  doc.transact(() => {
    edm.set(id, { ...existing, ...patch, id });
  }, origin);
}

/** Delete an edge. */
export function deleteEdge(doc: Y.Doc, id: string, origin: Origin = LOCAL_ORIGIN): void {
  doc.transact(() => {
    edgeDataMap(doc).delete(id);
  }, origin);
}

// ── Bulk load ─────────────────────────────────────────────────────────────────

/**
 * Clear the three maps and bulk-populate them from a board, splitting each
 * node's text/title into `nodeTexts`. Used for initial load and history restore.
 * Clearing-then-loading (all inside one transaction) matches how the sources
 * seed a fresh doc, and guarantees no stale node/edge/text survives a reload.
 */
export function loadBoardIntoDoc(
  doc: Y.Doc,
  board: { nodes: BoardNode[]; edges: BoardEdge[] },
  origin: Origin = LOCAL_ORIGIN,
): void {
  const ndm = nodeDataMap(doc);
  const ntm = nodeTextsMap(doc);
  const edm = edgeDataMap(doc);
  doc.transact(() => {
    ndm.clear();
    ntm.clear();
    edm.clear();
    for (const node of board.nodes) {
      ndm.set(node.id, nodeToSyncShape(node));
      const text = nodeText(node);
      if (text !== undefined) ntm.set(node.id, text);
    }
    for (const edge of board.edges) {
      edm.set(edge.id, { ...edge });
    }
  }, origin);
}
