// ── The node ↔ Y.Map bridge — ONE definition for client AND server ───────────
//
// Ported from, and reconciling, two legacy definitions that were kept in sync
// only by hand:
//   - the client's `nodeToSyncShape` / `applyNodeSyncData` / `reconstructNode` /
//     `syncShapeEqual` and its `getNodeText` in src/components/BoardCanvas.tsx;
//   - the MCP server's inline projection in ops.ts (`getSnapshot` / `addNode`).
//
// The text/title split follows the client's `getNodeText`, which is the
// authoritative rule the live board actually applies on every push/pull:
//
//     frame                         → nodeTexts holds `title`
//     sticky | text | emoji | shape → nodeTexts holds `text`
//     icon | drawing                → no nodeTexts entry (undefined)
//
// (The legacy MCP `addNode` only *seeded* an empty-string default for
// sticky/text/shape and omitted emoji, but it still routed an emoji's glyph
// into nodeTexts because emojis are always created with a `text`. The observable
// reconstruct behaviour — frame→title, else→text — matched the client; the only
// drift was that cosmetic default. We drop the empty-string seeding entirely:
// `nodeText` returns the node's real text, so an empty sticky yields `''` and a
// texted one yields its text, with no special-casing.)

import type { BoardNode } from '../model/board.js';
import type { SyncShape } from './schema.js';

/**
 * Project a node onto its {@link SyncShape}: strip `text`/`title`, keep
 * everything else (including `order`). Never mutates the input.
 */
export function nodeToSyncShape(node: BoardNode): SyncShape {
  const obj = { ...node } as Record<string, unknown>;
  delete obj.text;
  delete obj.title;
  return obj as SyncShape;
}

/**
 * The string to store in `nodeTexts` for a node: a frame's `title`, a
 * text-bearing node's `text`, or `undefined` for icon/drawing (which carry no
 * editable text). Mirrors the client's `getNodeText`.
 */
export function nodeText(node: BoardNode): string | undefined {
  switch (node.type) {
    case 'frame':
      return node.title;
    case 'sticky':
    case 'text':
    case 'emoji':
      return node.text;
    case 'shape':
      return node.text;
    case 'icon':
    case 'drawing':
      return undefined;
  }
}

/**
 * The inverse of {@link nodeToSyncShape} + {@link nodeText}: re-attach `text`
 * as a frame's `title` or otherwise as the node's `text`. When `text` is
 * `undefined`, no text/title key is added, so a shape saved without text (or an
 * icon/drawing) reconstructs exactly as it was.
 *
 * INVARIANT: for every node `n`,
 *   reconstructNode(nodeToSyncShape(n), nodeText(n))  deep-equals  n.
 */
export function reconstructNode(shape: SyncShape, text: string | undefined): BoardNode {
  const node = { ...shape } as Record<string, unknown>;
  if (text !== undefined) {
    if (node.type === 'frame') node.title = text;
    else node.text = text;
  }
  return node as unknown as BoardNode;
}

/**
 * Cheap structural equality for the small POJO sync shapes. Ported from the
 * client's `syncShapeEqual` — avoids redundant Y.Map writes (which would cause
 * endless observer noise) without pulling in a deep-equal dependency.
 */
export function syncShapeEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
