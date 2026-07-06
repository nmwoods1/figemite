// ── startServer standalone-launcher tests ────────────────────────────────────
//
// Complements create-server.test.ts (which drives the composed requestHandler
// directly on a hand-rolled http.Server). These tests exercise the actual
// `startServer` entry point: real `listen()`, the resolved `url`, the socket-
// timeout hardening, and `close()`'s clean shutdown — plus a real two-client
// Yjs convergence test THROUGH `attachUpgrade` as wired by `startServer`
// (proving the full composed server, not just YjsWebsocketService in
// isolation, relays updates end-to-end).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { startServer } from './start-server.js';

type Handle = Awaited<ReturnType<typeof startServer>>;

describe('startServer', () => {
  let handle: Handle | undefined;
  let boardsRoot: string | undefined;

  afterEach(async () => {
    await handle?.close();
    if (boardsRoot) await fs.rm(boardsRoot, { recursive: true, force: true });
    handle = undefined;
    boardsRoot = undefined;
  });

  it('binds to an ephemeral port on 127.0.0.1 by default and resolves a usable url', async () => {
    boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-start-server-'));
    handle = await startServer({ boardsRoot, port: 0 });

    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(handle.httpServer.listening).toBe(true);

    const res = await fetch(`${handle.url}/api/boards`);
    expect(res.status).toBe(200);
  });

  it('sets requestTimeout/headersTimeout/keepAliveTimeout to the configured budget', async () => {
    boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-start-server-'));
    handle = await startServer({ boardsRoot, port: 0, requestTimeoutMs: 12_345 });

    expect(handle.httpServer.requestTimeout).toBe(12_345);
    expect(handle.httpServer.headersTimeout).toBe(12_345);
    expect(handle.httpServer.keepAliveTimeout).toBe(12_345);
  });

  it('defaults the socket-timeout budget to 30 seconds', async () => {
    boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-start-server-'));
    handle = await startServer({ boardsRoot, port: 0 });

    expect(handle.httpServer.requestTimeout).toBe(30_000);
    expect(handle.httpServer.headersTimeout).toBe(30_000);
    expect(handle.httpServer.keepAliveTimeout).toBe(30_000);
  });

  it('close() resolves and leaves the http server not listening', async () => {
    boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-start-server-'));
    handle = await startServer({ boardsRoot, port: 0 });

    await handle.close();
    expect(handle.httpServer.listening).toBe(false);
    handle = undefined; // already closed — afterEach shouldn't close again
  });

  it(
    'relays Yjs updates between two WebsocketProvider clients through the composed server',
    { retry: 2, timeout: 15_000 },
    async () => {
      boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-start-server-'));
      handle = await startServer({ boardsRoot, port: 0 });

      const wsUrl = handle.url.replace('http://', 'ws://') + '/yjs/test-room';
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const providerA = new WebsocketProvider(wsUrl, '', docA, {
        WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        connect: false,
      });
      const providerB = new WebsocketProvider(wsUrl, '', docB, {
        WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        connect: false,
      });

      try {
        providerA.connect();
        providerB.connect();

        docA.getMap('shared').set('hello', 'world');

        await waitFor(() => docB.getMap('shared').get('hello') === 'world', 10_000);
        expect(docB.getMap('shared').get('hello')).toBe('world');
      } finally {
        providerA.destroy();
        providerB.destroy();
        docA.destroy();
        docB.destroy();
      }
    },
  );
});

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
