// ── Atomic write helper ──────────────────────────────────────────────────────
//
// Shared by board-repo.ts, comments-repo.ts, and tags-repo.ts: write to a
// temp file in the same directory, then `fs.renameSync` over the target.
// Rename within the same filesystem is atomic, so readers never observe a
// partially-written file.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Writes `content` to `filePath` atomically, creating parent directories as needed. */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}
