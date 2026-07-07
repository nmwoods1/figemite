// ── Publish bundle config ────────────────────────────────────────────────────
//
// Bundles the stdio entry (`src/index.ts`) into a single self-contained ESM
// file at `dist/index.js` for the published npm artifact (`npx -y
// @figemite/mcp`). `@figemite/shared` is a private workspace package that
// isn't published, so it MUST be inlined (`noExternal`) rather than left as
// an unresolvable runtime `import` — that's the whole point of this config.
// Real third-party deps stay external so they install normally from npm via
// the package's own `dependencies`.
//
// The workspace dev experience (tests, `tsc -b` typecheck) is untouched by
// this file: those still resolve `@figemite/shared` via the npm workspace,
// same as before. Only this bundle inlines it.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  shims: false,
  // No explicit banner: `src/index.ts` already starts with its own
  // `#!/usr/bin/env node` shebang, and tsup preserves a source shebang
  // automatically — adding one here would duplicate it.
  // Inline the private workspace package; everything else (the real
  // third-party runtime deps) stays external and installs from npm.
  noExternal: ['@figemite/shared'],
  external: ['@modelcontextprotocol/sdk', 'ws', 'yjs', 'y-websocket', 'bonjour-service', 'zod'],
});
