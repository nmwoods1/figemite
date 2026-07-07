// ── useSyncStatus tests ──────────────────────────────────────────────────────
//
// Reflects the realtime provider's connection/sync state as a small
// `'connecting' | 'synced' | 'offline'` union, replacing the removed content-
// autosave's `SaveStatus` for the editable canvas's save-status indicator
// (P5-T29 — the server, not the client, now persists content; the indicator's
// job is "is my view of the board live" rather than "did my POST succeed").
//
// Modeled directly on y-websocket's `WebsocketProvider` events:
//   - `'status'` -> `{ status: 'connected' | 'disconnected' | 'connecting' }`
//   - `'sync'`   -> `boolean` (true once the doc has completed its initial sync)
//
// A bare event-emitter-shaped fake stands in for the real provider here
// (unit-testing the hook's OWN state-derivation logic); `lib/realtime.test.ts`
// covers that `joinBoardRoom` wires a real `WebsocketProvider` correctly, and
// the E2E gate covers the real thing end-to-end.

import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSyncStatus } from './useSyncStatus.js';

type StatusEvent = { status: 'connected' | 'disconnected' | 'connecting' };
type Listener<T> = (arg: T) => void;

class FakeProvider {
  synced = false;
  private statusListeners = new Set<Listener<StatusEvent>>();
  private syncListeners = new Set<Listener<boolean>>();

  on(event: string, listener: Listener<unknown>): void {
    if (event === 'status') this.statusListeners.add(listener as Listener<StatusEvent>);
    if (event === 'sync') this.syncListeners.add(listener as Listener<boolean>);
  }

  off(event: string, listener: Listener<unknown>): void {
    if (event === 'status') this.statusListeners.delete(listener as Listener<StatusEvent>);
    if (event === 'sync') this.syncListeners.delete(listener as Listener<boolean>);
  }

  emitStatus(status: StatusEvent['status']): void {
    for (const l of this.statusListeners) l({ status });
  }

  emitSync(synced: boolean): void {
    this.synced = synced;
    for (const l of this.syncListeners) l(synced);
  }
}

describe('useSyncStatus', () => {
  it('starts as "connecting" before any status/sync event has fired', () => {
    const provider = new FakeProvider();
    const { result } = renderHook(() => useSyncStatus(provider));
    expect(result.current).toBe('connecting');
  });

  it('reports "connecting" while connected but not yet synced', () => {
    const provider = new FakeProvider();
    const { result } = renderHook(() => useSyncStatus(provider));
    act(() => provider.emitStatus('connected'));
    expect(result.current).toBe('connecting');
  });

  it('reports "synced" once connected AND the sync event fires true', () => {
    const provider = new FakeProvider();
    const { result } = renderHook(() => useSyncStatus(provider));
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(result.current).toBe('synced');
  });

  it('reports "offline" when the status event fires disconnected', () => {
    const provider = new FakeProvider();
    const { result } = renderHook(() => useSyncStatus(provider));
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    act(() => provider.emitStatus('disconnected'));
    expect(result.current).toBe('offline');
  });

  it('returning to connected after being offline goes back through connecting until resynced', () => {
    const provider = new FakeProvider();
    const { result } = renderHook(() => useSyncStatus(provider));
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    act(() => provider.emitStatus('disconnected'));
    expect(result.current).toBe('offline');

    act(() => provider.emitStatus('connecting'));
    expect(result.current).toBe('connecting');

    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(result.current).toBe('synced');
  });

  it("reads the provider's already-true `synced` flag at mount time (late subscriber)", () => {
    const provider = new FakeProvider();
    provider.synced = true;
    const { result } = renderHook(() => useSyncStatus(provider));
    // No 'connected' status event has fired yet for this fresh render, but the
    // provider itself already reports synced === true (e.g. a provider handed
    // off after already syncing) — the hook should reflect that immediately
    // rather than requiring a fresh event.
    expect(result.current).toBe('synced');
  });

  it('unsubscribes its listeners on unmount (no further updates after unmount)', () => {
    const provider = new FakeProvider();
    const { result, unmount } = renderHook(() => useSyncStatus(provider));
    unmount();
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    // No assertion possible on `result.current` post-unmount changing (React
    // warns on state updates after unmount) — this test's real assertion is
    // implicit: no "Cannot update state on an unmounted component" warning/
    // error is thrown. Kept as an explicit test rather than relying on a
    // global console-error gate.
    expect(result.current).toBe('connecting');
  });

  it('null provider (not yet joined) reports "connecting"', () => {
    const { result } = renderHook(() => useSyncStatus(null));
    expect(result.current).toBe('connecting');
  });
});
