// ── Comments repository ──────────────────────────────────────────────────────
//
// Reads/writes boards/<slug>/comments.json — kept separate from board.json so
// the AI loop can rewrite the board wholesale without touching human
// discussion. Missing file reads back as an empty comments list.

import fs from 'node:fs';
import { parseCommentsFile, type CommentsFile } from '@figemite/shared';
import { commentsPath } from './paths.js';
import { atomicWriteFileSync } from './atomic-write.js';

/** Reads and validates a board's comments.json. Missing file -> `{ comments: [] }`. */
export function readComments(boardsRoot: string, slug: string): CommentsFile {
  const filePath = commentsPath(boardsRoot, slug);

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

/** Validates and atomically writes a board's comments.json. */
export function writeComments(boardsRoot: string, slug: string, comments: CommentsFile): void {
  const filePath = commentsPath(boardsRoot, slug);
  const validated = parseCommentsFile(comments);
  atomicWriteFileSync(filePath, JSON.stringify(validated, null, 2));
}
