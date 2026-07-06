// ArrowEdge: a bezier edge with arrowhead markers (none/end/both), solid/dashed
// stroke, and an optional label. Ported from figmalade's ArrowEdge.tsx.
// P4-T24 wires the label-editing seam (double-click -> edit -> commit via
// `data.onLabelChange`), gated the same way every node's text-edit seam is
// (P3-T19's pattern) — absent in Phase 3, live here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RfEdgeTestHarness, makeEdgeProps } from '../test/rf.js';
import { ArrowEdge } from './ArrowEdge.js';
import type { ArrowEdgeData } from './ArrowEdge.js';

afterEach(() => {
  cleanup();
});

function renderArrow(data: Partial<ArrowEdgeData> = {}, selected = false) {
  const fullData: ArrowEdgeData = {
    style: 'solid',
    arrow: 'end',
    ...data,
  };
  const props = makeEdgeProps('arrow', { id: 'e1', data: fullData, selected });
  return render(
    <RfEdgeTestHarness>
      <ArrowEdge {...props} />
    </RfEdgeTestHarness>,
  );
}

describe('ArrowEdge', () => {
  it('renders an end-arrowhead marker when data.arrow is "end"', () => {
    const { container } = renderArrow({ arrow: 'end' });
    expect(container.querySelector('marker[id^="arrow-end-"]')).toBeTruthy();
    expect(container.querySelector('marker[id^="arrow-start-"]')).toBeFalsy();
  });

  it('renders both start and end arrowhead markers when data.arrow is "both"', () => {
    const { container } = renderArrow({ arrow: 'both' });
    expect(container.querySelector('marker[id^="arrow-end-"]')).toBeTruthy();
    expect(container.querySelector('marker[id^="arrow-start-"]')).toBeTruthy();
  });

  it('renders no arrowhead markers when data.arrow is "none"', () => {
    const { container } = renderArrow({ arrow: 'none' });
    expect(container.querySelector('marker[id^="arrow-end-"]')).toBeFalsy();
    expect(container.querySelector('marker[id^="arrow-start-"]')).toBeFalsy();
  });

  it('renders a dashed stroke when data.style is "dashed"', () => {
    const { container } = renderArrow({ style: 'dashed' });
    const path = container.querySelector('.react-flow__edge-path') as SVGPathElement;
    expect(path.style.strokeDasharray).toBeTruthy();
  });

  it('renders a solid stroke (no dasharray) when data.style is "solid"', () => {
    const { container } = renderArrow({ style: 'solid' });
    const path = container.querySelector('.react-flow__edge-path') as SVGPathElement;
    expect(path.style.strokeDasharray).toBeFalsy();
  });

  it('renders the label text when data.label is set', () => {
    renderArrow({ label: 'triggers' });
    expect(screen.getByText('triggers')).toBeInTheDocument();
  });

  it('renders no label text when data.label is unset', () => {
    renderArrow({ label: undefined });
    expect(screen.queryByText(/./, { selector: 'span' })).not.toBeInTheDocument();
  });

  // ── P4-T24: inline label editing ─────────────────────────────────────────

  it('does not enter edit mode on double-click when no onLabelChange is provided (read-only)', () => {
    renderArrow({ label: 'triggers' });
    fireEvent.doubleClick(screen.getByText('triggers'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('enters edit mode on double-click when onLabelChange is provided', () => {
    renderArrow({ label: 'triggers', onLabelChange: vi.fn() });
    fireEvent.doubleClick(screen.getByText('triggers'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits the new label via onLabelChange on Enter', () => {
    const onLabelChange = vi.fn();
    renderArrow({ label: 'triggers', onLabelChange });
    fireEvent.doubleClick(screen.getByText('triggers'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'causes' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onLabelChange).toHaveBeenCalledWith('e1', 'causes');
  });

  it('reverts without committing on Escape', () => {
    const onLabelChange = vi.fn();
    renderArrow({ label: 'triggers', onLabelChange });
    fireEvent.doubleClick(screen.getByText('triggers'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'should not stick' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onLabelChange).not.toHaveBeenCalled();
    expect(screen.getByText('triggers')).toBeInTheDocument();
  });

  it('shows a "+" affordance to add a label when selected, editable, and no label exists', () => {
    renderArrow({ label: undefined, onLabelChange: vi.fn() }, true);
    expect(screen.getByTitle(/Double-click to add label/)).toBeInTheDocument();
  });

  it('does not show the "+" affordance when not editable (no onLabelChange), even if selected', () => {
    renderArrow({ label: undefined }, true);
    expect(screen.queryByTitle(/Double-click to add label/)).not.toBeInTheDocument();
  });

  it('does not show the "+" affordance when not selected', () => {
    renderArrow({ label: undefined, onLabelChange: vi.fn() }, false);
    expect(screen.queryByTitle(/Double-click to add label/)).not.toBeInTheDocument();
  });
});
