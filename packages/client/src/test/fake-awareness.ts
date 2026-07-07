// ── FakeAwareness: a minimal in-memory double for y-protocols' Awareness ────
//
// The real `Awareness` (from `y-protocols/awareness`, reached via a
// `WebsocketProvider`'s `.awareness`) is a thin `Observable` wrapping a
// `Map<number, unknown>` of per-client states plus a local `clientID`. This
// double implements just the surface the presence hooks/components need
// (`clientID`, `getStates()`, `setLocalState`/`setLocalStateField`, and the
// `'change'` event via `on`/`off`), so unit tests can drive multi-client
// awareness scenarios (remote peers appearing/disappearing/updating) without
// depending on yjs/y-websocket at all — mirrors the structural-fake approach
// already used for `SyncStatusProvider` (hooks/useSyncStatus.test.ts) and
// `BoardRoom` (board-store.test.ts / BoardCanvas.test.tsx).
//
// `setLocalState(null)` and a null/undefined `state` field lookup are
// supported since `lib/realtime.ts`'s `destroy()` calls
// `awareness.setLocalState(null)` on teardown, matching the real Awareness'
// contract that `setLocalStateField` on a null local state is a no-op (see
// that module's bootstrap-order doc comment).

type ChangeListener = (arg: unknown) => void;

export class FakeAwareness {
  readonly clientID: number;
  private states = new Map<number, Record<string, unknown> | null>();
  private listeners = new Set<ChangeListener>();

  /**
   * `initialLocalState` mirrors real usage: `lib/realtime.ts`'s
   * `joinBoardRoom` ALWAYS calls `awareness.setLocalState({ user:
   * getLocalUser() })` before handing the awareness off to any other code
   * (presence hooks included) — a real `Awareness`'s local state is never
   * null by the time application code touches it. Defaults to `{}` (non-null,
   * no fields yet) rather than `null` so `setLocalStateField` calls from
   * hooks under test behave the same as they would against the real,
   * already-bootstrapped Awareness. Pass `null` explicitly only to test the
   * pre-bootstrap/no-op-on-null edge case itself.
   */
  constructor(clientID = 1, initialLocalState: Record<string, unknown> | null = {}) {
    this.clientID = clientID;
    this.states.set(clientID, initialLocalState);
  }

  getStates(): Map<number, Record<string, unknown> | null> {
    return this.states;
  }

  getLocalState(): Record<string, unknown> | null {
    return this.states.get(this.clientID) ?? null;
  }

  setLocalState(state: Record<string, unknown> | null): void {
    this.states.set(this.clientID, state);
    this.emitChange();
  }

  setLocalStateField(field: string, value: unknown): void {
    const current = this.states.get(this.clientID);
    if (current == null) return; // matches the real Awareness' no-op-on-null contract
    this.states.set(this.clientID, { ...current, [field]: value });
    this.emitChange();
  }

  on(event: 'change', listener: ChangeListener): void {
    if (event === 'change') this.listeners.add(listener);
  }

  off(event: 'change', listener: ChangeListener): void {
    if (event === 'change') this.listeners.delete(listener);
  }

  /** Test helper: set (or clear, via `state: null`) a REMOTE client's full
   * awareness state directly (bypassing the local-state no-op-on-null guard,
   * since remote states arrive over the wire pre-built) and notify
   * subscribers — simulates another peer joining/updating/leaving. */
  setRemoteState(clientId: number, state: Record<string, unknown> | null): void {
    if (state === null) {
      this.states.delete(clientId);
    } else {
      this.states.set(clientId, state);
    }
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener({});
  }
}
