// ── BoardPeer — an AI agent's connection to a board's Yjs room ──────────────
//
// Ported from the legacy figmalade prototype's mcp/airjam-mcp-server/src/peer.ts,
// adapted to the shared CRDT contract:
//
//   - Room naming, presence types, and colour identity now come from
//     `@easel/shared` (`roomNameFor`, `colorForName`, `AwarenessState`)
//     instead of being duplicated inline — the whole point of this rewrite
//     is ONE contract shared by the browser client and this MCP peer.
//   - NO disk flush. The legacy peer scheduled a debounced `POST /api/board`
//     after every write (`scheduleFlush`/`flushToDisk` in the legacy
//     server.ts). That is gone entirely: the server now seeds and persists
//     each Yjs room itself (P5-T28's `YjsWebsocketService`), so a peer that
//     edits the room via `@easel/shared`'s ops needs no client-side
//     persistence step at all — the CRDT update reaching the server over the
//     websocket is sufficient; the server's own debounced writeback takes it
//     from there.
//
// `makeProvider` is an injectable `WebsocketProvider` factory (defaulting to
// the real one) so unit tests can drive BoardPeer against a fake provider
// without opening a real socket — mirrors the `makeBonjour` factory pattern
// already used by `@easel/server`'s `MdnsService`.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { roomNameFor, colorForName, type AwarenessState } from '@easel/shared';

export type ProviderFactory = (wsUrl: string, roomname: string, doc: Y.Doc) => WebsocketProvider;

function defaultMakeProvider(wsUrl: string, roomname: string, doc: Y.Doc): WebsocketProvider {
  return new WebsocketProvider(wsUrl, roomname, doc, {
    connect: true,
    // y-websocket needs an explicit WebSocket constructor outside the browser.
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
}

export interface BoardPeerOptions {
  /** Base WebSocket URL of the easel server, e.g. `ws://localhost:5400/yjs`. */
  wsUrl: string;
  /** Board slug, e.g. "spend". */
  slug: string;
  /** Sub-board path, e.g. ["NodeA"] for a sub-board, [] (default) for root. */
  path?: string[];
  /** Display name shown in other users' browsers. Defaults to "AI". */
  name?: string;
  /** Tag identifying the AI client software, e.g. "cursor", "claude-code". */
  agentClient?: string;
  /** Injectable `WebsocketProvider` factory. Defaults to the real one; tests supply a fake. */
  makeProvider?: ProviderFactory;
}

export class BoardPeer {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;
  readonly awareness: WebsocketProvider['awareness'];
  readonly roomName: string;
  readonly slug: string;
  readonly path: string[];
  readonly wsUrl: string;

  constructor(opts: BoardPeerOptions) {
    this.slug = opts.slug;
    this.path = opts.path ?? [];
    this.wsUrl = opts.wsUrl;
    this.roomName = roomNameFor(this.slug, this.path);

    this.doc = new Y.Doc();

    const makeProvider = opts.makeProvider ?? defaultMakeProvider;
    this.provider = makeProvider(opts.wsUrl, this.roomName, this.doc);
    this.awareness = this.provider.awareness;

    // Bootstrap local state up front: y-protocols' setLocalStateField is a
    // no-op while local state is null (the default at construction), so every
    // later presence setter below would be silently dropped without this.
    const name = opts.name ?? 'AI';
    const initialState: AwarenessState = {
      user: { name, color: colorForName(name) },
      cursor: null,
      editingNodeId: null,
      isAI: true,
      ...(opts.agentClient ? { agentClient: opts.agentClient } : {}),
    };
    this.awareness.setLocalState(initialState);
  }

  /** Resolves once the provider completes its first sync with the room's server. */
  waitForSync(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.provider.synced) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.provider.off('sync', onSync);
        reject(new Error(`BoardPeer: sync timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      const onSync = (isSynced: boolean): void => {
        if (!isSynced) return;
        clearTimeout(timer);
        this.provider.off('sync', onSync);
        resolve();
      };
      this.provider.on('sync', onSync);
    });
  }

  /** Publish cursor position in flow-space coordinates. `null` clears it. */
  setCursor(pos: { x: number; y: number } | null): void {
    this.awareness.setLocalStateField('cursor', pos);
  }

  /** Publish which node the AI is currently editing. `null` clears the outline. */
  setEditing(nodeId: string | null): void {
    this.awareness.setLocalStateField('editingNodeId', nodeId);
  }

  /** Publish the AI's current viewport so humans can optionally follow it. */
  setViewport(vp: { x: number; y: number; zoom: number } | null): void {
    this.awareness.setLocalStateField('viewport', vp);
  }

  /** Tear down the connection cleanly: clears awareness, destroys the provider and the doc. */
  destroy(): void {
    this.awareness.setLocalState(null);
    this.provider.destroy();
    this.doc.destroy();
  }
}
