# Better arrow handling: floating edges + routing styles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make connectors look deliberate instead of arbitrary. Two changes, borrowed from tldraw's arrow model but implemented natively on ReactFlow:

1. **Floating edges** — an edge's endpoints attach to the point on each node's **boundary facing the other node** (and are trimmed to that boundary), instead of snapping to one of four fixed `t/r/b/l` handles. A connector between two nodes then leaves and arrives at sensible points no matter where the nodes are, and never cuts across the node body.
2. **Routing styles** — a per-edge `routing` of `bezier` (current look, default), `straight`, or `elbow` (orthogonal / right-angle), because right-angle routing reads better for the structured ER-style diagrams figemite is built for.

**Current state (what already exists):**

- Edges anchor to 4 fixed handles per node (`t/r/b/l`, defined in `nodes/ConnectionHandles.tsx`). `BoardEdge.sourceHandle`/`targetHandle` (`packages/shared/src/model/board.ts:133`) persist those handle ids into `board.json`.
- `edges/ArrowEdge.tsx` and `edges/CardinalityEdge.tsx` render with `getBezierPath()` fed by ReactFlow's handle-derived `sourceX/Y`, `targetX/Y`, `sourcePosition`, `targetPosition`.
- `canvas/BoardCanvas.tsx` sets `ConnectionMode.Loose`; handles always render (even read-only) because RF measures them to route edges (see `ConnectionHandles.tsx`'s module doc — removing them throws RF error #008).
- `canvas/rf-adapters.ts::boardEdgeToRf` maps a `BoardEdge` → RF edge, sets `type` to `'cardinality'` or `'arrow'`, passes `sourceHandle`/`targetHandle`, and injects editing callbacks via the `EdgeCallbacks` bag (`onLabelChange`/`onArrowChange`/`onStyleChange`/`onCardinalityChange`).
- `ShapeNode` diamonds already carry explicit vertex anchors (`getDiamondAnchors`) so handles sit on the visual vertices, not the bbox corners.

**Architecture:** A new pure module `edges/floating.ts` computes, from two nodes' measured rects, the boundary-intersection endpoints of the line joining their centers (the standard ReactFlow "floating edge" `getEdgeParams` recipe), plus an `getElbowPath()` orthogonal path generator. `ArrowEdge`/`CardinalityEdge` read live node geometry via `useInternalNode(id)` and feed the computed endpoints into `getBezierPath` / `getStraightPath` / `getElbowPath` selected by `data.routing`. The fixed handles **stay** — they remain the drag targets for *creating/reconnecting* edges and RF still measures them — but they no longer dictate where a rendered edge attaches. `routing` is added to the model as an optional field defaulting to `bezier`, so **every existing `board.json` loads unchanged and immediately renders with floating endpoints** (no migration; `sourceHandle`/`targetHandle` become ignored-on-render hints we keep writing for compatibility).

**Tech Stack:** TypeScript, React 19, `@xyflow/react` (`useInternalNode`, `getBezierPath`, `getStraightPath`, `Position`), Zod (shared schema), Vitest + @testing-library/react, `@modelcontextprotocol/sdk` (MCP), `fast-check` (optional geometry fuzz).

---

## File Structure

**Shared (`packages/shared/src`)**
- Modify: `model/board.ts` — add `EdgeRouting = 'bezier' | 'straight' | 'elbow'` and optional `routing?: EdgeRouting` on `BoardEdge`.
- Modify: `model/schema.ts` — `EdgeRoutingSchema` + optional field on the edge schema.
- Modify: `board-io.ts` — `makeEdge` gains a `routing` param (default `'bezier'`); serializer includes `routing` when set (mirror the existing `sourceHandle`/`cardinality` conditional-spread at `board-io.ts:385`).
- Tests: `model/schema.test.ts`, `board-io.test.ts` — round-trip + reject bad enum.

**Client (`packages/client/src`)**
- Create: `edges/floating.ts` — `getFloatingEdgeParams(source, target)` + `getRectIntersection` + `getElbowPath`. Pure (takes plain rect data, not RF hooks).
- Create: `edges/floating.test.ts`.
- Modify: `edges/ArrowEdge.tsx` — resolve endpoints via `useInternalNode` + `floating.ts`; pick path fn by `data.routing`; keep the label/`useEditableText` logic verbatim.
- Modify: `edges/CardinalityEdge.tsx` — same endpoint/routing switch; cardinality glyphs placed relative to the computed endpoints.
- Modify: `edges/ArrowEdge.test.tsx`, `edges/CardinalityEdge.test.tsx`.
- Modify: `canvas/rf-adapters.ts` — pass `data.routing` through `boardEdgeToRf`; add `onRoutingChange` to `EdgeCallbacks`.
- Modify: `store/board-store.ts` — `setEdgeRouting(id, routing)` op (mirror `setEdgeArrow`/`setEdgeLineStyle`).
- Modify: `hooks/useEditableCanvas.ts` — expose `onRoutingChange` in the callbacks bag.
- Modify: `components/Toolbar.tsx` (or the edge context toolbar) — a routing picker (bezier/straight/elbow) for the selected edge.

**MCP (`packages/mcp/src`)**
- Modify: `tools.ts` / `server.ts` — accept optional `routing` on `add_edge` and `update_edge` (mirror the existing `arrow`/`style` params).
- Modify: `AGENTS.md` (repo root) — document `routing` in the edge-ops section (the file's header requires it stay in sync with real tool registrations).

---

## Task 1: Model — add `routing` to `BoardEdge` (shared)

**Files:** `model/board.ts`, `model/schema.ts`, `board-io.ts` (+ tests).

- [ ] **Step 1: Failing tests** — `schema.test.ts`: a valid edge with `routing: 'elbow'` parses; `routing: 'zig'` is rejected; an edge with **no** `routing` still parses (optional). `board-io.test.ts`: `makeEdge(..., { routing: 'straight' })` round-trips through serialize→parse; an edge built without routing serializes without the key (no `routing: undefined` noise).
- [ ] **Step 2: Implement**

```ts
// model/board.ts
export type EdgeRouting = 'bezier' | 'straight' | 'elbow';
// on BoardEdge:
routing?: EdgeRouting;
```

```ts
// model/schema.ts
export const EdgeRoutingSchema = z.enum(['bezier', 'straight', 'elbow']);
// on the edge object schema:
routing: EdgeRoutingSchema.optional(),
```

Extend `makeEdge` with `routing` and add the conditional spread in the serializer next to `sourceHandle`/`targetHandle`.

- [ ] **Step 3:** `npm test -w @figemite/shared` green. **Back-compat check:** load a fixture board that predates `routing` (any in `fixtures/`) and confirm it parses.

## Task 2: `edges/floating.ts` — boundary intersection + elbow path (pure)

**Files:** Create `edges/floating.ts` + `edges/floating.test.ts`.

- [ ] **Step 1: Failing tests** (pure, no RF/DOM) using plain rects `{x, y, width, height}`:
  - Two horizontally-separated 100×60 rects → source endpoint on the **right** edge of the left rect, target on the **left** edge of the right rect; `sourcePos = Position.Right`, `targetPos = Position.Left`.
  - Vertically-stacked rects → top/bottom edges.
  - Diagonal offset → intersection on the correct side, `sy`/`ty` between each rect's top and bottom.
  - `getElbowPath` between two boundary points returns an SVG path containing only horizontal/vertical segments (assert the path string has an `L` and no `C`/`Q`), and its mid-vertex sits at the expected corner for the dominant axis.
- [ ] **Step 2: Implement** the standard recipe:

```ts
export interface RectGeom { x: number; y: number; width: number; height: number }

// Intersection of the segment (rect-center → other-center) with `rect`'s border.
export function getRectIntersection(rect: RectGeom, other: RectGeom): { x: number; y: number } { /* ... */ }

// Which side of the rect the intersection landed on → a ReactFlow Position.
export function getEdgePosition(rect: RectGeom, point: { x: number; y: number }): Position { /* ... */ }

export function getFloatingEdgeParams(source: RectGeom, target: RectGeom): {
  sx: number; sy: number; tx: number; ty: number; sourcePos: Position; targetPos: Position;
} { /* getRectIntersection both ways + getEdgePosition */ }

// Orthogonal L/Z path between two already-on-boundary points.
export function getElbowPath(sx: number, sy: number, tx: number, ty: number): [path: string, labelX: number, labelY: number] { /* ... */ }
```

Keep it dependency-light (only `Position` from `@xyflow/react`, which is a plain enum). Handle the degenerate overlapping-rects case (centers coincide) by falling back to a straight center-to-center segment so it never divides by zero.

- [ ] **Step 3:** consider a `fast-check` property: the returned endpoint always lies on the rect's border (within epsilon). tests green.

## Task 3: `ArrowEdge` — floating endpoints + routing switch

**Files:** `edges/ArrowEdge.tsx` (+ test).

- [ ] **Step 1:** Replace the handle-derived coordinates with live geometry:

```tsx
const sourceNode = useInternalNode(source);
const targetNode = useInternalNode(target);
if (!sourceNode || !targetNode) return null; // not yet measured — paint next frame
const s = rectOf(sourceNode), t = rectOf(targetNode); // from measured width/height + positionAbsolute
const { sx, sy, tx, ty, sourcePos, targetPos } = getFloatingEdgeParams(s, t);
const [edgePath, labelX, labelY] =
  data?.routing === 'straight' ? getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })
  : data?.routing === 'elbow'  ? getElbowPath(sx, sy, tx, ty)
  : getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sourcePos, targetX: tx, targetY: ty, targetPosition: targetPos });
```

`ArrowEdgeData` gains `routing?: EdgeRouting`. `source`/`target` node ids are already available on `EdgeProps`. Keep everything below the path (markers, `BaseEdge`, `EdgeLabelRenderer`, `useEditableText`) unchanged — only the *endpoint/path computation* changes.

- [ ] **Step 2:** The graceful `return null` before measurement matters — the codebase previously hit RF error #008 / empty edges when geometry wasn't ready (see `ConnectionHandles.tsx` doc). Because handles still render, RF still measures nodes; `useInternalNode` returns the measured node once ready. Add a fallback to the model rect if `measured` is absent so first paint isn't blank.
- [ ] **Step 3: Test** — render an ArrowEdge between two positioned nodes in the `RfTestHarness`; assert a `path` with a non-empty `d` renders, that `routing: 'straight'` yields a path with no cubic segment, and that the existing label-editing tests still pass unchanged.

## Task 4: `CardinalityEdge` — same floating/routing switch

**Files:** `edges/CardinalityEdge.tsx` (+ test).

- [ ] Apply the identical endpoint/routing computation. Re-derive the cardinality glyph/crow's-foot placement from the computed `sx,sy / tx,ty` and `sourcePos/targetPos` (they currently hang off the RF handle coords). Keep label editing intact. Update its test to the floating geometry.

## Task 5: Adapter, store op, and callbacks wiring

**Files:** `canvas/rf-adapters.ts`, `store/board-store.ts`, `hooks/useEditableCanvas.ts`.

- [ ] **Step 1:** `boardEdgeToRf` adds `routing: edge.routing` to the RF edge `data` (mirror how `style`/`arrow`/`cardinality` are copied). Add `onRoutingChange: (id, routing) => void` to `EdgeCallbacks` and include it in `data` for both edge kinds (routing is meaningful for both, like `onStyleChange`).
- [ ] **Step 2:** `board-store.ts` — `setEdgeRouting(id, routing)` CRDT op mirroring `setEdgeArrow`/`setEdgeLineStyle`. Unit-test it in `board-store.test.ts` (set → snapshot reflects it → persists).
- [ ] **Step 3:** `useEditableCanvas.ts` — expose `onRoutingChange` in the one stable callbacks bag it builds per store.

## Task 6: Toolbar routing picker

**Files:** `components/Toolbar.tsx` (+ the edge-selection toolbar it drives) + test.

- [ ] Add a 3-way routing control (bezier/straight/elbow — small icons) shown when an edge is selected, calling `onRoutingChange`. Mirror the existing arrow-style / line-style pickers' placement and styling. Test: selecting an option invokes the callback with the right value.

## Task 7: MCP — `routing` on `add_edge` / `update_edge`

**Files:** `packages/mcp/src/tools.ts`, `packages/mcp/src/server.ts`, `AGENTS.md`.

- [ ] **Step 1:** Add an optional `routing` enum to the `add_edge` and `update_edge` input schemas (next to `arrow`/`style`). `add_edge` forwards it to `makeEdge`; `update_edge` merges it via the existing edge-patch path.
- [ ] **Step 2:** Update `server.test.ts` / `tools.test.ts` — creating an edge with `routing: 'elbow'` round-trips into the board.
- [ ] **Step 3:** Document `routing` in `AGENTS.md`'s Edge-ops section (the header mandates the file mirror real tool registrations — don't let it drift).

## Task 8: Full verification

- [ ] `npm run typecheck` — 0 errors.
- [ ] `npm test` — all green (shared + client + server + mcp).
- [ ] `npm run lint` — clean.
- [ ] `npm run build:static` — succeeds.
- [ ] Existing e2e (`npm run test:e2e`) — edges still create/reconnect/label/delete. Regenerate any edge-related visual snapshots deliberately (the new routing changes their appearance) and eyeball the diff before committing baselines.
- [ ] Manual: connect two nodes → the arrow leaves/arrives on the facing edges; drag a node around → endpoints track the boundary smoothly without crossing the body; switch a selected edge to `elbow` → right-angle route; load a pre-existing board → edges immediately render floating with no errors.

---

## Self-Review

- **Zero-migration back-compat.** `routing` is optional and defaults to `bezier`; `sourceHandle`/`targetHandle` stay in the schema and keep being written, so old `board.json` files load byte-compatibly and simply *render better* (floating) on load. No fixture needs rewriting.
- **Handles deliberately retained.** They remain the authoring affordance (drag-to-connect / reconnect) and RF's measurement anchors — this sidesteps the error-#008 empty-edge trap the codebase already documented. We change *rendering*, not the connection model.
- **Pure geometry is isolated + fuzzable.** All the tricky math lives in `edges/floating.ts` with no React/DOM deps, so it's unit- and property-testable in isolation; the edge components stay thin.
- **Diamonds:** `getFloatingEdgeParams` treats nodes as rects; `ShapeNode` diamonds will attach to the bounding rect, slightly outside the visual vertex. Acceptable for v1; a follow-up can special-case diamond geometry using the same `getDiamondAnchors` data. Flag it, don't silently ship it as "perfect."
- **Scope honesty:** this delivers floating anchoring + straight/elbow routing. It does *not* add obstacle-avoiding auto-routing (edges routing *around* intervening nodes) — that is a much larger pathfinding problem and is explicitly out of scope here.
