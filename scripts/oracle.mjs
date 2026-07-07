#!/usr/bin/env node
// ── Legacy oracle harness (LOCAL ONLY — not run in CI) ──────────────────────
//
// Purpose: prove the new v1.0 model (packages/shared) can ingest EVERY real
// legacy board — from a private, non-versioned boards directory supplied by
// the caller — without silent data loss.
//
// This is intentionally a plain Node script, not a vitest test: it reads
// private local data that CI does not have access to, and never should.
//
// Data-hygiene contract (do not weaken this):
//   - Never print board/comment/tag CONTENT to stdout — only file paths,
//     field NAMES, counts, and error messages.
//   - Never copy anything from the boards dir into this repo.
//
// Usage (the boards dir is REQUIRED — there is no default):
//   node scripts/oracle.mjs /path/to/boards
//   ORACLE_BOARDS_DIR=/path/to/boards npm run oracle
//
// Prerequisite: `npm run typecheck` must have been run at least once so
// packages/shared/dist exists (this script imports the BUILT @figemite/shared,
// not the TypeScript source, to avoid needing a TS loader).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const sharedDistIndex = join(repoRoot, 'packages', 'shared', 'dist', 'index.js');

if (!existsSync(sharedDistIndex)) {
  console.error(
    `error: ${sharedDistIndex} does not exist.\n` +
      `Run "npm run typecheck" first to build @figemite/shared before running the oracle.`,
  );
  process.exit(1);
}

const { deserialise, serialise, parseCommentsFile, parseTagsFile } = await import(sharedDistIndex);

const boardsDir = process.argv[2] || process.env.ORACLE_BOARDS_DIR;

if (!boardsDir) {
  console.error(
    'error: no boards directory supplied.\n' +
      'Usage: node scripts/oracle.mjs /path/to/boards\n' +
      '   or: ORACLE_BOARDS_DIR=/path/to/boards node scripts/oracle.mjs',
  );
  process.exit(1);
}

if (!existsSync(boardsDir)) {
  console.error(`error: boards dir does not exist: ${boardsDir}`);
  process.exit(1);
}

// ── Discover board slugs (one directory per board) ──────────────────────────

function listBoardSlugs(dir) {
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .sort();
}

// board.json, board.<seg>.json, board.<seg>.<seg>.json, ... — never matches
// comments.json / tags.json, which don't start with "board".
const BOARD_FILE_RE = /^board(\.[^./]+)*\.json$/;

function listBoardFilesForSlug(slugDir) {
  return readdirSync(slugDir)
    .filter((entry) => BOARD_FILE_RE.test(entry))
    .sort()
    .map((entry) => join(slugDir, entry));
}

// ── Key-diff (dropped-field detection) ──────────────────────────────────────
//
// Compares the raw parsed JSON's per-node / per-edge KEYS against the
// migrated node/edge KEYS. Any key present in the raw file but absent after
// migrate is a silently-dropped field: a gap between the new model and real
// data. Only field NAMES are ever collected — never values.

function keysOf(obj) {
  return obj && typeof obj === 'object' ? Object.keys(obj) : [];
}

/**
 * Matches raw nodes/edges to their migrated counterparts by `id` (stable
 * across migration) and returns the set of keys present in some raw item's
 * own keys but never present in the corresponding migrated item's keys.
 */
function droppedKeys(rawItems, migratedItems) {
  const migratedById = new Map();
  for (const item of migratedItems) {
    if (item && typeof item === 'object' && typeof item.id === 'string') {
      migratedById.set(item.id, item);
    }
  }

  const dropped = new Set();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue;
    const migrated = migratedById.get(raw.id);
    const migratedKeys = new Set(keysOf(migrated));
    for (const key of keysOf(raw)) {
      if (!migratedKeys.has(key)) {
        dropped.add(key);
      }
    }
  }
  return dropped;
}

// ── Summary accumulators ─────────────────────────────────────────────────────

let boardFilesSeen = 0;
let boardFilesParsedOk = 0;
const parseFailures = []; // { file, error }
const droppedFieldNames = new Set();
const droppedFieldDetails = []; // { file, field } — for a per-file dedup count
let unstableFiles = 0;
const unstableList = [];

let commentsFilesSeen = 0;
let commentsFilesParsedOk = 0;
const commentsFailures = [];

let tagsFilesSeen = 0;
let tagsFilesParsedOk = 0;
const tagsFailures = [];

// ── Walk every board slug ────────────────────────────────────────────────────

const slugs = listBoardSlugs(boardsDir);

for (const slug of slugs) {
  const slugDir = join(boardsDir, slug);
  const boardFiles = listBoardFilesForSlug(slugDir);

  for (const filePath of boardFiles) {
    boardFilesSeen++;
    const relPath = join(slug, basename(filePath));

    let raw;
    let rawParsed;
    try {
      raw = readFileSync(filePath, 'utf8');
      rawParsed = JSON.parse(raw);
    } catch (err) {
      parseFailures.push({ file: relPath, error: `JSON.parse failed: ${err.message}` });
      continue;
    }

    let migrated;
    try {
      migrated = deserialise(raw);
    } catch (err) {
      parseFailures.push({ file: relPath, error: err.message });
      continue;
    }
    boardFilesParsedOk++;

    // Dropped-field detection: nodes.
    const rawNodes = Array.isArray(rawParsed.nodes) ? rawParsed.nodes : [];
    const nodeDropped = droppedKeys(rawNodes, migrated.nodes);
    for (const field of nodeDropped) {
      droppedFieldNames.add(`node.${field}`);
      droppedFieldDetails.push({ file: relPath, field: `node.${field}` });
    }

    // Dropped-field detection: edges.
    const rawEdges = Array.isArray(rawParsed.edges) ? rawParsed.edges : [];
    const edgeDropped = droppedKeys(rawEdges, migrated.edges);
    for (const field of edgeDropped) {
      droppedFieldNames.add(`edge.${field}`);
      droppedFieldDetails.push({ file: relPath, field: `edge.${field}` });
    }

    // Round-trip stability.
    try {
      const once = serialise(migrated);
      const twice = serialise(deserialise(once));
      if (once !== twice) {
        unstableFiles++;
        unstableList.push(relPath);
      }
    } catch (err) {
      unstableFiles++;
      unstableList.push(`${relPath} (error: ${err.message})`);
    }
  }

  // comments.json / tags.json for this slug, if present.
  const commentsPath = join(slugDir, 'comments.json');
  if (existsSync(commentsPath)) {
    commentsFilesSeen++;
    try {
      const raw = JSON.parse(readFileSync(commentsPath, 'utf8'));
      parseCommentsFile(raw);
      commentsFilesParsedOk++;
    } catch (err) {
      commentsFailures.push({ file: join(slug, 'comments.json'), error: err.message });
    }
  }

  const tagsPath = join(slugDir, 'tags.json');
  if (existsSync(tagsPath)) {
    tagsFilesSeen++;
    try {
      const raw = JSON.parse(readFileSync(tagsPath, 'utf8'));
      parseTagsFile(raw);
      tagsFilesParsedOk++;
    } catch (err) {
      tagsFailures.push({ file: join(slug, 'tags.json'), error: err.message });
    }
  }
}

// ── Print summary (counts + de-duplicated field/file names only) ───────────

console.log('── Legacy oracle summary ───────────────────────────────────────');
console.log(`Boards dir: ${boardsDir}`);
console.log(`Board slugs scanned: ${slugs.length}`);
console.log('');
console.log(`Board files seen:       ${boardFilesSeen}`);
console.log(`Board files parsed OK:  ${boardFilesParsedOk}`);
console.log(`Board files failed:     ${parseFailures.length}`);
if (parseFailures.length > 0) {
  console.log('  Failing files:');
  for (const { file, error } of parseFailures) {
    console.log(`    - ${file}: ${error}`);
  }
}
console.log('');
console.log(`Dropped fields (present in raw, absent after migrate): ${droppedFieldNames.size}`);
if (droppedFieldNames.size > 0) {
  const countByField = new Map();
  for (const { field } of droppedFieldDetails) {
    countByField.set(field, (countByField.get(field) ?? 0) + 1);
  }
  for (const field of [...droppedFieldNames].sort()) {
    console.log(`    - ${field} (${countByField.get(field)} occurrence(s))`);
  }
}
console.log('');
console.log(`Round-trip unstable files: ${unstableFiles}`);
if (unstableFiles > 0) {
  for (const f of unstableList) {
    console.log(`    - ${f}`);
  }
}
console.log('');
console.log(`comments.json seen:       ${commentsFilesSeen}`);
console.log(`comments.json parsed OK:  ${commentsFilesParsedOk}`);
if (commentsFailures.length > 0) {
  console.log('  Failing files:');
  for (const { file, error } of commentsFailures) {
    console.log(`    - ${file}: ${error}`);
  }
}
console.log('');
console.log(`tags.json seen:       ${tagsFilesSeen}`);
console.log(`tags.json parsed OK:  ${tagsFilesParsedOk}`);
if (tagsFailures.length > 0) {
  console.log('  Failing files:');
  for (const { file, error } of tagsFailures) {
    console.log(`    - ${file}: ${error}`);
  }
}
console.log('');

const ok =
  parseFailures.length === 0 &&
  droppedFieldNames.size === 0 &&
  unstableFiles === 0 &&
  commentsFailures.length === 0 &&
  tagsFailures.length === 0;

if (ok) {
  console.log(
    'RESULT: OK — every board/comments/tags file ingested cleanly, no dropped fields, stable round-trip.',
  );
  process.exit(0);
} else {
  console.log(
    'RESULT: FAILED — see above. This indicates a real gap between the new model and real legacy data.',
  );
  process.exit(1);
}
