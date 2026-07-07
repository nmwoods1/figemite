// ── Granular CRDT ops on a Y.Doc — shared by the client AND the MCP server ────
//
// Ported from mcp/legacy-mcp-server/src/ops.ts and reconciled with the client's
// sync effects in src/components/BoardCanvas.tsx. Operates directly on a
// `Y.Doc`, using the schema constants (crdt/schema.ts) and the node↔map bridge
// (crdt/accessors.ts) — the SINGLE definition both peers now import.
//
// Two invariants carried over from the sources:
//
//   1. Merge granularity is per-Y.Map and per-node-id — NOT per-field.
//      Each op writes the minimum number of Y.Map entries, so:
//        - a text edit and a position drag never collide: they land in
//          different maps (nodeTexts vs nodeData);
//        - edits to two different nodes never collide: different map keys.
//      But within ONE node's `nodeData`, the stored value is an opaque object
//      keyed by id, so two concurrent writes to the SAME node's nodeData (a drag
//      vs a recolor) are last-writer-wins over the whole value — Yjs does not
//      merge inside it. This matches the legacy design and is intentional; the
//      value is deliberately a plain object, not a nested Y.Map, so we keep it.
//
//   2. Tagged transactions. Every mutation runs inside `doc.transact(fn, origin)`
//      with a default of {@link LOCAL_ORIGIN}. A later phase scopes a
//      `Y.UndoManager` to local-origin changes, so keeping origins explicit here
//      is load-bearing — remote/AI writes can pass a different origin to stay
//      out of the local undo stack.

import * as Y from 'yjs';
import type { BoardEdge, BoardNode, DrawingNode, XY } from '../model/board.js';
import { BoardNodeSchema } from '../model/schema.js';
import { pruneEdgesForDeletedNodes } from '../board-io.js';
import { EDGE_DATA, NODE_DATA, NODE_TEXTS, type SyncShape } from './schema.js';
import { nodeText, nodeToSyncShape, reconstructNode } from './accessors.js';

/**
 * Default transaction origin for a local (this-peer) mutation. A symbol so it's
 * globally unique and can't be confused with a string origin from elsewhere.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('figemite.local');

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
 *
 * Self-consistency guarantee: dangling edges (whose source/target isn't a live
 * node) are dropped, so the returned `edges` always reference returned `nodes`.
 * Under concurrency `edgeData` can transiently hold an edge for a node that
 * another peer just deleted; this makes the snapshot coherent for T6's
 * convergence checks.
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

  return { nodes, edges: pruneEdgesForDeletedNodes(edges, new Set(nodes.map((n) => n.id))) };
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
 *
 * `Partial<SyncShape>` distributes over the union, so a cross-variant patch
 * (e.g. mixing `shape`, `name`, and `points`) would typecheck; the `as SyncShape`
 * cast can't catch it. So before writing we reconstruct the merged candidate and
 * validate it with the T3 {@link BoardNodeSchema}, throwing a clear error if it
 * would produce a malformed node. This makes it impossible for `updateNode` to
 * land an invalid shape in the doc.
 *
 * The zod variant schemas STRIP unknown keys rather than rejecting them, so a
 * schema pass alone wouldn't catch a foreign field (e.g. `points` on a shape) —
 * it would just be silently dropped by validation while the junk key still
 * lands in `nodeData`. We therefore also reject any key the parse stripped: a
 * dropped key means the patch introduced a field that doesn't belong to this
 * node's variant.
 */
export function updateNode(
  doc: Y.Doc,
  id: string,
  patch: Partial<SyncShape>,
  origin: Origin = LOCAL_ORIGIN,
): void {
  if (Object.keys(patch).length === 0) return;
  const ndm = nodeDataMap(doc);
  doc.transact(() => {
    const existing = ndm.get(id);
    if (!existing) return;
    const merged = { ...existing, ...patch } as SyncShape;
    const type = (existing as { type?: unknown }).type ?? '?';

    // Validate against the canonical node schema (via a full reconstruct, so
    // required text/title are present) before committing the write.
    const candidate = reconstructNode(merged, nodeTextsMap(doc).get(id));
    const result = BoardNodeSchema.safeParse(candidate);
    if (!result.success) {
      throw new Error(
        `updateNode(${JSON.stringify(id)}): patch [${Object.keys(patch).join(', ')}] would ` +
          `produce an invalid ${type} node: ${result.error.issues
            .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
            .join('; ')}`,
      );
    }

    // Reject foreign keys the schema silently stripped (cross-variant patch).
    const stripped = Object.keys(candidate).filter(
      (k) => !Object.prototype.hasOwnProperty.call(result.data, k),
    );
    if (stripped.length > 0) {
      throw new Error(
        `updateNode(${JSON.stringify(id)}): patch introduced field(s) [${stripped.join(', ')}] ` +
          `that are invalid for a ${type} node`,
      );
    }

    ndm.set(id, merged);
  }, origin);
}

/** Move a node to a new position. No-op if the node doesn't exist. */
export function moveNode(doc: Y.Doc, id: string, pos: XY, origin: Origin = LOCAL_ORIGIN): void {
  const ndm = nodeDataMap(doc);
  doc.transact(() => {
    const existing = ndm.get(id);
    if (!existing) return;
    ndm.set(id, { ...existing, pos });
  }, origin);
}

/**
 * Delete a node, its text entry, and every edge touching it — all in one
 * transaction, so `edgeData` never accumulates orphaned edges (getSnapshot's
 * filter is the read-side guarantee; this is the write-side one).
 */
export function deleteNode(doc: Y.Doc, id: string, origin: Origin = LOCAL_ORIGIN): void {
  doc.transact(() => {
    nodeDataMap(doc).delete(id);
    nodeTextsMap(doc).delete(id);
    const edm = edgeDataMap(doc);
    for (const [edgeId, edge] of edm.entries()) {
      if (edge.source === id || edge.target === id) edm.delete(edgeId);
    }
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

/**
 * Merge a patch into an existing edge (its `id` is preserved). No-op if
 * absent. A patch field explicitly set to `undefined` (e.g. clearing
 * `arrow` when switching an edge's `kind` to `'cardinality'`) REMOVES that
 * key from the merged object entirely, rather than leaving an own-
 * enumerable `key: undefined` — a ghost key would otherwise survive a CRDT
 * encode/decode round-trip (propagating the phantom key to remote peers)
 * even though every reader already treats `undefined` and "absent"
 * identically via `??`/optional-chaining.
 */
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
    const merged: BoardEdge = { ...existing, ...patch, id };
    for (const key of Object.keys(patch) as (keyof BoardEdge)[]) {
      if (patch[key] === undefined) delete merged[key];
    }
    edm.set(id, merged);
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
