// ArrowEdge: a bezier edge with arrowhead markers (none/end/both), solid/dashed
// stroke, and an optional label. Ported from figmalade's ArrowEdge.tsx, minus
// the label-editing affordance (Phase 4 seam — gated on a write callback in
// `data` that Phase 3 never supplies).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RfEdgeTestHarness, makeEdgeProps } from '../test/rf.js';
import { ArrowEdge } from './ArrowEdge.js';
import type { ArrowEdgeData } from './ArrowEdge.js';

afterEach(() => {
  cleanup();
});

function renderArrow(data: Partial<ArrowEdgeData> = {}, overrides: Partial<ArrowEdgeData> = {}) {
  const fullData: ArrowEdgeData = {
    style: 'solid',
    arrow: 'end',
    ...data,
    ...overrides,
  };
  const props = makeEdgeProps('arrow', { id: 'e1', data: fullData });
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
});
