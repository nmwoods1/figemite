// ── Tags repository ───────────────────────────────────────────────────────────
//
// Reads/writes boards/<slug>/tags.json — kept separate from board.json so AI
// agents rewriting the board never touch tagging metadata. Missing file reads
// back as an empty tags list.

import fs from 'node:fs';
import { parseTagsFile, type TagsFile } from '@easel/shared';
import { tagsPath } from './paths.js';
import { atomicWriteFileSync } from './atomic-write.js';

/** Reads and validates a board's tags.json. Missing file -> `{ tags: [] }`. */
export function readTags(boardsRoot: string, slug: string): TagsFile {
  const filePath = tagsPath(boardsRoot, slug);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { tags: [] };
    }
    throw err;
  }

  try {
    return parseTagsFile(JSON.parse(raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid tags file at ${filePath}: ${message}`);
  }
}

/** Validates and atomically writes a board's tags.json. */
export function writeTags(boardsRoot: string, slug: string, tags: TagsFile): void {
  const filePath = tagsPath(boardsRoot, slug);
  const validated = parseTagsFile(tags);
  atomicWriteFileSync(filePath, JSON.stringify(validated, null, 2));
}
