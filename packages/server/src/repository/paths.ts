// ── Board file-layout path helpers ──────────────────────────────────────────
//
// Ported from the figmalade prototype's `vite.config.ts` (boardFile /
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
import { PathSegmentSchema, SlugSchema } from '@easel/shared';

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
 * The JSON file path for a board or sub-board.
 * Root board  -> <boardsRoot>/<slug>/board.json
 * Sub-board   -> <boardsRoot>/<slug>/board.<seg1>.<seg2>....json
 */
export function boardFilePath(boardsRoot: string, slug: string, subPath: string[]): string {
  validateSlugAndPath(slug, subPath);
  const filename = subPath.length ? `board.${subPath.join('.')}.json` : 'board.json';
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, filename));
}

/**
 * The history directory for a board or sub-board.
 * Root board  -> <boardsRoot>/<slug>/.history
 * Sub-board   -> <boardsRoot>/<slug>/.history/<seg1>.<seg2>...
 */
export function historyDir(boardsRoot: string, slug: string, subPath: string[]): string {
  validateSlugAndPath(slug, subPath);
  const dir = subPath.length
    ? path.join(boardsRoot, slug, '.history', subPath.join('.'))
    : path.join(boardsRoot, slug, '.history');
  return assertInsideRoot(boardsRoot, dir);
}

/** The comments.json file path for a board. */
export function commentsPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, 'comments.json'));
}

/** The tags.json file path for a board. */
export function tagsPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug, 'tags.json'));
}

/** The board directory for a slug: <boardsRoot>/<slug>. */
export function boardDirPath(boardsRoot: string, slug: string): string {
  validateSlugAndPath(slug, []);
  return assertInsideRoot(boardsRoot, path.join(boardsRoot, slug));
}
