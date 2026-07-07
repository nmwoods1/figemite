// ── Multiplayer E2E: two real browsers, one room (P5-T33 — Phase 5 GATE) ────
//
// This is the Phase-5 gate's browser layer: TWO independent Playwright
// browser CONTEXTS (not just tabs — separate cookie/storage jars, exactly
// like two different humans on two different machines) open the SAME
// editable board against the REAL dev server (`webServer` in
// `playwright.config.ts` — Vite + the mounted `@figemite/server` backend, the
// same one `interaction.spec.ts` exercises), and prove:
//
//   A. Multi-peer sync: an edit committed in page A (create a node, drag,
//      type text) converges to page B via the shared Yjs room, AND persists
//      to `board.json` on disk (the server's debounced writeback, same
//      `waitForPersisted` contract `interaction.spec.ts` uses).
//   A. Presence: A's live mouse movement renders as a remote cursor in B
//      (`PresenceLayer`'s `[data-testid="presence-cursor"]`), and A editing a
//      node's text renders an editing outline in B
//      (`[data-testid="presence-outline"]`) — both sourced from
//      `hooks/usePresence.ts`'s awareness-backed `remotes`.
//   A. Follow-mode: B follows A via the `ActiveUsersPanel`'s "Follow" button;
//      A pans/zooms; B's ReactFlow viewport mirrors A's
//      (`hooks/useFollowMode.ts`).
//   C. AI-lock SSE-drop recovery is deliberately NOT tested in this file —
//      see the module doc at the bottom of this file (search "NOT tested at
//      this layer") for why a real-browser `context.setOffline` attempt was
//      tried and abandoned, and `hooks/useAiLock.test.ts` for where that
//      assertion actually lives instead (a jsdom-level stubbed-EventSource
//      test of the full begin -> drop -> end -> reconnect -> unlocked path).
//
// Every test seeds its OWN fresh `multiplayer` board (via `seedSlug`, the
// same helper `interaction.spec.ts` uses) in `beforeEach` — this suite
// mutates the board and runs serially against one shared dev server+`boards/`
// dir (`workers: 1`, see playwright.config.ts's module doc), so a pristine
// starting fixture per test is required for determinism, exactly like
// `interaction.spec.ts`.
//
// Robustness: every cross-page assertion uses Playwright's built-in
// actionability waits (`toBeVisible`, `toHaveCount`) or `expect.poll` with
// generous timeouts — Yjs sync, awareness broadcast, and the server's
// persist debounce are all asynchronous, so a single immediate read would be
// racy by construction (same rationale as `interaction.spec.ts`'s
// `waitForPersisted`).
import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { seedSlug, BOARDS_ROOT } from './support/seed-boards.mjs';

const SLUG = 'multiplayer';

// ── Types (minimal local shape — just what this spec reads off board.json) ──

interface XY {
  x: number;
  y: number;
}
interface WH {
  width: number;
  height: number;
}
interface PersistedNode {
  id: string;
  type: string;
  pos: XY;
  order: number;
  size?: WH | number;
  text?: string;
  color?: string;
}
interface PersistedBoard {
  formatVersion: number;
  boardLabel: string;
  nodes: PersistedNode[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
}

function boardJsonPath(): string {
  return path.join(BOARDS_ROOT, SLUG, 'board.json');
}

function readBoardJson(): PersistedBoard {
  const raw = readFileSync(boardJsonPath(), 'utf-8');
  return JSON.parse(raw) as PersistedBoard;
}

/** Polls the on-disk `board.json` until `predicate` passes (or times out) —
 * matching the server's own debounced persist-on-update
 * (`YjsWebsocketService`'s `DEFAULT_PERSIST_DEBOUNCE_MS`, ~1s) plus
 * network/fs slack. Same contract as `interaction.spec.ts`'s
 * `waitForPersisted`. */
async function waitForPersisted(
  predicate: (board: PersistedBoard) => boolean,
  message: string,
): Promise<PersistedBoard> {
  let last: PersistedBoard | undefined;
  await expect
    .poll(
      () => {
        try {
          last = readBoardJson();
          return predicate(last);
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000, intervals: [200, 300, 500, 500, 1000, 1000] },
    )
    .toBe(true);
  return last!;
}

async function gotoBoard(page: Page): Promise<void> {
  await page.goto(`/#/${SLUG}`);
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
}

function nodeLocator(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

/** A fresh browser context with a display name PRE-SEEDED into localStorage
 * (`lib/identity.ts`'s `NAME_KEY`) before any page ever loads the app. Every
 * test in this file uses a brand-new `browser.newContext()` per simulated
 * "human" (separate storage jars, exactly like two different people on two
 * different machines — the whole point of testing with contexts, not just
 * tabs) — but that also means each one is a first-time visitor as far as
 * `lib/identity.ts`'s `hasStoredUser()` is concerned, so `IdentityPrompt`
 * ("Who are you?") would otherwise mount and modally intercept every click
 * this suite makes. Seeding the name up front (via `addInitScript`, which
 * runs before ANY page script in this context, on every navigation) skips
 * that prompt entirely — exactly like a returning user — and gives each
 * simulated human a stable, readable name (instead of `identity.ts`'s random
 * `guest-xxxxx` fallback) so assertions like "the Follow button reads
 * `Follow <name>`" are deterministic rather than depending on a randomly
 * generated string captured at runtime. */
async function newIdentifiedContext(browser: Browser, name: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((n) => window.localStorage.setItem('figemite:author', n), name);
  return context;
}

test.describe('multi-peer browser sync (Phase 5 gate)', () => {
  test.beforeEach(() => {
    // Fresh on-disk board before every test — this suite mutates the shared
    // room, and tests run serially against one dev server (see module doc).
    seedSlug(SLUG);
  });

  // ── A. Node creation converges A -> B, and persists ─────────────────────

  test('a node created in page A appears in page B and persists to board.json', async ({
    browser,
  }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      // Create a sticky in A via the toolbar (same flow as interaction.spec.ts).
      await pageA.getByTitle('Sticky note', { exact: true }).click();
      await pageA.locator('[title="#fef3c7"]').first().click();

      await expect(pageA.locator('.react-flow__node')).toHaveCount(2);

      const newStickyId = await pageA.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.react-flow__node[data-id]'));
        const known = new Set(['sticky1']);
        const created = nodes.map((n) => n.getAttribute('data-id')!).find((id) => !known.has(id));
        return created ?? null;
      });
      expect(newStickyId, 'toolbar did not create a new sticky node id in page A').toBeTruthy();

      // Converges to B via the shared room — Yjs sync is async, so poll for
      // the count rather than asserting immediately.
      await expect(pageB.locator('.react-flow__node')).toHaveCount(2);
      await expect(nodeLocator(pageB, newStickyId!)).toHaveCount(1);

      // Persists to board.json on disk (the server's debounced writeback).
      const persisted = await waitForPersisted(
        (b) => b.nodes.length === 2,
        'node created in page A never persisted to board.json',
      );
      expect(persisted.nodes.some((n) => n.id === newStickyId)).toBe(true);

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });

  // ── A. Drag converges A -> B, and persists ──────────────────────────────

  test('dragging a node in page A moves it in page B and persists the new position', async ({
    browser,
  }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      const beforeBoxB = await nodeLocator(pageB, 'sticky1').boundingBox();
      expect(beforeBoxB).toBeTruthy();

      const stickyA = nodeLocator(pageA, 'sticky1');
      const box = await stickyA.boundingBox();
      expect(box).toBeTruthy();
      const startX = box!.x + box!.width / 2;
      const startY = box!.y + box!.height / 2;
      const DX = 150;
      const DY = 90;

      await pageA.mouse.move(startX, startY);
      await pageA.mouse.down();
      await pageA.mouse.move(startX + DX, startY + DY, { steps: 30 });
      await pageA.mouse.up();

      // B's copy moves too, converged via the room (poll: RF re-renders on
      // the next doc-update tick after the awareness/CRDT update arrives).
      await expect
        .poll(async () => {
          const afterBoxB = await nodeLocator(pageB, 'sticky1').boundingBox();
          if (!afterBoxB) return null;
          return afterBoxB.x - beforeBoxB!.x;
        })
        .toBeGreaterThan(DX * 0.5);

      const persisted = await waitForPersisted((b) => {
        const p = b.nodes.find((n) => n.id === 'sticky1')?.pos;
        return !!p && Math.abs(p.x - (40 + DX)) < DX * 0.5 && Math.abs(p.y - (40 + DY)) < DY * 0.5;
      }, 'dragged node position (from page A) never persisted to board.json');
      const pos = persisted.nodes.find((n) => n.id === 'sticky1')!.pos;
      expect(Math.abs(pos.x - (40 + DX))).toBeLessThan(DX * 0.5);

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });

  // ── A. Text edit converges A -> B, and persists ─────────────────────────

  test('typing text in page A appears in page B and persists to board.json', async ({
    browser,
  }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      const stickyA = nodeLocator(pageA, 'sticky1');
      await stickyA.dblclick();
      const textarea = stickyA.locator('textarea');
      await expect(textarea).toBeVisible();
      await textarea.fill('Hello from page A');
      // Blur commits (useEditableText.ts's `commit` fires on textarea blur).
      await stickyA
        .locator('[data-testid="base-node-rotation"]')
        .click({ position: { x: 5, y: 5 } });
      await expect(stickyA).toContainText('Hello from page A');

      // Converges to B.
      await expect(nodeLocator(pageB, 'sticky1')).toContainText('Hello from page A');

      const persisted = await waitForPersisted(
        (b) => b.nodes.find((n) => n.id === 'sticky1')?.text === 'Hello from page A',
        'text typed in page A never persisted to board.json',
      );
      expect(persisted.nodes.find((n) => n.id === 'sticky1')!.text).toBe('Hello from page A');

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });

  // ── A. Presence: remote cursor ──────────────────────────────────────────

  test("page B renders page A's remote cursor when A moves the mouse over the canvas", async ({
    browser,
  }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      // B shouldn't see a cursor before A moves — awareness starts with no
      // published cursor field.
      await expect(pageB.locator('[data-testid="presence-cursor"]')).toHaveCount(0);

      // A real mouse move over A's canvas — usePresence's publishCursor is
      // throttled to ~30Hz, so a single move is enough to publish eventually.
      const canvasA = pageA.locator('.react-flow__pane');
      const box = await canvasA.boundingBox();
      expect(box).toBeTruthy();
      const targetX = box!.x + box!.width * 0.75;
      const targetY = box!.y + box!.height * 0.25;
      await pageA.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
      await pageA.mouse.move(targetX, targetY, { steps: 10 });

      // B renders A's cursor.
      await expect(pageB.locator('[data-testid="presence-cursor"]')).toHaveCount(1, {
        timeout: 10_000,
      });

      // Roughly the right spot: the cursor element's on-screen position in B
      // should land near where A's mouse is, in B's own viewport (both pages
      // share the identical fixture viewport, so screen-space coordinates
      // line up directly without any flow<->screen conversion here). Polled
      // (not a single immediate read): `usePresence`'s `publishCursor` is
      // throttled to ~30Hz with a TRAILING-edge flush, so the cursor can
      // legitimately render at an earlier, intermediate mouse position for a
      // moment before the final target position's throttled publish flushes
      // — a single read right after the element first appears would be racy
      // against that settle window.
      const cursorLocatorB = pageB.locator('[data-testid="presence-cursor"]');
      await expect
        .poll(
          async () => {
            const box = await cursorLocatorB.boundingBox();
            if (!box) return null;
            return Math.hypot(box.x - targetX, box.y - targetY);
          },
          {
            message: "page B's remote cursor never settled near page A's final mouse position",
            timeout: 5000,
          },
        )
        .toBeLessThan(80);

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });

  // ── A. Presence: editing outline ────────────────────────────────────────

  test('page B shows an editing outline while page A is editing a node', async ({ browser }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      await expect(pageB.locator('[data-testid="presence-outline"]')).toHaveCount(0);

      // Enter edit mode on A's sticky (focuses its textarea) WITHOUT blurring
      // — useEditingNodeTracker publishes editingNodeId on focusin, and only
      // clears it on blur/focusout, so the outline should appear in B while
      // A's textarea remains focused.
      const stickyA = nodeLocator(pageA, 'sticky1');
      await stickyA.dblclick();
      const textarea = stickyA.locator('textarea');
      await expect(textarea).toBeVisible();
      await textarea.type('editing...');

      await expect(pageB.locator('[data-testid="presence-outline"]')).toHaveCount(1, {
        timeout: 10_000,
      });

      // Clean up: blur so the subsequent tests' pages (if any reused state)
      // aren't left with a stray focused textarea. Not strictly required
      // since each test gets fresh contexts, but keeps this test's own
      // teardown tidy.
      await stickyA
        .locator('[data-testid="base-node-rotation"]')
        .click({ position: { x: 5, y: 5 } });

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });

  // ── A. Follow-mode ───────────────────────────────────────────────────────

  test("B following A mirrors A's viewport when A pans/zooms", async ({ browser }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      // B sees A in its ActiveUsersPanel (a remote presence entry) and
      // clicks "Follow" on it.
      const panelB = pageB.locator('[data-testid="active-users-panel"]');
      await expect(panelB).toBeVisible();
      const followButton = panelB.getByRole('button', { name: /^Follow/ });
      await expect(followButton).toBeVisible({ timeout: 10_000 });
      await followButton.click();
      await expect(panelB.getByRole('button', { name: 'Stop' })).toBeVisible();

      const getTransform = async (page: Page): Promise<string> =>
        page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform);

      const beforeTransformB = await getTransform(pageB);

      // A pans the canvas — a wheel-drag or a plain mouse-drag on empty
      // canvas space pans RF's viewport (dragging the pane, not a node).
      const paneA = pageA.locator('.react-flow__pane');
      const paneBox = await paneA.boundingBox();
      expect(paneBox).toBeTruthy();
      // Start the drag away from sticky1 (top-left of the fixture) so this
      // grabs the empty pane, not the node.
      const startX = paneBox!.x + paneBox!.width * 0.8;
      const startY = paneBox!.y + paneBox!.height * 0.8;
      await pageA.mouse.move(startX, startY);
      await pageA.mouse.down();
      await pageA.mouse.move(startX - 120, startY - 80, { steps: 15 });
      await pageA.mouse.up();

      // B's viewport transform changes to mirror A's pan, converged via
      // awareness (`useFollowMode`'s apply-on-awareness-change effect).
      await expect
        .poll(async () => getTransform(pageB), {
          message: "B's viewport never changed to follow A's pan",
          timeout: 10_000,
        })
        .not.toBe(beforeTransformB);

      const afterTransformA = await getTransform(pageA);
      const afterTransformB = await getTransform(pageB);
      expect(afterTransformB).toBe(afterTransformA);

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });
});

// ── C. AI-lock SSE-drop recovery — NOT tested at this layer (see below) ─────
//
// P5-T33 (the Phase 5 gate) tried a REAL-browser version here first: begin an
// AI session via HTTP, `context.setOffline(true)` on the locked page, end the
// session while offline (so its `unlocked` SSE frame is missed), bring the
// page back online, and assert the banner clears via `useAiLock`'s reconnect
// -> `/api/ai/status` reconcile.
//
// That approach was abandoned after direct diagnosis proved it structurally
// cannot exercise the drop in this environment: Chromium's
// `BrowserContext.setOffline(true)` reliably blocks NEW requests from the
// page (confirmed — a `fetch()` issued from the page while "offline" rejects
// with "Failed to fetch"), but does NOT sever an ALREADY-ESTABLISHED
// `EventSource`/SSE stream — the locked page kept receiving the `unlocked`
// frame live and unlocked immediately, even while nominally offline, in every
// manual repro run. That means the test's own sanity check ("the banner is
// still showing — the page genuinely missed the unlock") never actually held
// (the banner cleared before that assertion even ran), which would have made
// the "recovery" assertion pass for the WRONG reason — the drop this test
// exists to prove recovery from was never happening. Per this task's
// instruction to use the cheapest RELIABLE layer and fall back rather than
// keep a test that can't prove what it claims: the full begin -> drop -> end
// (missed) -> reconnect -> unlocked path is instead asserted at the jsdom
// layer, against a REAL stubbed `EventSource` + `fetch` (not the real
// network) — see `hooks/useAiLock.test.ts`'s
// `'the classic bug: an "unlocked" missed during the drop resolves to
// UNLOCKED after reconnect'` test (pre-existing, P5-T31) plus this task's own
// added `'gate: full begin -> drop -> end -> reconnect -> unlocked path
// (P5-T33)'` test in that same file, which drives the identical state
// machine `useAiLock` uses in the real browser, just without a real socket.
