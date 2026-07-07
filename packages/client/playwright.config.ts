// ── Playwright config: browser-mode structural-parity + interaction gates ───
// (P3-T21 + P4-T26)
//
// This is the deterministic Phase-3/4 gate: it drives a REAL Chromium against
// the real dev server (Vite + the mounted @easel/server backend, see
// `src/dev/easel-server-plugin.ts`) so `BoardCanvas` renders — and, for
// `interaction.spec.ts`, is EDITED — in an actual browser layout/measurement/
// input pipeline — the thing jsdom (packages/client's `vitest` suite)
// structurally cannot do (see `canvas/BoardCanvas.test.tsx`'s module doc:
// RF's edge-rendering pipeline is measurement-gated and never mounts an edge
// in jsdom).
//
// `webServer.command` seeds a gitignored `boards/` dir straight from
// `fixtures/kitchen-sink` + `fixtures/minimal` + `fixtures/interaction` (via
// `e2e/support/seed-boards.mjs`) then starts `npm run dev` bound to a fixed
// port, so every test run gets a deterministic, from-fixtures board
// regardless of what a developer has scratched into their local `boards/`
// dir otherwise. `interaction.spec.ts` additionally re-seeds its own
// `interaction` slug in a `beforeEach` (via that same script's exported
// `seedSlug`), since its tests mutate the board and must not leak state
// between tests.
//
// Two projects, deliberately separated by which specs they run:
//   - `chromium` (default, matches `render-parity.spec.ts`,
//     `interaction.spec.ts`, AND `multiplayer.spec.ts`): the authoritative,
//     deterministic Phase-3 + Phase-4 + Phase-5 gate. `npm run test:e2e` runs
//     only this project — this is what CI treats as blocking.
//     `interaction.spec.ts` (P4-T26) is the Phase-4 gate: real-browser
//     single-user editing parity, asserting persistence to the same seeded
//     `boards/` dir this config's `webServer` sets up (see that spec's module
//     doc for how it re-seeds its own `interaction` fixture per-test via
//     `e2e/support/seed-boards.mjs`'s `seedSlug`). `multiplayer.spec.ts`
//     (P5-T33) is the Phase-5 gate: TWO real browser contexts on the same
//     seeded `multiplayer` board, proving realtime sync, presence/cursors,
//     follow-mode, and AI-lock SSE-drop recovery all work end-to-end against
//     the real dev server.
//   - `chromium-visual` (matches `visual-regression.spec.ts` only): the
//     best-effort screenshot layer (see that file's module doc for why a
//     mismatch here is never trustworthy across environments — the baseline
//     PNG is only ever generated on the author's own machine, so CI running
//     on a different OS/font-rendering stack would see EVERY run as
//     "baseline missing" otherwise). Deliberately its own project (not just a
//     try/catch around the assertion) because Playwright's snapshot matcher
//     registers a test failure through its own internal step-tracking that a
//     plain try/catch around `expect(...).toHaveScreenshot()` does NOT
//     intercept — the only reliable way to keep a screenshot mismatch from
//     ever failing the gate is to keep it in a project nobody runs as part
//     of the gate. Run explicitly via `npm run test:e2e:visual`; never wired
//     into CI's blocking steps.
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(CLIENT_ROOT, '../..');

const PORT = 5299;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Single worker: all specs share one seeded `boards/` dir + dev server, and
  // the fixture set is small — parallel workers would buy nothing here.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: ['render-parity.spec.ts', 'interaction.spec.ts', 'multiplayer.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-visual',
      testMatch: 'visual-regression.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `node ${JSON.stringify(path.join(CLIENT_ROOT, 'e2e/support/seed-boards.mjs'))} && npx vite --port ${PORT} --strictPort`,
    cwd: CLIENT_ROOT,
    url: BASE_URL,
    env: {
      EASEL_BOARDS_DIR: path.join(REPO_ROOT, 'boards'),
    },
    // Always start a fresh server for a deterministic seed, even locally —
    // reusing a stale dev server would skip re-seeding `boards/` and could
    // silently test against out-of-date fixture data.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
