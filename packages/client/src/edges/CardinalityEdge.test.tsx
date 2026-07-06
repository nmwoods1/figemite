// CardinalityEdge: an ER-style edge — the path plus cardinality pills
// (1:1/1:N/N:1/N:N) near each endpoint, NO arrowheads, solid/dashed stroke,
// optional verb label. Ported from figmalade's CardinalityEdge.tsx, minus the
// label/cardinality-editing affordances (Phase 4 seam — same rationale as
// ArrowEdge's module doc: gated on write callbacks in `data` that Phase 3
// never supplies).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RfEdgeTestHarness, makeEdgeProps } from '../test/rf.js';
import { CardinalityEdge } from './CardinalityEdge.js';
import type { CardinalityEdgeData } from './CardinalityEdge.js';

afterEach(() => {
  cleanup();
});

function renderCardinality(data: Partial<CardinalityEdgeData> = {}) {
  const fullData: CardinalityEdgeData = {
    style: 'solid',
    cardinality: '1:N',
    ...data,
  };
  const props = makeEdgeProps('cardinality', { id: 'e1', data: fullData });
  return render(
    <RfEdgeTestHarness>
      <CardinalityEdge {...props} />
    </RfEdgeTestHarness>,
  );
}

describe('CardinalityEdge', () => {
  it('shows the source-side "1" pill and target-side "N" pill for 1:N', () => {
    renderCardinality({ cardinality: '1:N' });
    expect(screen.getByTitle(/Source: 1/)).toBeInTheDocument();
    expect(screen.getByTitle(/Target: N/)).toBeInTheDocument();
  });

  it('shows the source-side "N" pill and target-side "1" pill for N:1', () => {
    renderCardinality({ cardinality: 'N:1' });
    expect(screen.getByTitle(/Source: N/)).toBeInTheDocument();
    expect(screen.getByTitle(/Target: 1/)).toBeInTheDocument();
  });

  it('shows "1" pills on both sides for 1:1', () => {
    renderCardinality({ cardinality: '1:1' });
    expect(screen.getByTitle(/Source: 1/)).toBeInTheDocument();
    expect(screen.getByTitle(/Target: 1/)).toBeInTheDocument();
  });

  it('shows "N" pills on both sides for N:N', () => {
    renderCardinality({ cardinality: 'N:N' });
    expect(screen.getByTitle(/Source: N/)).toBeInTheDocument();
    expect(screen.getByTitle(/Target: N/)).toBeInTheDocument();
  });

  it('renders no arrowhead marker elements', () => {
    const { container } = renderCardinality();
    expect(container.querySelector('marker')).toBeFalsy();
  });

  it('renders a dashed stroke when data.style is "dashed"', () => {
    const { container } = renderCardinality({ style: 'dashed' });
    const path = container.querySelector('.react-flow__edge-path') as SVGPathElement;
    expect(path.style.strokeDasharray).toBeTruthy();
  });

  it('renders a solid stroke (no dasharray) when data.style is "solid"', () => {
    const { container } = renderCardinality({ style: 'solid' });
    const path = container.querySelector('.react-flow__edge-path') as SVGPathElement;
    expect(path.style.strokeDasharray).toBeFalsy();
  });

  it('renders the verb label text when data.label is set', () => {
    renderCardinality({ label: 'owns' });
    expect(screen.getByText('owns')).toBeInTheDocument();
  });

  it('renders no verb label when data.label is unset', () => {
    renderCardinality({ label: undefined });
    expect(screen.queryByText('owns')).not.toBeInTheDocument();
  });
});
