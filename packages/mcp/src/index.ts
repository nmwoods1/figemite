#!/usr/bin/env node
// ── figemite-mcp entry point ────────────────────────────────────────────────────
//
// Thin runnable shim: builds a FigemiteMcpServer from CLI args / env vars and
// connects it to stdio, mirroring the original prototype's
// mcp/legacy-mcp-server/src/server.ts bottom section (and @figemite/server's
// own bin.ts env-var convention — FIGEMITE_* rather than the legacy prefix).
//
// Usage:
//   figemite-mcp [--http http://localhost:5400] [--name "Claude Code"] [--client claude-code]
//
// Env vars (all optional):
//   FIGEMITE_HTTP_URL   default HTTP base URL for board-mgmt tools and
//                    connect_board with no `address` (default http://localhost:5400)
//   FIGEMITE_NAME       display name shown in the browser (default "AI")
//   FIGEMITE_CLIENT     agent client tag, e.g. "cursor" / "claude-code"
//
// This source file is also the bundle entry: `npm run build` (tsup, see
// tsup.config.ts) inlines `@figemite/shared` and emits a self-contained
// `dist/index.js` — the published `figemite-mcp` bin (`npx -y @figemite/mcp`).
// Real third-party deps (the MCP SDK, ws, yjs, y-websocket, bonjour-service)
// stay external and install normally from npm.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFigemiteMcpServer } from './server.js';

export const PACKAGE_NAME = '@figemite/mcp';
export { createFigemiteMcpServer } from './server.js';
export { BoardPeer } from './peer.js';
export { PeerDiscovery, buildDirectUrls } from './discovery.js';

function arg(flag: string, envVar: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return (i !== -1 ? process.argv[i + 1] : undefined) ?? process.env[envVar];
}

async function main(): Promise<void> {
  const defaultHttpUrl = arg('--http', 'FIGEMITE_HTTP_URL') ?? 'http://localhost:5400';
  const defaultName = arg('--name', 'FIGEMITE_NAME') ?? 'AI';
  const defaultAgentClient = arg('--client', 'FIGEMITE_CLIENT') ?? 'claude-code';

  const server = createFigemiteMcpServer({ defaultHttpUrl, defaultName, defaultAgentClient });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run when executed directly (as the `figemite-mcp` bin), not when
// imported by tests importing the re-exports above.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
