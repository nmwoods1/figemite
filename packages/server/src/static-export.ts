// ── buildStaticBoards — repo-driven static-board export (P1-T13) ────────────
//
// Ports the repo-driven half of the figmalade prototype's
// `scripts/build-static.mjs` (steps 3-4: copy board/comments/tags files, write
// `boards/index.json`) into a standalone, reusable function. Deliberately
// excludes step 2 (`vite build`) and step 5 (`dist/` -> `public/` rename) —
// there is no client app yet in Phase 1; a later Phase-2 `build-static.mjs`
// will `vite build` the client into `dist/`, call `buildStaticBoards(boardsRoot,
// 'dist')` to populate `dist/boards/`, then rename `dist` -> `public`.
//
// Uses `BoardRepository` (for slugs/sub-board-paths/labels/read) and the
// comments/tags repo modules for everything path- and content-related, so
// there is exactly ONE path parser for the board file-layout convention
// (`repository/paths.ts`) — this module never re-walks directories or parses
// `board.<segs>.json` filenames itself, unlike the legacy script, which
// duplicated that parsing inline.
//
// Output layout, matching what the legacy static client reads:
//   <outDir>/boards/<slug>/board.json
//   <outDir>/boards/<slug>/board.<seg1>.<seg2>....json   (one per sub-board)
//   <outDir>/boards/<slug>/comments.json                  (empty file if none)
//   <outDir>/boards/<slug>/tags.json                       (empty file if none)
//   <outDir>/boards/index.json                             (the manifest)

import fs from 'node:fs';
import path from 'node:path';
import { boardFilePath } from './repository/paths.js';
import { BoardRepository } from './repository/board-repo.js';
import { readComments } from './repository/comments-repo.js';
import { readTags } from './repository/tags-repo.js';

interface StaticBoardManifestEntry {
  slug: string;
  label: string;
  tags: string[];
  subBoardPaths: string[][];
  /** Root board file mtime in epoch-ms — matches the live `/api/boards` field name. */
  lastModifiedMs: number;
}

/** Title-cases a slug for a fallback display label: `my-board` -> `My Board`. Mirrors api/handlers/boards.ts. */
function titleCaseSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Exports every board (and sub-board) under `boardsRoot` into a static bundle
 * at `<outDir>/boards/`, plus a top-level manifest. Safe to call against an
 * `outDir` that doesn't exist yet (created as needed) or that already has
 * content (files are overwritten, not merged/cleaned first — matching the
 * legacy script's plain `fs.mkdirSync(..., { recursive: true })` + copy
 * behaviour; callers wanting a pristine `outDir` should remove it first).
 */
export async function buildStaticBoards(boardsRoot: string, outDir: string): Promise<void> {
  const repo = new BoardRepository(boardsRoot);
  const boardsOut = path.join(outDir, 'boards');
  fs.mkdirSync(boardsOut, { recursive: true });

  const manifest: StaticBoardManifestEntry[] = [];

  for (const slug of repo.listSlugs()) {
    if (!repo.exists(slug, [])) continue; // no root board.json — not a real board dir

    const slugOut = path.join(boardsOut, slug);
    fs.mkdirSync(slugOut, { recursive: true });

    // Root board.
    const rootSrc = boardFilePath(boardsRoot, slug, []);
    fs.copyFileSync(rootSrc, path.join(slugOut, 'board.json'));

    // Every sub-board file, via the repository's own path parser.
    const subBoardPaths = repo.listSubBoardPaths(slug);
    for (const subPath of subBoardPaths) {
      const src = boardFilePath(boardsRoot, slug, subPath);
      const dest = path.join(slugOut, `board.${subPath.join('.')}.json`);
      fs.copyFileSync(src, dest);
    }

    // comments.json / tags.json — the repo helpers already default to an
    // empty file's parsed shape when missing, so writing their result back
    // out covers both "copy if present" and "write empty if absent".
    const comments = readComments(boardsRoot, slug);
    fs.writeFileSync(path.join(slugOut, 'comments.json'), JSON.stringify(comments, null, 2));

    const tagsFile = readTags(boardsRoot, slug);
    fs.writeFileSync(path.join(slugOut, 'tags.json'), JSON.stringify(tagsFile, null, 2));

    let label = titleCaseSlug(slug);
    try {
      label = repo.extractBoardLabel(slug);
    } catch {
      // Corrupt/unreadable root board — fall back to the title-cased slug
      // rather than dropping the board from the manifest, matching
      // api/handlers/boards.ts's listing behaviour.
    }

    let lastModifiedMs = 0;
    try {
      lastModifiedMs = fs.statSync(rootSrc).mtimeMs;
    } catch {
      // Shouldn't happen (we just copied it), but don't fail the export.
    }

    manifest.push({ slug, label, tags: tagsFile.tags, subBoardPaths, lastModifiedMs });
  }

  fs.writeFileSync(
    path.join(boardsOut, 'index.json'),
    JSON.stringify({ boards: manifest }, null, 2),
  );
}
