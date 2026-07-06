import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseHub, type SseSubscriberResponse } from './sse-hub.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fake `http.ServerResponse`-shaped object: a `write` spy plus an `on('close', ...)` hook. */
function fakeRes(): SseSubscriberResponse & {
  write: ReturnType<typeof vi.fn>;
  emitClose: () => void;
  destroyed: boolean;
  writableEnded: boolean;
} {
  let closeHandler: (() => void) | undefined;
  return {
    write: vi.fn(),
    destroyed: false,
    writableEnded: false,
    on(event: string, handler: () => void) {
      if (event === 'close') closeHandler = handler;
    },
    emitClose() {
      closeHandler?.();
    },
  };
}

describe('subscribe', () => {
  it('immediately writes an initial sync frame carrying the given state', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 3 });
    expect(res.write).toHaveBeenCalledWith('event: sync\ndata: {"locked":false,"epoch":3}\n\n');
  });

  it('registers res.on("close", ...) so a dropped connection unsubscribes itself', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();
    res.emitClose();
    hub.broadcast('my-board', [], 'external-change', {});
    expect(res.write).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that stops further delivery', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    const unsubscribe = hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();
    unsubscribe();
    hub.broadcast('my-board', [], 'external-change', {});
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('broadcast', () => {
  it('writes a well-formed SSE frame to every subscriber on that key', () => {
    const hub = new SseHub({});
    const resA = fakeRes();
    const resB = fakeRes();
    hub.subscribe('my-board', [], resA, { locked: false, epoch: 0 });
    hub.subscribe('my-board', [], resB, { locked: false, epoch: 0 });
    resA.write.mockClear();
    resB.write.mockClear();

    hub.broadcast('my-board', [], 'locked', { foo: 'bar' });

    const expected = 'event: locked\ndata: {"foo":"bar"}\n\n';
    expect(resA.write).toHaveBeenCalledWith(expected);
    expect(resB.write).toHaveBeenCalledWith(expected);
  });

  it('does not write to subscribers on a different key', () => {
    const hub = new SseHub({});
    const resRoot = fakeRes();
    const resSub = fakeRes();
    hub.subscribe('my-board', [], resRoot, { locked: false, epoch: 0 });
    hub.subscribe('my-board', ['frame1'], resSub, { locked: false, epoch: 0 });
    resRoot.write.mockClear();
    resSub.write.mockClear();

    hub.broadcast('my-board', [], 'locked', {});

    expect(resRoot.write).toHaveBeenCalledTimes(1);
    expect(resSub.write).not.toHaveBeenCalled();
  });

  it('is a silent no-op when there are no subscribers on the key', () => {
    const hub = new SseHub({});
    expect(() => hub.broadcast('unknown-board', [], 'locked', {})).not.toThrow();
  });

  it('evicts a subscriber whose write throws (broken pipe) and does not throw itself', () => {
    const hub = new SseHub({});
    const resGood = fakeRes();
    const resBad = fakeRes();
    resBad.write.mockImplementation(() => {
      throw new Error('EPIPE broken pipe');
    });
    hub.subscribe('my-board', [], resGood, { locked: false, epoch: 0 });
    hub.subscribe('my-board', [], resBad, { locked: false, epoch: 0 });
    resGood.write.mockClear();

    expect(() => hub.broadcast('my-board', [], 'locked', {})).not.toThrow();
    expect(resGood.write).toHaveBeenCalledTimes(1);

    // The bad subscriber should now be evicted — a second broadcast only
    // ever touches resGood again (resBad.write is not called a second time
    // beyond the failed first attempt).
    const callsToBadAfterEviction = resBad.write.mock.calls.length;
    hub.broadcast('my-board', [], 'locked', {});
    expect(resBad.write.mock.calls.length).toBe(callsToBadAfterEviction);
  });

  it('evicts a subscriber whose socket is already destroyed (no synchronous throw)', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();

    // Simulate a socket that disconnected without the write throwing: a stale
    // res whose `destroyed` flag is set. The hub must not write to it and must
    // evict it.
    res.destroyed = true;
    hub.broadcast('my-board', [], 'locked', {});
    expect(res.write).not.toHaveBeenCalled();

    // A subsequent broadcast confirms eviction (still never written to).
    res.destroyed = false; // even if it "came back", it's already gone
    hub.broadcast('my-board', [], 'locked', {});
    expect(res.write).not.toHaveBeenCalled();
  });

  it('evicts a subscriber whose writableEnded flag is set', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();

    res.writableEnded = true;
    hub.broadcast('my-board', [], 'locked', {});
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('heartbeat', () => {
  it('writes ": ping\\n\\n" to all subscribers on the configured interval once started', () => {
    const hub = new SseHub({ heartbeatMs: 1000 });
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();
    hub.start();

    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');

    res.write.mockClear();
    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('defaults heartbeatMs to 15 seconds', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();
    hub.start();

    vi.advanceTimersByTime(15_000 - 1);
    expect(res.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('does not send heartbeats before start() is called', () => {
    const hub = new SseHub({ heartbeatMs: 1000 });
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    res.write.mockClear();
    vi.advanceTimersByTime(5000);
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('dispose', () => {
  it('clears the heartbeat interval so no further pings are written', () => {
    const hub = new SseHub({ heartbeatMs: 1000 });
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    hub.start();
    res.write.mockClear();

    hub.dispose();
    vi.advanceTimersByTime(5000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('forgets subscribers so a broadcast after dispose is a no-op', () => {
    const hub = new SseHub({});
    const res = fakeRes();
    hub.subscribe('my-board', [], res, { locked: false, epoch: 0 });
    hub.dispose();
    res.write.mockClear();
    hub.broadcast('my-board', [], 'locked', {});
    expect(res.write).not.toHaveBeenCalled();
  });
});
