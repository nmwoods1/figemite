import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard, makeStickyNode, serialise, type BoardFile } from '@easel/shared';
import { startTestServer, type TestHarness } from './test-server.js';

let h: TestHarness;

beforeEach(async () => {
  // Tiny debounce so the external-change assertion resolves quickly; short
  // suppress so an external write right after a create isn't swallowed.
  h = await startTestServer({ debounceMs: 20, suppressMs: 50 });
});

afterEach(async () => {
  await h.close();
});

// ── SSE stream reader ────────────────────────────────────────────────────────
//
// Reads the `fetch` response body incrementally, splitting the byte stream into
// SSE frames on the blank-line delimiter. `nextEvent` resolves with the first
// frame (after any already-buffered) whose `event` matches `wanted`, so a test
// can assert "a `locked` frame eventually arrives" deterministically regardless
// of interleaved heartbeats/comments. A per-call timeout guards against a hang.

interface SseFrame {
  event: string;
  data: unknown;
}

class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = '';
  private queue: SseFrame[] = [];

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  /** Parses any complete frames currently in `buffer` into `queue`. */
  private drainBuffer(): void {
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const lines = raw.split('\n');
      let event = 'message';
      const dataLines: string[] = [];
      let isComment = true;
      for (const line of lines) {
        if (line.startsWith(':')) continue; // SSE comment (e.g. heartbeat)
        isComment = false;
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
      }
      if (isComment) continue;
      const dataStr = dataLines.join('\n');
      let data: unknown = undefined;
      if (dataStr) {
        try {
          data = JSON.parse(dataStr);
        } catch {
          data = dataStr;
        }
      }
      this.queue.push({ event, data });
    }
  }

  /** Resolves with the next frame whose event === `wanted`, or rejects on timeout. */
  async nextEvent(wanted: string, timeoutMs = 5000): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    // Serve any already-queued matching frame first.
    const queued = this.takeQueued(wanted);
    if (queued) return queued;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const chunk = await this.readWithTimeout(remaining);
      if (chunk === null) break; // stream ended
      this.buffer += this.decoder.decode(chunk, { stream: true });
      this.drainBuffer();
      const match = this.takeQueued(wanted);
      if (match) return match;
    }
    throw new Error(`Timed out waiting for SSE event "${wanted}"`);
  }

  private takeQueued(wanted: string): SseFrame | null {
    const i = this.queue.findIndex((f) => f.event === wanted);
    if (i === -1) return null;
    const [frame] = this.queue.splice(i, 1);
    return frame;
  }

  private async readWithTimeout(ms: number): Promise<Uint8Array | null> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('read timeout')), ms);
    });
    try {
      const result = await Promise.race([this.reader.read(), timeout]);
      return result.done ? null : (result.value ?? null);
    } finally {
      clearTimeout(timer!);
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

async function openStream(query: string): Promise<{ reader: SseReader; abort: AbortController }> {
  const abort = new AbortController();
  const res = await fetch(`${h.url}/api/events?${query}`, { signal: abort.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  if (!res.body) throw new Error('no SSE body');
  return { reader: new SseReader(res.body), abort };
}

function boardWithSticky(label = 'My Board'): BoardFile {
  return { ...emptyBoard(label), nodes: [makeStickyNode('s1', { x: 5, y: 6 }, '#fef3c7', 0)] };
}

async function post(p: string, data: unknown): Promise<Response> {
  return fetch(`${h.url}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SSE stream', () => {
  it('sends an initial sync frame carrying current lock state', async () => {
    await post('/api/boards', { slug: 'my-board' });
    const { reader, abort } = await openStream('board=my-board');
    try {
      const sync = await reader.nextEvent('sync');
      expect(sync.data).toEqual({ locked: false, epoch: 0 });
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });

  it('delivers locked then unlocked frames as an AI session begins and ends', async () => {
    await post('/api/boards', { slug: 'my-board', label: 'My Board' });
    const { reader, abort } = await openStream('board=my-board');
    try {
      await reader.nextEvent('sync');

      // begin -> locked frame
      const begin = await post('/api/ai/begin', { board: 'my-board' });
      expect(begin.status).toBe(200);
      const locked = await reader.nextEvent('locked');
      expect(locked.data).toEqual({ epoch: 1 });

      // Simulate the AI's out-of-band disk write, then end -> unlocked frame
      // carrying the board.
      const finalBoard = boardWithSticky('My Board');
      await fs.writeFile(
        path.join(h.boardsRoot, 'my-board', 'board.json'),
        serialise(finalBoard),
        'utf-8',
      );
      const end = await post('/api/ai/end', { board: 'my-board' });
      expect(end.status).toBe(200);
      const unlocked = await reader.nextEvent('unlocked');
      const payload = unlocked.data as { epoch: number; board: BoardFile };
      expect(payload.epoch).toBe(2);
      expect(payload.board).toEqual(finalBoard);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });

  it('delivers an external-change frame when a board file is written directly on disk', async () => {
    await post('/api/boards', { slug: 'my-board', label: 'My Board' });
    // Let the create's self-write suppression window elapse before the
    // "external editor" write, so it isn't swallowed as our own write.
    await new Promise((r) => setTimeout(r, 80));

    const { reader, abort } = await openStream('board=my-board');
    try {
      await reader.nextEvent('sync');

      // Simulate an external editor writing the board file directly.
      const external = boardWithSticky('My Board');
      await fs.writeFile(
        path.join(h.boardsRoot, 'my-board', 'board.json'),
        serialise(external),
        'utf-8',
      );

      const frame = await reader.nextEvent('external-change');
      const payload = frame.data as { board: BoardFile };
      expect(payload.board).toEqual(external);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });
});
