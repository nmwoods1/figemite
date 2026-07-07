import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileWatcher, parseWatchedPath } from './file-watcher.js';

// ── parseWatchedPath: pure filename classification ──────────────────────────

describe('parseWatchedPath', () => {
  it('parses the root board file', () => {
    expect(parseWatchedPath('my-board/board.json')).toEqual({ slug: 'my-board', subPath: [] });
  });

  it('parses a single-segment sub-board file', () => {
    expect(parseWatchedPath('my-board/board.frame1.json')).toEqual({
      slug: 'my-board',
      subPath: ['frame1'],
    });
  });

  it('parses a multi-segment sub-board file', () => {
    expect(parseWatchedPath('my-board/board.frame1.inner1.json')).toEqual({
      slug: 'my-board',
      subPath: ['frame1', 'inner1'],
    });
  });

  it('normalizes backslash separators (Windows) to forward slashes', () => {
    expect(parseWatchedPath('my-board\\board.json')).toEqual({ slug: 'my-board', subPath: [] });
  });

  it('ignores comments.json', () => {
    expect(parseWatchedPath('my-board/comments.json')).toBeNull();
  });

  it('ignores tags.json', () => {
    expect(parseWatchedPath('my-board/tags.json')).toBeNull();
  });

  it('ignores files under .history/', () => {
    expect(parseWatchedPath('my-board/.history/2026-01-01T00-00-00-000Z__save.json')).toBeNull();
    expect(
      parseWatchedPath('my-board/.history/frame1/2026-01-01T00-00-00-000Z__save.json'),
    ).toBeNull();
  });

  it('ignores a directory-only rename event (no basename component)', () => {
    expect(parseWatchedPath('my-board')).toBeNull();
  });

  it('ignores temp files from the atomic-write dance', () => {
    expect(parseWatchedPath('my-board/.board.json.abc123.tmp')).toBeNull();
  });

  it('ignores non-board json files at the slug root', () => {
    expect(parseWatchedPath('my-board/random.json')).toBeNull();
  });

  it('ignores non-json files', () => {
    expect(parseWatchedPath('my-board/board.json.bak')).toBeNull();
  });
});

// ── FileWatcher core event-handling logic (injectable, no real fs.watch) ───

describe('FileWatcher core logic (handleFsEvent)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeWatcher(overrides: Partial<ConstructorParameters<typeof FileWatcher>[0]> = {}) {
    const onExternalChange = vi.fn();
    const isLocked = vi.fn().mockReturnValue(false);
    const watcher = new FileWatcher({
      boardsRoot: '/irrelevant-for-core-tests',
      isLocked,
      onExternalChange,
      debounceMs: 10_000,
      suppressMs: 2_000,
      ...overrides,
    });
    return { watcher, onExternalChange, isLocked };
  }

  it('a "rename"-type event for a board file triggers external-change after the debounce (proves atomic writes are caught)', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('rename', 'my-board/board.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', []);
  });

  it('a "change"-type event for a board file also triggers external-change', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('change', 'my-board/board.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', []);
  });

  it('does not fire before the debounce window elapses', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('change', 'my-board/board.json');
    vi.advanceTimersByTime(9_999);
    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it('a burst of events for the same board within the debounce window collapses to one callback', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('rename', 'my-board/board.json');
    vi.advanceTimersByTime(3_000);
    watcher.handleFsEvent('change', 'my-board/board.json');
    vi.advanceTimersByTime(3_000);
    watcher.handleFsEvent('rename', 'my-board/board.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledTimes(1);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', []);
  });

  it('debounces sub-boards independently of the root board and of each other', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('change', 'my-board/board.json');
    watcher.handleFsEvent('change', 'my-board/board.frame1.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', []);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', ['frame1']);
    expect(onExternalChange).toHaveBeenCalledTimes(2);
  });

  it('ignores non-board files entirely (no timer, no callback)', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('change', 'my-board/comments.json');
    watcher.handleFsEvent('rename', 'my-board/tags.json');
    watcher.handleFsEvent('change', 'my-board/.history/x__save.json');
    vi.advanceTimersByTime(20_000);
    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it('a path suppressed via suppress() within the window does NOT trigger external-change', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.suppress('my-board', []);
    watcher.handleFsEvent('rename', 'my-board/board.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it('suppression expires after suppressMs, so a later external write is reported again', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.suppress('my-board', []);
    vi.advanceTimersByTime(2_000); // suppressMs window elapses
    watcher.handleFsEvent('rename', 'my-board/board.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', []);
  });

  it('suppression only applies to the suppressed key, not sibling sub-boards', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.suppress('my-board', []);
    watcher.handleFsEvent('rename', 'my-board/board.json');
    watcher.handleFsEvent('rename', 'my-board/board.frame1.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledTimes(1);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', ['frame1']);
  });

  it('an AI-locked board does NOT trigger external-change while locked', () => {
    const isLocked = vi.fn(
      (slug: string, subPath: string[]) => slug === 'my-board' && subPath.length === 0,
    );
    const { watcher, onExternalChange } = makeWatcher({ isLocked });
    watcher.handleFsEvent('change', 'my-board/board.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it('the AI-lock gate does not affect a different sub-board on the same slug', () => {
    const isLocked = vi.fn(
      (slug: string, subPath: string[]) => slug === 'my-board' && subPath.length === 0,
    );
    const { watcher, onExternalChange } = makeWatcher({ isLocked });
    watcher.handleFsEvent('change', 'my-board/board.frame1.json');
    vi.advanceTimersByTime(10_000);
    expect(onExternalChange).toHaveBeenCalledWith('my-board', ['frame1']);
  });

  it('dispose() clears pending debounce timers so no callback fires after', () => {
    const { watcher, onExternalChange } = makeWatcher();
    watcher.handleFsEvent('change', 'my-board/board.json');
    watcher.dispose();
    vi.advanceTimersByTime(20_000);
    expect(onExternalChange).not.toHaveBeenCalled();
  });
});

// ── Light integration test: real fs.watch wiring ────────────────────────────

describe('FileWatcher fs.watch integration (real filesystem)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-file-watcher-'));
    await fs.mkdir(path.join(tmpRoot, 'my-board'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  // This is the only test in this file that uses REAL timers + a real
  // `fs.watch` (every other test drives `handleFsEvent` directly under fake
  // timers, so they're immune to CPU scheduling). fs.watch delivery latency
  // is scheduler-dependent, so under a fully-loaded parallel suite this can
  // occasionally miss the 50ms debounce window's polling deadline. It's a
  // timing sensitivity, not a logic flaw, so we (a) give the test a generous
  // 15s ceiling to absorb CPU starvation, (b) `retry: 2` so a rare
  // fs.watch-latency miss re-runs instead of failing the suite, and (c) keep
  // the assertion on `vi.waitFor` polling (interval 50ms) with its own
  // timeout kept below the test timeout.
  it(
    'detects a real atomic write (temp file + rename) to a board file and reports external-change',
    { retry: 2, timeout: 15000 },
    async () => {
      const onExternalChange = vi.fn();
      const watcher = new FileWatcher({
        boardsRoot: tmpRoot,
        isLocked: () => false,
        onExternalChange,
        debounceMs: 50,
        suppressMs: 100,
      });
      watcher.start();

      try {
        // Simulate BoardRepository.write's atomic write: temp file + rename.
        const target = path.join(tmpRoot, 'my-board', 'board.json');
        const tmp = path.join(tmpRoot, 'my-board', '.board.json.abc.tmp');
        fsSync.writeFileSync(tmp, '{}');
        fsSync.renameSync(tmp, target);

        await vi.waitFor(
          () => {
            expect(onExternalChange).toHaveBeenCalledWith('my-board', []);
          },
          { timeout: 10000, interval: 50 },
        );
      } finally {
        watcher.dispose();
      }
    },
  );
});
