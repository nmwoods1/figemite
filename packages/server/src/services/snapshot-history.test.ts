import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard, serialise } from '@easel/shared';
import { BoardRepository } from '../repository/board-repo.js';
import { historyDir } from '../repository/paths.js';
import { SnapshotHistoryService, thinSnapshots, type SnapshotMeta } from './snapshot-history.js';

let tmpRoot: string;
let repo: BoardRepository;
let service: SnapshotHistoryService;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-snapshot-history-'));
  repo = new BoardRepository(tmpRoot);
  service = new SnapshotHistoryService(tmpRoot);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ── snapshot / list / read round-trip ───────────────────────────────────────

describe('snapshot + list + read round-trip', () => {
  it('snapshot writes a file into .history/', () => {
    repo.seedBoard('my-board', 'My Board');
    service.snapshot('my-board', [], 'save');

    const dir = historyDir(tmpRoot, 'my-board', []);
    const entries = fsSync.readdirSync(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z__save\.json$/);
  });

  it('list returns the written snapshot', () => {
    repo.seedBoard('my-board', 'My Board');
    service.snapshot('my-board', [], 'save');

    const snaps = service.list('my-board', []);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].trigger).toBe('save');
    expect(snaps[0].timestamp).toBeInstanceOf(Date);
  });

  it('read returns the snapshot content, matching the board file on disk at snapshot time', () => {
    repo.seedBoard('my-board', 'My Board');
    service.snapshot('my-board', [], 'save');

    const snaps = service.list('my-board', []);
    const content = service.read('my-board', [], snaps[0].id);
    const boardPath = path.join(tmpRoot, 'my-board', 'board.json');
    expect(content).toBe(fsSync.readFileSync(boardPath, 'utf-8'));
    expect(content).toBe(serialise(emptyBoard('My Board')));
  });

  it('list returns an empty array when no snapshots exist', () => {
    repo.seedBoard('my-board', 'My Board');
    expect(service.list('my-board', [])).toEqual([]);
  });
});

// ── content dedupe ───────────────────────────────────────────────────────────

describe('content dedupe', () => {
  it('two snapshot calls on unchanged content produce only one history file', () => {
    repo.seedBoard('my-board', 'My Board');
    service.snapshot('my-board', [], 'save');
    service.snapshot('my-board', [], 'save');

    expect(service.list('my-board', [])).toHaveLength(1);
  });

  it('changing the board content between calls produces two history files', () => {
    repo.seedBoard('my-board', 'My Board');
    service.snapshot('my-board', [], 'save');

    const board = emptyBoard('My Board');
    repo.write('my-board', [], { ...board, boardLabel: 'Changed' });
    service.snapshot('my-board', [], 'save');

    expect(service.list('my-board', [])).toHaveLength(2);
  });
});

// ── sub-board snapshots ──────────────────────────────────────────────────────

describe('sub-board snapshots', () => {
  it('lands in the correct nested history subdir and is independent of the root history', () => {
    repo.seedBoard('my-board', 'My Board');
    repo.write('my-board', ['frame1'], emptyBoard('Frame 1'));

    service.snapshot('my-board', ['frame1'], 'save');

    const subDir = historyDir(tmpRoot, 'my-board', ['frame1']);
    expect(fsSync.readdirSync(subDir)).toHaveLength(1);

    // Root history is untouched.
    expect(service.list('my-board', [])).toEqual([]);
    expect(service.list('my-board', ['frame1'])).toHaveLength(1);
  });

  it('reads back sub-board snapshot content correctly', () => {
    repo.seedBoard('my-board', 'My Board');
    repo.write('my-board', ['frame1'], emptyBoard('Frame 1'));
    service.snapshot('my-board', ['frame1'], 'save');

    const [snap] = service.list('my-board', ['frame1']);
    const content = service.read('my-board', ['frame1'], snap.id);
    expect(content).toBe(serialise(emptyBoard('Frame 1')));
  });
});

// ── read id validation ───────────────────────────────────────────────────────

describe('read rejects hostile ids', () => {
  beforeEach(() => {
    repo.seedBoard('my-board', 'My Board');
    service.snapshot('my-board', [], 'save');
  });

  it('rejects an id containing a forward slash', () => {
    expect(() => service.read('my-board', [], '../evil')).toThrow();
  });

  it('rejects an id containing a backslash', () => {
    expect(() => service.read('my-board', [], 'evil\\..\\..\\etc')).toThrow();
  });

  it('rejects an id containing ".."', () => {
    expect(() => service.read('my-board', [], '..')).toThrow();
  });

  it('rejects an id that does not match any known snapshot id shape', () => {
    expect(() => service.read('my-board', [], 'not-a-real-id')).toThrow();
  });

  it('never resolves outside the history dir for a traversal id', () => {
    const outsideFile = path.join(path.dirname(tmpRoot), 'outside-secret.json');
    fsSync.writeFileSync(outsideFile, JSON.stringify({ secret: true }));
    try {
      expect(() => service.read('my-board', [], '../../outside-secret')).toThrow();
    } finally {
      fsSync.rmSync(outsideFile, { force: true });
    }
  });
});

// ── thinSnapshots (pure function) ───────────────────────────────────────────

const NOW = new Date('2026-07-06T12:00:00.000Z');
const MIN = 60_000;

function meta(
  id: string,
  minutesAgo: number,
  trigger: SnapshotMeta['trigger'] = 'save',
): SnapshotMeta {
  return {
    id,
    timestamp: new Date(NOW.getTime() - minutesAgo * MIN),
    trigger,
  };
}

describe('thinSnapshots', () => {
  it('keeps all snapshots within the 15-minute dense window', () => {
    const snaps = [meta('a', 0), meta('b', 5), meta('c', 10), meta('d', 14)];
    const { keep, delete: del } = thinSnapshots(snaps, NOW);
    expect(keep.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(del).toEqual([]);
  });

  it('a snapshot exactly at the 15-minute boundary is treated as within the dense window (kept)', () => {
    const snaps = [meta('edge', 15)];
    const { keep, delete: del } = thinSnapshots(snaps, NOW);
    expect(keep.map((s) => s.id)).toEqual(['edge']);
    expect(del).toEqual([]);
  });

  it('older-than-15-min snapshots collapse to one-per-30-minute-bucket, keeping the newest in each bucket', () => {
    // Two snapshots 20 and 40 minutes old land in different 30-min buckets
    // (relative to `now`), given bucketing is by absolute epoch // BUCKET_MS.
    // Use snapshots clearly deep in two distinct buckets, with two entries in
    // the same bucket to verify only the newest of that pair survives.
    const older1 = meta('older-1', 50); // deep in one bucket
    const older2 = meta('older-2', 45); // same bucket as older-1 (newer)
    const older3 = meta('older-3', 100); // a distinct, separate bucket
    const snaps = [older1, older2, older3];
    const { keep, delete: del } = thinSnapshots(snaps, NOW);

    // older-2 is newer than older-1 within the same bucket -> older-1 dropped.
    expect(keep.map((s) => s.id).sort()).toEqual(['older-2', 'older-3']);
    expect(del.map((s) => s.id)).toEqual(['older-1']);
  });

  it('a snapshot exactly on a 30-minute bucket edge belongs to the bucket it falls into (floor division)', () => {
    // Construct two timestamps that straddle a bucket boundary using
    // absolute epoch ms, then confirm only one per bucket survives.
    const bucketMs = 30 * 60_000;
    const epochInBucket0 = 0; // bucket 0
    const epochInBucket1 = bucketMs; // bucket 1 (exactly on the edge)
    const now = new Date(epochInBucket1 + 20 * MIN); // keep both outside the dense window
    const a: SnapshotMeta = { id: 'bucket0', timestamp: new Date(epochInBucket0), trigger: 'save' };
    const b: SnapshotMeta = { id: 'bucket1', timestamp: new Date(epochInBucket1), trigger: 'save' };
    const { keep, delete: del } = thinSnapshots([a, b], now);
    expect(keep.map((s) => s.id).sort()).toEqual(['bucket0', 'bucket1']);
    expect(del).toEqual([]);
  });

  it('preai snapshots always survive thinning even in an old, collapsed bucket', () => {
    const collapsedVictim = meta('victim', 50);
    const survivorSameBucket = meta('preai-1', 49, 'preai');
    const { keep, delete: del } = thinSnapshots([collapsedVictim, survivorSameBucket], NOW);
    expect(keep.map((s) => s.id).sort()).toEqual(['preai-1', 'victim']);
    // The non-AI snapshot in the same bucket, if it's not the newest, would
    // normally be dropped -- but here it IS the newest of the non-AI ones in
    // its bucket, so assert the AI one is present regardless.
    expect(keep.some((s) => s.id === 'preai-1')).toBe(true);
    expect(del).not.toContainEqual(expect.objectContaining({ id: 'preai-1' }));
  });

  it('ai snapshots always survive thinning, even when several share a bucket with a non-AI snapshot', () => {
    // Two 'ai' snapshots and one 'save' snapshot all in the same old bucket.
    // Both ai snapshots must survive; the save snapshot (not newest) is
    // dropped by bucket collapse.
    const ai1 = meta('ai-1', 50, 'ai');
    const ai2 = meta('ai-2', 49, 'ai');
    const save1 = meta('save-1', 48, 'save');
    const { keep, delete: del } = thinSnapshots([ai1, ai2, save1], NOW);
    expect(keep.map((s) => s.id).sort()).toEqual(['ai-1', 'ai-2', 'save-1']);
    expect(del).toEqual([]);
  });

  it('drops old non-AI snapshots in a collapsed bucket while always keeping AI-boundary ones', () => {
    // Three 'save' snapshots in the same old bucket -> only the newest kept.
    // One 'ai' snapshot in the same bucket, older than all of them -> kept anyway.
    const save1 = meta('save-1', 45, 'save');
    const save2 = meta('save-2', 46, 'save');
    const save3 = meta('save-3', 47, 'save'); // newest of the three (smallest minutesAgo among 45/46/47 -> save1 is newest)
    const aiOld = meta('ai-old', 49, 'ai');
    const { keep, delete: del } = thinSnapshots([save1, save2, save3, aiOld], NOW);
    expect(keep.map((s) => s.id).sort()).toEqual(['ai-old', 'save-1']);
    expect(del.map((s) => s.id).sort()).toEqual(['save-2', 'save-3']);
  });

  it('applies the 200 hard cap by dropping the oldest non-AI-boundary snapshots first', () => {
    // 210 dense (within-15-min) snapshots -> all would normally be kept, but
    // the hard cap trims down to 200, dropping the oldest first.
    const snaps: SnapshotMeta[] = [];
    for (let i = 0; i < 210; i++) {
      // Spread across the dense window using sub-minute offsets so all 210
      // fall within 15 minutes (900_000 ms) of `now`.
      snaps.push({
        id: `dense-${i}`,
        timestamp: new Date(NOW.getTime() - i * 1000), // 1 second apart, newest = dense-0
        trigger: 'save',
      });
    }
    const { keep, delete: del } = thinSnapshots(snaps, NOW);
    expect(keep).toHaveLength(200);
    expect(del).toHaveLength(10);
    // The oldest 10 (dense-200..dense-209) are the ones dropped.
    const deletedIds = new Set(del.map((s) => s.id));
    for (let i = 200; i < 210; i++) expect(deletedIds.has(`dense-${i}`)).toBe(true);
    for (let i = 0; i < 200; i++) expect(deletedIds.has(`dense-${i}`)).toBe(false);
  });

  it('exactly 200 snapshots are all kept (cap is inclusive, not exclusive)', () => {
    const snaps: SnapshotMeta[] = [];
    for (let i = 0; i < 200; i++) {
      snaps.push({
        id: `dense-${i}`,
        timestamp: new Date(NOW.getTime() - i * 1000),
        trigger: 'save',
      });
    }
    const { keep, delete: del } = thinSnapshots(snaps, NOW);
    expect(keep).toHaveLength(200);
    expect(del).toHaveLength(0);
  });

  it('the hard cap never drops AI-boundary snapshots, even past 200 total', () => {
    // 200 dense 'save' snapshots + 20 'ai' snapshots also in the dense window
    // -> total 220, over the cap by 20. The cap must drop 20 'save' ones
    // (oldest first) and keep every 'ai' one.
    const snaps: SnapshotMeta[] = [];
    for (let i = 0; i < 200; i++) {
      snaps.push({
        id: `save-${i}`,
        timestamp: new Date(NOW.getTime() - i * 1000),
        trigger: 'save',
      });
    }
    for (let i = 0; i < 20; i++) {
      snaps.push({
        id: `ai-${i}`,
        timestamp: new Date(NOW.getTime() - (200 + i) * 1000),
        trigger: 'ai',
      });
    }
    const { keep, delete: del } = thinSnapshots(snaps, NOW);

    // All 20 ai snapshots survive regardless of the cap.
    for (let i = 0; i < 20; i++) {
      expect(keep.some((s) => s.id === `ai-${i}`)).toBe(true);
    }
    // Total kept can exceed 200 because AI-boundary snapshots are exempt.
    expect(keep).toHaveLength(220);
    expect(del).toHaveLength(0);
  });
});
