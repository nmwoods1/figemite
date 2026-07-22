#!/usr/bin/env node
// ── Manual standalone launcher ───────────────────────────────────────────────
//
// A tiny CLI shim for `node packages/server/dist/bin.js` manual runs — not a
// polished CLI (no arg parsing, no --help). Reads config from env vars:
//   FIGEMITE_BOARDS_DIR  — required. Absolute path to the boards root.
//   FIGEMITE_PORT        — optional, default 0 (ephemeral).
//   FIGEMITE_HOST        — optional, default 127.0.0.1 (see ServerConfig's doc
//                        on the local-first-safe-default).
//   FIGEMITE_MDNS        — optional, "1"/"true" to enable LAN advertisement.
//
// Phase 2's real CLI/dev-server entry point will supersede this; this exists
// only so the composed server is runnable and manually verifiable today.

import { startServer } from './start-server.js';

function truthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

async function main(): Promise<void> {
  const boardsRoot = process.env.FIGEMITE_BOARDS_DIR;
  if (!boardsRoot) {
    console.error('FIGEMITE_BOARDS_DIR is required (absolute path to the boards root).');
    process.exit(1);
  }

  const port = process.env.FIGEMITE_PORT ? Number(process.env.FIGEMITE_PORT) : undefined;
  const host = process.env.FIGEMITE_HOST;
  const mdns = truthy(process.env.FIGEMITE_MDNS);
  const instanceId = process.env.FIGEMITE_INSTANCE_ID;
  const instanceName = process.env.FIGEMITE_INSTANCE_NAME;

  const { url, handle } = await startServer({ boardsRoot, port, host, mdns, instanceId, instanceName });
  console.log(`figemite server listening on ${url} (instance ${handle.instance.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
