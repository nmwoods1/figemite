import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  getQuery,
  parsePathParam,
  readJsonBody,
  sendError,
  sendJson,
} from './body.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

/**
 * A minimal `IncomingMessage`-shaped stub built from a string body. Node's
 * `Readable` already provides the `on('data'|'end'|'error')` surface
 * `readJsonBody` consumes, so we cast a `Readable` with the fields body/query
 * helpers touch.
 */
function reqFrom(body: string, url = '/'): IncomingMessage {
  const stream = Readable.from([Buffer.from(body, 'utf-8')]) as unknown as IncomingMessage;
  stream.url = url;
  stream.method = 'POST';
  stream.headers = { host: 'localhost' };
  return stream;
}

/** A req whose body arrives in many chunks (to exercise streaming accumulation). */
function reqFromChunks(chunks: string[], url = '/'): IncomingMessage {
  const stream = Readable.from(
    chunks.map((c) => Buffer.from(c, 'utf-8')),
  ) as unknown as IncomingMessage;
  stream.url = url;
  stream.method = 'POST';
  stream.headers = { host: 'localhost' };
  return stream;
}

interface CapturedRes {
  res: ServerResponse;
  statusCode: () => number;
  headers: () => Record<string, string>;
  body: () => string;
}

function captureRes(): CapturedRes {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
  } as unknown as ServerResponse;
  return {
    res,
    statusCode: () => statusCode,
    headers: () => headers,
    body: () => body,
  };
}

// ── readJsonBody ─────────────────────────────────────────────────────────────

describe('readJsonBody', () => {
  it('parses a well-formed JSON object body', async () => {
    const parsed = await readJsonBody(reqFrom('{"a":1,"b":"x"}'));
    expect(parsed).toEqual({ a: 1, b: 'x' });
  });

  it('accumulates a body delivered across multiple chunks', async () => {
    const parsed = await readJsonBody(reqFromChunks(['{"hello":', '"wor', 'ld"}']));
    expect(parsed).toEqual({ hello: 'world' });
  });

  it('rejects malformed JSON', async () => {
    await expect(readJsonBody(reqFrom('{not json'))).rejects.toThrow();
  });

  it('rejects an empty body (no JSON to parse)', async () => {
    await expect(readJsonBody(reqFrom(''))).rejects.toThrow();
  });

  it('rejects a body larger than the cap without buffering the whole thing', async () => {
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1024);
    await expect(readJsonBody(reqFrom(`"${huge}"`))).rejects.toThrow(/too large/i);
  });
});

// ── getQuery / parsePathParam ────────────────────────────────────────────────

describe('getQuery', () => {
  it('returns URLSearchParams for the request url', () => {
    const q = getQuery(reqFrom('', '/api/board?board=foo&path=A.B'));
    expect(q.get('board')).toBe('foo');
    expect(q.get('path')).toBe('A.B');
  });

  it('returns empty params when there is no query string', () => {
    const q = getQuery(reqFrom('', '/api/board'));
    expect(q.get('board')).toBeNull();
  });
});

describe('parsePathParam', () => {
  it('splits a dotted path value into segments', () => {
    const q = new URLSearchParams('path=Node1.Sub2');
    expect(parsePathParam(q)).toEqual(['Node1', 'Sub2']);
  });

  it('returns [] when path is absent', () => {
    expect(parsePathParam(new URLSearchParams(''))).toEqual([]);
  });

  it('returns [] when path is present but empty', () => {
    expect(parsePathParam(new URLSearchParams('path='))).toEqual([]);
  });

  it('drops empty segments produced by stray dots', () => {
    const q = new URLSearchParams('path=A..B.');
    expect(parsePathParam(q)).toEqual(['A', 'B']);
  });
});

// ── sendJson / sendError ─────────────────────────────────────────────────────

describe('sendJson', () => {
  it('writes status, content-type, and serialised body', () => {
    const cap = captureRes();
    sendJson(cap.res, 201, { ok: true });
    expect(cap.statusCode()).toBe(201);
    expect(cap.headers()['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(cap.body())).toEqual({ ok: true });
  });
});

describe('sendError', () => {
  it('writes an { error } envelope with the given status', () => {
    const cap = captureRes();
    sendError(cap.res, 404, 'not_found');
    expect(cap.statusCode()).toBe(404);
    expect(JSON.parse(cap.body())).toEqual({ error: 'not_found' });
  });
});
