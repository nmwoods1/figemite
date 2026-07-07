// ── board-http unit tests ─────────────────────────────────────────────────────
//
// Mocks global fetch so these tests never make a real network call — proves
// listBoards/createBoard hit the right endpoint, method, and body, and
// surface the server's error message on failure.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { listBoards, createBoard } from './board-http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('listBoards', () => {
  it('GETs /api/boards on the given httpUrl', async () => {
    let calledUrl = '';
    let calledMethod = '';
    stubFetch(async (url, init) => {
      calledUrl = String(url);
      calledMethod = init?.method ?? 'GET';
      return jsonResponse({ boards: [{ slug: 'spend' }] });
    });

    const result = await listBoards('http://localhost:5400');

    expect(calledUrl).toBe('http://localhost:5400/api/boards');
    expect(calledMethod).toBe('GET');
    expect(result.boards).toEqual([{ slug: 'spend' }]);
  });

  it('throws the server error message on a non-2xx response', async () => {
    stubFetch(async () => jsonResponse({ error: 'boom' }, 500));
    await expect(listBoards('http://localhost:5400')).rejects.toThrow('boom');
  });

  it('falls back to a generic message when the error body has none', async () => {
    stubFetch(async () => jsonResponse({}, 500));
    await expect(listBoards('http://localhost:5400')).rejects.toThrow(/HTTP 500/);
  });
});

describe('createBoard', () => {
  it('POSTs /api/boards with the slug and label as JSON', async () => {
    let calledUrl = '';
    let calledMethod = '';
    let calledBody: unknown;
    stubFetch(async (url, init) => {
      calledUrl = String(url);
      calledMethod = init?.method ?? '';
      calledBody = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse({ ok: true, slug: 'payment-flow' });
    });

    const result = await createBoard('http://localhost:5400', 'payment-flow', 'Payment Flow');

    expect(calledUrl).toBe('http://localhost:5400/api/boards');
    expect(calledMethod).toBe('POST');
    expect(calledBody).toEqual({ slug: 'payment-flow', label: 'Payment Flow' });
    expect(result).toEqual({ ok: true, slug: 'payment-flow' });
  });

  it('throws the server error message on a non-2xx response', async () => {
    stubFetch(async () => jsonResponse({ error: 'A board with that name already exists.' }, 409));
    await expect(createBoard('http://localhost:5400', 'spend')).rejects.toThrow(
      'A board with that name already exists.',
    );
  });
});
