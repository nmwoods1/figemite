#!/usr/bin/env node
// ── Prepublish reference audit (BLOCKING gate) ──────────────────────────────
//
// Greps every git-tracked file for forbidden substrings that must never leak
// into a public release: the old prototype's product/company names, personal
// author identifiers, and leftover markers from the `easel` -> `figemite`
// codename rename (a stray `@easel/...` import, an unrenamed `EASEL_` env
// var, etc. would mean the rename regressed somewhere).
//
// Case-insensitive substring match, scoped to file CONTENT only (not paths).
// `package-lock.json` is excluded: its `integrity` fields are base64-encoded
// hashes that can coincidentally contain short substrings like `awx`, and the
// forbidden list below is specific enough (`awx.im`, `gitlab.awx`, full
// company/person names, `@easel`, etc.) that nothing in a real lockfile
// should ever legitimately match it — but we exclude it anyway rather than
// rely on that, since a hash collision here would be an unfixable false
// positive (you can't "fix" a dependency's own integrity hash).
//
// Usage: node scripts/prepublish-audit.mjs
// Exit code: 0 if clean, 1 if ANY forbidden substring is found anywhere.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files excluded from ALL checks below (see module doc for why).
 * This script itself is excluded because it necessarily contains every
 * forbidden substring literally, in its own `FORBIDDEN` list and the
 * comments explaining it — that's not a leak, it's the detector.
 */
const EXCLUDED_FILES = new Set(['package-lock.json', 'scripts/prepublish-audit.mjs']);

/**
 * Forbidden substrings, matched case-insensitively against file content.
 * Two categories:
 *   - Prototype/company/personal identifiers that must never appear in a
 *     public release.
 *   - Leftover-rename markers: if any of these match, the easel -> figemite
 *     rename regressed somewhere (a re-added import, a copy-pasted snippet
 *     from an old branch, etc.).
 */
const FORBIDDEN = [
  // Prototype / company / personal identifiers.
  'airwallex',
  'awx.im',
  'gitlab.awx',
  'figmalade',
  'airjam',
  'nick.woods',
  'n.m.woods',
  'nmwoods',
  // Leftover easel -> figemite rename markers. Matching is case-insensitive
  // (see findHits below), so `EASEL_`'s casing here is for readability only.
  '@easel',
  '_easel._tcp',
  'EASEL_',
  'easel-monorepo',
];

/** Cheap binary-file sniff: a NUL byte in the first 8KB means "not text". */
function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

function listTrackedFiles() {
  const stdout = execFileSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !EXCLUDED_FILES.has(file));
}

/** Returns `{ pattern, lineNumber, lineText }[]` for every forbidden hit in `content`. */
function findHits(content) {
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    for (const pattern of FORBIDDEN) {
      if (lower.includes(pattern.toLowerCase())) {
        hits.push({ pattern, lineNumber: i + 1, lineText: line.trim() });
      }
    }
  }
  return hits;
}

function main() {
  const files = listTrackedFiles();
  const offenses = []; // { file, lineNumber, pattern, lineText }

  for (const file of files) {
    const absPath = join(rootDir, file);
    let buffer;
    try {
      buffer = readFileSync(absPath);
    } catch {
      // Deleted/unreadable (e.g. a broken symlink) — skip.
      continue;
    }
    // Binary assets (PNGs, etc.) can "decode" as utf8 without throwing but
    // contain NUL bytes early on; skip those rather than scanning noise.
    if (looksBinary(buffer)) continue;

    for (const hit of findHits(buffer.toString('utf8'))) {
      offenses.push({ file, ...hit });
    }
  }

  if (offenses.length > 0) {
    console.error(`Prepublish audit FAILED — ${offenses.length} forbidden reference(s) found:`);
    for (const { file, lineNumber, pattern, lineText } of offenses) {
      console.error(`  ${file}:${lineNumber}  [${pattern}]  ${lineText}`);
    }
    return 1;
  }

  console.log(
    `Prepublish audit: ${files.length} tracked file(s) scanned, no forbidden references. OK.`,
  );
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`Prepublish audit errored: ${err.stack ?? err.message}`);
  process.exit(1);
}
