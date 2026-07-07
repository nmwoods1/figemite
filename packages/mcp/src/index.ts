#!/usr/bin/env node
// ── easel-mcp entry point ────────────────────────────────────────────────────
//
// Thin runnable shim: builds an EaselMcpServer from CLI args / env vars and
// connects it to stdio, mirroring the legacy figmalade prototype's
// mcp/airjam-mcp-server/src/server.ts bottom section (and @easel/server's
// own bin.ts env-var convention — EASEL_* rather than AIRJAM_*).
//
// Usage:
//   easel-mcp [--http http://localhost:5400] [--name "Claude Code"] [--client claude-code]
//
// Env vars (all optional):
//   EASEL_HTTP_URL   default HTTP base URL for board-mgmt tools and
//                    connect_board with no `address` (default http://localhost:5400)
//   EASEL_NAME       display name shown in the browser (default "AI")
//   EASEL_CLIENT     agent client tag, e.g. "cursor" / "claude-code"
//
// Scope note: this is the workspace-runnable entry only. Bundling a
// standalone npm-publishable CLI (tsup, a `files` allowlist, `publishConfig`)
// is a Phase-7 (release engineering) concern — TODO(phase-7): add the publish bundle.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEaselMcpServer } from './server.js';

export const PACKAGE_NAME = '@easel/mcp';
export { createEaselMcpServer } from './server.js';
export { BoardPeer } from './peer.js';
export { PeerDiscovery, buildDirectUrls } from './discovery.js';

function arg(flag: string, envVar: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return (i !== -1 ? process.argv[i + 1] : undefined) ?? process.env[envVar];
}

async function main(): Promise<void> {
  const defaultHttpUrl = arg('--http', 'EASEL_HTTP_URL') ?? 'http://localhost:5400';
  const defaultName = arg('--name', 'EASEL_NAME') ?? 'AI';
  const defaultAgentClient = arg('--client', 'EASEL_CLIENT') ?? 'claude-code';

  const server = createEaselMcpServer({ defaultHttpUrl, defaultName, defaultAgentClient });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run when executed directly (as the `easel-mcp` bin), not when
// imported by tests importing the re-exports above.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
