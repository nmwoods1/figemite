// ── Board file-layout path helpers ──────────────────────────────────────────
//
// Ported from the original prototype's `vite.config.ts` (boardFile /
// historyDir helpers embedded in the dev-server Vite plugin) into a
// standalone, pure module with no HTTP/plugin dependencies.
//
// File layout under `boardsRoot`:
//   <boardsRoot>/<slug>/board.json                     — root board
//   <boardsRoot>/<slug>/board.<seg1>.<seg2>....json     — sub-board (dotted path)
//   <boardsRoot>/<slug>/.history/                       — root board history
//   <boardsRoot>/<slug>/.history/<seg1>.<seg2>/         — sub-board history
//   <boardsRoot>/<slug>/comments.json
//   <boardsRoot>/<slug>/tags.json
//   <boardsRoot>/<slug>/drafts.json                    — draft index (sidecar)
//   <boardsRoot>/<slug>/.drafts/<draftId>/…            — a draft: a full board
//     directory (board.json, dotted sub-boards, .history/) nested under its
//     parent. Passing `draftId` to a path builder re-roots the board file
//     layout into this directory, so a draft is stored byte-for-byte like a
//     prod board — just one level deeper. `draftId` obeys the same id grammar
//     as a path segment (validated below), so `.drafts/<draftId>/` is as
//     traversal-safe as every dotted sub-board name.
//
// Security: every path builder below is defense-in-depth against path
// traversal. `validateSlugAndPath` rejects any slug/segment that doesn't
// match the shared id grammar (`SlugSchema` / `PathSegmentSchema`) — this
// alone rules out `.`, `/`, `\`, `..`, empty segments, and NUL bytes, since
// none of those characters are in `[A-Za-z0-9_-]+`. As a second, independent
// layer, every builder below also resolves its result with `path.resolve`
// and asserts the resolved path stays inside `path.resolve(boardsRoot)`
// before returning, throwing otherwise. The legacy prototype's `parsePath`
// only rejected empty segments — a lone id-grammar bypass there would have
// been a path-traversal hole; this module closes it structurally.

import path from 'node:path';
import { PathSegmentSchema, SlugSchema } from '@figemite/shared';

/**
 * Throws unless `slug` and every `subPath` segment match the shared id
 * grammar. This is the primary defense: valid ids can never contain `.`,
 * `/`, `\`, `..`, or be empty, so a validated slug/path can never encode a
 * path-traversal attempt via the dotted file-naming scheme.
 */
export function validateSlugAndPath(slug: string, subPath: string[]): void {
  const slugResult = SlugSchema.safeParse(slug);
  if (!slugResult.success) {
    throw new Error(`Invalid board slug ${JSON.stringify(slug)}: ${slugResult.error.message}`);
  }
  for (const segment of subPath) {
    const segResult = PathSegmentSchema.safeParse(segment);
    if (!segResult.success) {
      throw new Error(
        `Invalid sub-board path segment ${JSON.stringify(segment)}: ${segResult.error.message}`,
      );
    }
  }
}

/**
 * Throws unless `draftId` matches the shared id grammar. A draft id becomes a
 * directory name (`.drafts/<draftId>/`) AND arrives off the attacker-controlled
 * Yjs room name (via `parseRoomName`), so it must pass the exact same grammar
 * gate as a path segment before it is ever joined into a filesystem path — this
 * is what makes `.drafts/<draftId>/` traversal-safe.
 */
export function validateDraftId(draftId: string): void {
  const result = PathSegmentSchema.safeParse(draftId);
  if (!result.success) {
    throw new Error(`Invalid draft id ${JSON.stringify(draftId)}: ${result.error.message}`);
  }
}

/**
 * The directory that holds a board's content files (`board.json`, dotted
 * sub-boards, `.history/`). For prod this is `<boardsRoot>/<slug>`; for a draft
 * it is `<boardsRoot>/<slug>/.drafts/<draftId>`. Callers must have validated
 * `slug`/`draftId` first — every public builder below does.
 */
function contentDir(boardsRoot: string, slug: string, draftId?: string): string {
  return draftId === undefined
    ? path.join(boardsRoot, slug)
    : path.join(boardsRoot, slug, '.drafts', draftId);
}

/**
 * Defense-in-depth: resolves `candidate` and asserts it stays inside
 * `path.resolve(boardsRoot)`. Called by every path builder in this module
 * after building the path, independent of `validateSlugAndPath` having
 * already run — so a bug in the grammar check, or a future caller that
 * skips it, still can't escape `boardsRoot`.
 */
function assertInsideRoot(boardsRoot: string, candidate: string): string {
  const resolvedRoot = path.resolve(boardsRoot);
  const resolvedCandidate = path.resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(
      `Path traversal rejected: ${JSON.stringify(candidate)} resolves outside boardsRoot ${JSON.stringify(boardsRoot)}`,
    );
  }
  return resolvedCandidate;
}

/**
 * The JSON file path for a board or sub-board (of prod, or of a draft when
 * `draftId` is given).
 * Prod root   -> <boardsRoot>/<slug>/board.json
 * Prod sub    -> <boardsRoot>/<slug>/board.<seg1>.<seg2>....json
 * Draft root  -> <boardsRoot>/<slug>/.drafts/<draftId>/board.json
 * Draft sub   -> <boardsRoot>/<slug>/.drafts/<draftId>/board.<seg1>....json
 */
export function boardFilePath(
  boardsRoot: string,
  slug: string,
  subPath: string[],
  draftId?: string,
): string {
  validateSlugAndPath(slug, subPath);
  if (draftId !== undefined) validateDraftId(draftId);
  const filename = subPath.length ? `board.${subPath.join('.')}.json` : 'board.json';
  return assertInsideRoot(boardsRoot, path.join(contentDir(boardsRoot, slug, draftId), filename));
}

/**
 * The history directory for a board or sub-board (of prod, or of a draft when
 * `draftId` is given).
 * Prod root  -> <boardsRoot>/<slug>/.history
 * Prod sub   -> <boardsRoot>/<slug>/.history/<seg1>.<seg2>...
 * Draft      -> <boardsRoot>/<slug>/.drafts/<draftId>/.history[/<seg1>...]
 */
export function historyDir(
  boardsRoot: string,
  slug: string,
  subPath: string[],
  draftId?: string,
): string {
  validateSlugAndPath(slug, subPath);
  if (draftId !== undefined) validateDraftId(draftId);
  const base = contentDir(boardsRoot, slug, draftId);
  const dir = subPath.length ? path.join(base, '.history', subPath.join('.')) : path.join(base, '.history');
  return assertInsideRoot(boardsRoot, dir);
}

/** The comments.json file path for a board. Comments are prod-only (human-owned). */
export function commentsPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, 'comments.json'));
}

/** The tags.json file path for a board. Tags are prod-only (human-owned). */
export function tagsPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, 'tags.json'));
}

/** The drafts.json index sidecar for a board: <boardsRoot>/<slug>/drafts.json. */
export function draftsPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, 'drafts.json'));
}

/** The `.drafts` directory holding all of a board's draft dirs. */
export function draftsRootDir(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, '.drafts'));
}

/** A single draft's directory: <boardsRoot>/<slug>/.drafts/<draftId>. */
export function draftDirPath(boardsRoot: string, slug: string, draftId: string): string {
  validateSlugAndPath(slug, []);
  validateDraftId(draftId);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, '.drafts', draftId));
}

/**
 * The directory that contains a board's content files — `<boardsRoot>/<slug>`
 * for prod, `<boardsRoot>/<slug>/.drafts/<draftId>` for a draft. Used by the
 * repository to enumerate/delete board + sub-board files at the right level.
 */
export function contentDirPath(boardsRoot: string, slug: string, draftId?: string): string {
  validateSlugAndPath(slug, []);
  if (draftId !== undefined) validateDraftId(draftId);
  return assertInsideRoot(boardsRoot, contentDir(boardsRoot, slug, draftId));
}

/** The board directory for a slug: <boardsRoot>/<slug> (the whole board, incl. drafts). */
export function boardDirPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug));
}
