// ── Board-management HTTP client ─────────────────────────────────────────────
//
// `list_boards`/`create_board` talk to the plain REST API (no Yjs room
// connection required) rather than a BoardPeer's doc — ported from the
// original prototype's inline `fetch` calls in server.ts, pulled out
// into their own module so they're testable with a mocked `fetch` without
// touching MCP tool registration at all.

export interface InstanceInfoResult {
  id: string;
  name: string;
  url: string;
  version: string;
  boards: string[];
}

/**
 * GET `${httpUrl}/api/instance`. Returns the server's identity + current boards.
 * Used by the InstanceRegistry both to enrich a discovered instance and as its
 * health probe (a thrown error / timeout means "unhealthy / stopped"). Pass an
 * `AbortSignal` to bound the health-check wait.
 */
export async function getInstance(
  httpUrl: string,
  signal?: AbortSignal,
): Promise<InstanceInfoResult> {
  const res = await fetch(`${httpUrl}/api/instance`, { signal });
  const data = (await res.json()) as InstanceInfoResult & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to get instance: HTTP ${res.status}`);
  }
  return data;
}

export interface ListBoardsResult {
  boards: unknown[];
}

export interface CreateBoardResult {
  ok: true;
  slug: string;
}

/** GET `${httpUrl}/api/boards`. Throws with the server's error message on a non-2xx response. */
export async function listBoards(httpUrl: string): Promise<ListBoardsResult> {
  const res = await fetch(`${httpUrl}/api/boards`);
  const data = (await res.json()) as ListBoardsResult & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to list boards: HTTP ${res.status}`);
  }
  return data;
}

/** POST `${httpUrl}/api/boards` with `{ slug, label? }`. Throws with the server's error message on a non-2xx response. */
export async function createBoard(
  httpUrl: string,
  slug: string,
  label?: string,
): Promise<CreateBoardResult> {
  const res = await fetch(`${httpUrl}/api/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, label }),
  });
  const data = (await res.json()) as CreateBoardResult & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to create board: HTTP ${res.status}`);
  }
  return data;
}

export interface ListDraftsResult {
  drafts: unknown[];
}

export interface CreateDraftResult {
  ok: true;
  draftId: string;
  draft: unknown;
}

/** GET `${httpUrl}/api/drafts?board=<slug>`. Throws with the server's error message on a non-2xx response. */
export async function listDrafts(httpUrl: string, slug: string): Promise<ListDraftsResult> {
  const res = await fetch(`${httpUrl}/api/drafts?board=${encodeURIComponent(slug)}`);
  const data = (await res.json()) as ListDraftsResult & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to list drafts: HTTP ${res.status}`);
  }
  return data;
}

/**
 * POST `${httpUrl}/api/drafts` with `{ board, title?, createdBy: 'agent' }`.
 * Agents always create drafts tagged as agent-authored. Throws with the
 * server's error message on a non-2xx response.
 */
export async function createDraft(
  httpUrl: string,
  slug: string,
  title?: string,
): Promise<CreateDraftResult> {
  const res = await fetch(`${httpUrl}/api/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, title, createdBy: 'agent' }),
  });
  const data = (await res.json()) as CreateDraftResult & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Failed to create draft: HTTP ${res.status}`);
  }
  return data;
}
