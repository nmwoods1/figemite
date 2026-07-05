import { describe, expect, it } from 'vitest';
import type { BoardFile } from './board.js';
import { FORMAT_VERSION } from './constants.js';
import {
  ID_GRAMMAR,
  isValidId,
  assertValidId,
  IdSchema,
  SlugSchema,
  PathSegmentSchema,
  BoardFileSchema,
  BoardNodeSchema,
  BoardEdgeSchema,
  CommentsFileSchema,
  TagsFileSchema,
  migrate,
  parseBoardFile,
  safeParseBoardFile,
  parseCommentsFile,
  parseTagsFile,
} from './schema.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function validBoardFile(): BoardFile {
  return {
    formatVersion: FORMAT_VERSION,
    boardLabel: 'Test board',
    nodes: [
      {
        id: 'n1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'hello',
        color: '#fef3c7',
      },
      {
        id: 'n2',
        type: 'text',
        pos: { x: 10, y: 10 },
        order: 1,
        text: 'a label',
      },
      {
        id: 'n3',
        type: 'shape',
        pos: { x: 20, y: 20 },
        order: 2,
        size: { width: 160, height: 100 },
        shape: 'diamond',
        text: 'decision',
        color: '#1e293b',
        rotation: 0,
      },
      {
        id: 'n4',
        type: 'frame',
        pos: { x: 30, y: 30 },
        order: 3,
        size: { width: 480, height: 320 },
        title: 'Section',
        color: '#1e293b',
      },
      {
        id: 'n5',
        type: 'emoji',
        pos: { x: 40, y: 40 },
        order: 4,
        text: '🎉',
        size: 64,
      },
      {
        id: 'n6',
        type: 'icon',
        pos: { x: 50, y: 50 },
        order: 5,
        name: 'star',
        size: 48,
        color: '#1e293b',
      },
      {
        id: 'n7',
        type: 'drawing',
        pos: { x: 60, y: 60 },
        order: 6,
        size: { width: 100, height: 100 },
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        color: '#1e293b',
        strokeWidth: 3,
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        style: 'solid',
        kind: 'arrow',
        arrow: 'end',
      },
      {
        id: 'e2',
        source: 'n3',
        target: 'n4',
        style: 'dashed',
        kind: 'cardinality',
        cardinality: '1:N',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// ── ID / slug grammar ────────────────────────────────────────────────────────

describe('ID_GRAMMAR / isValidId', () => {
  it('accepts letters, digits, underscore, and hyphen', () => {
    expect(isValidId('Abc123_-xyz')).toBe(true);
    expect(ID_GRAMMAR.test('Abc123_-xyz')).toBe(true);
  });

  it('rejects a dot', () => {
    expect(isValidId('node.1')).toBe(false);
  });

  it('rejects a slash', () => {
    expect(isValidId('node/1')).toBe(false);
  });

  it('rejects a space', () => {
    expect(isValidId('node 1')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('rejects a path-traversal-looking id', () => {
    expect(isValidId('..')).toBe(false);
  });

  it('assertValidId throws for an invalid id and is silent for a valid one', () => {
    expect(() => assertValidId('bad.id')).toThrow();
    expect(() => assertValidId('good-id_1')).not.toThrow();
  });

  it('IdSchema/SlugSchema/PathSegmentSchema all enforce the same grammar', () => {
    expect(IdSchema.safeParse('node.1').success).toBe(false);
    expect(SlugSchema.safeParse('my/slug').success).toBe(false);
    expect(PathSegmentSchema.safeParse('..').success).toBe(false);
    expect(IdSchema.safeParse('valid-id_1').success).toBe(true);
    expect(SlugSchema.safeParse('valid-slug').success).toBe(true);
    expect(PathSegmentSchema.safeParse('SubBoard1').success).toBe(true);
  });
});

// ── Round trip ───────────────────────────────────────────────────────────────

describe('parseBoardFile: valid v1 board', () => {
  it('round-trips a valid v1 board unchanged', () => {
    const board = validBoardFile();
    const result = parseBoardFile(board);
    expect(result).toEqual(board);
  });

  it('validates the individual exported schemas too', () => {
    const board = validBoardFile();
    expect(BoardFileSchema.safeParse(board).success).toBe(true);
    for (const node of board.nodes) {
      expect(BoardNodeSchema.safeParse(node).success).toBe(true);
    }
    for (const edge of board.edges) {
      expect(BoardEdgeSchema.safeParse(edge).success).toBe(true);
    }
  });
});

// ── v0 -> v1 migration ───────────────────────────────────────────────────────

describe('migrate: legacy v0 board (no formatVersion)', () => {
  it('stamps formatVersion 1 and assigns order = array index per node', () => {
    const legacy = {
      boardLabel: 'Legacy board',
      nodes: [
        { id: 'a', type: 'text', pos: { x: 0, y: 0 }, text: 'first' },
        { id: 'b', type: 'text', pos: { x: 1, y: 1 }, text: 'second' },
        { id: 'c', type: 'text', pos: { x: 2, y: 2 }, text: 'third' },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const migrated = migrate(legacy);

    expect(migrated.formatVersion).toBe(1);
    expect(migrated.nodes.map((n) => n.order)).toEqual([0, 1, 2]);
    expect(migrated.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves an existing order on a node that already has one, but still indexes the rest', () => {
    const legacy = {
      boardLabel: 'Mixed board',
      nodes: [
        { id: 'a', type: 'text', pos: { x: 0, y: 0 }, text: 'first', order: 99 },
        { id: 'b', type: 'text', pos: { x: 1, y: 1 }, text: 'second' },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const migrated = migrate(legacy);

    expect(migrated.nodes.map((n) => n.order)).toEqual([99, 1]);
  });

  it('produces a result that validates against the strict v1 schema', () => {
    const legacy = {
      boardLabel: 'Legacy board',
      nodes: [{ id: 'a', type: 'text', pos: { x: 0, y: 0 }, text: 'first' }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const migrated = migrate(legacy);
    expect(BoardFileSchema.safeParse(migrated).success).toBe(true);
  });

  it('parseBoardFile migrates a legacy board end-to-end', () => {
    const legacy = {
      boardLabel: 'Legacy board',
      nodes: [
        {
          id: 'a',
          type: 'sticky',
          pos: { x: 0, y: 0 },
          size: { width: 200, height: 160 },
          text: 'hi',
          color: '#fef3c7',
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const result = parseBoardFile(legacy);
    expect(result.formatVersion).toBe(1);
    expect(result.nodes[0]?.order).toBe(0);
  });
});

// ── Unsupported future version ───────────────────────────────────────────────

describe('parseBoardFile: unsupported future formatVersion', () => {
  it('throws a clear error naming the unsupported version', () => {
    const future = { ...validBoardFile(), formatVersion: 2 };
    expect(() => parseBoardFile(future)).toThrow(/unsupported.*formatVersion 2/i);
  });

  it('never silently mangles data for an unknown version', () => {
    const future = { ...validBoardFile(), formatVersion: 2 };
    expect(() => migrate(future)).toThrow(/2/);
  });

  it('rejects formatVersion 0 with a validation error rather than treating it as legacy', () => {
    const board = { ...validBoardFile(), formatVersion: 0 };
    expect(() => parseBoardFile(board)).toThrow();
  });

  it('rejects a non-numeric formatVersion with a validation error', () => {
    const board = { ...validBoardFile(), formatVersion: '1' };
    expect(() => parseBoardFile(board)).toThrow();
  });
});

// ── Invalid inputs are rejected with useful errors ──────────────────────────

describe('parseBoardFile: invalid inputs are rejected', () => {
  it('rejects a node id containing a dot', () => {
    const board = validBoardFile();
    board.nodes[1] = { ...board.nodes[1], id: 'bad.id' } as (typeof board.nodes)[1];
    expect(() => parseBoardFile(board)).toThrow();
  });

  it('rejects a node id containing a slash', () => {
    const board = validBoardFile();
    board.nodes[1] = { ...board.nodes[1], id: 'bad/id' } as (typeof board.nodes)[1];
    expect(() => parseBoardFile(board)).toThrow();
  });

  it('rejects a node missing a required field', () => {
    const board = validBoardFile();
    const broken = {
      ...board,
      nodes: [
        {
          id: 'n1',
          type: 'sticky',
          pos: { x: 0, y: 0 },
          order: 0,
          // size missing
          text: 'hello',
          color: '#fef3c7',
        },
      ],
    };
    expect(() => parseBoardFile(broken)).toThrow();
  });

  it('rejects a bad shape enum value', () => {
    const board = validBoardFile();
    const broken = {
      ...board,
      nodes: board.nodes.map((n) => (n.type === 'shape' ? { ...n, shape: 'octagon' } : n)),
    };
    expect(() => parseBoardFile(broken)).toThrow();
  });

  it('rejects a sticky with a non-palette color', () => {
    const board = validBoardFile();
    const broken = {
      ...board,
      nodes: board.nodes.map((n) => (n.type === 'sticky' ? { ...n, color: '#123456' } : n)),
    };
    expect(() => parseBoardFile(broken)).toThrow();
  });

  it('rejects a bad cardinality enum value', () => {
    const board = validBoardFile();
    const broken = {
      ...board,
      edges: board.edges.map((e) => (e.kind === 'cardinality' ? { ...e, cardinality: '2:2' } : e)),
    };
    expect(() => parseBoardFile(broken)).toThrow();
  });

  it('rejects an edge with a bad kind', () => {
    const board = validBoardFile();
    const broken = {
      ...board,
      edges: [{ ...board.edges[0], kind: 'teleport' }],
    };
    expect(() => parseBoardFile(broken)).toThrow();
  });

  it('includes zod issue details in the thrown error message', () => {
    const board = validBoardFile();
    const broken = { ...board, nodes: [{ ...board.nodes[0], color: '#123456' }] };
    try {
      parseBoardFile(broken);
      expect.unreachable('expected parseBoardFile to throw');
    } catch (err) {
      expect(String((err as Error).message)).toMatch(/color/i);
    }
  });
});

// ── safeParseBoardFile ───────────────────────────────────────────────────────

describe('safeParseBoardFile', () => {
  it('returns ok:true with the validated value for valid input', () => {
    const board = validBoardFile();
    const result = safeParseBoardFile(board);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(board);
    }
  });

  it('returns ok:false with a string error for invalid input, without throwing', () => {
    const broken = { ...validBoardFile(), formatVersion: 2 };
    const result = safeParseBoardFile(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/formatVersion 2/i);
    }
  });

  it('returns ok:false for a grammar-violating node id', () => {
    const board = validBoardFile();
    board.nodes[0] = { ...board.nodes[0], id: 'has a space' } as (typeof board.nodes)[0];
    const result = safeParseBoardFile(board);
    expect(result.ok).toBe(false);
  });
});

// ── Edge kind defaulting ─────────────────────────────────────────────────────

describe('BoardEdgeSchema: kind', () => {
  it('validates an arrow-kind edge', () => {
    expect(
      BoardEdgeSchema.safeParse({
        id: 'e1',
        source: 'a',
        target: 'b',
        style: 'solid',
        kind: 'arrow',
        arrow: 'end',
      }).success,
    ).toBe(true);
  });

  it('validates a cardinality-kind edge', () => {
    expect(
      BoardEdgeSchema.safeParse({
        id: 'e2',
        source: 'a',
        target: 'b',
        style: 'dashed',
        kind: 'cardinality',
        cardinality: 'N:N',
      }).success,
    ).toBe(true);
  });

  it("accepts a missing kind (schema allows it; defaulting is the consumer's job)", () => {
    const result = BoardEdgeSchema.safeParse({
      id: 'e3',
      source: 'a',
      target: 'b',
      style: 'solid',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBeUndefined();
    }
  });
});

// ── comments / tags ──────────────────────────────────────────────────────────

describe('parseCommentsFile / parseTagsFile', () => {
  it('validates a well-formed comments file', () => {
    const comments = {
      comments: [
        {
          id: 'c1',
          target: { type: 'node', nodeId: 'n1' },
          author: 'nick',
          createdAt: '2026-01-01T00:00:00.000Z',
          text: 'looks good',
          replies: [],
        },
        {
          id: 'c2',
          target: { type: 'canvas', pos: { x: 5, y: 5 } },
          author: 'nick',
          createdAt: '2026-01-01T00:00:00.000Z',
          text: 'a canvas comment',
          resolved: true,
          replies: [
            { id: 'r1', author: 'ai', createdAt: '2026-01-01T00:01:00.000Z', text: 'reply' },
          ],
        },
      ],
    };
    expect(parseCommentsFile(comments)).toEqual(comments);
    expect(CommentsFileSchema.safeParse(comments).success).toBe(true);
  });

  it('rejects a comment with an invalid target type', () => {
    const bad = {
      comments: [
        {
          id: 'c1',
          target: { type: 'bogus' },
          author: 'nick',
          createdAt: '2026-01-01T00:00:00.000Z',
          text: 'x',
          replies: [],
        },
      ],
    };
    expect(() => parseCommentsFile(bad)).toThrow();
  });

  it('validates a well-formed tags file', () => {
    const tags = { tags: ['alpha', 'beta'] };
    expect(parseTagsFile(tags)).toEqual(tags);
    expect(TagsFileSchema.safeParse(tags).success).toBe(true);
  });

  it('rejects a tags file whose tags are not strings', () => {
    const bad = { tags: [1, 2, 3] };
    expect(() => parseTagsFile(bad)).toThrow();
  });
});
