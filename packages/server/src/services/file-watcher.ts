// ── FileWatcher ──────────────────────────────────────────────────────────────
//
// Detects EXTERNAL writes to board files — from an MCP server, a human
// editing JSON directly, or any process other than this server's own write
// path — and fires `onExternalChange(slug, subPath)` so the API layer (P1-T12)
// can broadcast an `external-change` SSE event. Ported from the original
// prototype's `fsSync.watch(BOARDS_ROOT, { recursive: true }, ...)` handler
// embedded in the dev-server Vite plugin (vite.config.ts ~394-444).
//
// Critical behaviour preserved from a bug the legacy code narrowly avoided
// but didn't defend against structurally: `BoardRepository.write` (this
// rewrite's atomic-write path) writes a temp file and `fs.renameSync`s it
// over the target. On macOS/Linux, `fs.watch`'s recursive mode reports that
// rename as a `'rename'` event, NOT `'change'` — verified empirically in this
// environment (a temp-file-write + rename against a real `fs.watch` produced
// only `'rename'` events, including for the temp file itself). A watcher that
// filters to only `'change'` (a naive port of "detect file changed") would
// silently miss every atomic write. This implementation classifies by
// filename/extension instead of event type, and explicitly handles BOTH
// `'change'` and `'rename'` — see `handleFsEvent` below.
//
// Design: the real `fs.watch` wiring (`start()`/`dispose()`) is a thin shell
// around `handleFsEvent`, which is the pure-ish, directly-callable core
// (suppression + AI-gate + debounce + callback). This lets the bulk of the
// test suite drive `handleFsEvent` directly with Vitest fake timers — fully
// deterministic — while a single light integration test exercises the real
// `fs.watch` wiring end-to-end (see file-watcher.test.ts's "fs.watch
// integration" describe block) to prove the wiring itself is correct.
//
// Self-write suppression: `suppress(slug, subPath)` marks a key as
// self-written for `suppressMs`; any fs event for that key arriving within
// the window is ignored. The API layer calls this immediately before/after
// its own `BoardRepository.write` for that slug/subPath so the server's own
// writes are never reported as "external".
//
// AI-session gate: while `isLocked(slug, subPath)` is true, external-change
// events for that key are suppressed outright (no debounce timer is even
// started) — during an active AI session, the AI's edits flow through Yjs
// and the `/api/ai/end` broadcast already handles notifying clients; this
// avoids a redundant/racy second notification path while the lock is held.
//
// Debounce/coalesce: a burst of qualifying events for the same key within
// `debounceMs` collapses into exactly one `onExternalChange` call — each new
// event within the window resets the timer (matching the legacy
// `clearTimeout(existing); debounceTimers.set(key, setTimeout(...))` pattern).
// Legacy's `AI_WATCHER_DEBOUNCE_MS` was 10 seconds; this rewrite keeps that as
// the default but makes it configurable (`debounceMs`) for fast tests.

import fs from 'node:fs';
import { validateSlugAndPath } from '../repository/paths.js';
import { sessionKey } from './session-key.js';

export interface ParsedWatchedPath {
  slug: string;
  subPath: string[];
}

const SLUG_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Classifies a raw `fs.watch` filename (relative to `boardsRoot`) as either a
 * board/sub-board JSON file (`<slug>/board.json` or
 * `<slug>/board.<seg1>.<seg2>....json`) or not. Returns `null` for anything
 * else: `.history/` entries, `comments.json`, `tags.json`, atomic-write temp
 * files (`.board.json.<uuid>.tmp`), directory-only events, and non-board
 * files. Pure — no filesystem access.
 */
export function parseWatchedPath(filename: string): ParsedWatchedPath | null {
  const normalized = filename.replace(/\\/g, '/');
  const slashIdx = normalized.indexOf('/');
  if (slashIdx === -1) return null; // no basename component (e.g. a bare dir rename)

  const slug = normalized.slice(0, slashIdx);
  const rest = normalized.slice(slashIdx + 1);
  if (rest.includes('/')) return null; // nested (.history/, .history/frame1/, ...) — not a board file

  if (!SLUG_SEGMENT_RE.test(slug)) return null;
  if (!rest.startsWith('board.') || !rest.endsWith('.json')) return null;

  if (rest === 'board.json') return { slug, subPath: [] };

  const inner = rest.slice('board.'.length, -'.json'.length);
  if (!inner) return null;
  const subPath = inner.split('.');
  if (subPath.some((seg) => !SLUG_SEGMENT_RE.test(seg))) return null;

  return { slug, subPath };
}

export interface FileWatcherOptions {
  boardsRoot: string;
  /** True while `slug`/`subPath` has an active AI session — external-change events for it are suppressed. */
  isLocked: (slug: string, subPath: string[]) => boolean;
  /** Fired once per debounced burst of external writes to a board/sub-board. */
  onExternalChange: (slug: string, subPath: string[]) => void;
  /** Self-write suppression window in ms. Defaults to 2000. */
  suppressMs?: number;
  /** Debounce/coalesce window in ms. Defaults to 10000, matching legacy AI_WATCHER_DEBOUNCE_MS. */
  debounceMs?: number;
  /** Delay before re-establishing the watch after the FSWatcher emits an
   * error (see {@link FileWatcher.handleWatcherError}). Defaults to 1000. */
  restartDelayMs?: number;
}

const DEFAULT_SUPPRESS_MS = 2_000;
const DEFAULT_DEBOUNCE_MS = 10_000;
const DEFAULT_RESTART_DELAY_MS = 1_000;

export class FileWatcher {
  private readonly boardsRoot: string;
  private readonly isLocked: (slug: string, subPath: string[]) => boolean;
  private readonly onExternalChange: (slug: string, subPath: string[]) => void;
  private readonly suppressMs: number;
  private readonly debounceMs: number;
  private readonly restartDelayMs: number;

  private readonly suppressedUntil = new Map<string, number>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private watcher: fs.FSWatcher | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: FileWatcherOptions) {
    this.boardsRoot = options.boardsRoot;
    this.isLocked = options.isLocked;
    this.onExternalChange = options.onExternalChange;
    this.suppressMs = options.suppressMs ?? DEFAULT_SUPPRESS_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
  }

  /** Marks `slug`/`subPath` as self-written; fs events for it are ignored for `suppressMs`. */
  suppress(slug: string, subPath: string[]): void {
    const key = sessionKey(slug, subPath);
    this.suppressedUntil.set(key, Date.now() + this.suppressMs);
  }

  private isSuppressed(key: string): boolean {
    const until = this.suppressedUntil.get(key);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      this.suppressedUntil.delete(key);
      return false;
    }
    return true;
  }

  /**
   * The injectable core: classifies a raw `fs.watch` event, applies self-
   * write suppression and the AI-lock gate, and (de)bounces qualifying
   * events into a single `onExternalChange` call. Handles both `'change'`
   * and `'rename'` event types identically — see module doc for why both
   * matter. Exposed directly so tests can drive it without real `fs.watch`.
   */
  handleFsEvent(_eventType: 'change' | 'rename' | string, filename: string | null): void {
    if (!filename) return;
    const parsed = parseWatchedPath(filename);
    if (!parsed) return;

    const { slug, subPath } = parsed;
    try {
      validateSlugAndPath(slug, subPath);
    } catch {
      return; // defense in depth — malformed slug/segment from a hostile filename
    }

    const key = sessionKey(slug, subPath);

    if (this.isSuppressed(key)) return;
    if (this.isLocked(slug, subPath)) return;

    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.onExternalChange(slug, subPath);
      }, this.debounceMs),
    );
  }

  /** Starts watching `boardsRoot` recursively for board file changes. */
  start(): void {
    if (this.disposed || this.watcher) return;
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(this.boardsRoot, { recursive: true }, (eventType, filename) => {
        this.handleFsEvent(eventType, filename);
      });
    } catch (err) {
      // `fs.watch` throws synchronously if `boardsRoot` is missing/unwatchable.
      // Log and leave external-change detection off rather than crash — the
      // server itself keeps running. (The common case is that the root always
      // exists; this only guards a genuine race/misconfiguration.)
      console.error('FileWatcher: failed to start watching board files', err);
      return;
    }
    // CRITICAL: an `fs.watch` FSWatcher is an EventEmitter, and a recursive
    // watch can emit an 'error' event (notably Linux ENOENT `scandir` when a
    // watched board sub-directory churns — sub-board delete, .history writes,
    // atomic renames). An 'error' event with NO listener is thrown by Node,
    // crashing the entire process — which is exactly what took down the e2e
    // web server. Handle it: log, tear down the (now-dead) watcher, and
    // best-effort re-establish the watch.
    watcher.on('error', (err) => this.handleWatcherError(err));
    this.watcher = watcher;
  }

  /**
   * Handles an FSWatcher 'error' event without crashing the process. A watcher
   * that has emitted 'error' is effectively dead, so this closes it and
   * schedules ONE best-effort restart (after `restartDelayMs`) so external-
   * change detection recovers. The delay + single-pending-restart guard keeps
   * a persistently-erroring watch from becoming a tight restart loop. Exposed
   * directly (like {@link handleFsEvent}) so tests can drive it deterministically.
   */
  handleWatcherError(err: unknown): void {
    console.error('FileWatcher: board file watcher error (recovering)', err);
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* already closed by the error — fine */
      }
      this.watcher = null;
    }
    if (this.disposed || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.restartDelayMs);
  }

  /** Closes the fs watcher and clears all pending timers. Idempotent. */
  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.suppressedUntil.clear();
  }
}
