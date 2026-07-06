// DrawingNode: a persistent freehand pencil stroke, rendered as an SVG path
// via smoothPath(points). Ported from figmalade's DrawingNode.tsx — no
// editing, no connection handles, no rotation (none exist in the legacy
// component either).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RfTestHarness, makeNodeProps } from '../test/rf.js';
import { DrawingNode } from './DrawingNode.js';
import type { DrawingNodeData } from './DrawingNode.js';

afterEach(() => {
  cleanup();
});

function renderDrawing(data: Partial<DrawingNodeData> = {}, selected = false) {
  const fullData: DrawingNodeData = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    color: '#1e293b',
    strokeWidth: 3,
    width: 100,
    height: 80,
    ...data,
  };
  const props = makeNodeProps('drawing', { id: 'd1', data: fullData, selected });
  return render(
    <RfTestHarness>
      <DrawingNode {...props} />
    </RfTestHarness>,
  );
}

describe('DrawingNode', () => {
  it('renders an SVG path built from the given points', () => {
    const { container } = renderDrawing({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toBe('M 0 0 L 10 10');
  });

  it('applies the stroke color and width', () => {
    const { container } = renderDrawing({ color: '#ff0000', strokeWidth: 5 });
    const path = container.querySelector('path[stroke="#ff0000"]');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke-width')).toBe('5');
  });

  it('sizes the svg to the node bbox', () => {
    const { container } = renderDrawing({ width: 200, height: 150 });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('150');
  });
});
