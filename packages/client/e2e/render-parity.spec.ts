// ── Structural-parity gate: BoardCanvas renders every board element ─────────
//
// The deterministic Phase-3 gate (P3-T21). Loads the `kitchen-sink` and
// `minimal` synthetic fixtures (fixtures/kitchen-sink, fixtures/minimal —
// seeded into the dev server's `boards/` dir by
// `e2e/support/seed-boards.mjs`, see playwright.config.ts's `webServer`)
// into the REAL read-only `BoardCanvas` in a real Chromium tab, and asserts
// DOM structure derived from the fixture JSON itself (read directly here, not
// hardcoded twice) — so this test breaks the moment the canvas stops
// rendering a fixture element correctly, rather than drifting out of sync
// with the fixtures.
//
// Console-error gate: every test captures the browser console and fails on
// any ReactFlow error-code message (`#008` "couldn't create edge for
// source/target handle", `#013` "styles not loaded", or any other `[React
// Flow]` error-level line) — these are exactly the two warning classes
// P3-T20/T21 flagged as structural correctness signals, not just noise.
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../../fixtures');

// ── Fixture JSON types (minimal local shape — just what this spec reads) ────

interface XY {
  x: number;
  y: number;
}
interface WH {
  width: number;
  height: number;
}
interface FixtureNode {
  id: string;
  type: string;
  pos: XY;
  order: number;
  size?: WH | number;
  text?: string;
  color?: string;
  title?: string;
  shape?: string;
  name?: string;
  rotation?: number;
  description?: string;
  points?: XY[];
  strokeWidth?: number;
}
interface FixtureEdge {
  id: string;
  source: string;
  target: string;
  kind?: 'arrow' | 'cardinality';
  arrow?: 'none' | 'end' | 'both';
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N';
  style: 'solid' | 'dashed';
  label?: string;
}
interface FixtureBoard {
  formatVersion: number;
  boardLabel: string;
  nodes: FixtureNode[];
  edges: FixtureEdge[];
  viewport: { x: number; y: number; zoom: number };
}

function loadFixture(slug: string): FixtureBoard {
  const raw = readFileSync(path.join(FIXTURES_ROOT, slug, 'board.json'), 'utf-8');
  return JSON.parse(raw) as FixtureBoard;
}

// ── Console-error capture ────────────────────────────────────────────────────
//
// ReactFlow logs its numbered error codes (`[React Flow]: Couldn't create
// edge for source handle id: "...", #008`, `...#013`, etc.) via
// `console.warn`/`console.error`. Capture every console message from page
// load and assert none contain a `#0xx`-style RF error code, in addition to
// each test's own structural assertions.
function attachConsoleCapture(page: Page): ConsoleMessage[] {
  const messages: ConsoleMessage[] = [];
  page.on('console', (msg) => messages.push(msg));
  return messages;
}

function assertNoReactFlowErrors(messages: ConsoleMessage[]) {
  const offenders = messages
    .map((m) => m.text())
    .filter((text) => /#0\d\d/.test(text) || /\[React Flow\]/i.test(text));
  expect(
    offenders,
    `ReactFlow error/warning codes found in console:\n${offenders.join('\n')}`,
  ).toEqual([]);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function gotoBoard(page: Page, slug: string) {
  await page.goto(`/#/${slug}`);
  // Wait for the canvas pane to mount before nodes are queried.
  await page.locator('.react-flow').waitFor({ state: 'visible' });
}

test.describe('kitchen-sink structural parity', () => {
  const board = loadFixture('kitchen-sink');

  test('every node id is present in the DOM with correct node count', async ({ page }) => {
    const messages = attachConsoleCapture(page);
    await gotoBoard(page, 'kitchen-sink');

    const rfNodes = page.locator('.react-flow__node');
    await expect(rfNodes).toHaveCount(board.nodes.length);

    for (const node of board.nodes) {
      await expect(page.locator(`[data-id="${node.id}"]`)).toHaveCount(1);
    }

    assertNoReactFlowErrors(messages);
  });

  test('sticky nodes render their text', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const stickies = board.nodes.filter((n) => n.type === 'sticky');
    expect(stickies.length).toBeGreaterThan(0);
    for (const sticky of stickies) {
      const el = page.locator(`[data-id="${sticky.id}"]`);
      await expect(el).toContainText(sticky.text ?? '');
    }
  });

  test('text node renders its text', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const textNodes = board.nodes.filter((n) => n.type === 'text');
    for (const n of textNodes) {
      await expect(page.locator(`[data-id="${n.id}"]`)).toContainText(n.text ?? '');
    }
  });

  test('frame node shows its title and renders behind non-frames (z-order)', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const frames = board.nodes.filter((n) => n.type === 'frame');
    expect(frames.length).toBeGreaterThan(0);

    for (const frame of frames) {
      const el = page.locator(`[data-id="${frame.id}"]`);
      await expect(el).toContainText(frame.title ?? '');
    }

    // z-order: every frame's zIndex must be lower (behind) every non-frame's.
    const zIndices = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'));
      return nodes.map((n) => ({
        id: n.getAttribute('data-id'),
        z: Number(getComputedStyle(n).zIndex) || 0,
      }));
    });
    const frameIds = new Set(frames.map((f) => f.id));
    const frameZs = zIndices.filter((n) => n.id && frameIds.has(n.id)).map((n) => n.z);
    const nonFrameZs = zIndices.filter((n) => n.id && !frameIds.has(n.id)).map((n) => n.z);
    expect(frameZs.length).toBeGreaterThan(0);
    expect(nonFrameZs.length).toBeGreaterThan(0);
    expect(Math.max(...frameZs)).toBeLessThan(Math.min(...nonFrameZs));
  });

  test('emoji node renders the glyph', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const emojiNodes = board.nodes.filter((n) => n.type === 'emoji');
    for (const n of emojiNodes) {
      await expect(page.locator(`[data-id="${n.id}"]`)).toContainText(n.text ?? '');
    }
  });

  test('icon node renders an SVG glyph', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const iconNodes = board.nodes.filter((n) => n.type === 'icon');
    expect(iconNodes.length).toBeGreaterThan(0);
    for (const n of iconNodes) {
      const svg = page.locator(`[data-id="${n.id}"] svg[aria-label="${n.name}"]`);
      await expect(svg).toHaveCount(1);
    }
  });

  test('drawing node renders an SVG path', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const drawingNodes = board.nodes.filter((n) => n.type === 'drawing');
    expect(drawingNodes.length).toBeGreaterThan(0);
    for (const n of drawingNodes) {
      const path = page.locator(`[data-id="${n.id}"] svg path`);
      expect(await path.count()).toBeGreaterThan(0);
    }
  });

  test('all 12 shape kinds render their distinguishing SVG element', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const shapeNodes = board.nodes.filter((n) => n.type === 'shape');
    // The fixture is documented to cover all 12 ShapeKinds — assert that
    // invariant explicitly so a shrinking fixture fails loudly here, not
    // silently under-testing.
    const ALL_SHAPE_KINDS = [
      'rect',
      'roundRect',
      'ellipse',
      'diamond',
      'triangle',
      'parallelogram',
      'hexagon',
      'pentagon',
      'star',
      'cylinder',
      'cloud',
      'arrow',
    ];
    const kindsInFixture = new Set(shapeNodes.map((n) => n.shape));
    for (const kind of ALL_SHAPE_KINDS) {
      expect(kindsInFixture.has(kind), `fixture missing shape kind "${kind}"`).toBe(true);
    }

    // Each shape kind's distinguishing SVG primitive, per ShapeNode's `renderShape`.
    const EXPECTED_SVG_TAG: Record<string, string> = {
      rect: 'rect',
      roundRect: 'rect',
      ellipse: 'ellipse',
      diamond: 'polygon',
      triangle: 'polygon',
      parallelogram: 'polygon',
      hexagon: 'polygon',
      pentagon: 'polygon',
      star: 'polygon',
      cylinder: 'path',
      cloud: 'path',
      arrow: 'polygon',
    };

    for (const node of shapeNodes) {
      const shape = node.shape!;
      const tag = EXPECTED_SVG_TAG[shape];
      const el = page.locator(`[data-id="${node.id}"] svg > ${tag}`);
      expect(await el.count(), `shape "${shape}" (${node.id}) missing <${tag}>`).toBeGreaterThan(0);
    }
  });

  test('rotation is applied as a transform on rotated nodes', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    const rotated = board.nodes.filter((n) => typeof n.rotation === 'number' && n.rotation !== 0);
    expect(rotated.length).toBeGreaterThan(0);

    for (const node of rotated) {
      const rotationWrapper = page.locator(
        `[data-id="${node.id}"] [data-testid="base-node-rotation"]`,
      );
      const transform = await rotationWrapper.evaluate((el) => getComputedStyle(el).transform);
      // A rotate() transform resolves to a non-identity matrix in computed
      // style (jsdom can't compute this — this is exactly what the browser
      // gate proves that the vitest/jsdom suite cannot).
      expect(transform, `node ${node.id} (rotation=${node.rotation}) has no transform`).not.toBe(
        'none',
      );
      expect(transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
    }
  });

  test('description badge present only on nodes with a description', async ({ page }) => {
    await gotoBoard(page, 'kitchen-sink');
    // `frame` and `drawing` are deliberately excluded here: neither node
    // component has ever rendered a description badge, in either the legacy
    // prototype or this port. FrameNode.tsx's module doc is explicit: "Legacy
    // FrameNode has no description badge... none of those are added here
    // either." DrawingNode.tsx doesn't compose BaseNode/DescriptionBadge at
    // all (it's a bare SVG stroke, no chrome) — matching the legacy
    // DrawingNode, which never had one either. `frame1`/`drawing1` in this
    // fixture DO carry a `description` field (NodeBase allows it on every
    // node type), but that's exercising a real, longstanding product gap —
    // neither node type has a UI surface for it — not a canvas rendering
    // defect introduced by this port, so asserting a badge here would assert
    // behavior that has never existed. Every OTHER node type that carries a
    // description (sticky, shape, emoji) DOES support the badge and is
    // asserted below.
    const NO_DESCRIPTION_BADGE_SUPPORT = new Set(['frame', 'drawing']);
    const withDescription = board.nodes.filter(
      (n) => !!n.description && !NO_DESCRIPTION_BADGE_SUPPORT.has(n.type),
    );
    const withoutDescription = board.nodes.filter(
      (n) => !n.description && !NO_DESCRIPTION_BADGE_SUPPORT.has(n.type),
    );
    expect(withDescription.length).toBeGreaterThan(0);
    expect(withoutDescription.length).toBeGreaterThan(0);

    for (const node of withDescription) {
      const badge = page.locator(
        `[data-id="${node.id}"] [data-testid="description-badge-hover-zone"] button`,
      );
      await expect(badge, `node ${node.id} expected a description badge`).toHaveCount(1);
    }
    for (const node of withoutDescription) {
      const badge = page.locator(
        `[data-id="${node.id}"] [data-testid="description-badge-hover-zone"] button`,
      );
      await expect(badge, `node ${node.id} unexpectedly has a description badge`).toHaveCount(0);
    }
  });

  test('both edge kinds render with correct edge count and no console errors', async ({ page }) => {
    const messages = attachConsoleCapture(page);
    await gotoBoard(page, 'kitchen-sink');

    // Edges are measurement-gated in RF (they only paint once both endpoint
    // nodes have measured dimensions) — wait for the expected count rather
    // than asserting immediately after navigation.
    const rfEdges = page.locator('.react-flow__edge');
    await expect(rfEdges).toHaveCount(board.edges.length);

    const arrowEdges = board.edges.filter((e) => (e.kind ?? 'arrow') === 'arrow');
    const cardinalityEdges = board.edges.filter((e) => e.kind === 'cardinality');
    expect(arrowEdges.length).toBeGreaterThan(0);
    expect(cardinalityEdges.length).toBeGreaterThan(0);

    for (const edge of arrowEdges) {
      const edgeEl = page.locator(`.react-flow__edge[data-id="${edge.id}"]`);
      await expect(edgeEl).toHaveCount(1);
      // Bezier path painted.
      const bezier = edgeEl.locator('path.react-flow__edge-path');
      await expect(bezier).toHaveCount(1);
      const d = await bezier.getAttribute('d');
      expect(d, `edge ${edge.id} has no path data`).toBeTruthy();
      expect(d).toMatch(/^M/); // bezier path data always starts with a moveto

      // Arrowhead marker per its `arrow` value.
      const arrow = edge.arrow ?? 'end';
      const showEnd = arrow === 'end' || arrow === 'both';
      const showStart = arrow === 'both';
      const endMarker = edgeEl.locator(`marker[id="arrow-end-${edge.id}"]`);
      const startMarker = edgeEl.locator(`marker[id="arrow-start-${edge.id}"]`);
      expect(await endMarker.count()).toBe(showEnd ? 1 : 0);
      expect(await startMarker.count()).toBe(showStart ? 1 : 0);

      if (edge.label) {
        await expect(page.getByText(edge.label, { exact: true })).toBeVisible();
      }
    }

    for (const edge of cardinalityEdges) {
      const edgeEl = page.locator(`.react-flow__edge[data-id="${edge.id}"]`);
      await expect(edgeEl).toHaveCount(1);

      // Path painted, no arrowhead marker at all (cardinality communicates
      // direction/multiplicity via pills, never an arrowhead — see
      // CardinalityEdge's module doc).
      const cardPath = edgeEl.locator('path.react-flow__edge-path');
      await expect(cardPath).toHaveCount(1);
      const d = await cardPath.getAttribute('d');
      expect(d).toBeTruthy();
      const markers = edgeEl.locator('marker');
      expect(await markers.count()).toBe(0);

      if (edge.label) {
        await expect(page.getByText(edge.label, { exact: true })).toBeVisible();
      }
    }

    // Cardinality pills render via RF's shared `EdgeLabelRenderer` portal (one
    // container for every edge's overlay, not one per edge — see
    // CardinalityEdge.tsx), so pills can't be scoped back to a specific edge
    // element by DOM ancestry. Instead assert the aggregate pill count: for
    // every "X:Y" cardinality across all cardinality edges, the number of
    // "Source: X" pills in the whole document equals the number of edges
    // with source symbol X (same for "Target: Y"), which is exactly as
    // precise an assertion as DOM scoping would give since `title` is the
    // only per-pill identifier CardinalityEdge renders.
    const expectedSourceTitleCounts = new Map<string, number>();
    const expectedTargetTitleCounts = new Map<string, number>();
    for (const edge of cardinalityEdges) {
      const [srcSymbol, tgtSymbol] = (edge.cardinality ?? '1:N').split(':');
      expectedSourceTitleCounts.set(srcSymbol, (expectedSourceTitleCounts.get(srcSymbol) ?? 0) + 1);
      expectedTargetTitleCounts.set(tgtSymbol, (expectedTargetTitleCounts.get(tgtSymbol) ?? 0) + 1);
    }
    for (const [symbol, count] of expectedSourceTitleCounts) {
      await expect(page.getByTitle(`Source: ${symbol}`)).toHaveCount(count);
    }
    for (const [symbol, count] of expectedTargetTitleCounts) {
      await expect(page.getByTitle(`Target: ${symbol}`)).toHaveCount(count);
    }

    assertNoReactFlowErrors(messages);
  });

  test('node positions are approximately correct (tolerant, not pixel-brittle)', async ({
    page,
  }) => {
    await gotoBoard(page, 'kitchen-sink');
    // Sample a couple of nodes rather than every one — this asserts the
    // pos->layout wiring works at all, not exact pixel placement (viewport
    // pan/zoom + fitView mean absolute screen coords aren't meaningful here;
    // instead assert relative ordering, which IS meaningful regardless of
    // camera transform).
    const sticky1Box = await page.locator('[data-id="sticky1"]').boundingBox();
    const sticky2Box = await page.locator('[data-id="sticky2"]').boundingBox();
    expect(sticky1Box).toBeTruthy();
    expect(sticky2Box).toBeTruthy();
    // sticky2.pos.x (280) > sticky1.pos.x (40) in board space, so sticky2
    // must render to the right of sticky1 on screen regardless of camera.
    expect(sticky2Box!.x).toBeGreaterThan(sticky1Box!.x);
  });
});

test.describe('minimal structural parity', () => {
  test('single empty-text sticky renders without error', async ({ page }) => {
    const messages = attachConsoleCapture(page);
    await gotoBoard(page, 'minimal');

    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    const sticky = page.locator('[data-id="sticky1"]');
    await expect(sticky).toHaveCount(1);
    await expect(sticky.locator('[data-testid="sticky-body"]')).toBeVisible();

    assertNoReactFlowErrors(messages);
  });
});
