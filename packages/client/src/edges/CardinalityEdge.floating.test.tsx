// CardinalityEdge — FLOATING endpoints + computed pill sides (Task 4).
//
// Same jsdom-measurement workaround as ArrowEdge.floating.test.tsx: partial-mock
// `@xyflow/react` to override `useInternalNode` with fake already-"measured"
// nodes, keeping the rest of the module real so the harness still mounts. With
// both nodes measured the pills must anchor to the COMPUTED border endpoints
// (`sx,sy`/`tx,ty`) and offset by the COMPUTED sides (`sourcePos`/`targetPos`),
// not the raw props + dx/dy fallback the isolated tests exercise.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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

const { RfEdgeTestHarness, makeEdgeProps } = await import('../test/rf.js');
const { CardinalityEdge } = await import('./CardinalityEdge.js');
type CardinalityEdgeData = import('./CardinalityEdge.js').CardinalityEdgeData;

function measuredNode(x: number, y: number, width: number, height: number) {
  return { internals: { positionAbsolute: { x, y } }, measured: { width, height } };
}

afterEach(() => {
  nodeStore.clear();
  cleanup();
});

function renderCardinality(data: Partial<CardinalityEdgeData> = {}) {
  const fullData: CardinalityEdgeData = { style: 'solid', cardinality: '1:N', ...data };
  const props = makeEdgeProps('cardinality', { id: 'e1', data: fullData });
  return render(
    <RfEdgeTestHarness>
      <CardinalityEdge {...props} />
    </RfEdgeTestHarness>,
  );
}

/** The transform string of the pill div wrapping the titled span. */
function pillTransform(titleRe: RegExp): string {
  const span = screen.getByTitle(titleRe);
  return (span.parentElement as HTMLElement).style.transform;
}

describe('CardinalityEdge — floating geometry', () => {
  it('renders both pills anchored to the floating endpoints/sides (horizontal)', () => {
    // Side by side: source center (50,30), target center (350,30). Facing sides
    // are source RIGHT (100,30) and target LEFT (300,30). pillOffset(Right)=+28x,
    // pillOffset(Left)=-28x ⇒ source pill at (128,30), target pill at (272,30).
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    nodeStore.set('target-node', measuredNode(300, 0, 100, 60));
    renderCardinality({ cardinality: '1:N' });

    expect(screen.getByTitle(/Source: 1/)).toBeInTheDocument();
    expect(screen.getByTitle(/Target: N/)).toBeInTheDocument();

    const src = pillTransform(/Source: 1/).replace(/\s+/g, '');
    const tgt = pillTransform(/Target: N/).replace(/\s+/g, '');
    // Right-side source pill: sx(100)+28 = 128, sy(30)+0 = 30.
    expect(src).toContain('translate(128px,30px)');
    // Left-side target pill: tx(300)-28 = 272, ty(30)+0 = 30.
    expect(tgt).toContain('translate(272px,30px)');
  });

  it('places pills on the vertical sides when nodes are stacked vertically', () => {
    // Stacked: source center (50,30), target center (50,330). Facing sides are
    // source BOTTOM (50,60) and target TOP (50,300). pillOffset(Bottom)=+28y,
    // pillOffset(Top)=-28y ⇒ source pill (50,88), target pill (50,272).
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    nodeStore.set('target-node', measuredNode(0, 300, 100, 60));
    renderCardinality({ cardinality: '1:N' });

    const src = pillTransform(/Source: 1/).replace(/\s+/g, '');
    const tgt = pillTransform(/Target: N/).replace(/\s+/g, '');
    expect(src).toContain('translate(50px,88px)'); // Bottom side
    expect(tgt).toContain('translate(50px,272px)'); // Top side
  });

  it('routing "elbow" produces an orthogonal edge path (has L, no C)', () => {
    nodeStore.set('source-node', measuredNode(0, 0, 100, 60));
    nodeStore.set('target-node', measuredNode(300, 0, 100, 60));
    const { container } = renderCardinality({ routing: 'elbow' });
    const d = container.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '';
    expect(d).toBeTruthy();
    expect(d).toContain('L');
    expect(d).not.toContain('C');
  });
});
