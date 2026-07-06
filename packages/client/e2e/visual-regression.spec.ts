// ── Visual regression: BEST-EFFORT baseline, NOT the Phase-3 gate ───────────
//
// Screenshots are inherently environment-sensitive (font rendering,
// anti-aliasing, GPU rasterization, even OS differ across runners —
// Playwright itself namespaces baselines per-platform, e.g.
// `kitchen-sink-chromium-darwin.png` vs `...-linux.png`, precisely because a
// mismatch across environments is expected, not a bug). A `toHaveScreenshot()`
// mismatch here does NOT indicate the canvas failed to render a board
// correctly — `render-parity.spec.ts`'s structural DOM assertions are the
// authoritative Phase-3 gate for that.
//
// This spec lives in its own Playwright project (`chromium-visual`, see
// playwright.config.ts) that is NEVER part of `npm run test:e2e` — the
// command CI/the verify step treats as the blocking gate only runs the
// `chromium` project (`render-parity.spec.ts`). That separation, not a
// try/catch around the assertion, is what makes this genuinely non-blocking:
// Playwright's snapshot matcher registers a test failure through its own
// internal step-tracking regardless of whether calling code catches the
// thrown error, so wrapping `expect(...).toHaveScreenshot()` in try/catch
// does NOT actually prevent the test (or the process) from failing — the
// only reliable way to keep a mismatch from ever failing the gate is to keep
// it out of the gate's test run entirely.
//
// Only the author's own machine (darwin) has ever generated a baseline here,
// so `npm run test:e2e:visual` on any other OS (including CI, which runs
// ubuntu-latest) will report "no baseline for this platform" — that's
// expected, not a regression. Regenerate locally with
// `npx playwright test --project=chromium-visual --update-snapshots`
// whenever the rendering environment changes; run
// `npm run test:e2e:visual` to check it informationally.
import { test, expect } from '@playwright/test';

test.describe('visual baselines (best-effort, non-blocking)', () => {
  test('kitchen-sink', async ({ page }) => {
    await page.goto('/#/kitchen-sink');
    await page.locator('.react-flow').waitFor({ state: 'visible' });
    // Let RF finish its measurement/fitView settle pass before capturing.
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('kitchen-sink.png', {
      maxDiffPixelRatio: 0.05,
      timeout: 10_000,
    });
  });

  test('minimal', async ({ page }) => {
    await page.goto('/#/minimal');
    await page.locator('.react-flow').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('minimal.png', {
      maxDiffPixelRatio: 0.05,
      timeout: 10_000,
    });
  });
});
