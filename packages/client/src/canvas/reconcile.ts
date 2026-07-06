// ── doc→RF reconciler ─────────────────────────────────────────────────────────
//
// Plan v2 §3. The Y.Doc is the source of truth; ReactFlow's controlled
// nodes/edges state is a transient interaction buffer. When the doc updates,
// BoardCanvas recomputes the doc-derived RF shape (`boardToRf(getSnapshot(doc))`)
// and reconciles it into RF's current state. This module is that reconcile.
//
// Two hard requirements, both about the doc↔RF feedback loop:
//
//   1. PRESERVE RF's transient per-node UI state. RF owns `selected` and the
//      in-flight `dragging` flag (and, in RF12, the `measured` dimensions and
//      `internals` bag it computes after mounting). `boardToRf` knows nothing
//      about these — it only produces doc-authoritative fields (position, data,
//      zIndex, type…). If we naively replaced RF's nodes with the doc-derived
//      ones on every doc tick, we'd wipe selection and interrupt drags. So we
//      OVERLAY the doc-authoritative fields onto RF's node, keeping the
//      transient ones from RF.
//
//   2. IDEMPOTENCE BY REFERENCE. A doc-first commit (e.g. `moveNode` at
//      drag-stop) writes the value RF already shows (the drag already moved the
//      node locally). The resulting doc update re-runs this reconcile with a
//      `next` that equals the current RF state. We must detect that and return
//      the SAME array — and the SAME element objects for unchanged nodes — so
//      the caller can skip `setNodes` entirely (no re-render, no visual jump, no
//      loop). Diffing is field-by-field over the doc-authoritative fields only;
//      transient fields never count as a change (they came from `prev`).
//
// Never call a mutation op from here — this is strictly doc→RF (read side).

import type { BoardRfEdge, BoardRfNode } from './rf-adapters.js';

/**
 * The RF-owned transient fields we carry over from the current RF node rather
 * than from the doc-derived one. `selected`/`dragging` are interaction state;
 * `measured`/`internals` are RF12's post-mount layout bookkeeping (absent on a
 * freshly `boardToRf`-built node, so overwriting them with `undefined` would
 * throw away real measurements and re-trigger measurement churn).
 */
const TRANSIENT_NODE_KEYS = ['selected', 'dragging', 'measured', 'internals'] as const;

/** Transient edge fields RF owns (selection); everything else is doc-authoritative. */
const TRANSIENT_EDGE_KEYS = ['selected'] as const;

/** Shallow structural equality good enough for RF node/edge fields (positions,
 * data objects, primitives). Used only to decide whether to reuse an object
 * reference, so a false negative just means a harmless extra object alloc. */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (typeof av === 'object' && av !== null && typeof bv === 'object' && bv !== null) {
      if (!shallowEqual(av, bv)) return false;
    } else if (!Object.is(av, bv)) {
      return false;
    }
  }
  return true;
}

/**
 * Merge one doc-derived node (`next`) onto the current RF node (`prev`),
 * carrying RF's transient fields over from `prev`. Returns `prev` unchanged
 * (same reference) when the merge is field-identical to it, so unchanged nodes
 * keep their object identity across a doc tick.
 */
function mergeNode(prev: BoardRfNode, next: BoardRfNode): BoardRfNode {
  const merged: BoardRfNode = { ...next };
  for (const key of TRANSIENT_NODE_KEYS) {
    if (key in prev) {
      (merged as Record<string, unknown>)[key] = (prev as Record<string, unknown>)[key];
    }
  }
  return shallowEqual(prev, merged) ? prev : merged;
}

function mergeEdge(prev: BoardRfEdge, next: BoardRfEdge): BoardRfEdge {
  const merged: BoardRfEdge = { ...next };
  for (const key of TRANSIENT_EDGE_KEYS) {
    if (key in prev) {
      (merged as Record<string, unknown>)[key] = (prev as Record<string, unknown>)[key];
    }
  }
  return shallowEqual(prev, merged) ? prev : merged;
}

/**
 * Reconcile RF's current nodes (`prev`) toward the doc-derived nodes (`next`).
 *
 * - Ordering and membership follow `next` (the doc) exactly — added ids appear,
 *   removed ids drop, and the array order matches `next` (so the frames-behind
 *   z-ordering `boardToRf` bakes in survives).
 * - Each node that exists in both keeps RF's transient state (selection/drag/
 *   measurements) via {@link mergeNode}.
 * - If the result is element-for-element identical to `prev` (same objects, same
 *   order), returns `prev` — the reference-stable idempotent path.
 */
export function reconcileNodes(prev: BoardRfNode[], next: BoardRfNode[]): BoardRfNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));

  let changed = prev.length !== next.length;
  const result = next.map((n, i) => {
    const existing = prevById.get(n.id);
    const merged = existing ? mergeNode(existing, n) : n;
    // A change is: a new/removed node shifting indices, or this slot's object
    // differing from whatever `prev` had at the same slot.
    if (!changed && merged !== prev[i]) changed = true;
    return merged;
  });

  return changed ? result : prev;
}

/** Edge counterpart of {@link reconcileNodes}. */
export function reconcileEdges(prev: BoardRfEdge[], next: BoardRfEdge[]): BoardRfEdge[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));

  let changed = prev.length !== next.length;
  const result = next.map((e, i) => {
    const existing = prevById.get(e.id);
    const merged = existing ? mergeEdge(existing, e) : e;
    if (!changed && merged !== prev[i]) changed = true;
    return merged;
  });

  return changed ? result : prev;
}
