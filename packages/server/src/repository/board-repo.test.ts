import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard, makeStickyNode, type BoardFile } from '@easel/shared';
import { BoardRepository } from './board-repo.js';

let tmpRoot: string;
let repo: BoardRepository;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-board-repo-'));
  repo = new BoardRepository(tmpRoot);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function boardWithContent(): BoardFile {
  const board = emptyBoard('My Board');
  return {
    ...board,
    nodes: [makeStickyNode('s1', { x: 10, y: 20 }, '#fef3c7', 0)],
    edges: [],
  };
}

// ── seed + round-trip ────────────────────────────────────────────────────────

describe('seedBoard + read round-trip', () => {
  it('seeds a board and reads back an empty board with the given label', () => {
    repo.seedBoard('my-board', 'My Board');
    const board = repo.read('my-board');
    expect(board).toEqual(emptyBoard('My Board'));
  });

  it('seeding creates the board directory and a valid JSON file on disk', () => {
    repo.seedBoard('my-board', 'My Board');
    const filePath = path.join(tmpRoot, 'my-board', 'board.json');
    const raw = fsSync.readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('write + read round-trip', () => {
  it('writes a board with nodes/edges and reads it back deep-equal after canonical round-trip', () => {
    repo.seedBoard('my-board', 'My Board');
    const board = boardWithContent();
    repo.write('my-board', [], board);
    const readBack = repo.read('my-board');
    expect(readBack).toEqual(board);
  });

  it('the file on disk is valid JSON', () => {
    repo.seedBoard('my-board', 'My Board');
    repo.write('my-board', [], boardWithContent());
    const filePath = path.join(tmpRoot, 'my-board', 'board.json');
    const raw = fsSync.readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('creates parent directories as needed', () => {
    // No seedBoard call — write() itself must create <boardsRoot>/<slug>/.
    repo.write('fresh-board', [], emptyBoard('Fresh'));
    const readBack = repo.read('fresh-board');
    expect(readBack).toEqual(emptyBoard('Fresh'));
  });
});

// ── sub-boards ───────────────────────────────────────────────────────────────

describe('sub-boards', () => {
  beforeEach(() => {
    repo.seedBoard('my-board', 'My Board');
    repo.write('my-board', ['frame1'], emptyBoard('Frame 1'));
    repo.write('my-board', ['frame1', 'inner1'], emptyBoard('Inner 1'));
  });

  it('listSubBoardPaths returns both sub-board paths as segment arrays', () => {
    const paths = repo.listSubBoardPaths('my-board');
    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(['frame1']);
    expect(paths).toContainEqual(['frame1', 'inner1']);
  });

  it('reads each sub-board independently', () => {
    expect(repo.read('my-board', ['frame1'])).toEqual(emptyBoard('Frame 1'));
    expect(repo.read('my-board', ['frame1', 'inner1'])).toEqual(emptyBoard('Inner 1'));
  });

  it('delete of a sub-board removes it and its descendant sub-boards', () => {
    repo.delete('my-board', ['frame1']);
    expect(repo.exists('my-board', ['frame1'])).toBe(false);
    expect(repo.exists('my-board', ['frame1', 'inner1'])).toBe(false);
    // Root board is untouched.
    expect(repo.exists('my-board', [])).toBe(true);
  });

  it('does not delete a sibling sub-board with a similar but distinct name', () => {
    repo.write('my-board', ['frame1x'], emptyBoard('Frame1x'));
    repo.delete('my-board', ['frame1']);
    expect(repo.exists('my-board', ['frame1x'])).toBe(true);
  });

  it('deleting the root board clears the whole board directory', () => {
    repo.delete('my-board', []);
    const boardDir = path.join(tmpRoot, 'my-board');
    expect(fsSync.existsSync(boardDir)).toBe(false);
  });
});

// ── listSlugs / exists / extractBoardLabel ──────────────────────────────────

describe('listSlugs', () => {
  it('returns all seeded board slugs', () => {
    repo.seedBoard('board-a', 'Board A');
    repo.seedBoard('board-b', 'Board B');
    expect(repo.listSlugs().sort()).toEqual(['board-a', 'board-b']);
  });

  it('returns an empty array when boardsRoot has no boards', () => {
    expect(repo.listSlugs()).toEqual([]);
  });
});

describe('exists', () => {
  it('is true for a seeded root board', () => {
    repo.seedBoard('my-board', 'My Board');
    expect(repo.exists('my-board', [])).toBe(true);
  });

  it('is false for a board that was never created', () => {
    expect(repo.exists('never-created', [])).toBe(false);
  });
});

describe('extractBoardLabel', () => {
  it("returns the root board's boardLabel", () => {
    repo.seedBoard('my-board', 'My Cool Board');
    expect(repo.extractBoardLabel('my-board')).toBe('My Cool Board');
  });
});

// ── hostile input: path-traversal defense ───────────────────────────────────

describe('hostile input rejection', () => {
  const hostileSlugs = [
    ['contains a dot', 'my.board'],
    ['contains a slash', 'my/board'],
    ['contains a backslash', 'my\\board'],
    ['is a parent-dir traversal', '..'],
    ['has a leading slash', '/etc'],
    ['is empty', ''],
    ['contains a NUL byte', 'my\0board'],
  ] as const;

  it.each(hostileSlugs)('read throws for a slug that %s', (_desc, slug) => {
    expect(() => repo.read(slug)).toThrow();
  });

  it.each(hostileSlugs)('write throws for a slug that %s', (_desc, slug) => {
    expect(() => repo.write(slug, [], emptyBoard('x'))).toThrow();
  });

  it.each(hostileSlugs)('delete throws for a slug that %s', (_desc, slug) => {
    expect(() => repo.delete(slug, ['frame1'])).toThrow();
  });

  const hostileSegments = [
    ['contains a dot', 'frame.1'],
    ['contains a slash', 'frame/1'],
    ['contains a backslash', 'frame\\1'],
    ['is a parent-dir traversal', '..'],
    ['has a leading slash', '/frame1'],
    ['is empty', ''],
    ['contains a NUL byte', 'frame\0'],
  ] as const;

  it.each(hostileSegments)('read throws for a sub-path segment that %s', (_desc, segment) => {
    repo.seedBoard('my-board', 'My Board');
    expect(() => repo.read('my-board', [segment])).toThrow();
  });

  it.each(hostileSegments)('write throws for a sub-path segment that %s', (_desc, segment) => {
    repo.seedBoard('my-board', 'My Board');
    expect(() => repo.write('my-board', [segment], emptyBoard('x'))).toThrow();
  });

  it('rejects a classic ../../etc/passwd style sub-path attempt on read', () => {
    repo.seedBoard('my-board', 'My Board');
    expect(() => repo.read('my-board', ['..', '..', 'etc', 'passwd'])).toThrow();
  });

  it('rejects a classic ../../etc/passwd style sub-path attempt on write', () => {
    repo.seedBoard('my-board', 'My Board');
    expect(() => repo.write('my-board', ['..', '..', 'etc', 'passwd'], emptyBoard('x'))).toThrow();
    // Assert nothing was created outside the temp root.
    const escapedTarget = path.resolve(tmpRoot, '..', '..', 'etc', 'passwd.json');
    expect(fsSync.existsSync(escapedTarget)).toBe(false);
  });

  it('rejects a classic ../../etc/passwd style sub-path attempt on delete', () => {
    repo.seedBoard('my-board', 'My Board');
    expect(() => repo.delete('my-board', ['..', '..', 'etc', 'passwd'])).toThrow();
  });

  it('never creates a file outside boardsRoot for a traversal slug write attempt', () => {
    const outsideDir = path.join(path.dirname(tmpRoot), 'escaped-board-dir');
    expect(() => repo.write('../escaped-board-dir', [], emptyBoard('x'))).toThrow();
    expect(fsSync.existsSync(outsideDir)).toBe(false);
  });

  it('never reads a file outside boardsRoot for a traversal slug read attempt', () => {
    // Plant a real file just outside the boards root to prove a traversal
    // read wouldn't merely fail to find something — it must never even
    // resolve there.
    const outsideFile = path.join(path.dirname(tmpRoot), 'outside-secret.json');
    fsSync.writeFileSync(outsideFile, JSON.stringify({ secret: true }));
    try {
      expect(() => repo.read('..', [path.basename(tmpRoot)])).toThrow();
    } finally {
      fsSync.rmSync(outsideFile, { force: true });
    }
  });
});

// ── fs edge cases ────────────────────────────────────────────────────────────

describe('fs edge cases', () => {
  it('read of a missing board throws a distinct "not found" error', () => {
    expect(() => repo.read('does-not-exist')).toThrowError(/not found/i);
  });

  it('read of corrupt/truncated JSON throws (never crashes, never returns junk)', () => {
    const boardDir = path.join(tmpRoot, 'broken-board');
    fsSync.mkdirSync(boardDir, { recursive: true });
    fsSync.writeFileSync(path.join(boardDir, 'board.json'), '{ "nodes": [ this is not json');
    expect(() => repo.read('broken-board')).toThrow();
  });

  it('read of a schema-invalid board throws', () => {
    const boardDir = path.join(tmpRoot, 'invalid-board');
    fsSync.mkdirSync(boardDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(boardDir, 'board.json'),
      JSON.stringify({ formatVersion: 1, boardLabel: 123, nodes: 'not-an-array' }),
    );
    expect(() => repo.read('invalid-board')).toThrow();
  });

  it('the "not found" error is distinguishable from the invalid-JSON error', () => {
    const boardDir = path.join(tmpRoot, 'broken-board');
    fsSync.mkdirSync(boardDir, { recursive: true });
    fsSync.writeFileSync(path.join(boardDir, 'board.json'), 'not json at all');

    let missingErr: unknown;
    try {
      repo.read('does-not-exist');
    } catch (err) {
      missingErr = err;
    }
    let corruptErr: unknown;
    try {
      repo.read('broken-board');
    } catch (err) {
      corruptErr = err;
    }
    expect(missingErr).toBeInstanceOf(Error);
    expect(corruptErr).toBeInstanceOf(Error);
    expect((missingErr as Error).message).not.toEqual((corruptErr as Error).message);
  });
});

// ── atomicity ─────────────────────────────────────────────────────────────

describe('atomic write', () => {
  it('leaves the target file always-parseable and removes the temp file after overwriting', () => {
    repo.seedBoard('my-board', 'My Board');
    repo.write('my-board', [], boardWithContent());

    const boardDir = path.join(tmpRoot, 'my-board');
    const entries = fsSync.readdirSync(boardDir);
    // Only board.json should remain — no leftover temp file.
    expect(entries).toEqual(['board.json']);

    const raw = fsSync.readFileSync(path.join(boardDir, 'board.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
