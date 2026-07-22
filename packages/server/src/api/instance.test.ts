// ── GET /api/instance ────────────────────────────────────────────────────────
//
// Drives the real request handler over HTTP (via startTestServer) and asserts
// the identity + liveness endpoint the MCP registry health-checks against.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBoard } from '@figemite/shared';
import { startTestServer, type TestHarness } from './test-server.js';

let h: TestHarness;

beforeEach(async () => {
  h = await startTestServer();
});

afterEach(async () => {
  await h.close();
});

describe('GET /api/instance', () => {
  it('returns id, name, url, version, and the current board slugs', async () => {
    h.ctx.repo.write('spend', [], emptyBoard('Spend'));
    h.ctx.repo.write('planning', [], emptyBoard('Planning'));

    const res = await fetch(`${h.url}/api/instance`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      id: h.ctx.instance.id,
      name: h.ctx.instance.name,
      url: h.ctx.instance.url,
      version: h.ctx.instance.version,
    });
    expect([...body.boards].sort()).toEqual(['planning', 'spend']);
  });

  it('reports an empty boards list on a fresh server', async () => {
    const body = await (await fetch(`${h.url}/api/instance`)).json();
    expect(body.boards).toEqual([]);
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
  });
});
