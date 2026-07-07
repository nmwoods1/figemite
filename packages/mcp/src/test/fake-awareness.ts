// ── FakeAwareness: a minimal in-memory double for y-protocols' Awareness ────
//
// Mirrors packages/client/src/test/fake-awareness.ts: the real `Awareness`
// (from `y-protocols/awareness`, reached via a `WebsocketProvider`'s
// `.awareness`) is a thin Observable wrapping a `Map<number, unknown>` of
// per-client states plus a local `clientID`. This double implements just the
// surface BoardPeer needs (`getLocalState`, `setLocalState`,
// `setLocalStateField`), so peer.test.ts can drive BoardPeer without
// depending on yjs/y-websocket's real awareness plumbing.
//
// Unlike the client's copy, the default initial local state is `null` — a
// real Awareness' local state is null until the FIRST `setLocalState` call,
// and BoardPeer's constructor is exactly what's under test making that call
// (mirroring `setLocalStateField` being a no-op on null local state, per the
// real Awareness contract).

export class FakeAwareness {
  readonly clientID: number;
  private states = new Map<number, Record<string, unknown> | null>();

  constructor(clientID = 1) {
    this.clientID = clientID;
    this.states.set(clientID, null);
  }

  getLocalState(): Record<string, unknown> | null {
    return this.states.get(this.clientID) ?? null;
  }

  setLocalState(state: Record<string, unknown> | null): void {
    this.states.set(this.clientID, state);
  }

  setLocalStateField(field: string, value: unknown): void {
    const current = this.states.get(this.clientID);
    if (current == null) return; // matches the real Awareness' no-op-on-null contract
    this.states.set(this.clientID, { ...current, [field]: value });
  }
}
