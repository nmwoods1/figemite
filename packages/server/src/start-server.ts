// ── startServer — standalone http.Server launcher (P1-T13) ──────────────────
//
// Wraps `createServer` with an actual `http.Server`: binds it, applies the
// socket-timeout hardening the P1-T12 review called for, and resolves once
// listening with the real bound `url`. This is the entry point a CLI/`bin.ts`
// or an integration test uses; `createServer` alone never touches a real
// socket.
//
// ── Slowloris hardening (why these three timeouts, bound here) ──────────────
//
// A slowloris-style client opens a TCP connection and trickles bytes (or
// none) slowly enough to hold the socket open indefinitely without ever
// completing a request, exhausting the server's connection pool. Node's
// `http.Server` has three independent knobs that bound this:
//   - `headersTimeout`: max time to receive the complete HTTP headers after
//     the connection opens. Without a cap this defaults to 60s in modern
//     Node, but we fix it explicitly here rather than relying on the
//     runtime default (which has changed across Node versions and isn't a
//     documented contract of this server).
//   - `requestTimeout`: max time to receive the complete request (headers +
//     body) before Node cuts the connection. Bounds a slow-body attack even
//     after headers land.
//   - `keepAliveTimeout`: max time an idle keep-alive connection is held open
//     waiting for the next request on the same socket. Without this, a
//     client that finishes a request but never closes the socket (or sends
//     another) ties up a connection slot forever.
// All three default to the same ~30s budget (`config.requestTimeoutMs`) so
// there's one number to reason about; a caller with different needs can
// still override it. 30s is generous for a LAN-local board server (real
// requests complete in milliseconds) while still bounding the worst case to
// a small, fixed window instead of "forever".
//
// `attachUpgrade` is called before `listen()` so the Yjs upgrade listener is
// registered before any client could possibly connect.

import http from 'node:http';
import { createServer, type ServerHandle } from './create-server.js';
import type { ServerConfig } from './config.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HOST = '127.0.0.1';

export interface StartedServer {
  url: string;
  httpServer: http.Server;
  handle: ServerHandle;
  close(): Promise<void>;
}

/**
 * Composes every service via `createServer`, binds a real `http.Server` to
 * `config.host ?? '127.0.0.1'` : `config.port ?? 0`, and resolves once
 * listening. `close()` disposes the composition then force-closes the HTTP
 * server (including idle keep-alive sockets) so shutdown never stalls.
 */
export async function startServer(config: ServerConfig): Promise<StartedServer> {
  const handle = createServer(config);
  const httpServer = http.createServer(handle.requestHandler);
  handle.attachUpgrade(httpServer);

  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  httpServer.requestTimeout = timeoutMs;
  httpServer.headersTimeout = timeoutMs;
  httpServer.keepAliveTimeout = timeoutMs;

  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? 0;
  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('startServer: failed to bind to a TCP port');
  }
  const url = `http://${host}:${address.port}`;

  return {
    url,
    httpServer,
    handle,
    async close(): Promise<void> {
      handle.dispose();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
