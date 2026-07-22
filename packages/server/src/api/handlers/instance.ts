// ── /api/instance handler ────────────────────────────────────────────────────
//
// GET /api/instance — this server's identity + liveness probe. Returns the
// stable instance id, advertised name, full URL, version, and the current board
// slugs. The MCP `InstanceRegistry` hits this endpoint both to learn an
// instance's full metadata (the mDNS TXT record only carries a capped preview)
// and as its health check: a 200 means "alive"; a failure/timeout is what marks
// a stopped instance for eviction.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../../http/body.js';
import type { RequestContext } from '../router.js';

export interface InstanceInfoResponse {
  id: string;
  name: string;
  url: string;
  version: string;
  boards: string[];
}

/** GET /api/instance → `{ id, name, url, version, boards }`. */
export function handleGetInstance(
  ctx: RequestContext,
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const { id, name, url, version } = ctx.instance;
  const body: InstanceInfoResponse = {
    id,
    name,
    url,
    version,
    boards: ctx.repo.listSlugs(),
  };
  sendJson(res, 200, body);
}
