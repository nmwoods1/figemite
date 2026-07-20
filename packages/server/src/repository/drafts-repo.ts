// ── Drafts index repository ───────────────────────────────────────────────────
//
// Reads/writes boards/<slug>/drafts.json — the human-owned index of a board's
// drafts (id, title, provenance). Kept separate from board.json (like tags.json
// / comments.json) so an agent rewriting board content never touches it. The
// actual draft board data lives in boards/<slug>/.drafts/<id>/; this file is
// just the metadata index. Missing file reads back as an empty draft list.

import fs from 'node:fs';
import { parseDraftsFile, type DraftsFile } from '@figemite/shared';
import { draftsPath } from './paths.js';
import { atomicWriteFileSync } from './atomic-write.js';

/** Reads and validates a board's drafts.json. Missing file -> `{ drafts: [] }`. */
export function readDrafts(boardsRoot: string, slug: string): DraftsFile {
  const filePath = draftsPath(boardsRoot, slug);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { drafts: [] };
    }
    throw err;
  }

  try {
    return parseDraftsFile(JSON.parse(raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid drafts file at ${filePath}: ${message}`);
  }
}

/** Validates and atomically writes a board's drafts.json. */
export function writeDrafts(boardsRoot: string, slug: string, drafts: DraftsFile): void {
  const filePath = draftsPath(boardsRoot, slug);
  const validated = parseDraftsFile(drafts);
  atomicWriteFileSync(filePath, JSON.stringify(validated, null, 2));
}
