#!/usr/bin/env node
// ── Manual standalone launcher ───────────────────────────────────────────────
//
// A tiny CLI shim for `node packages/server/dist/bin.js` manual runs — not a
// polished CLI (no arg parsing, no --help). Reads config from env vars:
//   EASEL_BOARDS_DIR  — required. Absolute path to the boards root.
//   EASEL_PORT        — optional, default 0 (ephemeral).
//   EASEL_HOST        — optional, default 127.0.0.1 (see ServerConfig's doc
//                        on the local-first-safe-default).
//   EASEL_MDNS        — optional, "1"/"true" to enable LAN advertisement.
//
// Phase 2's real CLI/dev-server entry point will supersede this; this exists
// only so the composed server is runnable and manually verifiable today.

import { startServer } from './start-server.js';

function truthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

async function main(): Promise<void> {
  const boardsRoot = process.env.EASEL_BOARDS_DIR;
  if (!boardsRoot) {
    console.error('EASEL_BOARDS_DIR is required (absolute path to the boards root).');
    process.exit(1);
  }

  const port = process.env.EASEL_PORT ? Number(process.env.EASEL_PORT) : undefined;
  const host = process.env.EASEL_HOST;
  const mdns = truthy(process.env.EASEL_MDNS);

  const { url } = await startServer({ boardsRoot, port, host, mdns });
  console.log(`easel server listening on ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
