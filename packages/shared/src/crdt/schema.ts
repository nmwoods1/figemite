// ── Shared CRDT schema — the ONE definition of the Yjs doc layout ────────────
//
// Historically the browser client (src/components/BoardCanvas.tsx) and the MCP
// server (mcp/airjam-mcp-server/src/ops.ts) EACH declared these Y.Map names and
// the node↔map projection separately. A field-name drift between the two would
// corrupt multiplayer sync silently, with no error. This module is the single
// source of truth both sides import so that can never happen again.
//
// The layout, kept byte-identical to the legacy rooms so existing boards stay
// compatible, is three `Y.Map`s plus one `Y.Array` on the doc:
//
//   nodeData    Y.Map<SyncShape>   id → the node's data EXCEPT its text/title
//   nodeTexts   Y.Map<string>      id → the node's text (or a frame's title)
//   edgeData    Y.Map<BoardEdge>   id → the edge
//   annotations Y.Array<...>       ephemeral discussion strokes
//
// nodeData and nodeTexts are split so a text edit (typing into a sticky) merges
// independently of a concurrent drag of the same node — the two live on
// different Y.Map keys and never collide.

import type { BoardNode } from '../model/board.js';

/** Y.Map name: id → {@link SyncShape} (node data minus text/title). */
export const NODE_DATA = 'nodeData';

/** Y.Map name: id → the node's text string (a node's `text`, or a frame's `title`). */
export const NODE_TEXTS = 'nodeTexts';

/** Y.Map name: id → BoardEdge. */
export const EDGE_DATA = 'edgeData';

/**
 * Y.Array name: ephemeral annotation strokes shared during a discussion. Its
 * typed accessor + ops land with the annotation-overlay client phase — the
 * constant is defined now so the doc layout is complete in one place
 * (intentional deferral).
 */
export const ANNOTATIONS = 'annotations';

// ── SyncShape ────────────────────────────────────────────────────────────────
//
// A node as stored in the `nodeData` Y.Map: everything a BoardNode carries
// EXCEPT its text/title field (that lives in `nodeTexts`), but INCLUDING the
// `order` z-index. Storing `order` here is a deliberate addition over the
// legacy layout: z-order is node data, not text, so it must replicate through
// nodeData for stacking to survive sync.
//
// The distributive conditional keeps each union variant's discriminant and its
// own fields intact — a plain `Omit<BoardNode, 'text' | 'title'>` would collapse
// the union and lose the per-variant shape.
export type SyncShape = BoardNode extends infer N
  ? N extends BoardNode
    ? Omit<N, 'text' | 'title'>
    : never
  : never;
