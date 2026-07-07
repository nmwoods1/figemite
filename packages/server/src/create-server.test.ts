// ── createServer composition tests ───────────────────────────────────────────
//
// Proves createServer(config) actually WIRES the real services together (not
// a hand-built ctx, unlike test-server.ts's harness which composition itself
// now supersedes for production use). These tests drive `handle.requestHandler`
// mounted on a real http.Server directly (no startServer involved) so the
// composition unit is exercised in isolation from the listen/timeout layer.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyBoard, serialise } from '@figemite/shared';
import { createServer, type ServerHandle } from './create-server.js';

interface Harness {
  handle: ServerHandle;
  server: http.Server;
  url: string;
  boardsRoot: string;
  close(): Promise<void>;
}

async function startHarness(
  overrides: Partial<Parameters<typeof createServer>[0]> = {},
): Promise<Harness> {
  const boardsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-create-server-'));
  const handle = createServer({ boardsRoot, ...overrides });
  const server = http.createServer(handle.requestHandler);
  handle.attachUpgrade(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  return {
    handle,
    server,
    url,
    boardsRoot,
    async close() {
      handle.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(boardsRoot, { recursive: true, force: true });
    },
  };
}

async function post(url: string, path: string, data: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Minimal SSE frame reader (mirrors api/sse.test.ts's SseReader) ───────────

interface SseFrame {
  event: string;
  data: unknown;
}

class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = '';

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  private drainOne(wanted: string): SseFrame | null {
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const lines = raw.split('\n');
      let event = 'message';
      const dataLines: string[] = [];
      let isComment = true;
      for (const line of lines) {
        if (line.startsWith(':')) continue;
        isComment = false;
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
      }
      if (isComment) continue;
      if (event !== wanted) continue;
      const dataStr = dataLines.join('\n');
      return { event, data: dataStr ? JSON.parse(dataStr) : undefined };
    }
    return null;
  }

  async nextEvent(wanted: string, timeoutMs = 5000): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.drainOne(wanted);
      if (match) return match;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for SSE event "${wanted}"`);
      const remaining = deadline - Date.now();
      const timeout = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), Math.max(remaining, 0)),
      );
      const result = await Promise.race([this.reader.read(), timeout]);
      if (result.done) continue;
      this.buffer += this.decoder.decode(result.value, { stream: true });
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

async function openStream(
  url: string,
  query: string,
): Promise<{ reader: SseReader; abort: AbortController }> {
  const abort = new AbortController();
  const res = await fetch(`${url}/api/events?${query}`, { signal: abort.signal });
  expect(res.status).toBe(200);
  if (!res.body) throw new Error('no SSE body');
  return { reader: new SseReader(res.body), abort };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createServer composition', () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it('wires the repo + router: POST /api/boards then GET /api/board round-trips', async () => {
    h = await startHarness();
    const created = await post(h.url, '/api/boards', { slug: 'my-board', label: 'My Board' });
    expect(created.status).toBe(200);

    const got = await fetch(`${h.url}/api/board?board=my-board`);
    expect(got.status).toBe(200);
    const board = (await got.json()) as { boardLabel: string };
    expect(board.boardLabel).toBe('My Board');
  });

  it('wires ai.onChange -> sse: begin/end broadcast locked/unlocked through the real composition', async () => {
    h = await startHarness({ heartbeatMs: 60_000 });
    await post(h.url, '/api/boards', { slug: 'my-board', label: 'My Board' });

    const { reader, abort } = await openStream(h.url, 'board=my-board');
    try {
      await reader.nextEvent('sync');

      const begin = await post(h.url, '/api/ai/begin', { board: 'my-board' });
      expect(begin.status).toBe(200);
      const locked = await reader.nextEvent('locked');
      expect(locked.data).toEqual({ epoch: 1 });

      // While locked, a save must 409 — proves the SAME ai instance gates the
      // router's write path as the one whose onChange feeds sse.
      const saveWhileLocked = await post(h.url, '/api/board', {
        board: 'my-board',
        path: [],
        data: emptyBoard('My Board'),
      });
      expect(saveWhileLocked.status).toBe(409);

      const end = await post(h.url, '/api/ai/end', { board: 'my-board' });
      expect(end.status).toBe(200);
      const unlocked = await reader.nextEvent('unlocked');
      expect((unlocked.data as { epoch: number }).epoch).toBe(2);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });

  it('wires the file watcher -> sse: an external disk write emits external-change', async () => {
    h = await startHarness({ debounceMs: 20, suppressMs: 50 });
    await post(h.url, '/api/boards', { slug: 'my-board', label: 'My Board' });
    // Let the create's self-write suppression window elapse before the
    // "external editor" write, so it isn't swallowed as our own write.
    await new Promise((r) => setTimeout(r, 80));

    const { reader, abort } = await openStream(h.url, 'board=my-board');
    try {
      await reader.nextEvent('sync');
      await fs.writeFile(
        path.join(h.boardsRoot, 'my-board', 'board.json'),
        serialise(emptyBoard('Externally Edited')),
        'utf-8',
      );
      const frame = await reader.nextEvent('external-change');
      const payload = frame.data as { board?: { boardLabel: string } };
      expect(payload.board?.boardLabel).toBe('Externally Edited');
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });

  it('dispose() tears down services without throwing', async () => {
    h = await startHarness();
    expect(() => h.handle.dispose()).not.toThrow();
  });
});
