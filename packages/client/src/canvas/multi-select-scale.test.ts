// ── multi-select-scale: pure group-resize transform ──────────────────────────
//
// Ported from the prototype's `handleMultiScale` (src/components/BoardCanvas.tsx
// ~L1507-1545): given a scale factor (sx, sy) anchored at a fixed corner and
// each selected node's ORIGINAL flow-space rect, compute the patch to apply
// to each node so the whole group scales as one object (Figma-style).
//
// Per-type behaviour (ported faithfully):
//   - sticky / shape / frame: scale width x height independently (sx, sy).
//   - drawing: scale width x height AND every stored point (so the stroke
//     scales with the bbox instead of getting clipped/left behind).
//   - emoji / icon: uniform scale via min(sx, sy) so the glyph stays square.
//   - text: position-only (no size to scale).

import { describe, it, expect } from 'vitest';
import type { BoardNode } from '@figemite/shared';
import { scaleNodeForGroupResize } from './multi-select-scale.js';
import type { OriginalRect } from './multi-select-scale.js';

function rect(x: number, y: number, width: number, height: number): OriginalRect {
  return { x, y, width, height };
}

describe('scaleNodeForGroupResize', () => {
  it('scales a sticky node width/height independently and repositions from the anchor', () => {
    const node: BoardNode = {
      id: 's1',
      type: 'sticky',
      pos: { x: 100, y: 100 },
      order: 0,
      size: { width: 200, height: 160 },
      text: 'hi',
      color: '#fff',
    };
    const patch = scaleNodeForGroupResize(node, rect(100, 100, 200, 160), {
      sx: 2,
      sy: 1.5,
      anchor: { x: 100, y: 100 },
    });
    expect(patch).toEqual({
      pos: { x: 100, y: 100 },
      size: { width: 400, height: 240 },
    });
  });

  it('repositions relative to a non-origin anchor (opposite corner stays fixed)', () => {
    const node: BoardNode = {
      id: 's1',
      type: 'sticky',
      pos: { x: 100, y: 100 },
      order: 0,
      size: { width: 200, height: 160 },
      text: 'hi',
      color: '#fff',
    };
    // Anchor at the bbox's bottom-right (300, 260); scaling by 0.5 should
    // move pos closer to the anchor.
    const patch = scaleNodeForGroupResize(node, rect(100, 100, 200, 160), {
      sx: 0.5,
      sy: 0.5,
      anchor: { x: 300, y: 260 },
    });
    expect(patch.pos).toEqual({ x: 200, y: 180 });
    expect(patch.size).toEqual({ width: 100, height: 80 });
  });

  it('scales a shape node the same way as sticky', () => {
    const node: BoardNode = {
      id: 'sh1',
      type: 'shape',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 160, height: 100 },
      shape: 'rect',
      color: '#fff',
    };
    const patch = scaleNodeForGroupResize(node, rect(0, 0, 160, 100), {
      sx: 2,
      sy: 2,
      anchor: { x: 0, y: 0 },
    });
    expect(patch.size).toEqual({ width: 320, height: 200 });
  });

  it('scales a frame node the same way as sticky', () => {
    const node: BoardNode = {
      id: 'f1',
      type: 'frame',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 480, height: 320 },
      title: 'Frame',
      color: '#fff',
    };
    const patch = scaleNodeForGroupResize(node, rect(0, 0, 480, 320), {
      sx: 0.5,
      sy: 0.5,
      anchor: { x: 0, y: 0 },
    });
    expect(patch.size).toEqual({ width: 240, height: 160 });
  });

  it('enforces a minimum size floor (never collapses to zero/negative)', () => {
    const node: BoardNode = {
      id: 's1',
      type: 'sticky',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 200, height: 160 },
      text: 'hi',
      color: '#fff',
    };
    const patch = scaleNodeForGroupResize(node, rect(0, 0, 200, 160), {
      sx: 0.001,
      sy: 0.001,
      anchor: { x: 0, y: 0 },
    });
    const size = patch.size as { width: number; height: number };
    expect(size.width).toBeGreaterThanOrEqual(20);
    expect(size.height).toBeGreaterThanOrEqual(20);
  });

  it('scales a drawing node width/height AND its stored points proportionally', () => {
    const node: BoardNode = {
      id: 'd1',
      type: 'drawing',
      pos: { x: 0, y: 0 },
      order: 0,
      size: { width: 100, height: 80 },
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 40 },
        { x: 100, y: 80 },
      ],
      color: '#000',
      strokeWidth: 2,
    };
    const patch = scaleNodeForGroupResize(node, rect(0, 0, 100, 80), {
      sx: 2,
      sy: 2,
      anchor: { x: 0, y: 0 },
    });
    expect(patch.size).toEqual({ width: 200, height: 160 });
    expect(patch.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 80 },
      { x: 200, y: 160 },
    ]);
  });

  it('scales an emoji node UNIFORMLY (min of sx, sy) so the glyph stays square', () => {
    const node: BoardNode = {
      id: 'em1',
      type: 'emoji',
      pos: { x: 0, y: 0 },
      order: 0,
      text: '🎉',
      size: 64,
    };
    const patch = scaleNodeForGroupResize(node, rect(0, 0, 64, 64), {
      sx: 2,
      sy: 3,
      anchor: { x: 0, y: 0 },
    });
    // min(2, 3) = 2 -> 64 * 2 = 128
    expect(patch.size).toBe(128);
  });

  it('scales an icon node UNIFORMLY (min of sx, sy) so the glyph stays square', () => {
    const node: BoardNode = {
      id: 'i1',
      type: 'icon',
      pos: { x: 0, y: 0 },
      order: 0,
      name: 'star',
      size: 48,
      color: '#000',
    };
    const patch = scaleNodeForGroupResize(node, rect(0, 0, 48, 48), {
      sx: 0.5,
      sy: 0.25,
      anchor: { x: 0, y: 0 },
    });
    // min(0.5, 0.25) = 0.25 -> 48 * 0.25 = 12, floored to the 16px minimum.
    expect(patch.size).toBe(16);
  });

  it('moves a text node by position ONLY (no size field in the patch)', () => {
    const node: BoardNode = {
      id: 't1',
      type: 'text',
      pos: { x: 100, y: 100 },
      order: 0,
      text: 'label',
    };
    const patch = scaleNodeForGroupResize(node, rect(100, 100, 0, 0), {
      sx: 2,
      sy: 2,
      anchor: { x: 0, y: 0 },
    });
    expect(patch).toEqual({ pos: { x: 200, y: 200 } });
    expect(patch).not.toHaveProperty('size');
  });
});
