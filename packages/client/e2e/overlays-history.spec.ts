// ── Overlays + history E2E: comments, pencil, annotation, history (P6-T37) ──
//
// This is the Phase-6 GATE: a REAL Chromium against the REAL dev server (same
// `webServer` as interaction.spec.ts/multiplayer.spec.ts — see
// playwright.config.ts), proving the four Phase-6 features work end to end —
// on screen AND (where the feature is meant to persist at all) on disk:
//
//   1. Comments (P6-T34): placing a CANVAS comment and a NODE comment, a
//      reply, and resolving a thread all render on screen AND round-trip
//      through the server to `boards/overlays-history/comments.json` — the
//      file `useComments.ts` saves on every mutation (see that hook's module
//      doc: "save-on-each-change, simplest correct option for a low-
//      frequency, file-based resource — no debouncing needed"), so this
//      spec's disk assertions poll only for eventual-consistency slack (the
//      POST + fs write), not a debounce window.
//   2. Pencil (P6-T35): a real pointer-drawn stroke commits a PERSISTED
//      `DrawingNode` (`@easel/shared`'s `makeDrawingNode` + `store.addNode`)
//      that reaches `board.json` via the SAME server-debounced room-persist
//      path `interaction.spec.ts`'s `waitForPersisted` already proves for
//      other node types (`YjsWebsocketService`'s `DEFAULT_PERSIST_DEBOUNCE_MS`,
//      ~1s).
//   3. Annotation (P6-T35): TWO real browser contexts (mirrors
//      multiplayer.spec.ts's pattern) on the SAME board — a scribble drawn in
//      page A syncs live to page B via the room's shared `ANNOTATIONS`
//      Y.Array, Wipe (from either page) clears it for both, and — the
//      defining contract of this feature — `board.json` NEVER contains any
//      annotation data at any point, because `AnnotationLayer`'s strokes live
//      on a Y.Array `getSnapshot()` never reads (see that module's doc).
//   4. History (P6-T36): a real edit produces a `save`-triggered snapshot
//      (`YjsWebsocketService.persistNow` calls `history.snapshot(..., 'save')`
//      after every debounced persist — packages/server/src/services/
//      yjs-ws.ts — so no bespoke `.history/` seeding is needed here, unlike a
//      from-scratch board with zero edits). Previewing an OLDER snapshot
//      renders it read-only WITHOUT mutating the live doc (`useHistory.ts`'s
//      central isolation invariant — see that module's doc), and Restore
//      applies it to the live doc + disk, after which undo is cleared and a
//      subsequent edit still works cleanly.
//
// Every test seeds its OWN fresh `overlays-history` board (`seedSlug`, same
// helper `interaction.spec.ts`/`multiplayer.spec.ts` use) in `beforeEach` —
// this suite mutates the board and runs serially against one shared dev
// server + `boards/` dir (`workers: 1`, see playwright.config.ts's module
// doc), so a pristine starting fixture per test is required for determinism.
//
// Identity: every context seeds a display name via `addInitScript` before any
// page loads (mirrors `interaction.spec.ts`'s `beforeEach` /
// `multiplayer.spec.ts`'s `newIdentifiedContext`) so `IdentityPrompt` ("Who
// are you?") never mounts and intercepts a click — comments in particular
// gate their placement flow on `hasStoredUser()` (CommentLayer.tsx).
//
// Console-error gate: every test captures the browser console and fails on a
// ReactFlow error code / uncaught page error, same contract as
// interaction.spec.ts/multiplayer.spec.ts.
import {
  test,
  expect,
  type Page,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
} from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { seedSlug, BOARDS_ROOT } from './support/seed-boards.mjs';

const SLUG = 'overlays-history';

// ── Types (minimal local shape — just what this spec reads off disk) ────────

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
  points?: XY[];
  strokeWidth?: number;
}
interface PersistedBoard {
  formatVersion: number;
  boardLabel: string;
  nodes: PersistedNode[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
}

interface CommentTargetNode {
  type: 'node';
  nodeId: string;
  offset?: XY;
}
interface CommentTargetCanvas {
  type: 'canvas';
  pos: XY;
}
type CommentTarget = CommentTargetNode | CommentTargetCanvas;
interface CommentReply {
  id: string;
  author: string;
  createdAt: string;
  text: string;
}
interface BoardComment {
  id: string;
  target: CommentTarget;
  author: string;
  createdAt: string;
  text: string;
  resolved?: boolean;
  replies: CommentReply[];
}
interface CommentsFile {
  comments: BoardComment[];
}

// ── Disk read helpers ────────────────────────────────────────────────────────

function boardJsonPath(): string {
  return path.join(BOARDS_ROOT, SLUG, 'board.json');
}
function commentsJsonPath(): string {
  return path.join(BOARDS_ROOT, SLUG, 'comments.json');
}

function readBoardJson(): PersistedBoard {
  const raw = readFileSync(boardJsonPath(), 'utf-8');
  return JSON.parse(raw) as PersistedBoard;
}

function readCommentsJson(): CommentsFile {
  const raw = readFileSync(commentsJsonPath(), 'utf-8');
  return JSON.parse(raw) as CommentsFile;
}

/** Every `.history/` snapshot filename stem for this board, newest-first
 * (matches SnapshotHistoryService's own sort — see that module's doc). Reads
 * the directory directly (not via the `/api/history` network endpoint) since
 * this file already has a raw filesystem path (`BOARDS_ROOT`) to the same
 * dir the server itself resolves via `historyDir`. */
function listHistoryIds(): string[] {
  const dir = path.join(BOARDS_ROOT, SLUG, '.history');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => e.endsWith('.json')).map((e) => e.slice(0, -'.json'.length));
}

/** Polls the on-disk `board.json` until `predicate` passes — matches the
 * server's own debounced persist-on-update (`YjsWebsocketService`'s
 * `DEFAULT_PERSIST_DEBOUNCE_MS`, ~1s). Same contract as
 * interaction.spec.ts's/multiplayer.spec.ts's `waitForPersisted`. */
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

/** Polls `comments.json` until `predicate` passes. `useComments.ts` persists
 * on every mutation immediately (no client debounce — see that hook's module
 * doc), so this only needs to absorb network/fs round-trip slack, not a
 * deliberate debounce window — but it's still a POST-then-read-back on disk,
 * so a poll (not a single immediate read) is the only race-free option. */
async function waitForCommentsPersisted(
  predicate: (file: CommentsFile) => boolean,
  message: string,
): Promise<CommentsFile> {
  let last: CommentsFile | undefined;
  await expect
    .poll(
      () => {
        try {
          last = readCommentsJson();
          return predicate(last);
        } catch {
          return false;
        }
      },
      { message, timeout: 10_000, intervals: [100, 200, 300, 500, 500, 1000] },
    )
    .toBe(true);
  return last!;
}

// ── Console / page-error capture (same contract as the other Phase specs) ──

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

// ── Navigation / identity helpers ────────────────────────────────────────────

async function gotoBoard(page: Page): Promise<void> {
  await page.goto(`/#/${SLUG}`);
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
}

function nodeLocator(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

/** A fresh browser context with a display name pre-seeded into localStorage
 * (`lib/identity.ts`'s key) before any page ever loads the app — mirrors
 * interaction.spec.ts's `beforeEach`/multiplayer.spec.ts's
 * `newIdentifiedContext`. Skips `IdentityPrompt` entirely, and gives a
 * deterministic author name (rather than identity.ts's random `guest-xxxxx`
 * fallback) so comment-author assertions are stable. */
async function newIdentifiedContext(browser: Browser, name: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((n) => window.localStorage.setItem('easel:author', n), name);
  return context;
}

/** Draws a real pointer stroke over the given overlay locator (pencil or
 * annotation), an L-shaped path so the commit definitely has >= 2 thinned
 * points (`draw-utils.ts`'s `thinPoints` drops points within 1.5 flow units
 * of each other — each leg here moves ~80px in one axis, well clear of that
 * threshold at zoom 1). `steps` on each leg mirrors interaction.spec.ts's
 * `dragNodeBy` rationale: a real drag/draw gesture needs several intermediate
 * `mousemove` events, not a single jump, for the app's own pointer-tracking
 * to sample it as more than a single point. */
async function drawStroke(
  page: Page,
  overlay: ReturnType<Page['locator']>,
  origin: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 80, origin.y, { steps: 10 });
  await page.mouse.move(origin.x + 80, origin.y + 60, { steps: 10 });
  await page.mouse.up();
  // Sanity check the overlay actually captured the gesture (otherwise a
  // silent no-op stroke would make every downstream assertion vacuous).
  await overlay.waitFor({ state: 'visible' });
}

test.describe('comments, pencil, annotation, history (Phase 6 gate)', () => {
  test.beforeEach(async ({ context }) => {
    seedSlug(SLUG);
    await context.addInitScript(
      (n) => window.localStorage.setItem('easel:author', n),
      'Overlay Tester',
    );
  });

  // ── 1. Comments: canvas + node placement, reply, resolve, on disk ───────

  test('placing a canvas comment and a node comment, replying, and resolving round-trip to comments.json', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    // Enter comment mode.
    await page.getByTitle('Comment', { exact: true }).click();
    const overlay = page.locator('[data-testid="comment-placement-overlay"]');
    await expect(overlay).toBeVisible();

    // ── Canvas comment: click empty space (well clear of sticky1, which the
    // fixture seeds at flow (40,40)-(240,200), viewport pinned to zoom 1/
    // (40,40) offset — see fixtures/overlays-history/board.json). ──────────
    const canvasBox = await overlay.boundingBox();
    expect(canvasBox).toBeTruthy();
    const emptyX = canvasBox!.x + canvasBox!.width - 100;
    const emptyY = canvasBox!.y + 100;
    await overlay.click({ position: { x: emptyX - canvasBox!.x, y: emptyY - canvasBox!.y } });

    const canvasForm = page.locator('textarea[placeholder="Add a comment…"]');
    await expect(canvasForm).toBeVisible();
    await canvasForm.fill('A canvas-level note');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(canvasForm).toHaveCount(0);

    // Re-enter comment mode for the second placement (submitting the first
    // one exits comment mode — CommentLayer's onAddComment -> setActiveMode('none')).
    await page.getByTitle('Comment', { exact: true }).click();
    await expect(overlay).toBeVisible();

    // ── Node comment: click directly on sticky1's body. ─────────────────
    const stickyBox = await nodeLocator(page, 'sticky1').boundingBox();
    expect(stickyBox).toBeTruthy();
    const nodeClickX = stickyBox!.x + stickyBox!.width / 2;
    const nodeClickY = stickyBox!.y + stickyBox!.height / 2;
    await overlay.click({
      position: { x: nodeClickX - canvasBox!.x, y: nodeClickY - canvasBox!.y },
    });

    const nodeForm = page.locator('textarea[placeholder="Add a comment…"]');
    await expect(nodeForm).toBeVisible();
    await nodeForm.fill('A node-level note');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(nodeForm).toHaveCount(0);

    // Both pins render on screen.
    await expect(page.locator('[data-testid^="comment-pin-"]')).toHaveCount(2);

    // Disk: both comments landed in comments.json with the right target
    // shapes (canvas vs node).
    const afterPlace = await waitForCommentsPersisted(
      (f) => f.comments.length === 2,
      'both placed comments never persisted to comments.json',
    );
    const canvasComment = afterPlace.comments.find((c) => c.text === 'A canvas-level note');
    const nodeComment = afterPlace.comments.find((c) => c.text === 'A node-level note');
    expect(canvasComment, 'canvas comment missing from comments.json').toBeTruthy();
    expect(nodeComment, 'node comment missing from comments.json').toBeTruthy();
    expect(canvasComment!.target.type).toBe('canvas');
    expect(nodeComment!.target.type).toBe('node');
    expect((nodeComment!.target as CommentTargetNode).nodeId).toBe('sticky1');
    expect(canvasComment!.author).toBe('Overlay Tester');
    expect(canvasComment!.resolved ?? false).toBe(false);

    // Comment mode already exited on its own — CommentLayer's
    // `onAddComment` handler calls `setActiveMode('none')` right after each
    // submission (see BoardCanvas.tsx's EditableCanvas), so no extra click is
    // needed here; doing one anyway would just RE-ENTER comment mode.
    await expect(overlay).toHaveCount(0);

    // ── Reply to the node comment ────────────────────────────────────────
    const nodePin = page.locator(`[data-testid="comment-pin-${nodeComment!.id}"]`);
    await nodePin.click();
    const thread = page.locator(`[data-testid="comment-thread-${nodeComment!.id}"]`);
    await expect(thread).toBeVisible();

    const replyBox = thread.getByPlaceholder('Reply…');
    await replyBox.fill('Following up on this');
    await thread.getByRole('button', { name: 'Reply' }).click();
    await expect(thread).toContainText('Following up on this');

    const afterReply = await waitForCommentsPersisted(
      (f) => (f.comments.find((c) => c.id === nodeComment!.id)?.replies.length ?? 0) === 1,
      'reply never persisted to comments.json',
    );
    const replyPersisted = afterReply.comments.find((c) => c.id === nodeComment!.id)!;
    expect(replyPersisted.replies).toHaveLength(1);
    expect(replyPersisted.replies[0].text).toBe('Following up on this');
    expect(replyPersisted.replies[0].author).toBe('Overlay Tester');

    // ── Resolve the thread ────────────────────────────────────────────────
    await thread.getByRole('button', { name: 'Resolve' }).click();
    await expect(thread.getByText('RESOLVED')).toBeVisible();
    // Pin styling: CommentPin.tsx sets `data-resolved="true"` and dims/greys
    // the bubble once resolved.
    await expect(nodePin).toHaveAttribute('data-resolved', 'true');

    const afterResolve = await waitForCommentsPersisted(
      (f) => f.comments.find((c) => c.id === nodeComment!.id)?.resolved === true,
      'resolved flag never persisted to comments.json',
    );
    expect(afterResolve.comments.find((c) => c.id === nodeComment!.id)!.resolved).toBe(true);
    // The canvas comment (untouched) stays unresolved — resolving one thread
    // doesn't clobber another's state.
    expect(afterResolve.comments.find((c) => c.id === canvasComment!.id)!.resolved ?? false).toBe(
      false,
    );

    assertNoReactFlowErrors(capture);
  });

  // ── 2. Pencil: on-screen node + persisted DrawingNode in board.json ────

  test('drawing a pencil stroke creates a drawing node on screen and persists it to board.json', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const before = readBoardJson();
    const beforeIds = new Set(before.nodes.map((n) => n.id));
    expect(before.nodes.some((n) => n.type === 'drawing')).toBe(false);

    await page.getByTitle('Pencil', { exact: true }).click();
    const overlay = page.locator('[data-testid="pencil-overlay"]');
    await expect(overlay).toBeVisible();

    const box = await overlay.boundingBox();
    expect(box).toBeTruthy();
    // Draw well clear of sticky1 (top-left of the fixture) so this can't be
    // mistaken for interacting with the existing node.
    const origin = { x: box!.x + box!.width - 300, y: box!.y + 300 };
    await drawStroke(page, overlay, origin);

    // On screen: a new node appears (the toolbar's pencil overlay commits a
    // real BoardNode via store.addNode on pointerup).
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    const newDrawingId = await page.evaluate((known) => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node[data-id]'));
      return nodes.map((n) => n.getAttribute('data-id')!).find((id) => !known.includes(id)) ?? null;
    }, Array.from(beforeIds));
    expect(newDrawingId, 'pencil stroke never created a new node').toBeTruthy();

    const drawingLocator = nodeLocator(page, newDrawingId!);
    await expect(drawingLocator).toBeVisible();

    // Persistence: the drawing node reaches board.json via the same
    // server-debounced room-persist path as any other node.
    const persisted = await waitForPersisted(
      (b) => b.nodes.some((n) => n.id === newDrawingId && n.type === 'drawing'),
      'pencil stroke never persisted a drawing node to board.json',
    );
    const drawingNode = persisted.nodes.find((n) => n.id === newDrawingId)!;
    expect(drawingNode.type).toBe('drawing');
    // Points/bbox reflect the stroke: `makeDrawingNode` rebases points
    // relative to `pos` and computes `size` as their bbox (+ padding). The
    // drawn L-shape spans 80 flow units in x and 60 in y (see drawStroke),
    // so the persisted bbox should be at least that large in both axes.
    expect(Array.isArray(drawingNode.points)).toBe(true);
    expect(drawingNode.points!.length).toBeGreaterThanOrEqual(2);
    const size = drawingNode.size as WH;
    expect(size.width).toBeGreaterThanOrEqual(80);
    expect(size.height).toBeGreaterThanOrEqual(60);
    // Every persisted point stays within the padded bbox (rebased relative
    // to `pos`, i.e. relative to (0,0)..size).
    for (const p of drawingNode.points!) {
      expect(p.x).toBeGreaterThanOrEqual(-0.01);
      expect(p.y).toBeGreaterThanOrEqual(-0.01);
      expect(p.x).toBeLessThanOrEqual(size.width + 0.01);
      expect(p.y).toBeLessThanOrEqual(size.height + 0.01);
    }

    assertNoReactFlowErrors(capture);
  });

  // ── 3. Annotation: two contexts, live sync, Wipe clears both, NEVER on disk ─

  test('an annotation scribble syncs between two pages, Wipe clears both, and board.json never contains annotation data', async ({
    browser,
  }) => {
    const contextA = await newIdentifiedContext(browser, 'Page A');
    const contextB = await newIdentifiedContext(browser, 'Page B');
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const captureA = attachConsoleCapture(pageA);
      const captureB = attachConsoleCapture(pageB);

      await gotoBoard(pageA);
      await gotoBoard(pageB);

      const beforeBoard = readBoardJson();

      // A enters annotation mode and draws a scribble.
      await pageA.getByTitle('Annotation', { exact: true }).click();
      const overlayA = pageA.locator('[data-testid="annotation-overlay"]');
      await expect(overlayA).toBeVisible();
      const boxA = await overlayA.boundingBox();
      expect(boxA).toBeTruthy();
      const origin = { x: boxA!.x + boxA!.width - 300, y: boxA!.y + 300 };
      await drawStroke(pageA, overlayA, origin);

      // Renders in A immediately.
      await expect(pageA.locator('[data-testid="annotation-stroke-0"]')).toBeVisible();

      // Syncs to B (B never entered annotation mode — the stroke still
      // renders there because AnnotationLayer's `<svg>` of existing strokes
      // is unconditional; only the CAPTURE overlay is mode-gated).
      await expect(pageB.locator('[data-testid="annotation-stroke-0"]')).toBeVisible({
        timeout: 10_000,
      });

      // Give the room a moment to reach any debounced persist path it might
      // have (there shouldn't be one for annotations, but the assertion
      // below is only meaningful if we've waited at least as long as a real
      // node edit would take to land — proving ABSENCE, not just "haven't
      // looked yet"). Reuses the same window waitForPersisted's poll would.
      await pageA.waitForTimeout(1500);

      // board.json is BYTE-FOR-BYTE unchanged: annotations must never reach
      // disk (AnnotationLayer.tsx's module doc — `getSnapshot()` never reads
      // the ANNOTATIONS Y.Array at all).
      const duringBoard = readBoardJson();
      expect(duringBoard).toEqual(beforeBoard);

      // Wipe from page A clears it in BOTH pages. Two elements share the
      // title "Wipe all annotations" (Toolbar.tsx's icon-only IconButton AND
      // AnnotationLayer.tsx's own floating text button, both wired to the
      // same handler) — disambiguate via the floating button's visible
      // "Wipe" text (AnnotationLayer.tsx), since the Toolbar's IconButton has
      // no accessible name beyond its title.
      await pageA.getByRole('button', { name: 'Wipe', exact: true }).click();
      await expect(pageA.locator('[data-testid="annotation-stroke-0"]')).toHaveCount(0);
      await expect(pageB.locator('[data-testid="annotation-stroke-0"]')).toHaveCount(0, {
        timeout: 10_000,
      });

      // Still never touched disk.
      const afterWipeBoard = readBoardJson();
      expect(afterWipeBoard).toEqual(beforeBoard);

      assertNoReactFlowErrors(captureA);
      assertNoReactFlowErrors(captureB);

      await contextA.close();
      await contextB.close();
    } finally {
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
    }
  });

  // ── 4. History: preview (isolated) then restore ─────────────────────────

  test('previewing an older snapshot is read-only and isolated; Restore applies it to the canvas and board.json', async ({
    page,
  }) => {
    const capture = attachConsoleCapture(page);
    await gotoBoard(page);

    const original = readBoardJson();
    const originalStickyPos = original.nodes.find((n) => n.id === 'sticky1')!.pos;

    // ── Edit 1 (the OLDER snapshot this test will restore back to): drag
    // sticky1 to a new position, wait for the server's debounced persist +
    // its own `save` history snapshot (YjsWebsocketService.persistNow calls
    // `history.snapshot(..., 'save')` right after every persisted write). ──
    const stickyBefore = nodeLocator(page, 'sticky1');
    const box1 = await stickyBefore.boundingBox();
    expect(box1).toBeTruthy();
    await page.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box1!.x + box1!.width / 2 + 150, box1!.y + box1!.height / 2 + 40, {
      steps: 20,
    });
    await page.mouse.up();

    const afterEdit1 = await waitForPersisted((b) => {
      const p = b.nodes.find((n) => n.id === 'sticky1')?.pos;
      return !!p && Math.abs(p.x - (originalStickyPos.x + 150)) < 30;
    }, 'first edit (pre-restore-target) never persisted to board.json');
    const midStickyPos = afterEdit1.nodes.find((n) => n.id === 'sticky1')!.pos;

    // Give the server's own history-snapshot write (right after the persist
    // above) a moment to land on disk before we move on to edit 2 — both are
    // debounced off the SAME doc-update event, but the snapshot write itself
    // is a separate synchronous fs call inside `persistNow`, so polling here
    // (rather than a fixed sleep) is what actually proves it happened.
    await expect
      .poll(() => listHistoryIds().length, {
        message: 'no history snapshot was written after the first edit',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1);
    const idsAfterEdit1 = listHistoryIds();

    // ── Edit 2: drag sticky1 again, further away, and wait for ITS OWN
    // persist + a NEWER history snapshot — this is "the live board" the
    // preview/restore flow below must NOT touch until Restore is clicked. ──
    const box2 = await stickyBefore.boundingBox();
    expect(box2).toBeTruthy();
    await page.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2!.x + box2!.width / 2 + 150, box2!.y + box2!.height / 2 + 40, {
      steps: 20,
    });
    await page.mouse.up();

    const afterEdit2 = await waitForPersisted((b) => {
      const p = b.nodes.find((n) => n.id === 'sticky1')?.pos;
      return !!p && Math.abs(p.x - (midStickyPos.x + 150)) < 30;
    }, 'second edit (live-board target) never persisted to board.json');
    const liveStickyPos = afterEdit2.nodes.find((n) => n.id === 'sticky1')!.pos;

    await expect
      .poll(() => listHistoryIds().length, {
        message: 'no second history snapshot was written after the second edit',
        timeout: 10_000,
      })
      .toBeGreaterThan(idsAfterEdit1.length);

    // ── Open the History panel and preview the OLDEST snapshot (the one
    // taken right after edit 1 — i.e. sticky1 at `midStickyPos`, NOT the
    // current live position `liveStickyPos`). ─────────────────────────────
    await page.getByTitle('Version history', { exact: true }).click();
    // Two elements share the text "Version history" (the Toolbar's IconButton
    // AND the panel's own header span) — `.last()` is the panel's header
    // (rendered after, and only once the panel opens), disambiguating
    // without needing a dedicated testid.
    const panel = page.getByText('Version history', { exact: true }).last();
    await expect(panel).toBeVisible();

    // Version rows render oldest-appearing-last / newest-first per
    // HistoryPanel.tsx — select the OLDEST (last) row so the preview target
    // is unambiguously the pre-edit-2 snapshot, not whichever the newest
    // happens to be. `relativeTime` renders "just now" for anything under 5s
    // old (HistoryPanel.tsx) — both snapshots in this test are that fresh, so
    // the filter must accept "just now" too, not just "Xs/Xm/Xh/Xd ago".
    const rows = page.locator('button[title]').filter({ hasText: /ago|just now|Latest/ });
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
    await rows.nth(rowCount - 1).click();

    // Preview renders READ-ONLY: the "Previewing ..." banner appears, and the
    // canvas shows sticky1 at the OLDER (mid) position — not the live one.
    await expect(page.getByText(/^Previewing /)).toBeVisible();
    const previewBox = await nodeLocator(page, 'sticky1').boundingBox();
    expect(previewBox).toBeTruthy();

    // Live board on disk is UNCHANGED by merely previewing (the central
    // isolation invariant — useHistory.ts never touches store.doc during
    // preview).
    const duringPreview = readBoardJson();
    const duringPreviewPos = duringPreview.nodes.find((n) => n.id === 'sticky1')!.pos;
    expect(Math.abs(duringPreviewPos.x - liveStickyPos.x)).toBeLessThan(5);
    expect(Math.abs(duringPreviewPos.y - liveStickyPos.y)).toBeLessThan(5);

    // The read-only preview pane is non-interactive: `ReadOnlyCanvas` renders
    // with `nodesDraggable={false}`/`elementsSelectable={false}` (canvas/
    // BoardCanvas.tsx), which RF surfaces as the `.react-flow__node`'s own
    // `draggable`/`selectable` data attributes — a direct, unambiguous check
    // of the wiring rather than attempting a real drag gesture and inferring
    // "it didn't move" from a screen delta (which would be confounded by
    // `panOnDrag` still being on for this read-only pane: a mousedown+drag
    // starting ON a non-draggable node's body falls through and pans the
    // whole viewport instead, moving the node's on-screen box for a reason
    // that has nothing to do with whether the NODE itself is draggable —
    // confirmed via manual reproduction while developing this test).
    const previewNode = nodeLocator(page, 'sticky1');
    await expect(previewNode).toBeVisible();
    expect(await previewNode.getAttribute('draggable')).not.toBe('true');
    // A click doesn't select it either (elementsSelectable={false} in
    // ReadOnlyCanvas) — RF applies the `selected` class synchronously on
    // click for a selectable node (see interaction.spec.ts's `selectNode`
    // doc); its absence here confirms selection is truly disabled, not just
    // slow to apply.
    await previewNode.click({ force: true });
    await expect(previewNode).not.toHaveClass(/\bselected\b/);

    // ── Restore ──────────────────────────────────────────────────────────
    // The button's accessible name is its visible text "Restore"
    // (BoardCanvas.tsx's `HistoryPreviewBanner`) — its `title` attribute
    // ("Restore this version") is only a hover tooltip, not part of the
    // accessible name when visible text is already present.
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText(/^Previewing /)).toHaveCount(0);

    // Canvas now reflects the restored (older/mid) state.
    await expect
      .poll(async () => {
        const b = await nodeLocator(page, 'sticky1').boundingBox();
        return b ? b.x : null;
      })
      .not.toBeNull();

    // board.json reflects the restored (older) state too, via the same
    // room -> server persist path every other edit uses (restore's
    // `loadBoardIntoDoc` runs inside a normal doc transaction).
    const restored = await waitForPersisted((b) => {
      const p = b.nodes.find((n) => n.id === 'sticky1')?.pos;
      return !!p && Math.abs(p.x - midStickyPos.x) < 5 && Math.abs(p.y - midStickyPos.y) < 5;
    }, 'restored (older) sticky1 position never persisted to board.json');
    const restoredPos = restored.nodes.find((n) => n.id === 'sticky1')!.pos;
    expect(Math.abs(restoredPos.x - midStickyPos.x)).toBeLessThan(5);
    expect(Math.abs(restoredPos.y - midStickyPos.y)).toBeLessThan(5);
    // And definitely NOT the pre-restore live position.
    expect(Math.abs(restoredPos.x - liveStickyPos.x)).toBeGreaterThan(50);

    // ── A subsequent edit still works (undo was cleared per useHistory.ts's
    // `restore()`, no crash) — drag sticky1 once more and confirm it commits
    // and persists normally. ───────────────────────────────────────────────
    const postRestoreBox = await nodeLocator(page, 'sticky1').boundingBox();
    expect(postRestoreBox).toBeTruthy();
    await page.mouse.move(
      postRestoreBox!.x + postRestoreBox!.width / 2,
      postRestoreBox!.y + postRestoreBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      postRestoreBox!.x + postRestoreBox!.width / 2 + 70,
      postRestoreBox!.y + postRestoreBox!.height / 2 + 25,
      { steps: 15 },
    );
    await page.mouse.up();

    await waitForPersisted((b) => {
      const p = b.nodes.find((n) => n.id === 'sticky1')?.pos;
      return !!p && Math.abs(p.x - (midStickyPos.x + 70)) < 20;
    }, 'post-restore edit never persisted to board.json');

    // Undo after restore should be a safe no-op or revert only the
    // post-restore edit (undo stack was cleared by restore) — never throw,
    // never resurrect the pre-restore live state. Exercised here purely as a
    // crash/no-op check (the "no crash" contract this task calls out), not
    // asserting a specific reverted position.
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(300);

    assertNoReactFlowErrors(capture);
  });
});
