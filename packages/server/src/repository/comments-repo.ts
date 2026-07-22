// ── Comments repository ──────────────────────────────────────────────────────
//
// Reads/writes a board version's comments.json — prod's `<slug>/comments.json`
// when `draftId` is omitted, or a draft's `<slug>/.drafts/<draftId>/comments.json`
// when given, so each version owns its own thread. Kept separate from board.json
// so the AI loop can rewrite the board wholesale without touching human
// discussion. Missing file reads back as an empty comments list.

import fs from 'node:fs';
import { parseCommentsFile, type CommentsFile } from '@figemite/shared';
import { commentsPath } from './paths.js';
import { atomicWriteFileSync } from './atomic-write.js';

/** Reads and validates a board version's comments.json. Missing file -> `{ comments: [] }`. */
export function readComments(boardsRoot: string, slug: string, draftId?: string): CommentsFile {
  const filePath = commentsPath(boardsRoot, slug, draftId);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { comments: [] };
    }
    throw err;
  }

  try {
    return parseCommentsFile(JSON.parse(raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid comments file at ${filePath}: ${message}`);
  }
}

/** Validates and atomically writes a board version's comments.json. */
export function writeComments(
  boardsRoot: string,
  slug: string,
  comments: CommentsFile,
  draftId?: string,
): void {
  const filePath = commentsPath(boardsRoot, slug, draftId);
  const validated = parseCommentsFile(comments);
  atomicWriteFileSync(filePath, JSON.stringify(validated, null, 2));
}
