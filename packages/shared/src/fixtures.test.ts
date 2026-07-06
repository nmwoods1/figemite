// ── Fixture validation ───────────────────────────────────────────────────────
//
// Golden-master synthetic fixtures live in the repo-root `fixtures/` dir (see
// fixtures/kitchen-sink, fixtures/minimal, fixtures/legacy-v0). This test is
// the guard that keeps them honest:
//
//   - every board.json / board.*.json deserialises (validates + migrates),
//     round-trips through serialise/deserialise, and is canonically
//     idempotent;
//   - the legacy-v0 fixture specifically proves migration upgrades a v0 file
//     (no formatVersion, no per-node order) to v1;
//   - every comments.json / tags.json parses;
//   - the kitchen-sink board is asserted to cover every node type, every
//     shape kind, and both edge kinds, so the fixture can't silently be
//     trimmed without this test failing.
//
// All fixture content is synthetic placeholder data — never copy real board
// content here (see fixtures/README-equivalent notes in the task description).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserialise, serialise } from './board-io.js';
import { parseCommentsFile, parseTagsFile } from './model/schema.js';
import { SHAPE_KINDS } from './model/constants.js';
import type { BoardNode, EdgeKind } from './model/board.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/shared/src -> repo root is three levels up.
const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures');

// ── Directory walking ────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(FIXTURES_DIR);

const boardFiles = allFiles.filter((f) => /(^|\/)board(\.[^/]+)?\.json$/.test(f)).sort();

const commentsFiles = allFiles.filter((f) => f.endsWith('comments.json')).sort();
const tagsFiles = allFiles.filter((f) => f.endsWith('tags.json')).sort();

function rel(f: string): string {
  return f.slice(FIXTURES_DIR.length + 1);
}

// Sanity check on the walker itself: fail loudly (not silently pass 0 tests)
// if the fixtures directory is empty or missing entirely.
describe('fixtures directory sanity', () => {
  it('found the expected fixture board files', () => {
    expect(boardFiles.length).toBeGreaterThanOrEqual(5);
    expect(commentsFiles.length).toBeGreaterThanOrEqual(2);
    expect(tagsFiles.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Every board.json / board.*.json ─────────────────────────────────────────

describe('every fixture board file', () => {
  for (const file of boardFiles) {
    describe(rel(file), () => {
      const raw = readFileSync(file, 'utf8');

      it('deserialises (validates + migrates) successfully', () => {
        expect(() => deserialise(raw)).not.toThrow();
      });

      it('passes as a valid BoardFile', () => {
        const board = deserialise(raw);
        expect(board.formatVersion).toBe(1);
        expect(typeof board.boardLabel).toBe('string');
        expect(Array.isArray(board.nodes)).toBe(true);
        expect(Array.isArray(board.edges)).toBe(true);
      });

      it('canonical serialisation is idempotent', () => {
        const once = serialise(deserialise(raw));
        const twice = serialise(deserialise(once));
        expect(twice).toBe(once);
      });
    });
  }
});

// ── legacy-v0 migration proof ────────────────────────────────────────────────

describe('legacy-v0 fixture', () => {
  const file = boardFiles.find((f) => f.includes('legacy-v0'));

  it('exists', () => {
    expect(file).toBeDefined();
  });

  it('has no formatVersion and no per-node order in its raw form', () => {
    const raw = JSON.parse(readFileSync(file!, 'utf8')) as Record<string, unknown>;
    expect(raw.formatVersion).toBeUndefined();
    const nodes = raw.nodes as Record<string, unknown>[];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect('order' in node).toBe(false);
    }
  });

  it('deserialise stamps formatVersion === 1 and assigns order to every node', () => {
    const raw = readFileSync(file!, 'utf8');
    const board = deserialise(raw);
    expect(board.formatVersion).toBe(1);
    for (const node of board.nodes) {
      expect(typeof node.order).toBe('number');
    }
    // order assigned from array index, per the migration contract.
    const rawNodes = (JSON.parse(raw) as { nodes: unknown[] }).nodes;
    board.nodes.forEach((node, i) => {
      expect(node.order).toBe(i);
      expect(node.id).toBe((rawNodes[i] as { id: string }).id);
    });
  });

  it('has 2-3 nodes and at least one edge', () => {
    const board = deserialise(readFileSync(file!, 'utf8'));
    expect(board.nodes.length).toBeGreaterThanOrEqual(2);
    expect(board.nodes.length).toBeLessThanOrEqual(3);
    expect(board.edges.length).toBeGreaterThanOrEqual(1);
  });
});

// ── comments.json / tags.json ────────────────────────────────────────────────

describe('every fixture comments.json', () => {
  for (const file of commentsFiles) {
    it(`${rel(file)} parses via parseCommentsFile`, () => {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      expect(() => parseCommentsFile(raw)).not.toThrow();
    });
  }
});

describe('every fixture tags.json', () => {
  for (const file of tagsFiles) {
    it(`${rel(file)} parses via parseTagsFile`, () => {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      expect(() => parseTagsFile(raw)).not.toThrow();
    });
  }
});

// ── kitchen-sink coverage guard ──────────────────────────────────────────────
//
// If someone trims the kitchen-sink fixture, this suite fails — it's the
// self-guarding mechanism the task calls for.

describe('kitchen-sink board coverage', () => {
  const file = boardFiles.find((f) => /kitchen-sink\/board\.json$/.test(f));
  const board = deserialise(readFileSync(file!, 'utf8'));

  it('contains all 7 node types', () => {
    const types = new Set(board.nodes.map((n: BoardNode) => n.type));
    const expected = ['sticky', 'text', 'shape', 'frame', 'emoji', 'icon', 'drawing'];
    for (const t of expected) {
      expect(types.has(t as BoardNode['type'])).toBe(true);
    }
    expect(types.size).toBe(expected.length);
  });

  it('contains all 12 shape kinds', () => {
    const shapeKinds = new Set(
      board.nodes
        .filter((n): n is Extract<BoardNode, { type: 'shape' }> => n.type === 'shape')
        .map((n) => n.shape),
    );
    for (const kind of SHAPE_KINDS) {
      expect(shapeKinds.has(kind)).toBe(true);
    }
    expect(shapeKinds.size).toBe(SHAPE_KINDS.length);
  });

  it('contains both edge kinds (arrow and cardinality)', () => {
    const kinds = new Set(board.edges.map((e) => (e.kind ?? 'arrow') as EdgeKind));
    expect(kinds.has('arrow')).toBe(true);
    expect(kinds.has('cardinality')).toBe(true);
  });

  it('contains all four cardinality variants', () => {
    const cardinalities = new Set(
      board.edges.filter((e) => e.kind === 'cardinality').map((e) => e.cardinality),
    );
    expect(cardinalities).toEqual(new Set(['1:1', '1:N', 'N:1', 'N:N']));
  });

  it('contains all three arrow styles (none, end, both)', () => {
    const arrowStyles = new Set(
      board.edges.filter((e) => (e.kind ?? 'arrow') === 'arrow').map((e) => e.arrow),
    );
    expect(arrowStyles).toEqual(new Set(['none', 'end', 'both']));
  });

  it('has at least one rotated node', () => {
    const rotated = board.nodes.some(
      (n) => 'rotation' in n && typeof n.rotation === 'number' && n.rotation !== undefined,
    );
    expect(rotated).toBe(true);
  });

  it('has at least one node with a description', () => {
    expect(board.nodes.some((n) => n.description !== undefined)).toBe(true);
  });

  it('has a drawing node with several points', () => {
    const drawing = board.nodes.find(
      (n): n is Extract<BoardNode, { type: 'drawing' }> => n.type === 'drawing',
    );
    expect(drawing).toBeDefined();
    expect(drawing!.points.length).toBeGreaterThanOrEqual(3);
  });

  it('has edges with labels and with source/target handles', () => {
    expect(board.edges.some((e) => e.label !== undefined)).toBe(true);
    expect(
      board.edges.some((e) => e.sourceHandle !== undefined || e.targetHandle !== undefined),
    ).toBe(true);
  });

  it('has both dashed and solid edge styles', () => {
    const styles = new Set(board.edges.map((e) => e.style));
    expect(styles).toEqual(new Set(['solid', 'dashed']));
  });
});

describe('kitchen-sink sub-boards (dotted-path encoding)', () => {
  it('has a sub-board file for frame1', () => {
    expect(boardFiles.some((f) => /kitchen-sink\/board\.frame1\.json$/.test(f))).toBe(true);
  });

  it('has a nested sub-board file for frame1.inner1', () => {
    expect(boardFiles.some((f) => /kitchen-sink\/board\.frame1\.inner1\.json$/.test(f))).toBe(true);
  });
});
