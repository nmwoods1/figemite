import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSessionManager } from './ai-session.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('begin', () => {
  it('locks the session and reports isLocked true', () => {
    const mgr = new AiSessionManager({});
    mgr.begin('my-board', []);
    expect(mgr.isLocked('my-board', [])).toBe(true);
  });

  it('increments the epoch from the default 0', () => {
    const mgr = new AiSessionManager({});
    expect(mgr.status('my-board', []).epoch).toBe(0);
    mgr.begin('my-board', []);
    expect(mgr.status('my-board', []).epoch).toBe(1);
  });

  it('fires onChange with the sessionKey and new state', () => {
    const onChange = vi.fn();
    const mgr = new AiSessionManager({ onChange });
    mgr.begin('my-board', ['frame1']);
    expect(onChange).toHaveBeenCalledWith('my-board|frame1', { locked: true, epoch: 1 });
  });

  it('tracks sub-boards independently of the root board', () => {
    const mgr = new AiSessionManager({});
    mgr.begin('my-board', ['frame1']);
    expect(mgr.isLocked('my-board', [])).toBe(false);
    expect(mgr.isLocked('my-board', ['frame1'])).toBe(true);
  });
});

describe('status / isLocked for unknown keys', () => {
  it('status defaults to { locked: false, epoch: 0 }', () => {
    const mgr = new AiSessionManager({});
    expect(mgr.status('never-touched', [])).toEqual({ locked: false, epoch: 0 });
  });

  it('isLocked defaults to false', () => {
    const mgr = new AiSessionManager({});
    expect(mgr.isLocked('never-touched', [])).toBe(false);
  });
});

describe('end', () => {
  it('unlocks a locked session and increments the epoch', () => {
    const mgr = new AiSessionManager({});
    mgr.begin('my-board', []);
    mgr.end('my-board', []);
    expect(mgr.status('my-board', [])).toEqual({ locked: false, epoch: 2 });
  });

  it('fires onChange on end', () => {
    const onChange = vi.fn();
    const mgr = new AiSessionManager({ onChange });
    mgr.begin('my-board', []);
    onChange.mockClear();
    mgr.end('my-board', []);
    expect(onChange).toHaveBeenCalledWith('my-board', { locked: false, epoch: 2 });
  });

  it('ending a never-locked session is a no-op: epoch stays 0, no onChange', () => {
    const onChange = vi.fn();
    const mgr = new AiSessionManager({ onChange });
    mgr.end('my-board', []);
    expect(mgr.status('my-board', [])).toEqual({ locked: false, epoch: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ending an already-ended session again is a no-op: epoch does not advance further', () => {
    const mgr = new AiSessionManager({});
    mgr.begin('my-board', []);
    mgr.end('my-board', []);
    const onChange = vi.fn();
    mgr.end('my-board', []); // already unlocked -> no-op
    expect(mgr.status('my-board', [])).toEqual({ locked: false, epoch: 2 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the auto-end timer so it does not fire later and double-end', () => {
    const onChange = vi.fn();
    const mgr = new AiSessionManager({ autoEndMs: 5000, onChange });
    mgr.begin('my-board', []);
    mgr.end('my-board', []);
    onChange.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(mgr.status('my-board', [])).toEqual({ locked: false, epoch: 2 });
  });
});

describe('auto-end timer', () => {
  it('automatically unlocks after autoEndMs elapses', () => {
    const mgr = new AiSessionManager({ autoEndMs: 5000 });
    mgr.begin('my-board', []);
    vi.advanceTimersByTime(5000);
    expect(mgr.isLocked('my-board', [])).toBe(false);
  });

  it('increments the epoch and fires onChange when it auto-ends', () => {
    const onChange = vi.fn();
    const mgr = new AiSessionManager({ autoEndMs: 5000, onChange });
    mgr.begin('my-board', []);
    onChange.mockClear();
    vi.advanceTimersByTime(5000);
    expect(onChange).toHaveBeenCalledWith('my-board', { locked: false, epoch: 2 });
  });

  it('does not fire before autoEndMs has elapsed', () => {
    const mgr = new AiSessionManager({ autoEndMs: 5000 });
    mgr.begin('my-board', []);
    vi.advanceTimersByTime(4999);
    expect(mgr.isLocked('my-board', [])).toBe(true);
  });

  it('defaults to 5 minutes when autoEndMs is not configured', () => {
    const mgr = new AiSessionManager({});
    mgr.begin('my-board', []);
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(mgr.isLocked('my-board', [])).toBe(true);
    vi.advanceTimersByTime(1);
    expect(mgr.isLocked('my-board', [])).toBe(false);
  });
});

describe('re-begin on an already-locked session', () => {
  it('refreshes the auto-end timer instead of stacking a second one', () => {
    const mgr = new AiSessionManager({ autoEndMs: 5000 });
    mgr.begin('my-board', []);
    vi.advanceTimersByTime(4000);
    mgr.begin('my-board', []); // refresh — should push the deadline out another 5000ms
    vi.advanceTimersByTime(4000);
    // 8000ms since the first begin, only 4000ms since the refresh — still locked.
    expect(mgr.isLocked('my-board', [])).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(mgr.isLocked('my-board', [])).toBe(false);
  });

  it('still increments the epoch on every begin call, including a refresh', () => {
    const mgr = new AiSessionManager({});
    mgr.begin('my-board', []);
    mgr.begin('my-board', []);
    expect(mgr.status('my-board', []).epoch).toBe(2);
  });

  it('fires onChange again on a refreshing begin', () => {
    const onChange = vi.fn();
    const mgr = new AiSessionManager({ onChange });
    mgr.begin('my-board', []);
    onChange.mockClear();
    mgr.begin('my-board', []);
    expect(onChange).toHaveBeenCalledWith('my-board', { locked: true, epoch: 2 });
  });
});

describe('multiple independent keys', () => {
  it('auto-end timer for one key does not affect another', () => {
    const mgr = new AiSessionManager({ autoEndMs: 5000 });
    mgr.begin('board-a', []);
    vi.advanceTimersByTime(2000);
    mgr.begin('board-b', []);
    vi.advanceTimersByTime(3000); // board-a hits 5000ms, board-b at 3000ms
    expect(mgr.isLocked('board-a', [])).toBe(false);
    expect(mgr.isLocked('board-b', [])).toBe(true);
  });
});
