// ── useAiLock tests ───────────────────────────────────────────────────────────
//
// P5-T31 (plan rough-edge b). `useAiLock` opens an `EventSource` to
// `/api/events?board=&path=` and derives `aiLocked` from its `sync` / `locked`
// / `unlocked` frames (see server contract: packages/server/src/services/
// sse-hub.ts, packages/server/src/api/handlers/{events,ai}.ts).
//
// The critical behaviour under test is RECONNECT RECONCILIATION: a dropped
// SSE connection must not leave the browser stuck in whatever lock state it
// last observed. `EventSource.onerror` triggers a close + reconnect (with
// backoff), and every (re)connect immediately reconciles against the
// authoritative `GET /api/ai/status`, using `epoch` to ignore stale events.
//
// A minimal `FakeEventSource` stands in for the real DOM `EventSource` (jsdom
// doesn't implement it) — it records every instance constructed (so a test can
// grab "the current" one after a reconnect swaps in a fresh instance) and lets
// a test fire `open`/named `message`/`error` synthetically, mirroring the
// FakeProvider/FakeAwareness pattern used by useSyncStatus.test.ts/
// usePresence.test.ts elsewhere in this codebase.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAiLock } from './useAiLock.js';

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: fires a named SSE event with a JSON-encoded `data` payload. */
  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const l of this.listeners.get(type) ?? []) l(event);
  }

  /** Test helper: fires the connection-level error handler. */
  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

/** The most recently constructed FakeEventSource (post-reconnect, "the current" one). */
function currentEventSource(): FakeEventSource {
  const instances = FakeEventSource.instances;
  return instances[instances.length - 1];
}

const fetchMock = vi.fn();

function mockStatus(state: { locked: boolean; epoch: number }): void {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => state,
  } as Response);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  fetchMock.mockReset();
  mockStatus({ locked: false, epoch: 0 });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useAiLock', () => {
  it('opens an EventSource to /api/events with the board slug', () => {
    renderHook(() => useAiLock('my-board', [], {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(currentEventSource().url).toContain('/api/events');
    expect(currentEventSource().url).toContain('board=my-board');
  });

  it('includes the dotted sub-board path in the query when given', () => {
    renderHook(() => useAiLock('my-board', ['a', 'b'], {}));
    expect(currentEventSource().url).toContain('path=a.b');
  });

  it('initial "sync" event sets aiLocked from its locked field (true)', () => {
    const { result } = renderHook(() => useAiLock('my-board', [], {}));
    act(() => currentEventSource().emit('sync', { locked: true, epoch: 1 }));
    expect(result.current.aiLocked).toBe(true);
  });

  it('initial "sync" event sets aiLocked from its locked field (false)', () => {
    const { result } = renderHook(() => useAiLock('my-board', [], {}));
    act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));
    expect(result.current.aiLocked).toBe(false);
  });

  it('"locked" event flips aiLocked to true', () => {
    const { result } = renderHook(() => useAiLock('my-board', [], {}));
    act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));
    act(() => currentEventSource().emit('locked', { epoch: 2 }));
    expect(result.current.aiLocked).toBe(true);
  });

  it('"unlocked" event flips aiLocked to false (no re-fetch of the board)', () => {
    const { result } = renderHook(() => useAiLock('my-board', [], {}));
    act(() => currentEventSource().emit('sync', { locked: true, epoch: 1 }));
    act(() => currentEventSource().emit('unlocked', { epoch: 2, board: { fake: true } }));
    expect(result.current.aiLocked).toBe(false);
  });

  it('"external-change" calls opts.onExternalChange', () => {
    const onExternalChange = vi.fn();
    renderHook(() => useAiLock('my-board', [], { onExternalChange }));
    act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));
    act(() => currentEventSource().emit('external-change', { board: {} }));
    expect(onExternalChange).toHaveBeenCalledTimes(1);
  });

  it('ignores an event whose epoch is older than the last-known epoch', () => {
    const { result } = renderHook(() => useAiLock('my-board', [], {}));
    act(() => currentEventSource().emit('sync', { locked: true, epoch: 5 }));
    // A stale/out-of-order "unlocked" carrying an OLDER epoch must not flip state.
    act(() => currentEventSource().emit('unlocked', { epoch: 3 }));
    expect(result.current.aiLocked).toBe(true);
  });

  it('accepts an event whose epoch is newer than the last-known epoch', () => {
    const { result } = renderHook(() => useAiLock('my-board', [], {}));
    act(() => currentEventSource().emit('sync', { locked: true, epoch: 5 }));
    act(() => currentEventSource().emit('unlocked', { epoch: 6 }));
    expect(result.current.aiLocked).toBe(false);
  });

  describe('reconnect reconciliation', () => {
    it('reconnects and calls GET /api/ai/status after the socket errors', async () => {
      renderHook(() => useAiLock('my-board', [], {}));
      act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));
      fetchMock.mockClear();

      act(() => currentEventSource().emitError());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(fetchMock).toHaveBeenCalled();
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/api/ai/status');
      expect(url).toContain('board=my-board');
    });

    it('opens a fresh EventSource after an error (with backoff)', async () => {
      renderHook(() => useAiLock('my-board', [], {}));
      act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));
      const first = currentEventSource();

      act(() => first.emitError());
      expect(first.closed).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(FakeEventSource.instances.length).toBeGreaterThan(1);
      expect(currentEventSource()).not.toBe(first);
    });

    it('the classic bug: an "unlocked" missed during the drop resolves to UNLOCKED after reconnect', async () => {
      const { result } = renderHook(() => useAiLock('my-board', [], {}));
      // Client was locked before the connection dropped...
      act(() => currentEventSource().emit('sync', { locked: true, epoch: 1 }));
      expect(result.current.aiLocked).toBe(true);

      // ...the AI finished and unlocked WHILE the socket was down, so this
      // client never saw the 'unlocked' frame. The reconciliation poll must
      // now report the true, unlocked state.
      mockStatus({ locked: false, epoch: 2 });

      act(() => currentEventSource().emitError());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(result.current.aiLocked).toBe(false);
    });

    it('the inverse: locked during the drop resolves to LOCKED after reconnect', async () => {
      const { result } = renderHook(() => useAiLock('my-board', [], {}));
      act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));
      expect(result.current.aiLocked).toBe(false);

      // AI began editing WHILE the socket was down.
      mockStatus({ locked: true, epoch: 2 });

      act(() => currentEventSource().emitError());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(result.current.aiLocked).toBe(true);
    });

    it("honors the fresh connection's own initial sync without waiting for the poll", async () => {
      const { result } = renderHook(() => useAiLock('my-board', [], {}));
      act(() => currentEventSource().emit('sync', { locked: false, epoch: 1 }));

      act(() => currentEventSource().emitError());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // The NEW EventSource's own sync frame arrives (say, locked) before the
      // status fetch promise resolves — the hook should reflect it immediately.
      act(() => currentEventSource().emit('sync', { locked: true, epoch: 3 }));
      expect(result.current.aiLocked).toBe(true);
    });
  });

  describe('disabled paths', () => {
    it('does not open an EventSource when there is no slug', () => {
      renderHook(() => useAiLock(undefined, [], {}));
      expect(FakeEventSource.instances).toHaveLength(0);
    });

    it('does not open an EventSource in read-only mode', () => {
      renderHook(() => useAiLock('my-board', [], { readonly: true }));
      expect(FakeEventSource.instances).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('closes the EventSource on unmount', () => {
      const { unmount } = renderHook(() => useAiLock('my-board', [], {}));
      const es = currentEventSource();
      unmount();
      expect(es.closed).toBe(true);
    });

    it('closes the old EventSource and opens a new one when the slug changes', () => {
      const { rerender } = renderHook(({ slug }) => useAiLock(slug, [], {}), {
        initialProps: { slug: 'board-a' },
      });
      const first = currentEventSource();
      rerender({ slug: 'board-b' });
      expect(first.closed).toBe(true);
      expect(currentEventSource()).not.toBe(first);
      expect(currentEventSource().url).toContain('board=board-b');
    });

    it('does not reconnect after unmount even if a pending backoff timer was armed', async () => {
      const { unmount } = renderHook(() => useAiLock('my-board', [], {}));
      const first = currentEventSource();
      act(() => first.emitError());
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // No new EventSource should have been opened post-unmount.
      expect(FakeEventSource.instances).toHaveLength(1);
    });
  });
});
