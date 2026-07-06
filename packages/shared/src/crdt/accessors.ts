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
 *
 * The `never` default is load-bearing: a future text-bearing node variant added
 * to {@link BoardNode} without a case here would fail to compile rather than
 * silently drop its text from replication — exactly the drift this contract
 * exists to prevent.
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
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const _exhaustive: never = node;
      void _exhaustive;
      return undefined;
    }
  }
}

/**
 * The inverse of {@link nodeToSyncShape} + {@link nodeText}: re-attach the text
 * from `nodeTexts` onto a node's SyncShape.
 *
 * TOTAL for the required text/title fields. `nodeData` and `nodeTexts` replicate
 * independently, so a torn read — the node's shape present but its `nodeTexts`
 * entry not yet arrived (`text === undefined`) — is a NORMAL transient state.
 * For types whose text/title is a REQUIRED field (frame.title, sticky/text/emoji
 * .text) we must still emit that field, defaulting to `''`, so the reconstructed
 * node always validates against the T3 schema instead of being silently
 * malformed. `shape.text` is optional, so a text-less shape stays text-less;
 * icon/drawing carry no text at all.
 *
 * INVARIANT (unchanged): for every node `n`,
 *   reconstructNode(nodeToSyncShape(n), nodeText(n))  deep-equals  n.
 * (When `n` is a frame/sticky/text/emoji, `nodeText(n)` is that required string,
 * so `?? ''` is a no-op; when `n` is a text-less shape/icon/drawing, `nodeText`
 * is `undefined` and no key is added.)
 */
export function reconstructNode(shape: SyncShape, text: string | undefined): BoardNode {
  const node = { ...shape } as Record<string, unknown>;
  switch (shape.type) {
    case 'frame':
      node.title = text ?? '';
      break;
    case 'sticky':
    case 'text':
    case 'emoji':
      node.text = text ?? '';
      break;
    case 'shape':
      // shape.text is optional — only attach it when it actually exists.
      if (text !== undefined) node.text = text;
      break;
    case 'icon':
    case 'drawing':
      // No editable text.
      break;
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const _exhaustive: never = shape;
      void _exhaustive;
      break;
    }
  }
  return node as unknown as BoardNode;
}

/**
 * Structural equality for the small POJO sync shapes — used to suppress
 * redundant Y.Map writes (which would otherwise cause endless observer noise).
 *
 * Deliberately NOT `JSON.stringify(a) === JSON.stringify(b)` (the legacy
 * client's approach): stringify is key-order-sensitive, so a spread that
 * reorders keys — e.g. `{ ...existing, ...patch }` moving a patched key to the
 * end — would compare unequal to a byte-identical shape and trigger a spurious
 * write, defeating the whole point. This walks the structure order-insensitively
 * instead. Compares plain objects, arrays, and primitives (which is all a
 * SyncShape ever contains); it is not a general-purpose deep-equal (no Map/Set/
 * Date handling), by design.
 */
export function syncShapeEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') {
    // Primitives (and null): already handled by `===` above; unequal here.
    return false;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!syncShapeEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!syncShapeEqual(ao[k], bo[k])) return false;
  }
  return true;
}
