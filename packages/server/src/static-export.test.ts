// ── buildStaticBoards tests ──────────────────────────────────────────────────
//
// Seeds boards via BoardRepository (+ writeComments/writeTags for the repo-
// managed sidecar files) and asserts the exported static bundle matches what
// the original prototype `scripts/build-static.mjs` produced: per-board copies
// of board.json/board.<segs>.json/comments.json/tags.json, plus a top-level
// boards/index.json manifest.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard, makeStickyNode, serialise, type BoardFile } from '@figemite/shared';
import { BoardRepository } from './repository/board-repo.js';
import { writeComments } from './repository/comments-repo.js';
import { writeTags } from './repository/tags-repo.js';
import { buildStaticBoards } from './static-export.js';

interface BoardManifestEntry {
  slug: string;
  label: string;
  tags: string[];
  subBoardPaths: string[][];
  lastModifiedMs: number;
}

let boardsRoot: string;
let outDir: string;
let repo: BoardRepository;

beforeEach(async () => {
  boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-static-export-src-'));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-static-export-out-'));
  repo = new BoardRepository(boardsRoot);
});

afterEach(async () => {
  await fs.rm(boardsRoot, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});

async function readJson(p: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(p, 'utf-8'));
}

describe('buildStaticBoards', () => {
  it('copies a simple board.json into <outDir>/boards/<slug>/board.json', async () => {
    repo.seedBoard('simple-board', 'Simple Board');

    await buildStaticBoards(boardsRoot, outDir);

    const exported = (await readJson(
      path.join(outDir, 'boards', 'simple-board', 'board.json'),
    )) as BoardFile;
    expect(exported).toEqual(emptyBoard('Simple Board'));
  });

  it('copies a sub-board file alongside the root board', async () => {
    repo.seedBoard('with-sub', 'With Sub');
    const sub: BoardFile = {
      ...emptyBoard('Sub'),
      nodes: [makeStickyNode('s1', { x: 1, y: 2 }, '#fff', 0)],
    };
    repo.write('with-sub', ['frame1'], sub);

    await buildStaticBoards(boardsRoot, outDir);

    const exportedSub = (await readJson(
      path.join(outDir, 'boards', 'with-sub', 'board.frame1.json'),
    )) as BoardFile;
    expect(exportedSub).toEqual(sub);
  });

  it('copies comments.json when present', async () => {
    repo.seedBoard('with-comments', 'With Comments');
    writeComments(boardsRoot, 'with-comments', {
      comments: [
        {
          id: 'c1',
          target: { type: 'node', nodeId: 's1' },
          author: 'nick',
          createdAt: new Date(0).toISOString(),
          text: 'hello',
          resolved: false,
          replies: [],
        },
      ],
    });

    await buildStaticBoards(boardsRoot, outDir);

    const exported = (await readJson(
      path.join(outDir, 'boards', 'with-comments', 'comments.json'),
    )) as { comments: unknown[] };
    expect(exported.comments).toHaveLength(1);
  });

  it('writes an empty comments.json when the board has none', async () => {
    repo.seedBoard('no-comments', 'No Comments');

    await buildStaticBoards(boardsRoot, outDir);

    const exported = (await readJson(
      path.join(outDir, 'boards', 'no-comments', 'comments.json'),
    )) as { comments: unknown[] };
    expect(exported).toEqual({ comments: [] });
  });

  it('copies tags.json when present', async () => {
    repo.seedBoard('with-tags', 'With Tags');
    writeTags(boardsRoot, 'with-tags', { tags: ['alpha', 'beta'] });

    await buildStaticBoards(boardsRoot, outDir);

    const exported = (await readJson(path.join(outDir, 'boards', 'with-tags', 'tags.json'))) as {
      tags: string[];
    };
    expect(exported.tags).toEqual(['alpha', 'beta']);
  });

  it('writes an empty tags.json when the board has none', async () => {
    repo.seedBoard('no-tags', 'No Tags');

    await buildStaticBoards(boardsRoot, outDir);

    const exported = (await readJson(path.join(outDir, 'boards', 'no-tags', 'tags.json'))) as {
      tags: string[];
    };
    expect(exported).toEqual({ tags: [] });
  });

  it('generates boards/index.json listing every board with label, tags, subBoardPaths, lastModifiedMs', async () => {
    repo.seedBoard('board-one', 'Board One');
    writeTags(boardsRoot, 'board-one', { tags: ['x'] });

    repo.seedBoard('board-two', 'Board Two');
    repo.write('board-two', ['frameA'], emptyBoard('Frame A'));
    repo.write('board-two', ['frameA', 'inner'], emptyBoard('Inner'));

    await buildStaticBoards(boardsRoot, outDir);

    const manifest = (await readJson(path.join(outDir, 'boards', 'index.json'))) as {
      boards: BoardManifestEntry[];
    };
    expect(manifest.boards).toHaveLength(2);

    const one = manifest.boards.find((b) => b.slug === 'board-one');
    expect(one).toBeDefined();
    expect(one!.label).toBe('Board One');
    expect(one!.tags).toEqual(['x']);
    expect(one!.subBoardPaths).toEqual([]);
    expect(one!.lastModifiedMs).toBeGreaterThan(0);

    const two = manifest.boards.find((b) => b.slug === 'board-two');
    expect(two).toBeDefined();
    expect(two!.label).toBe('Board Two');
    expect(two!.tags).toEqual([]);
    expect(two!.subBoardPaths).toEqual(expect.arrayContaining([['frameA'], ['frameA', 'inner']]));
  });

  it('falls back to a title-cased slug label when the root board is corrupt/unreadable', async () => {
    await fs.mkdir(path.join(boardsRoot, 'weird-slug'), { recursive: true });
    await fs.writeFile(path.join(boardsRoot, 'weird-slug', 'board.json'), 'not json', 'utf-8');

    await buildStaticBoards(boardsRoot, outDir);

    const manifest = (await readJson(path.join(outDir, 'boards', 'index.json'))) as {
      boards: BoardManifestEntry[];
    };
    const entry = manifest.boards.find((b) => b.slug === 'weird-slug');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Weird Slug');
  });

  it('produces an empty manifest for an empty boardsRoot', async () => {
    await buildStaticBoards(boardsRoot, outDir);
    const manifest = (await readJson(path.join(outDir, 'boards', 'index.json'))) as {
      boards: BoardManifestEntry[];
    };
    expect(manifest.boards).toEqual([]);
  });

  it('produces canonically-serialised board JSON (round-trips through @figemite/shared)', async () => {
    repo.seedBoard('canon', 'Canon');
    await buildStaticBoards(boardsRoot, outDir);
    const raw = await fs.readFile(path.join(outDir, 'boards', 'canon', 'board.json'), 'utf-8');
    expect(raw).toBe(serialise(emptyBoard('Canon')));
  });
});
