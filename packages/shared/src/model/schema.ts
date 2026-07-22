// ── Runtime schema validation + migration ───────────────────────────────────
//
// This is the validation boundary the server, API, and MCP layers use instead
// of blindly `JSON.parse`-casting board/comments/tags JSON. Two jobs:
//
//   1. Zod mirrors of the T2 TypeScript types (packages/shared/src/model/
//      {board,comments,tags}.ts) — the CANONICAL, strict v1 schemas.
//   2. `migrate` upgrades legacy v0 files (no `formatVersion`) to v1 by
//      stamping `order` from array position, and rejects any future
//      `formatVersion` this build doesn't understand instead of guessing.
//
// Anything that reads board/comments/tags JSON from disk, from an API
// request, or from an MCP tool call should go through `parseBoardFile` /
// `safeParseBoardFile` / `parseCommentsFile` / `parseTagsFile` here rather
// than casting.

import { z } from 'zod';
import type { BoardFile, BoardNode, BoardEdge } from './board.js';
import type { CommentsFile } from './comments.js';
import type { TagsFile } from './tags.js';
import type { DraftsFile } from './drafts.js';
import { SHAPE_KINDS, FORMAT_VERSION } from './constants.js';

// ── ID / slug grammar ────────────────────────────────────────────────────────
//
// One source of truth for the character set allowed in node ids, board slugs,
// and sub-board path segments. Restricting to `[A-Za-z0-9_-]+` guarantees:
//   - the dotted-path file encoding (`board.NodeA.SubB.json`) can never be
//     broken by an id containing `.` or `/`,
//   - an id can never be a path-traversal segment (`..`, `/etc`, etc.),
//   - the same string is always safe to use as a Yjs room name.

export const ID_GRAMMAR = /^[A-Za-z0-9_-]+$/;

/** Branded string type — a value that has passed the {@link ID_GRAMMAR} check. */
export type Id = string & { readonly __brand: 'Id' };

export function isValidId(s: string): s is Id {
  return ID_GRAMMAR.test(s);
}

/** Throws if `s` does not match {@link ID_GRAMMAR}; narrows to {@link Id} on return. */
export function assertValidId(s: string): asserts s is Id {
  if (!isValidId(s)) {
    throw new Error(
      `Invalid id ${JSON.stringify(s)}: ids must match ${ID_GRAMMAR} (letters, digits, "_", "-" only).`,
    );
  }
}

// Unbranded at the zod-schema level: T2's hand-written types (board.ts) declare
// `id: string`, not `id: Id`, so the schemas that feed the drift guard below
// must infer to plain `string` for those fields. `IdSchema` is the public,
// branded schema for standalone id/slug validation (e.g. a server route
// parsing a path segment into an `Id`); `IdStringSchema` is the same grammar
// check without the brand, used internally wherever a hand-written type
// expects a plain `string`.
const IdStringSchema = z
  .string()
  .regex(ID_GRAMMAR, 'must match [A-Za-z0-9_-]+ (letters, digits, "_", "-" only)');

export const IdSchema = IdStringSchema.brand<'Id'>();

// Board slugs and sub-board path segments share the exact same grammar as node
// ids — that's the point (see module doc above). Kept as distinct exports so
// call sites can name their intent, even though the underlying schema is
// identical today.
export const SlugSchema = z
  .string()
  .regex(ID_GRAMMAR, 'must match [A-Za-z0-9_-]+ (letters, digits, "_", "-" only)');

export const PathSegmentSchema = z
  .string()
  .regex(ID_GRAMMAR, 'must match [A-Za-z0-9_-]+ (letters, digits, "_", "-" only)');

// ── Primitives ───────────────────────────────────────────────────────────────

export const XYSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const WHSchema = z.object({
  width: z.number(),
  height: z.number(),
});

// ── Enums ────────────────────────────────────────────────────────────────────

export const ArrowStyleSchema = z.enum(['none', 'end', 'start', 'both']);
export const LineStyleSchema = z.enum(['solid', 'dashed']);
export const EdgeKindSchema = z.enum(['arrow', 'cardinality']);
export const CardinalitySchema = z.enum(['1:1', '1:N', 'N:1', 'N:N']);
export const EdgeRoutingSchema = z.enum(['bezier', 'straight', 'elbow']);

// StickyColor is a free-form hex string (like ShapeNode/FrameNode's `color`)
// — STICKY_COLORS is only the picker palette/default, not an exhaustive
// enum, so this validates as a plain string rather than z.enum(STICKY_COLORS).
export const StickyColorSchema = z.string();

// z.enum requires a non-empty tuple of literal strings; SHAPE_KINDS is
// already exactly that (see constants.ts).
export const ShapeKindSchema = z.enum(
  SHAPE_KINDS as [(typeof SHAPE_KINDS)[number], ...(typeof SHAPE_KINDS)[number][]],
);

// ── Node schemas ─────────────────────────────────────────────────────────────

const NodeBaseSchema = {
  id: IdStringSchema,
  pos: XYSchema,
  order: z.number(),
  description: z.string().optional(),
};

export const StickyNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('sticky'),
  size: WHSchema,
  text: z.string(),
  color: StickyColorSchema,
});

export const TextNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('text'),
  text: z.string(),
});

export const ShapeNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('shape'),
  size: WHSchema,
  shape: ShapeKindSchema,
  text: z.string().optional(),
  color: z.string(),
  rotation: z.number().optional(),
});

export const FrameNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('frame'),
  size: WHSchema,
  title: z.string(),
  color: z.string(),
});

export const EmojiNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('emoji'),
  text: z.string(),
  size: z.number(),
  rotation: z.number().optional(),
});

export const IconNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('icon'),
  name: z.string(),
  size: z.number(),
  color: z.string(),
  rotation: z.number().optional(),
});

export const DrawingNodeSchema = z.object({
  ...NodeBaseSchema,
  type: z.literal('drawing'),
  size: WHSchema,
  points: z.array(XYSchema),
  color: z.string(),
  strokeWidth: z.number(),
});

export const BoardNodeSchema = z.discriminatedUnion('type', [
  StickyNodeSchema,
  TextNodeSchema,
  ShapeNodeSchema,
  FrameNodeSchema,
  EmojiNodeSchema,
  IconNodeSchema,
  DrawingNodeSchema,
]);

// ── Edge schema ──────────────────────────────────────────────────────────────

export const BoardEdgeSchema = z.object({
  id: IdStringSchema,
  source: IdStringSchema,
  target: IdStringSchema,
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  label: z.string().optional(),
  style: LineStyleSchema,
  // Defaults to 'arrow' when absent — existing board files stay valid. The
  // schema only validates shape; applying the default is the consumer's job.
  kind: EdgeKindSchema.optional(),
  arrow: ArrowStyleSchema.optional(),
  cardinality: CardinalitySchema.optional(),
  routing: EdgeRoutingSchema.optional(),
});

// ── BoardFile schema (canonical v1) ─────────────────────────────────────────

export const BoardFileSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  boardLabel: z.string(),
  nodes: z.array(BoardNodeSchema),
  edges: z.array(BoardEdgeSchema),
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    zoom: z.number(),
  }),
});

// ── Compile-time drift guard ─────────────────────────────────────────────────
//
// If T2's TypeScript types (board.ts) change shape without a matching update
// here, these assignments stop typechecking: the zod-inferred type for each
// schema must be assignable to (i.e. `satisfies`) the corresponding
// hand-written type. This is intentionally one-directional rather than exact
// equality — a schema is allowed to be *narrower* than the hand-written type
// (e.g. `BoardFileSchema.formatVersion` is `z.literal(1)`, narrower than the
// hand-written `formatVersion: number`, because only the current version
// should pass strict v1 validation) but never *wider* or missing a field,
// which is what would actually indicate drift.
//
// (Kept at the bottom, referenced only for type-level effect — no runtime
// behavior. Each function is called once immediately below, so nothing here
// is unused.)
function assertBoardNodeSchemaSatisfiesType(value: z.infer<typeof BoardNodeSchema>): BoardNode {
  return value;
}
function assertBoardEdgeSchemaSatisfiesType(value: z.infer<typeof BoardEdgeSchema>): BoardEdge {
  return value;
}
function assertBoardFileSchemaSatisfiesType(value: z.infer<typeof BoardFileSchema>): BoardFile {
  return value;
}
void assertBoardNodeSchemaSatisfiesType;
void assertBoardEdgeSchemaSatisfiesType;
void assertBoardFileSchemaSatisfiesType;

// ── Comments schema ──────────────────────────────────────────────────────────

const CommentTargetNodeSchema = z.object({
  type: z.literal('node'),
  nodeId: IdStringSchema,
  offset: XYSchema.optional(),
});

const CommentTargetCanvasSchema = z.object({
  type: z.literal('canvas'),
  pos: XYSchema,
});

export const CommentTargetSchema = z.discriminatedUnion('type', [
  CommentTargetNodeSchema,
  CommentTargetCanvasSchema,
]);

export const CommentReplySchema = z.object({
  id: IdStringSchema,
  author: z.string(),
  createdAt: z.string(),
  text: z.string(),
});

export const BoardCommentSchema = z.object({
  id: IdStringSchema,
  target: CommentTargetSchema,
  author: z.string(),
  createdAt: z.string(),
  text: z.string(),
  resolved: z.boolean().optional(),
  replies: z.array(CommentReplySchema),
});

export const CommentsFileSchema = z.object({
  comments: z.array(BoardCommentSchema),
});

// ── Tags schema ──────────────────────────────────────────────────────────────

export const TagsFileSchema = z.object({
  tags: z.array(z.string()),
});

// ── Drafts schema ────────────────────────────────────────────────────────────

export const DraftAuthorKindSchema = z.enum(['human', 'agent']);

export const DraftMetaSchema = z.object({
  // A draft id is used as a directory name (`.drafts/<id>/`) AND as a room
  // coordinate, so it must obey the same grammar as slugs/path segments — this
  // is what makes it traversal-safe.
  id: IdStringSchema,
  title: z.string(),
  createdBy: DraftAuthorKindSchema,
  createdAt: z.string(),
});

export const DraftsFileSchema = z.object({
  drafts: z.array(DraftMetaSchema),
});

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Migrates a raw (untyped) board payload to the canonical v1 {@link BoardFile}
 * shape and validates it against {@link BoardFileSchema}.
 *
 * - No `formatVersion` (legacy v0): each node's `order` is stamped from its
 *   array index if missing (preserving current array-position z-order
 *   semantics), then `formatVersion` is set to 1.
 * - `formatVersion === 1`: validated as-is.
 * - `formatVersion` a number greater than 1 (unknown future version): throws
 *   — never silently mangled.
 *
 * Throws a {@link ZodError}-derived message (via {@link parseBoardFile}'s
 * caller contract) if the result doesn't validate against the strict v1
 * schema.
 */
export function migrate(raw: unknown): BoardFile {
  if (raw === null || typeof raw !== 'object') {
    return BoardFileSchema.parse(raw);
  }

  const obj = raw as Record<string, unknown>;

  if (obj.formatVersion === undefined) {
    const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
    const migratedNodes = nodes.map((node: unknown, index: number) => {
      if (node !== null && typeof node === 'object' && !('order' in node)) {
        return { ...node, order: index };
      }
      return node;
    });
    const migrated = { ...obj, nodes: migratedNodes, formatVersion: FORMAT_VERSION };
    return BoardFileSchema.parse(migrated);
  }

  if (obj.formatVersion === FORMAT_VERSION) {
    return BoardFileSchema.parse(obj);
  }

  if (typeof obj.formatVersion === 'number' && obj.formatVersion > FORMAT_VERSION) {
    throw new Error(
      `Unsupported board formatVersion ${obj.formatVersion} — this build supports up to ${FORMAT_VERSION}. Upgrade the app.`,
    );
  }

  // formatVersion present but not a plain number > 0, and not exactly
  // FORMAT_VERSION, and not undefined: let the strict schema produce a
  // precise validation error rather than guessing what was meant.
  return BoardFileSchema.parse(obj);
}

// ── Boundary parsing helpers ─────────────────────────────────────────────────

function formatZodError(context: string, error: z.ZodError): string {
  return `${context}:\n${z.prettifyError(error)}`;
}

/**
 * Migrates + validates a raw board payload. Throws a helpful error (including
 * the underlying zod issues) if the input is invalid or uses an unsupported
 * `formatVersion`.
 */
export function parseBoardFile(raw: unknown): BoardFile {
  try {
    return migrate(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatZodError('Invalid board file', err));
    }
    throw err;
  }
}

/**
 * Non-throwing variant of {@link parseBoardFile} for boundaries that want to
 * quarantine bad data (e.g. log a warning and skip) instead of crashing.
 */
export function safeParseBoardFile(
  raw: unknown,
): { ok: true; value: BoardFile } | { ok: false; error: string } {
  try {
    return { ok: true, value: parseBoardFile(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Validates a comments file. No versioning — comments.json has no `formatVersion`. */
export function parseCommentsFile(raw: unknown): CommentsFile {
  const result = CommentsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatZodError('Invalid comments file', result.error));
  }
  return result.data;
}

/** Validates a tags file. No versioning — tags.json has no `formatVersion`. */
export function parseTagsFile(raw: unknown): TagsFile {
  const result = TagsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatZodError('Invalid tags file', result.error));
  }
  return result.data;
}

/** Validates a drafts index file. No versioning — drafts.json has no `formatVersion`. */
export function parseDraftsFile(raw: unknown): DraftsFile {
  const result = DraftsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatZodError('Invalid drafts file', result.error));
  }
  return result.data;
}
