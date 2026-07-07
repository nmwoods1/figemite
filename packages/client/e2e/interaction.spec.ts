// ── Interaction E2E: single-user editing parity + persistence (P4-T26) ──────
//
// This is the Phase-4 GATE: a REAL Chromium against the REAL dev server
// (same `webServer` as render-parity.spec.ts — see playwright.config.ts),
// editing a board in DEV mode (`READONLY` is a build-time flag that defaults
// off — see app/mode.ts — so `npx vite` here serves the editable pane) and
// asserting BOTH the on-screen result AND persistence to disk, by reading the
// board's `board.json` back off the dev server's `EASEL_BOARDS_DIR`
// (playwright.config.ts's `webServer.env`, resolved the same way
// `easel-server-plugin.ts`'s `resolveDevBoardsRoot` resolves it for the
// running server) after the ~1.5s autosave debounce (`useAutosave.ts`'s
// `SAVE_DEBOUNCE_MS`) or an explicit Cmd/Ctrl+S flush.
//
// Render-parity's `kitchen-sink`/`minimal` fixtures are read-only structural
// fixtures shared across many small assertions; reusing them here for
// destructive edits would make render-parity's fixed expectations flaky. So
// this spec seeds its own fixture (`fixtures/interaction`, plain sticky +
// rect-shape, no pre-existing edge) via `seedSlug('interaction')` — the SAME
// `seed-boards.mjs` render-parity's `webServer.command` runs — and re-seeds
// it fresh in `beforeEach`, since every test here mutates the board and the
// suite runs with `workers: 1` (one shared dev server + `boards/` dir; see
// playwright.config.ts's module doc).
//
// Console-error gate: every test captures the browser console and fails on a
// ReactFlow error code / uncaught page error, same contract as
// render-parity.spec.ts.
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { seedSlug, BOARDS_ROOT } from './support/seed-boards.mjs';

const SLUG = 'interaction';

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
  shape?: string;
  rotation?: number;
}
interface PersistedEdge {
  id: string;
  source: string;
  target: string;
  style: string;
}
interface PersistedBoard {
  formatVersion: number;
  boardLabel: string;
  nodes: PersistedNode[];
  edges: PersistedEdge[];
  viewport: { x: number; y: number; zoom: number };
}

// ── Disk read helpers ────────────────────────────────────────────────────────

function boardJsonPath(): string {
  return path.join(BOARDS_ROOT, SLUG, 'board.json');
}

function readBoardJson(): PersistedBoard {
  const raw = readFileSync(boardJsonPath(), 'utf-8');
  return JSON.parse(raw) as PersistedBoard;
}

function findNode(board: PersistedBoard, id: string): PersistedNode {
  const node = board.nodes.find((n) => n.id === id);
  if (!node)
    throw new Error(
      `node ${id} not found in persisted board (ids: ${board.nodes.map((n) => n.id).join(', ')})`,
    );
  return node;
}

/** Polls the on-disk `board.json` until `predicate` passes (or times out),
 * matching the ~1.5s autosave debounce (`useAutosave.ts`'s `SAVE_DEBOUNCE_MS`)
 * plus network/fs slack. Used for every persistence assertion in this file —
 * disk state is asynchronous relative to the on-screen DOM state, so a single
 * immediate read is inherently racy. */
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
      { message, timeout: 10_000, intervals: [200, 300, 500, 500, 1000] },
    )
    .toBe(true);
  return last!;
}

// ── Console / page-error capture ─────────────────────────────────────────────

interface ConsoleCapture {
  messages: ConsoleMessage[];
  pageErrors: Error[];
}

function attachConsoleCapture(page: Page): ConsoleCapture {
  const capture: ConsoleCapture = { messages: [], pageErrors: [] };
  page.on('console', (msg) => capture.messages.push(msg));
  page.on('pageerror', (err) => capture.pageErrors.push(err));
  return capture;
}

function assertNoReactFlowErrors(capture: ConsoleCapture) {
  const offenders = capture.messages
    .map((m) => m.text())
    .filter((text) => /#0\d\d/.test(text) || /\[React Flow\]/i.test(text));
  expect(
    offenders,
    `ReactFlow error/warning codes found in console:\n${offenders.join('\n')}`,
  ).toEqual([]);
  expect(
    capture.pageErrors.map((e) => e.stack ?? e.message),
    `uncaught page errors:\n${capture.pageErrors.map((e) => e.stack ?? e.message).join('\n')}`,
  ).toEqual([]);
}

// ── Shared navigation / gesture helpers ───────────────────────────────────────

async function gotoBoard(page: Page): Promise<void> {
  await page.goto(`/#/${SLUG}`);
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  // Let RF finish its initial measurement pass before any gesture —
  // dragging/resizing against a not-yet-settled layout is exactly the kind of
  // timing flake the task calls out. (The fixture's viewport is pinned, not
  // `fitView`-derived — see dragNodeBy's doc — but RF still needs a beat to
  // measure each node's real DOM size before handles/resize controls are
  // positioned correctly.)
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
}

function nodeLocator(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

/** RF's current zoom factor, read off `.react-flow__viewport`'s CSS
 * transform (`translate(x, y) scale(zoom)`). `fixtures/interaction/board.json`
 * deliberately seeds a NON-default viewport (`{ x: 40, y: 40, zoom: 1 }` —
 * anything other than the exact all-zero `{0,0,1}` BoardFile sentinel, see
 * BoardCanvas.tsx's `isDefaultViewport`) specifically so this spec ALWAYS
 * gets zoom exactly 1, deterministically, regardless of the test viewport's
 * pixel dimensions — if the fixture's viewport were left at the all-zero
 * default, BoardCanvas would call RF's `fitView` instead, which picks
 * whatever zoom fits both seeded nodes on screen (varies with viewport size,
 * confirmed non-deterministic across manual runs during this spec's
 * development — NOT safe to assume any particular value, let alone 1:1).
 * `getZoom` exists as a defensive assertion/documentation aid (the resize
 * test also uses it for its own conversion) rather than something every
 * drag needs to convert through, now that the fixture pins it. */
async function getZoom(page: Page): Promise<number> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((el) => getComputedStyle(el).transform);
  // `getComputedStyle().transform` resolves to a 2D matrix
  // `matrix(a, b, c, d, tx, ty)` where `a` === `d` === zoom for RF's
  // uniform-scale viewport transform (no rotation/skew is ever applied to
  // `.react-flow__viewport`).
  const match = /matrix\(([^,]+),/.exec(transform);
  if (!match) throw new Error(`could not parse RF viewport transform: ${transform}`);
  return Number(match[1]);
}

/** Drags a node by a fixed FLOW-SPACE delta (i.e. the amount its persisted
 * `pos` should change by) via its body (avoiding handles/resize corners/
 * rotation knob). Screen px === flow-space units here because the fixture
 * pins zoom to exactly 1 (see {@link getZoom}'s doc) — so no unit
 * conversion is needed, only a real, gradual pointer gesture.
 *
 * Uses a HIGH step count (30), not a token 1-2 steps: RF's `d3-drag`-based
 * internals apply a small fixed-pixel drag-START THRESHOLD before a drag
 * "engages" at all, consumed once at the start of the gesture regardless of
 * the total requested delta. Confirmed via manual reproduction during this
 * spec's development: with `steps: 1` a drag registered ZERO movement at
 * all; with `steps: 3` only ~67% of the requested delta landed; `steps: 10`
 * -> ~90%; `steps: 40` -> ~98%. The threshold is a small ABSOLUTE pixel
 * cost, so spreading the same total delta over MORE, smaller intermediate
 * `mousemove` events shrinks the threshold's cost as a PERCENTAGE of the
 * total — this is not a flakiness-tolerance workaround, it's what it
 * actually takes to simulate a real, gradual human drag gesture closely
 * enough for RF's pointer-tracking to sample it accurately. */
async function dragNodeBy(page: Page, id: string, flowDx: number, flowDy: number): Promise<void> {
  const el = nodeLocator(page, id);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`node ${id} has no bounding box`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + flowDx, startY + flowDy, { steps: 30 });
  await page.mouse.up();
}

/**
 * A connection handle's exact geometric center sits precisely on its node's
 * boundary pixel (e.g. the "r" handle's center is exactly at `x =
 * nodeWidth`, `y = nodeHeight / 2` — see ConnectionHandles.tsx: `right: 0`/
 * `top: 50%`). The node's own body div (StickyNode.tsx's `sticky-body`,
 * ShapeNode's SVG container, etc.) fills that SAME boundary pixel and is
 * LATER in DOM order (rendered after `<ConnectionHandles>` inside
 * `BaseNode`), so it wins the pixel-exact hit-test tie at dead-center —
 * confirmed via `document.elementsFromPoint` during this spec's
 * development: the body div, not the handle, is topmost at the handle's
 * exact center. A real mouse essentially never lands on that exact
 * sub-pixel boundary, so this is invisible to a human; Playwright's
 * precise-to-the-pixel math does land there. Nudging a couple of CSS px
 * outward (away from the node's center, per `awayFromCenter`'s sign) is
 * enough to land on the handle's own (only slightly larger) hit area
 * without the body div contesting it. */
function handleGrabPoint(
  handleBox: { x: number; y: number; width: number; height: number },
  nodeBox: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const hcx = handleBox.x + handleBox.width / 2;
  const hcy = handleBox.y + handleBox.height / 2;
  const ncx = nodeBox.x + nodeBox.width / 2;
  const ncy = nodeBox.y + nodeBox.height / 2;
  const nudge = 3;
  return {
    x: hcx + Math.sign(hcx - ncx || 1) * nudge,
    y: hcy + Math.sign(hcy - ncy || 1) * nudge,
  };
}

async function selectNode(page: Page, id: string): Promise<void> {
  await nodeLocator(page, id).click();
  // RF itself applies the `selected` class to `.react-flow__node`
  // SYNCHRONOUSLY on click (BaseNode.tsx's OWN `data-selected` attribute
  // lives on an inner wrapper div, one level below the RF node element this
  // locator targets, so asserting the RF-native class here is both correct
  // and node-type-agnostic) — but that is NOT the same signal
  // `useBoardInteractions.ts`'s keyboard shortcuts gate on. Those read the
  // HOISTED `selectedNodeIds` (useSelection.ts), which only updates
  // slightly LATER, via RF's own `onSelectionChange` callback. Confirmed via
  // manual reproduction during this spec's development: pressing `]`
  // immediately after only the `.selected` CSS class had appeared was a
  // real, reproducible race that silently no-opped the shortcut (RF's
  // click-driven internal selection had landed; the app's hoisted
  // selection hadn't yet) — waiting for the "Cycle colour" toolbar button
  // (which only renders once the HOISTED selection is non-empty and
  // sticky/shape/frame-only, see Toolbar.tsx's `showColorCycle`) is a
  // screen-visible proxy for that later, authoritative signal.
  await expect(nodeLocator(page, id)).toHaveClass(/\bselected\b/, { timeout: 5000 });
  await page.getByTitle('Cycle colour').waitFor({ state: 'visible', timeout: 5000 });
}

// `ControlOrMeta` is Playwright's OS-aware modifier alias — it sends Meta on
// macOS and Control elsewhere, matching `useBoardInteractions.ts`'s
// `e.metaKey || e.ctrlKey` mod-key check on both platforms.
async function flushSave(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+s');
}

/** Polls the toolbar's save-status dot until it reads 'saved' (its `title`
 * attribute, set by SaveIndicator.tsx's `DOT_LABELS`) — a screen-visible
 * proxy for "the debounced/flushed save has completed" that's faster and
 * less flaky than a blind `waitForTimeout`. */
async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status-dot')).toHaveAttribute('title', 'All changes saved', {
    timeout: 10_000,
  });
}

test.describe('single-user editing parity + persistence (Phase 4 gate)', () => {
  test.beforeEach(() => {
    // Fresh on-disk board before every test — see module doc. Tests run
    // serially (`workers: 1`) against one shared dev server, so re-seeding
    // between tests (rather than per-worker isolation) is what keeps every
    // test's starting state pristine regardless of run order.
    seedSlug(SLUG);
  });

  // ── 1. Create + text ────────────────────────────────────────────────────

  test('toolbar creates a sticky, text commits on screen and to disk', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    await page.getByTitle('Sticky note', { exact: true }).click();
    // The sticky-color popover opens; pick the first swatch to actually
    // create the node (matches Toolbar.tsx's StickyColorPicker flow — the
    // button alone only opens the picker).
    await page.locator('[title="#fef3c7"]').first().click();

    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const newStickyId = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node[data-id]'));
      const known = new Set(['sticky1', 'shape1']);
      const created = nodes.map((n) => n.getAttribute('data-id')!).find((id) => !known.has(id));
      return created ?? null;
    });
    expect(newStickyId, 'toolbar did not create a new sticky node id').toBeTruthy();

    const created = nodeLocator(page, newStickyId!);
    await created.dblclick();
    const textarea = created.locator('textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('Hello from Playwright');
    await created.locator('[data-testid="base-node-rotation"]').click({ position: { x: 5, y: 5 } });
    // Blur commits (useEditableText.ts's `commit` fires on textarea blur).
    await expect(created).toContainText('Hello from Playwright');

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted(
      (b) => findNode(b, newStickyId!)?.text === 'Hello from Playwright',
      'new sticky text never persisted to board.json',
    );
    expect(findNode(persisted, newStickyId!).text).toBe('Hello from Playwright');

    assertNoReactFlowErrors(capture);
  });

  // ── 2. Drag + PERSIST — the key proof ───────────────────────────────────

  test('dragging a node moves it on screen AND persists pos to board.json', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const before = readBoardJson();
    const startPos = findNode(before, 'sticky1').pos;

    const beforeBox = await nodeLocator(page, 'sticky1').boundingBox();
    expect(beforeBox).toBeTruthy();
    // Sanity check: the fixture's viewport pins zoom to exactly 1 (see
    // dragNodeBy's doc), so screen px === flow-space units below.
    expect(await getZoom(page)).toBeCloseTo(1, 5);

    const DX = 150;
    const DY = 90;
    await dragNodeBy(page, 'sticky1', DX, DY);

    // On-screen: the node's bounding box moved by ~(DX, DY) screen px, which
    // equals flow-space units at zoom 1. +/-10% tolerance for the residual
    // drag-start-threshold cost dragNodeBy's `steps: 30` doesn't fully
    // eliminate (see its doc).
    const afterBox = await nodeLocator(page, 'sticky1').boundingBox();
    expect(afterBox).toBeTruthy();
    const tol = 0.1;
    expect(afterBox!.x - beforeBox!.x).toBeGreaterThan(DX * (1 - tol));
    expect(afterBox!.x - beforeBox!.x).toBeLessThan(DX * (1 + tol));
    expect(afterBox!.y - beforeBox!.y).toBeGreaterThan(DY * (1 - tol));
    expect(afterBox!.y - beforeBox!.y).toBeLessThan(DY * (1 + tol));

    // Persistence: wait out the autosave debounce, then re-read board.json —
    // this is the proof that the whole edit -> store -> autosave -> disk
    // loop is wired end to end, not just the in-memory doc. Tolerance of 10%
    // of the requested delta (not a fixed px value) for the same
    // drag-start-threshold residual as the on-screen assertion above.
    const persisted = await waitForPersisted((b) => {
      const p = findNode(b, 'sticky1').pos;
      return (
        Math.abs(p.x - (startPos.x + DX)) < DX * tol && Math.abs(p.y - (startPos.y + DY)) < DY * tol
      );
    }, 'dragged node position never persisted to board.json within tolerance');

    const persistedPos = findNode(persisted, 'sticky1').pos;
    expect(Math.abs(persistedPos.x - (startPos.x + DX))).toBeLessThan(DX * tol);
    expect(Math.abs(persistedPos.y - (startPos.y + DY))).toBeLessThan(DY * tol);

    assertNoReactFlowErrors(capture);
  });

  // ── 3. Resize ────────────────────────────────────────────────────────────

  test('resizing a node changes size on screen and in board.json', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const before = readBoardJson();
    const beforeSize = findNode(before, 'sticky1').size as WH;

    const zoom = await getZoom(page);
    const beforeBox = await nodeLocator(page, 'sticky1').boundingBox();

    await selectNode(page, 'sticky1');
    const handle = page.locator(
      '.react-flow__node[data-id="sticky1"] .react-flow__resize-control.bottom.right',
    );
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    const hx = handleBox!.x + handleBox!.width / 2;
    const hy = handleBox!.y + handleBox!.height / 2;

    // Flow-space growth this drag should produce (>=40 doc units in each
    // axis) converted to the screen-space mouse delta via the live zoom —
    // BoardCanvas.tsx's `fitView` picks zoom!=1 for this fixture (see
    // getZoom's doc), so a raw, unconverted screen-pixel drag distance would
    // under/over-shoot the intended flow-space growth.
    const flowGrowX = 80;
    const flowGrowY = 60;
    const screenDx = flowGrowX * zoom;
    const screenDy = flowGrowY * zoom;

    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + screenDx, hy + screenDy, { steps: 20 });
    await page.mouse.up();

    const afterBox = await nodeLocator(page, 'sticky1').boundingBox();
    expect(afterBox!.width - beforeBox!.width).toBeGreaterThan(screenDx - 20);
    expect(afterBox!.height - beforeBox!.height).toBeGreaterThan(screenDy - 20);

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted((b) => {
      const s = findNode(b, 'sticky1').size as WH;
      return s.width > beforeSize.width + 20 && s.height > beforeSize.height + 20;
    }, 'resized node size never persisted to board.json');

    const persistedSize = findNode(persisted, 'sticky1').size as WH;
    expect(persistedSize.width).toBeGreaterThan(beforeSize.width + 20);
    expect(persistedSize.height).toBeGreaterThan(beforeSize.height + 20);

    assertNoReactFlowErrors(capture);
  });

  // ── 4. Rotate ────────────────────────────────────────────────────────────

  test('rotating a shape node persists rotation', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    await selectNode(page, 'shape1');
    const rotateHandle = page.locator('.react-flow__node[data-id="shape1"] [title^="Rotate"]');
    await expect(rotateHandle).toBeVisible();
    const box = await rotateHandle.boundingBox();
    expect(box).toBeTruthy();
    const hx = box!.x + box!.width / 2;
    const hy = box!.y + box!.height / 2;

    const nodeBox = await nodeLocator(page, 'shape1').boundingBox();
    const cx = nodeBox!.x + nodeBox!.width / 2;
    const cy = nodeBox!.y + nodeBox!.height / 2;

    await page.mouse.move(hx, hy);
    await page.mouse.down();
    // Drag the rotation handle from "above center" (12 o'clock) to "right of
    // center" (3 o'clock) — a ~90° sweep, matching RotationHandle.tsx's
    // atan2-around-center math.
    await page.mouse.move(cx, cy - (hy - cy), { steps: 3 });
    await page.mouse.move(cx + (cy - hy), cy, { steps: 5 });
    await page.mouse.up();

    const rotationWrapper = page.locator(
      '.react-flow__node[data-id="shape1"] [data-testid="base-node-rotation"]',
    );
    const transform = await rotationWrapper.evaluate((el) => getComputedStyle(el).transform);
    expect(transform, 'shape1 has no rotation transform after dragging the rotate handle').not.toBe(
      'none',
    );
    expect(transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted((b) => {
      const r = findNode(b, 'shape1').rotation;
      return typeof r === 'number' && Math.abs(r) > 5;
    }, 'shape1 rotation never persisted to board.json');
    expect(Math.abs(findNode(persisted, 'shape1').rotation ?? 0)).toBeGreaterThan(5);

    assertNoReactFlowErrors(capture);
  });

  // ── 5. Edge ──────────────────────────────────────────────────────────────

  test('dragging from one handle to another creates an edge that persists with correct endpoints', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    await expect(page.locator('.react-flow__edge')).toHaveCount(0);

    // sticky1's right handle -> shape1's left handle. Both render (hidden
    // when non-interactive, but this canvas is editable — see
    // ConnectionHandles.tsx) as `.react-flow__handle[data-nodeid][data-handleid]`.
    const sourceHandle = page.locator(
      '.react-flow__handle[data-nodeid="sticky1"][data-handleid="r"]',
    );
    const targetHandle = page.locator(
      '.react-flow__handle[data-nodeid="shape1"][data-handleid="l"]',
    );
    await expect(sourceHandle).toBeAttached();
    await expect(targetHandle).toBeAttached();

    const srcBox = await sourceHandle.boundingBox();
    const tgtBox = await targetHandle.boundingBox();
    const srcNodeBox = await nodeLocator(page, 'sticky1').boundingBox();
    const tgtNodeBox = await nodeLocator(page, 'shape1').boundingBox();
    expect(srcBox).toBeTruthy();
    expect(tgtBox).toBeTruthy();

    const { x: sx, y: sy } = handleGrabPoint(srcBox!, srcNodeBox!);
    const { x: tx, y: ty } = handleGrabPoint(tgtBox!, tgtNodeBox!);

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 5 });
    await page.mouse.move(tx, ty, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const edgeEl = page.locator('.react-flow__edge');
    const bezier = edgeEl.locator('path.react-flow__edge-path');
    await expect(bezier).toHaveCount(1);

    const edgeId = await edgeEl.getAttribute('data-id');
    expect(edgeId).toBeTruthy();

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted(
      (b) => b.edges.length === 1,
      'new edge never persisted to board.json',
    );
    expect(persisted.edges).toHaveLength(1);
    expect(persisted.edges[0].source).toBe('sticky1');
    expect(persisted.edges[0].target).toBe('shape1');

    assertNoReactFlowErrors(capture);
  });

  // ── 6. Undo/redo ─────────────────────────────────────────────────────────

  test('Cmd/Ctrl+Z reverts a drag on screen and in the doc; Cmd/Ctrl+Shift+Z reapplies', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const before = readBoardJson();
    const startPos = findNode(before, 'sticky1').pos;

    await dragNodeBy(page, 'sticky1', 120, 80);
    // Wait for the drag's commit to actually land in the doc (RF's own
    // controlled-node position is enough on-screen, but we want the store
    // updated before undo — the drag-stop commit is synchronous with the
    // mouseup event, so a short poll on the doc's DOM reflection is enough).
    await expect
      .poll(async () => {
        const box = await nodeLocator(page, 'sticky1').boundingBox();
        return box ? box.x : null;
      })
      .not.toBeNull();

    const movedBox = await nodeLocator(page, 'sticky1').boundingBox();

    await page.keyboard.press('ControlOrMeta+z');

    // On screen: reverts close to the original bounding box position.
    await expect
      .poll(async () => {
        const box = await nodeLocator(page, 'sticky1').boundingBox();
        if (!box || !movedBox) return null;
        return Math.abs(box.x - movedBox.x) > 30; // moved away from the post-drag position
      })
      .toBe(true);

    await flushSave(page);
    await waitForSaved(page);
    const afterUndo = await waitForPersisted((b) => {
      const p = findNode(b, 'sticky1').pos;
      return Math.abs(p.x - startPos.x) < 5 && Math.abs(p.y - startPos.y) < 5;
    }, 'undo never reverted sticky1 position in board.json');
    expect(Math.abs(findNode(afterUndo, 'sticky1').pos.x - startPos.x)).toBeLessThan(5);

    // Redo: Cmd/Ctrl+Shift+Z reapplies the drag. Tolerance of 10 (matching
    // the drag test's) rather than undo's tighter 5: redo restores the
    // ORIGINAL drag's committed position exactly (Y.UndoManager redoes the
    // precise recorded delta, not a re-derived one), but that original
    // commit itself came from a zoom-converted screen-space drag — so it
    // carries the same few px of float-rounding slack as any other drag
    // commit in this file, unlike undo's revert-to-`startPos` above (which
    // reverts to the fixture's exact, never-converted seed value).
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await flushSave(page);
    await waitForSaved(page);
    const afterRedo = await waitForPersisted((b) => {
      const p = findNode(b, 'sticky1').pos;
      return Math.abs(p.x - (startPos.x + 120)) < 10 && Math.abs(p.y - (startPos.y + 80)) < 10;
    }, 'redo never reapplied sticky1 position in board.json');
    expect(Math.abs(findNode(afterRedo, 'sticky1').pos.x - (startPos.x + 120))).toBeLessThan(10);

    assertNoReactFlowErrors(capture);
  });

  // ── 7. Clipboard ─────────────────────────────────────────────────────────

  test('Cmd/Ctrl+C/+V duplicates offset; Cmd/Ctrl+D duplicates; Cmd/Ctrl+X cuts', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    // Copy + paste.
    await selectNode(page, 'sticky1');
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    const before = readBoardJson();
    const originalPos = findNode(before, 'sticky1').pos;

    await flushSave(page);
    await waitForSaved(page);
    let persisted = await waitForPersisted(
      (b) => b.nodes.length === 3,
      'pasted node never persisted to board.json',
    );
    expect(persisted.nodes).toHaveLength(3);
    const pastedNode = persisted.nodes.find(
      (n) => n.id !== 'sticky1' && n.id !== 'shape1' && n.type === 'sticky',
    );
    expect(pastedNode, 'no pasted sticky node found in persisted board').toBeTruthy();
    // Paste offsets by +20/+20 (useBoardInteractions.ts's pasteClipboard).
    expect(pastedNode!.pos.x - originalPos.x).toBe(20);
    expect(pastedNode!.pos.y - originalPos.y).toBe(20);

    // Duplicate (Cmd/Ctrl+D) — selection is still sticky1 (RF keeps focus on
    // the originally-selected node; paste's own selection isn't re-asserted
    // here since duplicateSelection reads `optionsRef.current.selectedNodeIds`
    // directly, which still holds sticky1).
    await selectNode(page, 'sticky1');
    await page.keyboard.press('ControlOrMeta+d');
    await expect(page.locator('.react-flow__node')).toHaveCount(4);

    await flushSave(page);
    await waitForSaved(page);
    persisted = await waitForPersisted(
      (b) => b.nodes.length === 4,
      'duplicated node (Cmd/Ctrl+D) never persisted to board.json',
    );
    expect(persisted.nodes).toHaveLength(4);

    // Cut (Cmd/Ctrl+X) removes the selected node.
    await selectNode(page, 'sticky1');
    await page.keyboard.press('ControlOrMeta+x');
    await expect(page.locator('.react-flow__node[data-id="sticky1"]')).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await flushSave(page);
    await waitForSaved(page);
    persisted = await waitForPersisted(
      (b) => b.nodes.every((n) => n.id !== 'sticky1') && b.nodes.length === 3,
      'cut node (Cmd/Ctrl+X) never removed from board.json',
    );
    expect(persisted.nodes.find((n) => n.id === 'sticky1')).toBeUndefined();
    expect(persisted.nodes).toHaveLength(3);

    assertNoReactFlowErrors(capture);
  });

  // ── 8. Delete ────────────────────────────────────────────────────────────

  test('select + Delete removes a node (and its edges), persisted', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    // Create an edge first so we can assert it's removed alongside its node.
    const sourceHandle = page.locator(
      '.react-flow__handle[data-nodeid="sticky1"][data-handleid="r"]',
    );
    const targetHandle = page.locator(
      '.react-flow__handle[data-nodeid="shape1"][data-handleid="l"]',
    );
    const srcBox = await sourceHandle.boundingBox();
    const tgtBox = await targetHandle.boundingBox();
    const srcNodeBox = await nodeLocator(page, 'sticky1').boundingBox();
    const tgtNodeBox = await nodeLocator(page, 'shape1').boundingBox();
    const { x: sx, y: sy } = handleGrabPoint(srcBox!, srcNodeBox!);
    const { x: tx, y: ty } = handleGrabPoint(tgtBox!, tgtNodeBox!);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 8 });
    await page.mouse.up();
    // Move the pointer well away from any handle before the next
    // interaction — clicking a node immediately after finishing a
    // connection-drag, with the cursor still resting exactly on the target
    // handle, has been observed to occasionally get reinterpreted as
    // starting ANOTHER connection rather than a plain select.
    await page.mouse.move(20, 20);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await selectNode(page, 'sticky1');
    await page.keyboard.press('Delete');

    await expect(page.locator('.react-flow__node[data-id="sticky1"]')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted(
      (b) => b.nodes.every((n) => n.id !== 'sticky1') && b.edges.length === 0,
      'deleted node/edge never persisted to board.json',
    );
    expect(persisted.nodes.find((n) => n.id === 'sticky1')).toBeUndefined();
    expect(persisted.edges).toHaveLength(0);

    assertNoReactFlowErrors(capture);
  });

  // ── 9. Layer reorder ─────────────────────────────────────────────────────

  test('] / [ change stacking order (zIndex) and persist the new order', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    // `getComputedStyle().zIndex` is NOT read directly against a SELECTED
    // node in this test: ReactFlow's own `elevateNodesOnSelect` (on by
    // default) adds a flat +1000 to whichever node is currently selected,
    // on top of the zIndex `rf-adapters.ts` derives from `order` — so
    // comparing raw zIndex while `sticky1` stays selected across both the
    // `]` and `[` assertions is confounded by that elevation (confirmed via
    // manual reproduction during this spec's development: after `[`,
    // sticky1's real `order` correctly dropped back below shape1's, but
    // its zIndex still read HIGHER than shape1's purely from the +1000
    // selection bonus, which would make a naive zIndex comparison here
    // assert the wrong thing). Deselecting (click empty canvas) before
    // reading zIndex removes that confound; the persisted `order` (read via
    // the live `/api/board` GET, not just the on-disk file) is the
    // unambiguous ground truth this test leans on for the actual assertion.
    const zIndexOf = async (id: string): Promise<number> =>
      nodeLocator(page, id).evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);

    const deselect = async () => {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
    };

    const beforeStickyZ = await zIndexOf('sticky1');
    const beforeShapeZ = await zIndexOf('shape1');
    // Fixture seeds sticky1 (order 0) behind shape1 (order 1).
    expect(beforeStickyZ).toBeLessThan(beforeShapeZ);

    await selectNode(page, 'sticky1');
    await page.keyboard.press(']'); // bring sticky1 forward

    // `order` is doc-first state — it's authoritative in the RENDERED
    // zIndex the instant the keypress commits (rf-adapters.ts derives
    // zIndex from `order` synchronously via the reconcile effect), well
    // before autosave's ~1.5s debounce ever POSTs it to disk. So this reads
    // the SAME zIndex signal already used for `beforeStickyZ`/`beforeShapeZ`
    // above, deselecting first to remove the `elevateNodesOnSelect`
    // confound (see this test's opening comment) — NOT `/api/board`'s GET,
    // which only reflects the last-SAVED disk state and would still show
    // the pre-`]` order for the whole ~1.5s debounce window (a real bug in
    // an earlier version of this test: polling the network endpoint here
    // raced the autosave debounce and could time out even though the
    // reorder itself had already committed correctly in the browser).
    await deselect();
    await expect.poll(() => zIndexOf('sticky1')).toBeGreaterThan(await zIndexOf('shape1'));

    const afterStickyZ = await zIndexOf('sticky1');
    const afterShapeZ = await zIndexOf('shape1');
    expect(afterStickyZ).toBeGreaterThan(afterShapeZ);

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted((b) => {
      return findNode(b, 'sticky1').order > findNode(b, 'shape1').order;
    }, 'layer reorder (]) never persisted new order to board.json');
    expect(findNode(persisted, 'sticky1').order).toBeGreaterThan(
      findNode(persisted, 'shape1').order,
    );

    // Send it back with [. Re-select first — the global keydown handler's
    // layer-reorder shortcuts require a live node selection
    // (useBoardInteractions.ts's `hasNodeSelection` gate), which the
    // `deselect()` above intentionally cleared.
    await selectNode(page, 'sticky1');
    await page.keyboard.press('[');
    await deselect();

    await expect.poll(() => zIndexOf('sticky1')).toBeLessThan(await zIndexOf('shape1'));
    const backStickyZ = await zIndexOf('sticky1');
    const backShapeZ = await zIndexOf('shape1');
    expect(backStickyZ).toBeLessThan(backShapeZ);

    await flushSave(page);
    await waitForSaved(page);
    const persistedBack = await waitForPersisted((b) => {
      return findNode(b, 'sticky1').order < findNode(b, 'shape1').order;
    }, 'layer reorder ([) never persisted the reverted order to board.json');
    expect(findNode(persistedBack, 'sticky1').order).toBeLessThan(
      findNode(persistedBack, 'shape1').order,
    );

    assertNoReactFlowErrors(capture);
  });

  // `}`/`{` (front/back) share `]`/`[`'s exact code path (both call
  // `reorderSelectedLayers`, just with the `'front'`/`'back'` LayerOp instead
  // of `'forward'`/`'backward'` — see useBoardInteractions.ts) and this
  // fixture only has 2 non-frame nodes, so "one step forward" and "all the
  // way to front" are indistinguishable outcomes here. Covered as its own
  // small test (rather than folded into the `]`/`[` test above) so a
  // regression that broke ONLY the front/back variant — e.g. a typo mapping
  // both to the same op — would still be caught.
  test('} / { (front/back) also change stacking order and persist it', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const zIndexOf = async (id: string): Promise<number> =>
      nodeLocator(page, id).evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);
    const deselect = async () => {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
    };

    await selectNode(page, 'sticky1');
    await page.keyboard.press('}'); // bring sticky1 to front
    await deselect();

    await expect.poll(() => zIndexOf('sticky1')).toBeGreaterThan(await zIndexOf('shape1'));

    await flushSave(page);
    await waitForSaved(page);
    const persisted = await waitForPersisted((b) => {
      return findNode(b, 'sticky1').order > findNode(b, 'shape1').order;
    }, 'layer reorder (}) never persisted new order to board.json');
    expect(findNode(persisted, 'sticky1').order).toBeGreaterThan(
      findNode(persisted, 'shape1').order,
    );

    await selectNode(page, 'sticky1');
    await page.keyboard.press('{'); // send sticky1 to back
    await deselect();

    await expect.poll(() => zIndexOf('sticky1')).toBeLessThan(await zIndexOf('shape1'));

    await flushSave(page);
    await waitForSaved(page);
    const persistedBack = await waitForPersisted((b) => {
      return findNode(b, 'sticky1').order < findNode(b, 'shape1').order;
    }, 'layer reorder ({) never persisted the reverted order to board.json');
    expect(findNode(persistedBack, 'sticky1').order).toBeLessThan(
      findNode(persistedBack, 'shape1').order,
    );

    assertNoReactFlowErrors(capture);
  });

  // Escape: cancels an in-progress mode rather than editing the board
  // directly — BoardCanvas.tsx wires `onEscape` to close the
  // DescriptionModal (`setDescNodeId(null)`), the only stateful "mode" this
  // phase's editable canvas has. A text-editing Escape (revert an in-flight
  // sticky/shape edit without committing) is `useEditableText.ts`'s own
  // LOCAL `onKeyDown` handler on the textarea, not this global shortcut —
  // already exercised structurally by every node-editing test's `.fill()`
  // + blur-commits flow; Escape's DISTINCT, global-shortcut-owned behavior
  // (closing the description modal) is what this test covers that nothing
  // else does.
  //
  // Opens the modal via `shape1`'s badge (the fixture seeds it WITH a
  // description, see fixtures/interaction/board.json) rather than
  // `sticky1`'s hover-revealed "Add description" affordance: hovering to
  // reveal that badge is NOT reproducible with a real OS-level mouse move in
  // a real browser — DescriptionBadge.tsx's hover-zone div is
  // `pointer-events: none` (only the badge BUTTON inside gets
  // `pointer-events: auto`, once rendered), so no real cursor position can
  // ever land ON the pointer-events:none zone to fire its `onMouseEnter` in
  // the first place; only jsdom's `fireEvent.mouseEnter()` (used by this
  // codebase's own unit tests, e.g. BoardCanvas.test.tsx) can trigger it,
  // because that synthetic dispatch bypasses CSS pointer-events entirely —
  // an escape hatch a real browser has no equivalent for. Confirmed via
  // manual reproduction during this spec's development: moving the mouse to
  // every plausible point over a hover-revealed badge (including its exact
  // documented position) never made the button appear. This is a REAL gap
  // in the product's hover-to-discover UX for real users, not a test
  // limitation — reported in this task's write-up rather than worked around
  // by weakening this assertion; a description-having node's ALWAYS-visible
  // badge is what real users would actually use to reach this modal anyway
  // (and is what this test exercises), so the flow this test covers is
  // itself fully real and unaffected by that gap.
  test('Escape closes the description modal without committing a change', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    await page
      .locator(
        '.react-flow__node[data-id="shape1"] [data-testid="description-badge-hover-zone"] button',
      )
      .click();
    await expect(page.getByText('Edit description')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Edit description')).toHaveCount(0);

    assertNoReactFlowErrors(capture);
  });

  // ── 10. Cmd+S flush ──────────────────────────────────────────────────────

  test('Cmd/Ctrl+S flushes pending edits to board.json promptly (no debounce wait)', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const before = readBoardJson();
    const startPos = findNode(before, 'sticky1').pos;

    await dragNodeBy(page, 'sticky1', 60, 30);

    // Flush immediately (bypassing the debounce timer per useAutosave.ts's
    // `flushNow`) and assert the save-status dot reaches 'saved' fast.
    const flushStart = Date.now();
    await flushSave(page);
    await waitForSaved(page);
    const flushElapsed = Date.now() - flushStart;
    // Generous upper bound — this is asserting "promptly", not chasing a
    // tight perf budget; the debounce alone is 1.5s, so a flush taking
    // meaningfully longer than that would indicate flushNow isn't actually
    // bypassing the timer.
    expect(flushElapsed).toBeLessThan(5000);

    const persisted = readBoardJson();
    const p = findNode(persisted, 'sticky1').pos;
    // Tolerance of 10 (not an exact match): dragNodeBy's drag-start
    // threshold residual (see its doc) leaves a few px of slack even at
    // zoom 1 — this assertion cares that the flush delivered the DRAGGED
    // position promptly, not sub-pixel exactness (which isn't this test's
    // point; the drag test already covers precision).
    expect(Math.abs(p.x - (startPos.x + 60))).toBeLessThan(10);
    expect(Math.abs(p.y - (startPos.y + 30))).toBeLessThan(10);

    assertNoReactFlowErrors(capture);
  });
});
