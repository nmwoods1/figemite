import { configDefaults, defineConfig } from 'vitest/config';

// The client is the only package that renders to the DOM, so it's the only
// one that needs a jsdom test environment; `@easel/shared` and
// `@easel/server` run fine under Vitest's node default. The root
// `vitest.config.ts`'s `projects: ['packages/*']` picks this file up
// automatically for `packages/client`, so `npm test` from the repo root
// still runs every package's tests, each in the right environment.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // `e2e/**` holds Playwright specs (`*.spec.ts`, matching vitest's default
    // include glob) — those run in a real browser via `npm run test:e2e`, not
    // under vitest/jsdom. Exclude the whole dir so `npm test` stays unit-only.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
