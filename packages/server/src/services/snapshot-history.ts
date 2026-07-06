// ── SnapshotHistoryService ───────────────────────────────────────────────────
//
// Ported from the figmalade prototype's `vite.config.ts` (the `snapshot` /
// `listSnapshots` / `readSnapshot` / `thinSnapshotIds` helpers embedded in the
// dev-server Vite plugin, lines ~106–324) into a standalone module with no
// HTTP/plugin dependencies.
//
// Each board (and each sub-board) owns a `.history/` directory (path via
// `historyDir` from `../repository/paths.js`, which already validates the
// slug/segments and asserts the resolved path stays inside `boardsRoot`).
// Snapshot files are named `<isoTimestamp>__<trigger>.json`, where
// `<isoTimestamp>` is `new Date().toISOString()` with every `:` AND `.`
// replaced by `-` (e.g. `2026-07-06T12-34-56-789Z` — filesystem-safe on all
// platforms, matching the legacy `.replace(/:/g, '-').replace(/\./g, '-')`)
// and `<trigger>` is one of `save | preai | ai`. File content is the board
// JSON exactly as read from disk at snapshot time (already canonically
// serialised by `BoardRepository`, so this module never re-serialises it).
//
// Content dedupe: `snapshot()` sha1-hashes the current board content and
// compares it against the most recent existing snapshot (if any); an
// identical hash skips the write entirely, so repeated saves of unchanged
// content don't spam the history directory.
//
// Deviation from legacy hard-cap behaviour: see the `thinSnapshots` doc below
// — this rewrite makes the 200 hard cap NEVER drop `preai`/`ai` snapshots,
// which the legacy `thinSnapshotIds` (vite.config.ts:295-324) did not
// actually guarantee (its final `sorted.slice(0, HARD_CAP)` step operates on
// the mixed keep-set irrespective of trigger, so an old AI-boundary snapshot
// could be evicted if enough newer snapshots of any kind piled up). Per the
// P1-T9 spec, AI-boundary snapshots are meaningful checkpoints and must
// survive every tier, including the cap.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { boardFilePath, historyDir } from '../repository/paths.js';
import { atomicWriteFileSync } from '../repository/atomic-write.js';

export type SnapshotTrigger = 'save' | 'preai' | 'ai';

export interface SnapshotMeta {
  /** The filename stem (without `.json`) — the id `read()` accepts. */
  id: string;
  /** The snapshot's timestamp, decoded from the filename. */
  timestamp: Date;
  trigger: SnapshotTrigger;
}

// Matches ids of the form `2026-07-06T12-34-56-789Z__save`, produced by
// `stemFor()` below. Anchored full-string match: rejects path separators,
// `..`, and anything that isn't exactly this shape.
const SNAPSHOT_ID_RE = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z__(save|preai|ai)$/;

function stemFor(date: Date, trigger: SnapshotTrigger): string {
  // toISOString() -> "2026-07-06T12-34-56.789Z" needs BOTH the `:` and the
  // millisecond `.` replaced to be filesystem-safe (Windows forbids `:`; the
  // `.` isn't unsafe but legacy replaced it too, and SNAPSHOT_ID_RE below
  // matches that exact shape).
  const ts = date.toISOString().replace(/:/g, '-').replace(/\./g, '-');
  return `${ts}__${trigger}`;
}

function parseId(id: string): { timestamp: Date; trigger: SnapshotTrigger } | null {
  const match = SNAPSHOT_ID_RE.exec(id);
  if (!match) return null;
  const [, datePart, mm, ss, ms, trigger] = match;
  const iso = `${datePart}:${mm}:${ss}.${ms}Z`;
  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) return null;
  return { timestamp, trigger: trigger as SnapshotTrigger };
}

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

/** Lists raw `SnapshotMeta` for a history dir, sorted newest-first by timestamp. */
function listDir(dir: string): SnapshotMeta[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const metas: SnapshotMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -'.json'.length);
    const parsed = parseId(id);
    if (!parsed) continue;
    metas.push({ id, timestamp: parsed.timestamp, trigger: parsed.trigger });
  }
  metas.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return metas;
}

// ── Two-tier thinning (pure function) ───────────────────────────────────────
//
// Mirrors the legacy constants and tiers exactly (vite.config.ts:276-278):
//   - RECENT_WINDOW_MS = 15 min: snapshots newer than this (relative to `now`)
//     are ALL kept (dense window).
//   - BUCKET_MS = 30 min: snapshots older than the dense window are kept at
//     one-per-bucket granularity (the newest snapshot in each 30-min epoch
//     bucket survives; the rest in that bucket are deletion candidates).
//   - HARD_CAP = 200: a backstop on total count.
//   - `preai`/`ai` snapshots are AI session boundaries and are NEVER thinned
//     by the dense-window/bucket tiers, matching legacy.
//
// See the module doc above for the one deliberate behavioural change: the
// HARD_CAP tier here additionally never drops `preai`/`ai` snapshots (legacy
// did not guarantee this — its final slice operated on the mixed keep-set).
export const RECENT_WINDOW_MS = 15 * 60 * 1000;
export const BUCKET_MS = 30 * 60 * 1000;
export const HARD_CAP = 200;

function isAiBoundary(trigger: SnapshotTrigger): boolean {
  return trigger === 'preai' || trigger === 'ai';
}

export function thinSnapshots(
  snapshots: SnapshotMeta[],
  now: Date,
): { keep: SnapshotMeta[]; delete: SnapshotMeta[] } {
  const nowMs = now.getTime();
  const recentCutoff = nowMs - RECENT_WINDOW_MS;

  // Iterate newest-first so "the newest in each bucket" is simply "the first
  // one seen for that bucket".
  const sorted = [...snapshots].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const keep: SnapshotMeta[] = [];
  const deleted: SnapshotMeta[] = [];
  const seenBuckets = new Set<number>();

  for (const snap of sorted) {
    if (isAiBoundary(snap.trigger)) {
      keep.push(snap);
      continue;
    }
    const ts = snap.timestamp.getTime();
    if (ts >= recentCutoff) {
      keep.push(snap);
      continue;
    }
    const bucket = Math.floor(ts / BUCKET_MS);
    if (!seenBuckets.has(bucket)) {
      seenBuckets.add(bucket);
      keep.push(snap);
    } else {
      deleted.push(snap);
    }
  }

  // Hard cap: trim the oldest non-AI-boundary survivors down to HARD_CAP,
  // never dropping preai/ai (a deliberate hardening over legacy — see module
  // doc). `keep` is newest-first already; walk it in that order, keeping every
  // AI-boundary snapshot plus up to HARD_CAP non-AI-boundary ones.
  const nonAiCount = keep.reduce((n, s) => n + (isAiBoundary(s.trigger) ? 0 : 1), 0);
  if (nonAiCount > HARD_CAP) {
    const capped: SnapshotMeta[] = [];
    let nonAiKept = 0;
    for (const snap of keep) {
      if (isAiBoundary(snap.trigger)) {
        capped.push(snap);
      } else if (nonAiKept < HARD_CAP) {
        capped.push(snap);
        nonAiKept++;
      } else {
        deleted.push(snap);
      }
    }
    return { keep: capped, delete: deleted };
  }

  return { keep, delete: deleted };
}

// ── SnapshotHistoryService ───────────────────────────────────────────────────

export class SnapshotHistoryService {
  constructor(private readonly boardsRoot: string) {}

  /**
   * Reads the current board (or sub-board) file content and writes it into
   * the history dir with a fresh timestamp + `trigger`. Runs thinning
   * afterwards and deletes anything it marks for deletion.
   *
   * Content dedupe: a `save` snapshot whose content is byte-identical (by
   * sha1) to the most recent existing snapshot is skipped, so repeated saves
   * of unchanged content don't spam history. AI-boundary triggers (`preai` /
   * `ai`) are EXEMPT from this — they are semantic session markers, not just
   * content, and MUST be recorded even when disk is unchanged. AI edits are
   * out-of-band/deferred, so disk content is frequently byte-identical across
   * a begin/end boundary; deduping the boundary away would erase the very
   * checkpoint the history is meant to preserve. This mirrors the existing
   * "AI-boundary snapshots are never thinned" policy in `thinSnapshots`.
   */
  snapshot(slug: string, subPath: string[], trigger: SnapshotTrigger): void {
    const boardPath = boardFilePath(this.boardsRoot, slug, subPath);

    let content: string;
    try {
      content = fs.readFileSync(boardPath, 'utf-8');
    } catch {
      return;
    }

    const dir = historyDir(this.boardsRoot, slug, subPath);
    const existing = listDir(dir);

    // Content-dedupe applies ONLY to plain `save` snapshots. `preai`/`ai`
    // boundaries always write (see method doc).
    if (trigger === 'save' && existing.length > 0) {
      const newestPath = path.join(dir, `${existing[0].id}.json`);
      try {
        const newestContent = fs.readFileSync(newestPath, 'utf-8');
        if (sha1(newestContent) === sha1(content)) return;
      } catch {
        // Newest snapshot file vanished between listing and reading — proceed
        // to write a fresh one rather than erroring out.
      }
    }

    fs.mkdirSync(dir, { recursive: true });
    const id = this.uniqueStem(dir, new Date(), trigger);
    atomicWriteFileSync(path.join(dir, `${id}.json`), content);

    const all = listDir(dir);
    const { delete: toDelete } = thinSnapshots(all, new Date());
    for (const snap of toDelete) {
      fs.rmSync(path.join(dir, `${snap.id}.json`), { force: true });
    }
  }

  /**
   * Produces a snapshot stem guaranteed not to collide with an existing file
   * in `dir`. `stemFor` has millisecond resolution, so two boundary snapshots
   * taken in the same millisecond (e.g. a `preai` then `ai` in a tight test or
   * a fast auto-end) would otherwise map to the same filename and the second
   * would silently overwrite the first. If the base stem's file already
   * exists, we advance the timestamp by 1ms until we find a free stem — the id
   * stays a valid, parseable `SNAPSHOT_ID_RE` timestamp and sorts correctly.
   */
  private uniqueStem(dir: string, date: Date, trigger: SnapshotTrigger): string {
    let candidate = new Date(date.getTime());
    let stem = stemFor(candidate, trigger);
    while (fs.existsSync(path.join(dir, `${stem}.json`))) {
      candidate = new Date(candidate.getTime() + 1);
      stem = stemFor(candidate, trigger);
    }
    return stem;
  }

  /** Lists snapshot metadata for a board (or sub-board), sorted newest-first. */
  list(slug: string, subPath: string[]): SnapshotMeta[] {
    const dir = historyDir(this.boardsRoot, slug, subPath);
    return listDir(dir);
  }

  /**
   * Reads a specific snapshot's content. `id` must exactly match the shape
   * `list()` produces (an anchored regex, so any path separator or `..`
   * fails to match and is rejected before ever touching the filesystem).
   */
  read(slug: string, subPath: string[], id: string): string {
    if (!SNAPSHOT_ID_RE.test(id)) {
      throw new Error(`Invalid snapshot id ${JSON.stringify(id)}`);
    }
    const dir = historyDir(this.boardsRoot, slug, subPath);
    try {
      return fs.readFileSync(path.join(dir, `${id}.json`), 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new Error(
          `Snapshot not found: slug=${JSON.stringify(slug)} id=${JSON.stringify(id)}`,
        );
      }
      throw err;
    }
  }
}
