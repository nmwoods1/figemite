// ── Data-access layer: dev (`/api/*`) vs READONLY (static `boards/…`) ────────
//
// The single module every UI component uses to read/write board data. Every
// function branches on `READONLY` (app/mode.ts):
//   - dev mode hits the `/api/*` endpoints the mounted @figemite/server exposes
//     (packages/server/src/api/router.ts) — same endpoint shapes/params.
//   - READONLY mode fetches static JSON under `boards/` (as produced by
//     @figemite/server's `buildStaticBoards`, packages/server/src/static-export.ts)
//     and disables every write (save/create/delete) by throwing ReadOnlyError.
//
// Ported from the original prototype's `src/lib/comment-io.ts`,
// `src/lib/tags-io.ts`, and the fetch logic inlined in `src/App.tsx`, unified
// behind one module + one path-builder helper (`apiUrl` / `staticUrl`) instead
// of scattering URL construction across components.
//
// All responses that carry board/comments/tags JSON are validated through the
// shared zod-backed parsers (`parseBoardFile` / `parseCommentsFile` /
// `parseTagsFile`) before being handed back to callers — this is
// defense-in-depth against a malformed dev-server response, and it's also what
// migrates a legacy v0 static board file (no `formatVersion`) on the fly in
// READONLY mode, since `buildStaticBoards` copies whatever is on disk verbatim.

import {
  parseBoardFile,
  parseCommentsFile,
  parseTagsFile,
  type BoardFile,
  type CommentsFile,
  type DraftMeta,
} from '@figemite/shared';
import { READONLY } from '../app/mode.js';

// ── Errors ────────────────────────────────────────────────────────────────────

/** Thrown by every write operation (save/create/delete) when running in READONLY mode. */
export class ReadOnlyError extends Error {
  constructor(action: string) {
    super(`Cannot ${action}: the app is running in read-only mode.`);
    this.name = 'ReadOnlyError';
  }
}

/** Thrown when a dev-mode `/api/*` request resolves with a non-ok HTTP status. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ── Path builders (single source of URL construction) ────────────────────────

/** Builds an `/api/*` URL with optional query params, dropping empty/undefined values. */
function apiUrl(path: string, params: Record<string, string | undefined> = {}): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

/** Builds the static `boards/<slug>/...` URL for a given sub-path resource file. */
function staticBoardUrl(slug: string, subPath: string[]): string {
  const encodedSlug = encodeURIComponent(slug);
  if (subPath.length === 0) return `boards/${encodedSlug}/board.json`;
  const segs = subPath.map((s) => encodeURIComponent(s)).join('.');
  return `boards/${encodedSlug}/board.${segs}.json`;
}

function staticSlugFileUrl(slug: string, filename: string): string {
  return `boards/${encodeURIComponent(slug)}/${filename}`;
}

/** Joins sub-board path segments the way the server's `path` query param expects (dot-separated). */
function pathParam(subPath: string[]): string | undefined {
  return subPath.length > 0 ? subPath.join('.') : undefined;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(
      0,
      `Network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    let message = `Request to ${url} failed with HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      /* body wasn't JSON — keep the generic message */
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

// ── Board list ────────────────────────────────────────────────────────────────

export interface BoardListItem {
  slug: string;
  label: string;
  tags: string[];
  subBoardPaths: string[][];
  lastModifiedMs: number;
}

export async function listBoards(): Promise<BoardListItem[]> {
  const url = READONLY ? 'boards/index.json' : apiUrl('/api/boards');
  const data = (await fetchJson(url)) as { boards?: BoardListItem[] };
  return Array.isArray(data.boards) ? data.boards : [];
}

// ── Board read/write ──────────────────────────────────────────────────────────

export async function getBoard(
  slug: string,
  path: string[],
  draftId?: string,
): Promise<BoardFile> {
  // Drafts are dev-only (never in the static build), so READONLY ignores
  // `draftId` and always resolves the prod static file.
  const url = READONLY
    ? staticBoardUrl(slug, path)
    : apiUrl('/api/board', { board: slug, path: pathParam(path), draft: draftId });
  const raw = await fetchJson(url);
  try {
    return parseBoardFile(raw);
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : String(err));
  }
}

export async function saveBoard(slug: string, path: string[], data: BoardFile): Promise<void> {
  if (READONLY) throw new ReadOnlyError('save a board');
  await fetchJson('/api/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, path, data }),
  });
}

export async function createBoard(slug: string, label?: string): Promise<void> {
  if (READONLY) throw new ReadOnlyError('create a board');
  await fetchJson('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, label }),
  });
}

export async function createSubBoard(slug: string, path: string[], label?: string): Promise<void> {
  if (READONLY) throw new ReadOnlyError('create a sub-board');
  await fetchJson('/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, path, label }),
  });
}

export async function deleteSubBoard(slug: string, path: string[]): Promise<void> {
  if (READONLY) throw new ReadOnlyError('delete a sub-board');
  const url = apiUrl('/api/board', { board: slug, path: pathParam(path) });
  await fetchJson(url, { method: 'DELETE' });
}

// ── Drafts (dev only — never part of the static build) ───────────────────────

export type { DraftMeta };

/** Lists a board's drafts. Empty in READONLY mode (drafts aren't exported). */
export async function listDrafts(slug: string): Promise<DraftMeta[]> {
  if (READONLY) return [];
  const data = (await fetchJson(apiUrl('/api/drafts', { board: slug }))) as {
    drafts?: DraftMeta[];
  };
  return Array.isArray(data.drafts) ? data.drafts : [];
}

/** Creates a new (human-authored) draft of a board; returns its id. */
export async function createDraft(slug: string, title?: string): Promise<string> {
  if (READONLY) throw new ReadOnlyError('create a draft');
  const data = (await fetchJson('/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, title, createdBy: 'human' }),
  })) as { draftId?: string };
  if (!data.draftId) throw new ApiError(0, 'Server did not return a draft id');
  return data.draftId;
}

/** Discards a draft (deletes it without touching prod). */
export async function discardDraft(slug: string, draftId: string): Promise<void> {
  if (READONLY) throw new ReadOnlyError('discard a draft');
  const url = apiUrl('/api/drafts', { board: slug, draft: draftId });
  await fetchJson(url, { method: 'DELETE' });
}

/** Approves a draft, overwriting prod with its content. Human-only. */
export async function promoteDraft(slug: string, draftId: string): Promise<void> {
  if (READONLY) throw new ReadOnlyError('approve a draft');
  await fetchJson('/api/board/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, draft: draftId }),
  });
}

// ── Comments ──────────────────────────────────────────────────────────────────

export async function fetchComments(slug: string): Promise<CommentsFile> {
  const url = READONLY
    ? staticSlugFileUrl(slug, 'comments.json')
    : apiUrl('/api/comments', { board: slug });
  const raw = await fetchJson(url);
  try {
    return parseCommentsFile(raw);
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : String(err));
  }
}

export async function saveComments(slug: string, data: CommentsFile): Promise<void> {
  if (READONLY) throw new ReadOnlyError('save comments');
  await fetchJson('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, data }),
  });
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function fetchTags(slug: string): Promise<string[]> {
  const url = READONLY
    ? staticSlugFileUrl(slug, 'tags.json')
    : apiUrl('/api/tags', { board: slug });
  const raw = await fetchJson(url);
  try {
    return parseTagsFile(raw).tags;
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : String(err));
  }
}

export async function saveTags(slug: string, tags: string[]): Promise<void> {
  if (READONLY) throw new ReadOnlyError('save tags');
  await fetchJson('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: slug, tags }),
  });
}

// ── History (dev only — not part of the static build) ────────────────────────

export interface HistoryVersion {
  id: string;
  timestamp: string;
  trigger: 'save' | 'preai' | 'ai';
}

export async function fetchHistory(slug: string, path: string[]): Promise<HistoryVersion[]> {
  if (READONLY) {
    throw new Error(
      'History is not available in read-only mode (not included in the static build).',
    );
  }
  const url = apiUrl('/api/history', { board: slug, path: pathParam(path) });
  const data = (await fetchJson(url)) as { versions?: HistoryVersion[] };
  return Array.isArray(data.versions) ? data.versions : [];
}

export async function fetchVersion(slug: string, path: string[], id: string): Promise<BoardFile> {
  if (READONLY) {
    throw new Error(
      'History is not available in read-only mode (not included in the static build).',
    );
  }
  const url = apiUrl('/api/history/version', { board: slug, path: pathParam(path), id });
  const raw = await fetchJson(url);
  try {
    return parseBoardFile(raw);
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : String(err));
  }
}
