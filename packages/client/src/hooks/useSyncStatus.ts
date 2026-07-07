// ── useSyncStatus: provider-derived connection/sync status ──────────────────
//
// P5-T29. Replaces the removed content-autosave's `SaveStatus` for the
// editable canvas's save-status indicator: the server (not the client) now
// persists board content (P5-T28's `YjsWebsocketService`), so "is this client
// caught up with the room" is the meaningful status to show, not "did my last
// POST succeed."
//
// Modeled on y-websocket's `WebsocketProvider` events:
//   - `'status'` -> `{ status: 'connected' | 'disconnected' | 'connecting' }`
//   - `'sync'`   -> `boolean` (true once this doc has completed its initial
//     sync exchange with the room)
//
// Derivation: 'offline' whenever the last status event was 'disconnected';
// otherwise 'synced' once the provider has both connected AND completed a
// sync, else 'connecting'. A `null` provider (board not yet joined a room,
// e.g. still loading) reports 'connecting'.
import { useEffect, useState } from 'react';

/** A `'status'` event's payload shape (y-websocket's `WebsocketProvider`). */
export interface ProviderStatusEvent {
  status: 'connected' | 'disconnected' | 'connecting';
}

/** The minimal event-emitter surface this hook needs — matches
 * `WebsocketProvider`'s `on`/`off`/`synced` (see `lib/realtime.ts`'s
 * `BoardRoom.provider`), kept structural (not importing the real type, and
 * kept to a SINGLE non-overloaded signature rather than per-event overloads —
 * `WebsocketProvider`'s own `ObservableV2`-derived `on`/`off` types each event
 * name to its own payload type, which is stricter than any one non-generic
 * signature could widen to, so a plain test double couldn't structurally
 * satisfy an overloaded shape without also modeling `ObservableV2` — this
 * looser `unknown`-payload shape is what makes both the real provider AND a
 * bare test double assignable) so a plain test double satisfies it without
 * depending on y-websocket. */
export interface SyncStatusProvider {
  synced: boolean;
  on(event: 'status' | 'sync', listener: (arg: unknown) => void): void;
  off(event: 'status' | 'sync', listener: (arg: unknown) => void): void;
}

export type SyncStatus = 'connecting' | 'synced' | 'offline';

function deriveStatus(connected: boolean, disconnected: boolean, synced: boolean): SyncStatus {
  if (disconnected) return 'offline';
  if (connected && synced) return 'synced';
  return 'connecting';
}

/** The initial status for a just-(re)subscribed `provider` — a provider that
 * already reports `synced === true` at subscribe time (e.g. handed off to
 * this hook after having already synced) must also be connected — sync can't
 * complete without a live connection — so `connected` seeds from `synced`
 * rather than waiting for a fresh 'status' event this hook may have missed by
 * subscribing late. */
function initialStatusFor(provider: SyncStatusProvider | null): SyncStatus {
  return deriveStatus(provider?.synced ?? false, false, provider?.synced ?? false);
}

export function useSyncStatus(provider: SyncStatusProvider | null): SyncStatus {
  // Derived-during-render "reset on prop change" pattern (React's own
  // recommended alternative to calling setState synchronously inside an
  // effect body — see react-hooks/set-state-in-effect): track the provider
  // this state was last computed for, and if it's changed, reset the status
  // for the NEW provider directly during render rather than via an effect.
  const [status, setStatus] = useState<SyncStatus>(() => initialStatusFor(provider));
  const [lastProvider, setLastProvider] = useState(provider);
  if (provider !== lastProvider) {
    setLastProvider(provider);
    setStatus(initialStatusFor(provider));
  }

  useEffect(() => {
    if (!provider) return;

    let connected = provider.synced;
    let disconnected = false;
    let synced = provider.synced;

    const onStatus = (arg: unknown) => {
      const e = arg as ProviderStatusEvent;
      connected = e.status === 'connected';
      disconnected = e.status === 'disconnected';
      if (e.status === 'connecting') synced = false;
      setStatus(deriveStatus(connected, disconnected, synced));
    };
    const onSync = (arg: unknown) => {
      synced = arg as boolean;
      setStatus(deriveStatus(connected, disconnected, synced));
    };

    provider.on('status', onStatus);
    provider.on('sync', onSync);
    return () => {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
    };
  }, [provider]);

  return status;
}
