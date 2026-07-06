#!/usr/bin/env node
// ── Seeds the gitignored `boards/` dir from synthetic fixtures ───────────────
//
// Used exclusively by `playwright.config.ts`'s `webServer.command` — copies
// `fixtures/kitchen-sink` and `fixtures/minimal` into `<repoRoot>/boards/`
// (the dev-server's default `EASEL_BOARDS_DIR`, see
// `src/dev/easel-server-plugin.ts`'s `resolveDevBoardsRoot`) so the e2e gate
// has real board JSON to fetch via `#/kitchen-sink` and `#/minimal`.
//
// Deliberately copies (not symlinks) each fixture directory verbatim: the
// fixtures dir's file layout (`board.json`, dotted sub-board files,
// `comments.json`, `tags.json`) already matches the `boards/<slug>/…`
// convention `@easel/server`'s `BoardRepository` expects (see
// `boards/kitchen-sink/` for confirmation this is how the dev boards root is
// really laid out) — no transformation needed.
//
// Never removes pre-existing boards under other slugs; only overwrites the
// `kitchen-sink`/`minimal` slugs so a developer's own scratch boards survive
// running the e2e suite locally.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(CLIENT_ROOT, '../..');

const FIXTURES_ROOT = path.join(REPO_ROOT, 'fixtures');
const BOARDS_ROOT = process.env.EASEL_BOARDS_DIR
  ? path.resolve(process.env.EASEL_BOARDS_DIR)
  : path.join(REPO_ROOT, 'boards');

const SLUGS = ['kitchen-sink', 'minimal'];

fs.mkdirSync(BOARDS_ROOT, { recursive: true });

for (const slug of SLUGS) {
  const src = path.join(FIXTURES_ROOT, slug);
  const dest = path.join(BOARDS_ROOT, slug);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[seed-boards] ${slug}: ${src} -> ${dest}`);
}

console.log(`[seed-boards] done. boardsRoot="${BOARDS_ROOT}"`);
