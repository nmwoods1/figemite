import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { YjsWebsocketService, roomFromUpgradeUrl } from './yjs-ws.js';

// ── roomFromUpgradeUrl: pure URL parsing ─────────────────────────────────────

describe('roomFromUpgradeUrl', () => {
  it('extracts the room for a root board', () => {
    expect(roomFromUpgradeUrl('/yjs/spend')).toBe('spend');
  });

  it('extracts the room for a dotted sub-board path', () => {
    expect(roomFromUpgradeUrl('/yjs/spend.frame1.inner1')).toBe('spend.frame1.inner1');
  });

  it('strips a query string from the room', () => {
    expect(roomFromUpgradeUrl('/yjs/spend?foo=bar')).toBe('spend');
  });

  it('URL-decodes the room', () => {
    expect(roomFromUpgradeUrl('/yjs/my%20board')).toBe('my board');
  });

  it('returns null for a path not under /yjs/', () => {
    expect(roomFromUpgradeUrl('/api/boards/spend')).toBeNull();
  });

  it('returns null for the bare /yjs prefix with no trailing slash', () => {
    expect(roomFromUpgradeUrl('/yjs')).toBeNull();
  });

  it('returns null for /yjs/ with an empty room', () => {
    expect(roomFromUpgradeUrl('/yjs/')).toBeNull();
  });

  it('returns null for /yjs/ with an empty room and a query string', () => {
    expect(roomFromUpgradeUrl('/yjs/?foo=bar')).toBeNull();
  });

  it('returns null for undefined url', () => {
    expect(roomFromUpgradeUrl(undefined)).toBeNull();
  });
});

// ── Light integration test: real http.Server + two Yjs clients ──────────────
//
// Proves the server actually relays Yjs updates between two independent
// WebsocketProvider connections to the same room, not just that the upgrade
// handler is wired up. Uses `ws` as the WebSocket implementation since
// y-websocket's client assumes a browser-global WebSocket by default.

describe('YjsWebsocketService (integration)', () => {
  it('relays Y.Doc updates between two clients connected to the same room', async () => {
    const server = http.createServer();
    const service = new YjsWebsocketService();
    service.attachUpgrade(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/yjs/test-room`;

    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = new WebsocketProvider(url, '', docA, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      connect: false,
    });
    const providerB = new WebsocketProvider(url, '', docB, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      connect: false,
    });

    try {
      providerA.connect();
      providerB.connect();

      docA.getMap('shared').set('hello', 'world');

      await vitestWaitFor(() => docB.getMap('shared').get('hello') === 'world', 5000);

      expect(docB.getMap('shared').get('hello')).toBe('world');
    } finally {
      providerA.destroy();
      providerB.destroy();
      docA.destroy();
      docB.destroy();
      service.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);
});

/** Polls `check` until it returns true or `timeoutMs` elapses. */
async function vitestWaitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('vitestWaitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
