// ── Dev-server integration (P2-T14) ──────────────────────────────────────────
//
// Mounts the in-process `@figemite/server` backend as Vite middleware so
// `npm run dev` starts a SINGLE process/port that serves the React app AND
// handles `/api/*` + `/yjs/*` — no separate backend process, no CORS, same
// origin. Ports the pattern from the original prototype's
// `boardApiPlugin`/`yjsPlugin` (vite.config.ts), but delegates all request
// handling to the composed `@figemite/server` (`createServer`) instead of
// reimplementing the API inline.
//
// Middleware ordering: this plugin's `configureServer` hook runs before
// Vite's own middlewares (Vite always appends its html/static middlewares
// after plugin `configureServer` hooks that don't return a post-hook), so
// only `/api/*` requests are intercepted here — everything else (`/`,
// `/src/main.tsx`, HMR client, etc.) falls through to `next()` and is served
// by Vite as usual.

import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Plugin } from 'vite';
import { createServer, type ServerHandle } from '@figemite/server';

/** Resolves the dev boards directory: `FIGEMITE_BOARDS_DIR` env override, else `<repoRoot>/boards`. Creates it if missing (it's gitignored — never versioned). */
export function resolveDevBoardsRoot(repoRoot: string): string {
  const boardsRoot = process.env.FIGEMITE_BOARDS_DIR
    ? path.resolve(process.env.FIGEMITE_BOARDS_DIR)
    : path.resolve(repoRoot, 'boards');
  fs.mkdirSync(boardsRoot, { recursive: true });
  return boardsRoot;
}

function isApiRequest(url: string | undefined): boolean {
  return url === '/api' || (url?.startsWith('/api/') ?? false);
}

/**
 * mDNS is ON by default in dev so a locally-run MCP can discover this server as
 * an instance (it was historically never advertised in the dev path). Opt out
 * with `FIGEMITE_MDNS=0` / `false`.
 */
function devMdnsEnabled(): boolean {
  const v = process.env.FIGEMITE_MDNS?.toLowerCase();
  return v !== '0' && v !== 'false';
}

/**
 * Vite plugin: composes `@figemite/server` via `createServer` and mounts it on
 * the dev server's middleware chain + HTTP upgrade event, scoped to
 * `/api/*` only. `/yjs/*` websocket upgrades are handled by
 * `attachUpgrade`, which (per `YjsWebsocketService`) ignores any upgrade
 * whose URL doesn't start with `/yjs/`, so Vite's own HMR websocket keeps
 * working on the same port.
 */
export function figemiteServerPlugin(repoRoot: string): Plugin {
  return {
    name: 'figemite-server',
    configureServer(server) {
      const boardsRoot = resolveDevBoardsRoot(repoRoot);
      const backend: ServerHandle = createServer({ boardsRoot, mdns: devMdnsEnabled() });

      server.middlewares.use((req, res, next) => {
        if (isApiRequest(req.url)) {
          backend.requestHandler(req, res);
          return;
        }
        next();
      });

      if (server.httpServer) {
        // Vite types `httpServer` as `http.Server | Http2SecureServer` to
        // cover the (opt-in, via `server.https` + `server.http2`) HTTP/2 dev
        // mode; this plugin never enables that, so the dev server's
        // `httpServer` is always a plain `http.Server` here, matching what
        // `attachUpgrade` (and `startServer`, its production counterpart)
        // expect.
        const httpServer = server.httpServer as http.Server;
        backend.attachUpgrade(httpServer);

        // Advertise the real bound URL/port once Vite's server is listening, so
        // the instance's `/api/instance` url and its mDNS record carry the true
        // address (not the ephemeral placeholder).
        const advertise = (): void => {
          const address = httpServer.address();
          if (address === null || typeof address === 'string') return;
          const host = address.address === '::' ? '127.0.0.1' : address.address;
          backend.advertise({ url: `http://${host}:${address.port}`, port: address.port });
        };
        if (httpServer.listening) advertise();
        else httpServer.once('listening', advertise);

        httpServer.once('close', () => backend.dispose());
      }
    },
  };
}
