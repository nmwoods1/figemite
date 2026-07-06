// ── YjsWebsocketService ──────────────────────────────────────────────────────
//
// Mounts a y-websocket-compatible relay on an existing `http.Server`. Each
// board (and sub-board) gets its own room, keyed by `<slug>` or
// `<slug>.<NodeId>.<SubId>` — clients connect to `ws://<host>:<port>/yjs/<room>`.
// Ported from the figmalade prototype's `yjsPlugin()` Vite plugin
// (vite.config.ts ~785-806).
//
// Vite's HMR (Phase 2) uses the same HTTP server for its own WebSocket
// upgrades. We share the port by creating the `WebSocketServer` with
// `noServer: true` and only completing the handshake for upgrade requests
// whose URL path starts with `/yjs/` — every other upgrade request is left
// untouched (no `socket.destroy()`, no response written) so another
// `'upgrade'` listener mounted on the same server can still handle it.
//
// y-websocket's server-side room/doc bookkeeping lives in its CJS-only
// `y-websocket/bin/utils` subpath export (there is no ESM build of it — see
// the package's `exports` map). `@easel/server` is an ESM package
// (`"type": "module"`), but Node's ESM loader supports named imports from a
// CJS module via static analysis of its `module.exports` shape (cjs-module-
// lexer), so `import { setupWSConnection } from 'y-websocket/bin/utils'`
// works directly with no `createRequire` needed — verified by the
// integration test below actually relaying updates end-to-end.
//
// Benign side-effect of this interop: `bin/utils.cjs` reaches `yjs` via its
// own CJS `require('yjs')`, a separate module-registry entry from our ESM
// `import * as Y from 'yjs'` even though both resolve to the identical file
// on disk (confirmed via `require.resolve`). Yjs logs a one-time "Yjs was
// already imported" warning for this (see yjs/yjs#438) — cosmetic here, since
// nothing on our side does `instanceof Y.Doc` across the two instances; the
// wire protocol (sync/awareness messages) is what actually carries updates,
// and the integration test proves those converge correctly end-to-end.

import type http from 'node:http';
import { WebSocketServer } from 'ws';
// y-websocket has no types for its CJS `bin/utils` subpath; the runtime
// import works via Node's CJS/ESM interop (see module doc above).
// @ts-expect-error -- untyped CJS subpath export, see module doc above
import { setupWSConnection } from 'y-websocket/bin/utils';

const YJS_PREFIX = '/yjs/';

/**
 * Extracts the Yjs room name from an upgrade request's URL path, or `null`
 * if the path isn't under `/yjs/`. Pure — no sockets involved — so it's
 * unit-testable on its own. Handles a trailing query string and URL-decodes
 * the room segment.
 */
export function roomFromUpgradeUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (!url.startsWith(YJS_PREFIX)) return null;

  const withoutQuery = url.slice(YJS_PREFIX.length).split('?')[0];
  if (!withoutQuery) return null;

  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return null; // malformed percent-encoding
  }
}

export class YjsWebsocketService {
  private readonly wss = new WebSocketServer({ noServer: true });
  private httpServer: http.Server | null = null;
  private readonly handleUpgrade = (
    req: InstanceType<typeof http.IncomingMessage>,
    socket: import('node:net').Socket,
    head: Buffer,
  ): void => {
    const room = roomFromUpgradeUrl(req.url);
    if (room === null) return; // not for us — leave it for another upgrade handler

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      setupWSConnection(ws, req, { docName: room });
    });
  };

  /**
   * Registers an `'upgrade'` listener on `httpServer` that handles requests
   * under `/yjs/` and ignores everything else. Safe to call once per
   * service instance; calling it again attaches a second listener (the
   * caller is expected to call this exactly once per server).
   */
  attachUpgrade(httpServer: http.Server): void {
    this.httpServer = httpServer;
    httpServer.on('upgrade', this.handleUpgrade);
  }

  /** Closes the WebSocketServer (and every open `/yjs/` connection) and detaches the upgrade listener. */
  dispose(): void {
    if (this.httpServer) {
      this.httpServer.off('upgrade', this.handleUpgrade);
      this.httpServer = null;
    }
    for (const client of this.wss.clients) {
      client.terminate();
    }
    this.wss.close();
  }
}
