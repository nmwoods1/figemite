// ── GET /api/events — SSE live updates ───────────────────────────────────────
//
// Opens a Server-Sent-Events stream for a board/sub-board. The SseHub sends an
// initial `sync` frame carrying the current AI lock state (`{ locked, epoch }`)
// so a reconnecting client reconciles immediately, then holds the connection
// open for `locked` / `unlocked` / `external-change` frames.
//
// Validation (slug/path) runs BEFORE any SSE header is written, so a bad
// request still surfaces as a normal JSON 400/404 (the router's error mapping
// handles the throw). Once headers are set we never switch back to a JSON error
// response for this request.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, PathSegmentSchema } from '@figemite/shared';
import { getQuery, parsePathParam } from '../../http/body.js';
import { ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

/** GET /api/events?board=&path= — subscribe to the board's SSE stream. */
export function handleEvents(ctx: RequestContext, req: IncomingMessage, res: ServerResponse): void {
  const query = getQuery(req);
  const slug = query.get('board') ?? '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(`Invalid or missing board: ${JSON.stringify(slug)}`);
  }
  const subPath = parsePathParam(query);
  // Reject a hostile segment (before it reaches sessionKey / any downstream
  // path use) as a 400 — done here, before any SSE header is written.
  for (const seg of subPath) {
    if (!PathSegmentSchema.safeParse(seg).success) {
      throw new ValidationError('Invalid sub-board path segment');
    }
  }
  // Optional draft scope: a draft view subscribes to its own event stream.
  const draftId = query.get('draft') ?? undefined;
  if (draftId !== undefined && !PathSegmentSchema.safeParse(draftId).success) {
    throw new ValidationError('Invalid draft id');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Flush headers immediately so the client's EventSource `open` fires and the
  // first frame can be read without waiting for more data.
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const initialState = ctx.ai.status(slug, subPath, draftId);
  const unsubscribe = ctx.sse.subscribe(slug, subPath, res, initialState, draftId);

  // SseHub already wires res.on('close', unsubscribe); also cover the request
  // stream closing/erroring (belt and suspenders — either can fire first).
  req.on('close', unsubscribe);
  req.on('error', unsubscribe);
}
