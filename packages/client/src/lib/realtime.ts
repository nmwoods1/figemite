// ── Real-time room abstraction ────────────────────────────────────────────────
//
// Ported from the original prototype's `src/lib/realtime.ts`, adapted
// to the new server-is-the-content-writer model (P5-T28/T29):
//
//   - The Y.Doc is now CALLER-supplied (the doc-first `BoardStore` —
//     store/board-store.ts — owns Y.Doc construction/lifecycle), not
//     constructed inside this module. `joinBoardRoom` just attaches a
//     provider + offline persistence to it.
//   - Content no longer needs to be POSTed by the client at all — the server
//     (`@figemite/server`'s `YjsWebsocketService`, P5-T28) seeds the room from
//     disk on first connect and persists it back on a debounce. This module's
//     entire job is "get this doc talking to the right room."
//
// Each board (and sub-board) gets its own y-websocket room. The room name
// mirrors the file layout so two clients editing the same board land in the
// same room:
//
//   Root board "spend"                  -> room "spend"
//   Sub-board "spend"/NodeA             -> room "spend.NodeA"
//   Nested sub-board "spend"/NodeA/SubB -> room "spend.NodeA.SubB"
//
// The provider connects to the same origin that served the page (via
// `location`), so this works transparently whether the app is opened at
// localhost or a LAN/VPN IP, over http or https.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { roomNameFor } from '@figemite/shared';
import { getLocalUser } from './identity.js';

export interface BoardRoom {
  roomName: string;
  provider: WebsocketProvider;
  awareness: WebsocketProvider['awareness'];
  /** True once the provider has completed its first sync with the room. */
  synced: boolean;
  /** Subscribe to sync-state changes (provider's `'sync'` event). Returns an unsubscribe function. */
  onSyncedChange(listener: (synced: boolean) => void): () => void;
  destroy(): void;
}

/** Builds the `/yjs` websocket base URL from the current page origin — `wss:`
 * when the page itself is served over `https:`, `ws:` otherwise. y-websocket
 * appends the room name itself, so this is just the base path (no room
 * segment, no trailing slash). */
function wsBaseUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/yjs`;
}

/**
 * Attaches a `WebsocketProvider` (content sync with the server room) and an
 * `IndexeddbPersistence` (offline cache, so a reconnect resumes from the last
 * known state rather than a blank doc) to `doc`, and bootstraps local
 * awareness.
 *
 * CRITICAL (ported verbatim from the legacy's own comment): local awareness
 * MUST be initialised with a non-null object up front. y-protocols'
 * `setLocalStateField()` is silently a no-op when local state is null, and
 * awareness defaults to null on construction. Without this, every later
 * `setLocalStateField` call (cursor position, editing-node id, viewport —
 * presence, a later task) is dropped on the floor and no remote peer ever
 * sees this client. This call MUST happen before any such field-set.
 */
export function joinBoardRoom(
  doc: Y.Doc,
  slug: string,
  path: string[],
  draftId?: string,
): BoardRoom {
  const roomName = roomNameFor(slug, path, draftId);
  const wsUrl = wsBaseUrl();

  const provider = new WebsocketProvider(wsUrl, roomName, doc, { connect: true });

  // Offline cache — DRAFT rooms only. The live ("prod") board is read-only and
  // server-authoritative (the server seeds each prod room from disk, and prod
  // content changes only via promote — see @figemite/server's promote handler +
  // yjs-ws). Caching prod locally is actively harmful: after a promote changes
  // prod on disk, a client rejoining Live would rehydrate its STALE IndexedDB
  // copy and sync it back into the freshly-seeded room, reverting the live view
  // to pre-promote content (the disk stays correct, so it looked like "promote
  // didn't update live"). Drafts are where the client actually edits, so they
  // keep the offline cache.
  const idb = draftId ? new IndexeddbPersistence(roomName, doc) : null;

  // CRITICAL: see this function's doc comment above.
  provider.awareness.setLocalState({ user: getLocalUser() });

  let synced = false;
  const syncListeners = new Set<(synced: boolean) => void>();
  const onSync = (isSynced: boolean) => {
    synced = isSynced;
    for (const listener of syncListeners) listener(isSynced);
  };
  provider.on('sync', onSync);

  return {
    roomName,
    provider,
    awareness: provider.awareness,
    get synced() {
      return synced;
    },
    onSyncedChange(listener: (synced: boolean) => void) {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
    destroy() {
      provider.off('sync', onSync);
      syncListeners.clear();
      provider.awareness.setLocalState(null);
      provider.destroy();
      idb?.destroy();
      // Deliberately does NOT call `doc.destroy()` — the doc is caller-owned
      // (the BoardStore constructed it and is responsible for its lifecycle).
    },
  };
}
