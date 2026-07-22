// ArrowEdge — FLOATING endpoints + routing switch (Task 3).
//
// The isolated edge harness (RfEdgeTestHarness) has NO nodes in the RF store, so
// in the plain unit tests `useInternalNode` returns undefined and the component
// takes its RF-prop fallback path (covered in ArrowEdge.test.tsx). To exercise
// the real-app FLOATING path in jsdom — where nothing is ever measured — we
// partial-mock `@xyflow/react`, keeping the real module (so the harness's
// ReactFlow/Position still work) but overriding `useInternalNode` to return
// fake, already-"measured" internal nodes for the edge's source/target ids.
// This is more reliable than mounting through `<ReactFlow nodes>` because RF
// gates edge rendering on ResizeObserver measurement, which jsdom never runs.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// Mutable per-test store of fake internal nodes, keyed by node id. `vi.hoisted`
// makes it available to the hoisted `vi.mock` factory below.
const { nodeStore } = vi.hoisted(() => ({
  nodeStore: new Map<string, unknown>(),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useInternalNode: (id: string) => nodeStore.get(id),
  };
});

// Imports below resolve against the mocked module — must come after vi.mock.
const { RfEdgeTestHarness, makeEdgeProps } = await import('../test/rf.js');
const { ArrowEdge } = await import('./ArrowEdge.js');
type ArrowEdgeData = import('./ArrowEdge.js').ArrowEdgeData;

/** A fake InternalNode: top-left `(x,y)` + a finite measured size. */
function measuredNode(x: number, y: number, width: number, height: number) {
  return { internals: { positionAbsolute: { x, y } }, measured: { width, height } };
}

afterEach(() => {
  nodeStore.clear();
  cleanup();
});

function renderArrow(data: Partial<ArrowEdgeData> = {}) {
  const fullData: ArrowEdgeData = { style: 'solid', arrow: 'end', ...data };
  // makeEdgeProps defaults source:'source-node', target:'target-node'.
  const props = makeEdgeProps('arrow', { id: 'e1', data: fullData });
  return render(
    <RfEdgeTestHarness>
      <ArrowEdge {...props} />
    </RfEdgeTestHarness>,
  );
}

function pathD(container: HTMLElement): string {
  const path = container.querySelector('.react-flow__edge-path');
  return path?.getAttribute('d') ?? '';
}

describe('ArrowEdge — floating geometry', () => {
  // Two rects side by side: source center (50,30), target center (350,30). The
  // facing borders are the source's RIGHT edge (100,30) and target's LEFT edge
  // (300,30) — a purely horizontal segment. These differ from the harness's
  // fallback endpoints (0,0)→(100,100), so seeing (100,30)/(300,30) in `d`
  // proves the floating path (not the fallback) produced it.
  function placeHorizontal() {
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    nodeStore.set('target-node', measuredNode(300, 0, 100, 60));
  }

  it('uses floating boundary endpoints (default bezier path) when both nodes are measured', () => {
    placeHorizontal();
    const { container } = renderArrow();
    const d = pathD(container);
    const compact = d.replace(/\s+/g, '');
    expect(d).toBeTruthy();
    expect(compact).toContain('100,30'); // source right border
    expect(compact).toContain('300,30'); // target left border
    expect(d).toContain('C'); // bezier ⇒ cubic curve command
  });

  it('routing "straight" yields a line with no cubic (C) command', () => {
    placeHorizontal();
    const { container } = renderArrow({ routing: 'straight' });
    const d = pathD(container);
    expect(d).toBeTruthy();
    expect(d).not.toContain('C');
    expect(d.replace(/\s+/g, '')).toContain('300,30'); // still the floating endpoint
  });

  it('routing "elbow" yields an orthogonal path (has L, no C)', () => {
    placeHorizontal();
    const { container } = renderArrow({ routing: 'elbow' });
    const d = pathD(container);
    expect(d).toBeTruthy();
    expect(d).toContain('L');
    expect(d).not.toContain('C');
  });

  it('falls back to the RF-provided endpoints when a node is not yet measured', () => {
    // Only the source is measured → not both → fallback to props (0,0)→(100,100).
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    const { container } = renderArrow();
    const compact = pathD(container).replace(/\s+/g, '');
    expect(compact).toContain('0,0'); // fallback source
    expect(compact).toContain('100,100'); // fallback target
  });

  it('falls back (no degenerate rect) when a node reports a 0 measured size', () => {
    // Source is properly measured, but the target's measured size is 0 — a
    // degenerate rect that would collapse to its top-left corner. It must be
    // treated as unmeasured → fallback to props (0,0)→(100,100), NOT a broken
    // or corner-anchored endpoint.
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    nodeStore.set('target-node', measuredNode(300, 0, 0, 0));
    const compact = pathD(renderArrow().container).replace(/\s+/g, '');
    expect(compact).toContain('0,0');
    expect(compact).toContain('100,100');
    expect(compact).not.toContain('NaN');
  });

  it('falls back (no NaN path) when a node reports a NaN measured size', () => {
    // A NaN size would poison the intersection math into a `d="M NaN,…"` path.
    // It must be treated as unmeasured → fallback to props (0,0)→(100,100).
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    nodeStore.set('target-node', measuredNode(300, 0, NaN, NaN));
    const compact = pathD(renderArrow().container).replace(/\s+/g, '');
    expect(compact).not.toContain('NaN');
    expect(compact).toContain('0,0');
    expect(compact).toContain('100,100');
  });
});
