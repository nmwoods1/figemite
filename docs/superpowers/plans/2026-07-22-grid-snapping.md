# Basic grid snapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make nodes snap to the existing 20px grid while being **dragged and resized** (today snapping only happens at toolbar-creation time and for Shift-held pencil strokes), show a canvas background grid whose spacing matches the snap grid, and add a user toggle to turn snapping on/off. This is a view/interaction feature only — nothing about the board *data model* or `board.json` changes.

**Current state (what already exists):**

- `packages/client/src/canvas/coords.ts` already defines `GRID_SIZE = 20` and a pure `snapToGrid(p)` that rounds a flow-space point to that grid. It is used by `viewCenter()` (new-node placement) and by `PencilLayer`'s Shift-to-snap.
- The editable `<ReactFlow>` (`canvas/BoardCanvas.tsx`, ~L696) passes **no** `snapToGrid`/`snapGrid` props, so **dragging a node does not snap** and neither does `NodeResizer`.
- `<Background />` is rendered on both the read-only (~L188) and editable (~L719) panes with all-default props (dots, default gap), so the visible grid does not necessarily line up with `GRID_SIZE`.
- Snapping is not currently user-toggleable.

**Architecture:** Node **drag** snapping is native to ReactFlow — set `snapToGrid` + `snapGrid={[GRID_SIZE, GRID_SIZE]}` on the editable `<ReactFlow>`. Node **resize** snapping is not native to `NodeResizer`, so we round the committed size to `GRID_SIZE` inside the existing `onResizeEnd` handlers (the single seam every resizable node already funnels through). A client-only `snapEnabled` preference (default on, persisted to `localStorage` — it is a view preference, not board content, so it must NOT go in `board.json`, consistent with how the project keeps view state out of the board model) gates the `snapToGrid` prop and the visible grid. The `<Background>` gets `gap={GRID_SIZE}` so the dots line up with where nodes actually land.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` (ReactFlow) `Background`/`BackgroundVariant`/`snapGrid`, Vitest + @testing-library/react.

---

## File Structure

**Client (`packages/client/src`)**
- Modify: `canvas/coords.ts` — export a `SNAP_GRID: [number, number]` tuple (`[GRID_SIZE, GRID_SIZE]`) and a `snapSize(wh)` helper (round a `{width,height}` up to the grid, respecting a minimum). Pure — unit-tested.
- Create: `hooks/useSnapPreference.ts` — a tiny hook holding `snapEnabled` boolean + `toggle`, persisted to `localStorage` (key e.g. `figemite:snap`). Test: `hooks/useSnapPreference.test.ts`.
- Modify: `canvas/BoardCanvas.tsx` — thread `snapEnabled` into the editable `<ReactFlow>` as `snapToGrid={snapEnabled}` + `snapGrid={SNAP_GRID}`; give both `<Background>` instances `variant={BackgroundVariant.Dots}` + `gap={GRID_SIZE}`, and hide/gray the grid when snapping is off (optional cosmetic).
- Modify: `hooks/useEditableCanvas.ts` (and/or wherever the shared `onResizeEnd` lives) — round committed `{width,height}` via `snapSize` before it hits the store, gated on `snapEnabled`.
- Modify: `components/Toolbar.tsx` — add a small grid-snap toggle button (icon + active state) calling the hook's `toggle`.

**No server / shared / mcp changes.** Snapping is purely client-side view behavior.

---

## Task 1: Grid constants + `snapSize` helper (pure)

**Files:** Modify `packages/client/src/canvas/coords.ts`; extend `packages/client/src/canvas/coords.test.ts`.

- [ ] **Step 1: Failing test** — assert `SNAP_GRID` equals `[GRID_SIZE, GRID_SIZE]`; assert `snapSize({width: 47, height: 12})` rounds each dimension to the nearest grid multiple but never below a `MIN` floor (reuse the DrawingNode `MIN_WIDTH = 20` convention). Include an exact case: `snapSize({width: 47, height: 33})` → `{width: 40, height: 40}` (nearest-multiple) with a documented rounding rule.
- [ ] **Step 2: Implement**

```ts
export const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];

/** Round a size to the grid, clamped to a minimum of one grid cell. */
export function snapSize(wh: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(GRID_SIZE, Math.round(wh.width / GRID_SIZE) * GRID_SIZE),
    height: Math.max(GRID_SIZE, Math.round(wh.height / GRID_SIZE) * GRID_SIZE),
  };
}
```

- [ ] **Step 3:** `npm test` green for `coords.test.ts`.

## Task 2: `useSnapPreference` hook (localStorage-backed toggle)

**Files:** Create `hooks/useSnapPreference.ts` + `hooks/useSnapPreference.test.ts`.

- [ ] **Step 1: Failing test** — default is `true` when nothing is stored; `toggle()` flips it and writes `'0'`/`'1'` (or `'false'`/`'true'`) to `localStorage['figemite:snap']`; a second mount reads the persisted value. Use `@testing-library/react`'s `renderHook`.
- [ ] **Step 2: Implement** a `useState` seeded from `localStorage`, a `toggle` callback that `setState` + writes through. Guard `localStorage` access in a `try/catch` (SSR/`build:static` safety — the static build must not throw).
- [ ] **Step 3:** tests green.

## Task 3: Wire native drag-snap + aligned background into the canvas

**Files:** Modify `canvas/BoardCanvas.tsx`.

- [ ] **Step 1:** Import `BackgroundVariant`, `SNAP_GRID`, `GRID_SIZE`, and `useSnapPreference`. In the editable pane component, read `const { snapEnabled } = useSnapPreference()` (or thread it down from a single owner near the Toolbar so both share one instance — pick whichever matches the existing prop-drilling; the Toolbar and canvas are siblings under the same route component, so lift the hook to that parent and pass `snapEnabled` down to both).
- [ ] **Step 2:** On the **editable** `<ReactFlow>` (~L696) add:

```tsx
snapToGrid={snapEnabled}
snapGrid={SNAP_GRID}
```

- [ ] **Step 3:** Replace both `<Background />` usages with `<Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} />`. (Read-only pane keeps the aligned grid for visual consistency but no snap prop — it has no dragging.)
- [ ] **Step 4: Test** — extend `canvas/BoardCanvas.test.tsx` (or a focused render test) to assert the editable `<ReactFlow>` receives `snapToGrid === true` and `snapGrid === [20, 20]` when the preference is on, and `snapToGrid === false` when off. (The existing tests already mock/inspect RF props via `test/rf.tsx` — follow that pattern.)

## Task 4: Snap committed resize sizes

**Files:** Modify the shared resize-commit seam (`hooks/useEditableCanvas.ts` — the `onResizeEnd` that DrawingNode/StickyNode/ShapeNode/FrameNode call through `data.onResizeEnd`).

- [ ] **Step 1: Failing test** — in the hook's test, simulate an `onResizeEnd(id, {width: 137, height: 82})` with snapping on and assert the store receives `{width: 140, height: 80}` (via `snapSize`); with snapping off, the raw size passes through.
- [ ] **Step 2: Implement** — wrap the size in `snapEnabled ? snapSize(size) : size` before the store mutation. Thread `snapEnabled` into the hook (constructor arg or a ref it reads) so it stays a pure function of its inputs.
- [ ] **Step 3:** tests green. Manually confirm a resized sticky lands on grid multiples.

> Note: `NodeResizer` also accepts live-snapping via its own props in newer `@xyflow/react`; if the installed version exposes a grid option on `NodeResizer`, prefer that for live feedback and keep the `onResizeEnd` rounding as the authoritative commit. Check the version before adding a second mechanism — do not snap twice with conflicting rules.

## Task 5: Toolbar toggle button

**Files:** Modify `components/Toolbar.tsx` (+ its test).

- [ ] **Step 1:** Add a toggle button (a `lucide-react` `Grid3x3`/`Grid2x2` icon) reflecting `snapEnabled` (active styling when on), calling `toggle`. Match the existing Toolbar button styling/aria conventions.
- [ ] **Step 2: Test** — clicking toggles `aria-pressed`/active class and invokes the callback. Assert the button exists and is wired.

## Task 6: Full verification

- [ ] `npm run typecheck` — 0 errors.
- [ ] `npm test` — all green.
- [ ] `npm run lint` — clean.
- [ ] `npm run build:static` — succeeds (proves the `localStorage` guard doesn't break the backend-less build).
- [ ] Manual: drag a node → snaps to 20px grid; resize → dimensions land on grid; toggle off → free movement; reload → toggle state persists; the background dots visually coincide with where nodes settle.

---

## Self-Review

- **Model untouched.** No `board.json`, schema, CRDT-op, or MCP change — snapping is a render/interaction preference. Existing boards load and save byte-identically.
- **Reuses the one grid source of truth** (`GRID_SIZE`) rather than introducing a second magic number; the visible grid, drag snap, resize snap, and new-node placement all derive from it.
- **Preference is client-only + guarded**, so multiplayer peers can independently choose snapping and the static build never touches an absent `localStorage`.
- **Risk:** `snapGrid` snaps *position*; multi-select group drags snap the group origin, not each node individually — acceptable and matches ReactFlow semantics. Call it out in the Toolbar tooltip if it surprises testers.
