// CardinalityEdge: an ER-style edge — the path plus cardinality pills
// (1:1/1:N/N:1/N:N) near each endpoint, NO arrowheads, solid/dashed stroke,
// optional verb label. Ported from figmalade's CardinalityEdge.tsx. P4-T24
// wires both inline affordances the legacy had: double-click the center
// label to edit it (same `useEditableText` pattern as ArrowEdge), and click
// either pill to toggle that side's cardinality (1<->N) via
// `data.onCardinalityChange` — gated on the respective write callback being
// present in `data`, same seam convention as every other editable element.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RfEdgeTestHarness, makeEdgeProps } from '../test/rf.js';
import { CardinalityEdge } from './CardinalityEdge.js';
import type { CardinalityEdgeData } from './CardinalityEdge.js';

afterEach(() => {
  cleanup();
});

function renderCardinality(data: Partial<CardinalityEdgeData> = {}, selected = false) {
  const fullData: CardinalityEdgeData = {
    style: 'solid',
    cardinality: '1:N',
    ...data,
  };
  const props = makeEdgeProps('cardinality', { id: 'e1', data: fullData, selected });
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

  // ── P4-T24: inline label editing ─────────────────────────────────────────

  it('does not enter edit mode on double-click when no onLabelChange is provided (read-only)', () => {
    renderCardinality({ label: 'owns' });
    fireEvent.doubleClick(screen.getByText('owns'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onLabelChange is provided', () => {
    renderCardinality({ label: 'owns', onLabelChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('owns'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new verb label via onLabelChange on Enter', () => {
    const onLabelChange = vi.fn();
    renderCardinality({ label: 'owns', onLabelChange });
    fireEvent.doubleClick(screen.getByText('owns'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'manages' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onLabelChange).toHaveBeenCalledWith('e1', 'manages');
  });

  it('reverts without committing on Escape', () => {
    const onLabelChange = vi.fn();
    renderCardinality({ label: 'owns', onLabelChange });
    fireEvent.doubleClick(screen.getByText('owns'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'should not stick' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onLabelChange).not.toHaveBeenCalled();
    expect(screen.getByText('owns')).toBeInTheDocument();
  });

  it('shows a "+" affordance to add a verb label when selected and editable, with no label', () => {
    renderCardinality({ label: undefined, onLabelChange: vi.fn() }, true);
    expect(screen.getByTitle(/Double-click to add verb label/)).toBeInTheDocument();
  });

  it('does not show the "+" affordance when not editable, even if selected', () => {
    renderCardinality({ label: undefined }, true);
    expect(screen.queryByTitle(/Double-click to add verb label/)).not.toBeInTheDocument();
  });

  // ── P4-T24: pill click-to-toggle cardinality ─────────────────────────────

  it('clicking the source pill toggles the source side (1:N -> N:N) via onCardinalityChange', () => {
    const onCardinalityChange = vi.fn();
    renderCardinality({ cardinality: '1:N', onCardinalityChange });
    fireEvent.click(screen.getByTitle(/Source: 1/));
    expect(onCardinalityChange).toHaveBeenCalledWith('e1', 'N:N');
  });

  it('clicking the target pill toggles the target side (1:N -> 1:1) via onCardinalityChange', () => {
    const onCardinalityChange = vi.fn();
    renderCardinality({ cardinality: '1:N', onCardinalityChange });
    fireEvent.click(screen.getByTitle(/Target: N/));
    expect(onCardinalityChange).toHaveBeenCalledWith('e1', '1:1');
  });

  it('does nothing when a pill is clicked with no onCardinalityChange provided (read-only)', () => {
    renderCardinality({ cardinality: '1:N' });
    expect(() => fireEvent.click(screen.getByTitle(/Source: 1/))).not.toThrow();
  });
});
