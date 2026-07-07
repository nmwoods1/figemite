#!/usr/bin/env node
// ── Seeds the gitignored `boards/` dir from synthetic fixtures ───────────────
//
// Used by `playwright.config.ts`'s `webServer.command` (as a CLI, see the
// `import.meta.url` guard at the bottom) — copies `fixtures/kitchen-sink`,
// `fixtures/minimal`, `fixtures/interaction`, `fixtures/multiplayer`, and
// `fixtures/overlays-history` into `<repoRoot>/boards/` (the dev-server's
// default `FIGEMITE_BOARDS_DIR`, see `src/dev/figemite-server-plugin.ts`'s
// `resolveDevBoardsRoot`) so the e2e gate has real board JSON to fetch via
// `#/kitchen-sink`, `#/minimal`, `#/interaction`, `#/multiplayer`,
// `#/overlays-history`.
//
// Also exported as `seedSlug`/`seedAll` for `interaction.spec.ts`'s,
// `multiplayer.spec.ts`'s, and `overlays-history.spec.ts`'s `beforeEach`,
// which re-seed their own slug fresh before every test — those tests MUTATE
// the board (drag/resize/rotate/delete/persist, multi-peer edits, comments/
// pencil/annotation/history), so each test needs its on-disk starting state
// reset to the pristine fixture, not whatever the previous test left behind.
//
// Deliberately copies (not symlinks) each fixture directory verbatim: the
// fixtures dir's file layout (`board.json`, dotted sub-board files,
// `comments.json`, `tags.json`) already matches the `boards/<slug>/…`
// convention `@figemite/server`'s `BoardRepository` expects (see
// `boards/kitchen-sink/` for confirmation this is how the dev boards root is
// really laid out) — no transformation needed.
//
// Never removes pre-existing boards under other slugs; only overwrites the
// known fixture slugs so a developer's own scratch boards survive running the
// e2e suite locally.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(CLIENT_ROOT, '../..');

export const FIXTURES_ROOT = path.join(REPO_ROOT, 'fixtures');
export const BOARDS_ROOT = process.env.FIGEMITE_BOARDS_DIR
  ? path.resolve(process.env.FIGEMITE_BOARDS_DIR)
  : path.join(REPO_ROOT, 'boards');

export const SLUGS = ['kitchen-sink', 'minimal', 'interaction', 'multiplayer', 'overlays-history'];

/** Re-copies a single fixture slug's directory into `BOARDS_ROOT`, overwriting whatever is there. */
export function seedSlug(slug) {
  const src = path.join(FIXTURES_ROOT, slug);
  const dest = path.join(BOARDS_ROOT, slug);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

export function seedAll(slugs = SLUGS) {
  fs.mkdirSync(BOARDS_ROOT, { recursive: true });
  for (const slug of slugs) {
    const dest = seedSlug(slug);
    console.log(`[seed-boards] ${slug}: ${path.join(FIXTURES_ROOT, slug)} -> ${dest}`);
  }
  console.log(`[seed-boards] done. boardsRoot="${BOARDS_ROOT}"`);
}

// CLI entrypoint: only runs when this file is executed directly (`node
// seed-boards.mjs`), not when imported by `interaction.spec.ts`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedAll();
}
