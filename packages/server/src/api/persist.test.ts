import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard, makeStickyNode, deserialise, type BoardFile } from '@figemite/shared';
import { BoardRepository } from '../repository/board-repo.js';
import { SnapshotHistoryService } from '../services/snapshot-history.js';
import { FileWatcher } from '../services/file-watcher.js';
import { AiSessionManager } from '../services/ai-session.js';
import { persistBoard } from './persist.js';

// Concrete ctx type: the real services (so `.dispose()` etc. are available),
// structurally assignable to `PersistContext` where `persistBoard` needs it.
interface TestCtx {
  repo: BoardRepository;
  history: SnapshotHistoryService;
  watcher: FileWatcher;
  ai: AiSessionManager;
}

let tmpRoot: string;
let ctx: TestCtx;

function makeCtx(root: string): TestCtx {
  return {
    repo: new BoardRepository(root),
    history: new SnapshotHistoryService(root),
    watcher: new FileWatcher({
      boardsRoot: root,
      isLocked: () => false,
      onExternalChange: () => {},
    }),
    ai: new AiSessionManager({ autoEndMs: 60_000 }),
  };
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-persist-'));
  ctx = makeCtx(tmpRoot);
});

afterEach(async () => {
  ctx.watcher.dispose();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function boardWithSticky(): BoardFile {
  return { ...emptyBoard('My Board'), nodes: [makeStickyNode('s1', { x: 0, y: 0 }, '#fef3c7', 0)] };
}

describe('persistBoard', () => {
  it('writes the board through the repo and it reads back canonically', () => {
    ctx.repo.seedBoard('my-board', 'My Board');
    const board = boardWithSticky();
    persistBoard(ctx, 'my-board', [], board, 'save');
    expect(ctx.repo.read('my-board', [])).toEqual(board);
  });

  it('records a snapshot with the given trigger', () => {
    ctx.repo.seedBoard('my-board', 'My Board');
    persistBoard(ctx, 'my-board', [], boardWithSticky(), 'save');
    const snaps = ctx.history.list('my-board', []);
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps.some((s) => s.trigger === 'save')).toBe(true);
  });

  it('leaves the on-disk file always parseable (atomic write via repo)', () => {
    ctx.repo.seedBoard('my-board', 'My Board');
    persistBoard(ctx, 'my-board', [], boardWithSticky(), 'save');
    const raw = fsSync.readFileSync(path.join(tmpRoot, 'my-board', 'board.json'), 'utf-8');
    expect(() => deserialise(raw)).not.toThrow();
  });

  it('suppresses the watcher for the written key so the write is not seen as external', () => {
    ctx.repo.seedBoard('my-board', 'My Board');
    let suppressed: string | null = null;
    // Wrap suppress to observe it was called with the right key.
    const originalSuppress = ctx.watcher.suppress.bind(ctx.watcher);
    ctx.watcher.suppress = (slug: string, subPath: string[]) => {
      suppressed = `${slug}|${subPath.join('.')}`;
      originalSuppress(slug, subPath);
    };
    persistBoard(ctx, 'my-board', [], boardWithSticky(), 'save');
    expect(suppressed).toBe('my-board|');
  });

  it('persists a sub-board at a dotted path', () => {
    ctx.repo.seedBoard('my-board', 'My Board');
    const sub = {
      ...emptyBoard('Child'),
      nodes: [makeStickyNode('s1', { x: 1, y: 2 }, '#fef3c7', 0)],
    };
    persistBoard(ctx, 'my-board', ['Node1'], sub, 'ai');
    expect(ctx.repo.read('my-board', ['Node1'])).toEqual(sub);
    expect(ctx.history.list('my-board', ['Node1']).some((s) => s.trigger === 'ai')).toBe(true);
  });
});
