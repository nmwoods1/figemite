import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Cross-package test resolution: lets any workspace package's tests import
// `@easel/<name>` directly from source, without requiring `tsc -b` to have
// produced `dist/` first. Generic so it covers every current and future
// `packages/<name>` workspace: `@easel/shared` -> `packages/shared/src/index.ts`,
// `@easel/server` -> `packages/server/src/index.ts`, etc.
const packagesRoot = fileURLToPath(new URL('./packages', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@easel\/(.*)$/,
        replacement: `${packagesRoot}/$1/src/index.ts`,
      },
    ],
  },
  test: {
    projects: ['packages/*'],
    passWithNoTests: true,
  },
});
