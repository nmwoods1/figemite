#!/usr/bin/env node
// Workspace-aware production license audit.
//
// Why not `license-checker-rseidelsohn --production`? In an npm-workspaces
// layout it reports "No packages found" and exits 0, so it never actually
// gates anything. This script walks the real production dependency graph via
// `npm ls` and checks every third-party package's license against an
// allowlist, exiting non-zero if any is disallowed or undeterminable.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ALLOWLIST = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
]);

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(rootDir, 'package.json'));

/** Our own workspace packages — not third-party, skip them. */
function isOwnPackage(name) {
  return name.startsWith('@figemite/');
}

/**
 * Run `npm ls` for the production graph. npm may exit non-zero on peer/other
 * warnings while still emitting valid JSON on stdout, so we parse regardless
 * of exit code and only fail if the output isn't parseable JSON.
 */
function loadProductionTree() {
  let stdout;
  try {
    stdout = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // Non-zero exit still carries JSON on stdout for `npm ls`.
    stdout = err.stdout;
    if (!stdout) {
      throw new Error(`npm ls produced no output: ${err.message}`);
    }
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to parse npm ls JSON: ${err.message}`);
  }
}

/** Recursively collect distinct third-party name@version from the npm ls tree. */
function collectPackages(node, out) {
  const deps = node.dependencies ?? {};
  for (const [name, info] of Object.entries(deps)) {
    if (info && typeof info === 'object') {
      if (!isOwnPackage(name) && info.version) {
        out.add(`${name}@${info.version}`);
      }
      collectPackages(info, out);
    }
  }
  return out;
}

/** Resolve and read a dependency's package.json, handling hoisting + scopes. */
function readPackageJson(name) {
  // Prefer the hoisted top-level copy; fall back to require.resolve.
  const candidate = join(rootDir, 'node_modules', name, 'package.json');
  try {
    return JSON.parse(readFileSync(candidate, 'utf8'));
  } catch {
    // Not hoisted to the top level — resolve from the root's module graph.
    const resolved = require.resolve(`${name}/package.json`);
    return JSON.parse(readFileSync(resolved, 'utf8'));
  }
}

/** Extract a normalized license string (SPDX expression or single id). */
function getLicense(pkg) {
  if (typeof pkg.license === 'string' && pkg.license.trim()) {
    return pkg.license.trim();
  }
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) {
    return String(pkg.license.type).trim();
  }
  // Legacy `licenses: [{ type }]` array form.
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    const types = pkg.licenses
      .map((l) => (typeof l === 'string' ? l : l?.type))
      .filter(Boolean)
      .map((t) => String(t).trim());
    if (types.length > 0) {
      return `(${types.join(' OR ')})`;
    }
  }
  return null;
}

/**
 * Decide if a license string is allowed. Handles SPDX expressions like
 * `(MIT OR Apache-2.0)` and `MIT AND ISC` — accept if ANY listed license is
 * on the allowlist (OR-permissive, matching common license-audit policy).
 */
function isAllowed(license) {
  if (!license) return false;
  const ids = license
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((s) => s.trim().replace(/\+$/, ''))
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.some((id) => ALLOWLIST.has(id));
}

function main() {
  const tree = loadProductionTree();
  const packages = [...collectPackages(tree, new Set())].sort();

  if (packages.length === 0) {
    console.log('License audit: no production third-party dependencies. OK.');
    return 0;
  }

  const offenders = [];
  for (const spec of packages) {
    // Split name@version where name may itself contain an @ (scoped).
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    let license = null;
    try {
      license = getLicense(readPackageJson(name));
    } catch (err) {
      offenders.push({ spec, license: `<error: ${err.message}>` });
      continue;
    }
    if (!isAllowed(license)) {
      offenders.push({ spec, license: license ?? '<undeterminable>' });
    }
  }

  if (offenders.length > 0) {
    console.error(`License audit FAILED — ${offenders.length} disallowed package(s):`);
    for (const { spec, license } of offenders) {
      console.error(`  ${spec}  ->  ${license}`);
    }
    console.error(`Allowlist: ${[...ALLOWLIST].join(', ')}`);
    return 1;
  }

  console.log(`License audit: ${packages.length} production package(s), all licenses allowed. OK.`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`License audit errored: ${err.stack ?? err.message}`);
  process.exit(1);
}
