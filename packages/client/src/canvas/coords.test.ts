import { describe, it, expect } from 'vitest';
import {
  flowToScreen,
  screenToFlow,
  getFlowPointer,
  nodeRect,
  boundingBox,
  snapToGrid,
  viewCenter,
} from './coords.js';
import type { BoardNode } from '@easel/shared';

describe('flowToScreen / screenToFlow', () => {
  it('screenToFlow is the inverse of flowToScreen at identity viewport', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const p = { x: 123, y: 456 };
    expect(screenToFlow(flowToScreen(p, vp), vp)).toEqual(p);
  });

  it('applies pan: screen = flow + viewport translation at zoom 1', () => {
    const vp = { x: 50, y: -20, zoom: 1 };
    expect(flowToScreen({ x: 10, y: 10 }, vp)).toEqual({ x: 60, y: -10 });
  });

  it('applies zoom: screen = flow * zoom + translation', () => {
    const vp = { x: 100, y: 200, zoom: 2 };
    expect(flowToScreen({ x: 10, y: 5 }, vp)).toEqual({ x: 120, y: 210 });
  });

  it('screenToFlow inverts flowToScreen under combined pan + zoom', () => {
    const vp = { x: 37, y: -14, zoom: 1.5 };
    const p = { x: -42, y: 88.5 };
    const roundTripped = screenToFlow(flowToScreen(p, vp), vp);
    expect(roundTripped.x).toBeCloseTo(p.x, 10);
    expect(roundTripped.y).toBeCloseTo(p.y, 10);
  });

  it('flowToScreen inverts screenToFlow (round trip the other direction)', () => {
    const vp = { x: 12, y: 34, zoom: 0.75 };
    const p = { x: 300, y: -150 };
    const roundTripped = flowToScreen(screenToFlow(p, vp), vp);
    expect(roundTripped.x).toBeCloseTo(p.x, 10);
    expect(roundTripped.y).toBeCloseTo(p.y, 10);
  });
});

describe('getFlowPointer', () => {
  it('converts a screen event position to flow coords relative to a container rect', () => {
    const rect = {
      left: 100,
      top: 50,
      right: 900,
      bottom: 700,
      width: 800,
      height: 650,
    } as DOMRect;
    const vp = { x: 0, y: 0, zoom: 1 };
    // Event at (150, 90) on screen; container starts at (100, 50) -> local (50, 40).
    const result = getFlowPointer({ clientX: 150, clientY: 90 }, rect, vp);
    expect(result).toEqual({ x: 50, y: 40 });
  });

  it('accounts for viewport pan/zoom on top of the container-relative offset', () => {
    const rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;
    const vp = { x: 20, y: 10, zoom: 2 };
    // local = (220, 110); flow = (local - vp) / zoom = (100, 50)
    const result = getFlowPointer({ clientX: 220, clientY: 110 }, rect, vp);
    expect(result).toEqual({ x: 100, y: 50 });
  });
});

describe('nodeRect', () => {
  it('returns the flow-space bbox for a node with a WH size (sticky)', () => {
    const node = {
      id: 's1',
      type: 'sticky',
      pos: { x: 10, y: 20 },
      order: 0,
      size: { width: 200, height: 160 },
      text: '',
      color: '#fef3c7',
    } as BoardNode;
    expect(nodeRect(node)).toEqual({ x: 10, y: 20, width: 200, height: 160 });
  });

  it('returns the flow-space bbox for a node with a numeric size (emoji)', () => {
    const node = {
      id: 'e1',
      type: 'emoji',
      pos: { x: 5, y: 5 },
      order: 0,
      text: '🎉',
      size: 64,
    } as BoardNode;
    expect(nodeRect(node)).toEqual({ x: 5, y: 5, width: 64, height: 64 });
  });

  it('returns the flow-space bbox for an icon node (numeric size)', () => {
    const node = {
      id: 'i1',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 0,
      name: 'star',
      size: 48,
      color: '#000',
    } as BoardNode;
    expect(nodeRect(node)).toEqual({ x: 0, y: 0, width: 48, height: 48 });
  });

  it('returns a zero-size bbox at pos for a text node (no size field)', () => {
    const node = {
      id: 't1',
      type: 'text',
      pos: { x: 30, y: 40 },
      order: 0,
      text: 'Label',
    } as BoardNode;
    expect(nodeRect(node)).toEqual({ x: 30, y: 40, width: 0, height: 0 });
  });
});

describe('boundingBox', () => {
  it('returns the union rect of multiple node rects', () => {
    const nodes = [
      {
        id: 'a',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 100, height: 100 },
        text: '',
        color: '#fff',
      },
      {
        id: 'b',
        type: 'sticky',
        pos: { x: 200, y: 50 },
        order: 1,
        size: { width: 100, height: 100 },
        text: '',
        color: '#fff',
      },
    ] as BoardNode[];

    expect(boundingBox(nodes)).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });

  it('returns a zero rect for an empty node list', () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('handles a single node (bbox equals its own rect)', () => {
    const node = {
      id: 'a',
      type: 'emoji',
      pos: { x: 10, y: 20 },
      order: 0,
      text: '🎉',
      size: 40,
    } as BoardNode;
    expect(boundingBox([node])).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });
});

describe('snapToGrid', () => {
  it('rounds a point to the nearest 20px grid cell', () => {
    expect(snapToGrid({ x: 13, y: 27 })).toEqual({ x: 20, y: 20 });
  });

  it('rounds down when closer to the lower grid line', () => {
    expect(snapToGrid({ x: 9, y: 111 })).toEqual({ x: 0, y: 120 });
  });

  it('leaves an already-aligned point unchanged', () => {
    expect(snapToGrid({ x: 100, y: -40 })).toEqual({ x: 100, y: -40 });
  });
});

describe('viewCenter', () => {
  it('computes the flow-space point at a fixed offset from the viewport origin, snapped to grid', () => {
    // Legacy formula: snapToGrid(-vp.x / vp.zoom + offset, -vp.y / vp.zoom + offset).
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(viewCenter(vp, 200)).toEqual({ x: 200, y: 200 });
  });

  it('accounts for pan', () => {
    const vp = { x: -100, y: 40, zoom: 1 };
    // -(-100)/1 + 200 = 300; -(40)/1 + 200 = 160
    expect(viewCenter(vp, 200)).toEqual({ x: 300, y: 160 });
  });

  it('accounts for zoom', () => {
    // -(-100)/2 + 200 = 250, snapped to the nearest 20px grid cell -> 260.
    const vpPanned = { x: -100, y: -100, zoom: 2 };
    expect(viewCenter(vpPanned, 200)).toEqual({ x: 260, y: 260 });
  });

  it('defaults the offset to 200 (the legacy default)', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(viewCenter(vp)).toEqual({ x: 200, y: 200 });
  });
});
