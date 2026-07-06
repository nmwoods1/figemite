// The 4 directional connection handles (top/right/bottom/left) shared by
// every node type that can be an edge endpoint. Ported from the identical
// 4-`<Handle>` block copy-pasted across StickyNode/ShapeNode/EmojiNode/
// IconNode in the legacy prototype.
//
// CRITICAL: the handle ELEMENTS must exist in the DOM at all times, even on a
// read-only board — ReactFlow measures each handle's position to compute
// `handleBounds`, and `getEdgePosition` (error #008) fails to route edges if
// a node has no handles. So `interactive` gates the handles' BEHAVIOUR
// (`isConnectable`) and visibility, NOT their existence. A read-only board
// renders all four handles but non-connectable + visually hidden.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RfTestHarness } from '../test/rf.js';
import { ConnectionHandles } from './ConnectionHandles.js';

afterEach(() => {
  cleanup();
});

function renderHandles(props: Partial<React.ComponentProps<typeof ConnectionHandles>> = {}) {
  return render(
    <RfTestHarness>
      <ConnectionHandles interactive {...props} />
    </RfTestHarness>,
  );
}

describe('ConnectionHandles', () => {
  it('renders 4 handles (top/right/bottom/left) when interactive', () => {
    const { container } = renderHandles({ interactive: true });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
  });

  it('still renders all 4 handles when NOT interactive (so ReactFlow can measure them and route edges)', () => {
    const { container } = renderHandles({ interactive: false });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
  });

  it('makes handles connectable when interactive', () => {
    const { container } = renderHandles({ interactive: true });
    const handles = container.querySelectorAll('.react-flow__handle');
    for (const handle of handles) {
      // RF adds the `connectable` class only when isConnectable is true.
      expect(handle.classList.contains('connectable')).toBe(true);
    }
  });

  it('makes handles non-connectable and visually hidden when NOT interactive (read-only)', () => {
    const { container } = renderHandles({ interactive: false });
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles).toHaveLength(4);
    for (const handle of handles) {
      expect(handle.classList.contains('connectable')).toBe(false);
      const el = handle as HTMLElement;
      expect(el.style.opacity).toBe('0');
      expect(el.style.pointerEvents).toBe('none');
    }
  });

  it('uses default bbox-edge-midpoint anchors by default', () => {
    const { container } = renderHandles({ interactive: true });
    const handles = container.querySelectorAll('.react-flow__handle');
    // Default (non-anchored) handles rely on ReactFlow's Position-based CSS
    // classes rather than explicit left/top inline styles.
    for (const handle of handles) {
      expect((handle as HTMLElement).style.left).toBe('');
      expect((handle as HTMLElement).style.top).toBe('');
    }
  });

  it('applies explicit vertex anchors when provided (e.g. ShapeNode diamond)', () => {
    const anchors = {
      t: { x: 50, y: 1 },
      r: { x: 99, y: 40 },
      b: { x: 50, y: 79 },
      l: { x: 1, y: 40 },
    };
    const { container } = renderHandles({ interactive: true, anchors });
    const top = container.querySelector('[data-handleid="t"]') as HTMLElement;
    expect(top.style.left).toBe('50px');
    expect(top.style.top).toBe('1px');
  });
});
