#!/usr/bin/env node
// ── Static read-only build (P2-T17) ──────────────────────────────────────────
//
// Ports the figmalade prototype's `scripts/build-static.mjs` to the
// `@easel/client` / `@easel/server` split. Unlike the legacy script, this one
// does NOT re-walk `boards/` itself — step 3 below delegates entirely to
// `@easel/server`'s `buildStaticBoards` (packages/server/src/static-export.ts,
// landed in P1-T13), which already owns the board file-layout convention
// (root board, dotted sub-board files, comments/tags, manifest generation)
// via `BoardRepository`. This script's only job is: build the client with
// READONLY baked in, call `buildStaticBoards`, then publish to `public/`.
//
// Steps:
//   1. Determine the Vite `base` path from `EASEL_BASE` (default `'/'`).
//   2. Run the `@easel/client` Vite build with `VITE_READONLY=1` and that
//      base, via Vite's JS `build()` API (in-process — no npx subprocess).
//   3. Call `buildStaticBoards(boardsRoot, dist)` to populate
//      `dist/boards/<slug>/…` and `dist/boards/index.json`.
//   4. Replace the repo-root `public/` with the finished `dist/` (the GitHub
//      Pages artifact path — see .github/workflows/ci.yml; the real Pages
//      *deploy* step lands in Phase 7).
//
// Env vars:
//   EASEL_BASE       Vite `base` path. Default '/'. For a project-subpath
//                    Pages deploy (e.g. GitHub Pages serving this repo at
//                    https://<user>.github.io/<reponame>/), set this to
//                    '/<reponame>/'. (The legacy script derived this
//                    automatically from GitLab CI's `CI_PROJECT_NAME`; there
//                    is no equivalent well-known env var on GitHub Actions,
//                    so it's an explicit input here instead.)
//   EASEL_BOARDS_DIR Path to the boards root to export. Default
//                    '<repoRoot>/boards'. Safe to point at a dir that's
//                    missing or empty — the build still succeeds, producing
//                    an empty `boards/index.json`.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { buildStaticBoards } from '@easel/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CLIENT_ROOT, '../..');

const DIST = path.join(CLIENT_ROOT, 'dist');
const PUBLIC = path.join(REPO_ROOT, 'public');
const BOARDS_ROOT = process.env.EASEL_BOARDS_DIR ?? path.join(REPO_ROOT, 'boards');

// ── 1. Compute Vite base ──────────────────────────────────────────────────────

const base = process.env.EASEL_BASE ?? '/';
console.log(`[build-static] base="${base}"`);
console.log(`[build-static] boardsRoot="${BOARDS_ROOT}"`);

// ── 2. Build the client with READONLY baked in ───────────────────────────────
//
// Using Vite's JS API in-process (rather than shelling out to `npx vite
// build`) so `mode`/`define` are set precisely without relying on dotenv-file
// conventions, and so build errors surface as a normal thrown rejection.
// `import.meta.env.VITE_READONLY` (packages/client/src/app/mode.ts) is
// resolved by Vite's built-in `VITE_`-prefixed env var handling, so setting
// `VITE_READONLY=1` in `process.env` before calling `build()` is sufficient —
// no extra `define` is required.
process.env.VITE_READONLY = '1';

await build({
  root: CLIENT_ROOT,
  base,
  mode: 'production',
});

console.log(`[build-static] client build complete -> ${DIST}`);

// ── 3. Export boards into dist/boards/ ────────────────────────────────────────
//
// Delegates to @easel/server's buildStaticBoards, which owns the board
// file-layout convention (root + dotted sub-board files, comments.json,
// tags.json, index.json manifest). Works fine against a missing or empty
// boardsRoot — the manifest is just written with zero boards.
await buildStaticBoards(BOARDS_ROOT, DIST);

const manifestPath = path.join(DIST, 'boards', 'index.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
console.log(`[build-static] wrote boards/index.json with ${manifest.boards.length} board(s).`);

// ── 4. Publish dist/ -> <repoRoot>/public/ ────────────────────────────────────
//
// `public/` is the GitHub Pages artifact path (see .github/workflows/ci.yml).
// Any pre-existing public/ is removed first so this is a clean replace, not a
// merge.
if (fs.existsSync(PUBLIC)) {
  fs.rmSync(PUBLIC, { recursive: true, force: true });
}
fs.renameSync(DIST, PUBLIC);

console.log(`[build-static] done. Output: ${path.relative(REPO_ROOT, PUBLIC)}/`);
