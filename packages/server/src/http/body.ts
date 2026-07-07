// ── HTTP request/response helpers ────────────────────────────────────────────
//
// Small, transport-level utilities shared by every endpoint handler: reading
// and size-capping a JSON request body, extracting query params, splitting the
// dotted `path` sub-board query param, and writing JSON / error responses.
//
// Ported from the original prototype's inline `readBody` / `json` closures and
// `parseBoard` / `parsePath` helpers (vite.config.ts ~54-81, ~450-453), with
// two deliberate hardenings:
//   - `readJsonBody` caps the accumulated body at `MAX_BODY_BYTES` and aborts
//     the stream once exceeded, rather than buffering an unbounded body into
//     memory (the legacy `readBody` concatenated every chunk with no limit).
//   - `readJsonBody` returns parsed JSON (`unknown`) and rejects on malformed
//     or empty input, so callers never see a half-parsed string.

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Maximum accepted request-body size in bytes. Board payloads are the largest
 * bodies this server handles and are still small (a board is a bounded set of
 * nodes/edges); 8 MiB is a generous ceiling that still refuses a hostile
 * unbounded upload before it can exhaust memory.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Collects the request body, enforces the size cap, and `JSON.parse`s it.
 * Rejects on a body over the cap, on malformed JSON, and on an empty body.
 * Never resolves with a raw string — callers get parsed `unknown`.
 */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer | string) => {
      if (aborted) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk;
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        // Stop consuming further data; reject immediately.
        req.destroy();
        reject(new Error(`Request body too large (limit ${MAX_BODY_BYTES} bytes)`));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw.trim().length === 0) {
        reject(new Error('Empty request body'));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Malformed JSON request body'));
      }
    });

    req.on('error', (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

/** Parses the request URL's query string into a `URLSearchParams`. */
export function getQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '', 'http://localhost');
  return url.searchParams;
}

/**
 * Splits the `path` query value into sub-board segments on `.`, dropping empty
 * segments (stray/leading/trailing dots). Returns `[]` when `path` is absent or
 * empty. Segment grammar is NOT validated here — the repository/path layer
 * re-validates every segment against the shared id grammar before touching the
 * filesystem, so an invalid segment surfaces as a 400 there.
 */
export function parsePathParam(query: URLSearchParams): string[] {
  const raw = query.get('path') ?? '';
  if (!raw) return [];
  return raw.split('.').filter(Boolean);
}

/** Writes `obj` as a JSON response with `status`. */
export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

/** Writes a `{ error: message }` JSON envelope with `status`. */
export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}
