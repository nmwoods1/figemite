// ── PresenceLayer tests ──────────────────────────────────────────────────────
//
// P5-T30. Renders remote cursors (arrow + name pill, colored via
// `RemotePresence.user.color`) and editing outlines (a colored rect around
// the node named by `editingNodeId`) over the canvas, positioned via
// `canvas/coords.ts`'s `flowToScreen`/`nodeRect` — the SAME transform every
// other overlay in this codebase uses (MultiSelectResizer, the toolbar's
// viewCenter, etc.) — rather than re-deriving the screen<->flow math inline
// (which is what the original prototype PresenceLayer did).
//
// `useViewport()` (from `@xyflow/react`) needs a real `<ReactFlow>` render
// context, so tests mount inside one with a fixed `defaultViewport`, mirroring
// canvas/MultiSelectResizer.test.tsx's harness.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import type { BoardNode } from '@figemite/shared';
import type { RemotePresence } from '../hooks/usePresence.js';
import { PresenceLayer } from './PresenceLayer.js';

afterEach(() => {
  cleanup();
});

function remote(overrides: Partial<RemotePresence> = {}): RemotePresence {
  return {
    clientId: 2,
    user: { name: 'Grace', color: '#22c55e' },
    cursor: null,
    editingNodeId: null,
    viewport: null,
    isAI: false,
    ...overrides,
  };
}

function sticky(id: string, x: number, y: number, width = 100, height = 80): BoardNode {
  return {
    id,
    type: 'sticky',
    pos: { x, y },
    order: 0,
    size: { width, height },
    text: '',
    color: '#fff',
  };
}

function renderLayer(
  remotes: RemotePresence[],
  nodes: BoardNode[] = [],
  viewport = { x: 0, y: 0, zoom: 1 },
) {
  return render(
    <ReactFlow nodes={[]} edges={[]} defaultViewport={viewport}>
      <PresenceLayer remotes={remotes} nodes={nodes} />
    </ReactFlow>,
  );
}

describe('PresenceLayer', () => {
  it('renders nothing when there are no remotes', () => {
    const { container } = renderLayer([]);
    expect(container.querySelectorAll('[data-testid="presence-cursor"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="presence-outline"]')).toHaveLength(0);
  });

  it('renders nothing for a remote with no cursor and no editingNodeId', () => {
    const { container } = renderLayer([remote()]);
    expect(container.querySelectorAll('[data-testid="presence-cursor"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="presence-outline"]')).toHaveLength(0);
  });

  describe('cursor rendering', () => {
    it('renders a cursor at the position given by flowToScreen(cursor, viewport)', () => {
      const { container } = renderLayer([remote({ cursor: { x: 100, y: 50 } })], [], {
        x: 20,
        y: 10,
        zoom: 2,
      });
      const cursor = container.querySelector('[data-testid="presence-cursor"]') as HTMLElement;
      expect(cursor).toBeTruthy();
      // flowToScreen({x:100,y:50}, {x:20,y:10,zoom:2}) = { x: 220, y: 110 }
      expect(cursor.style.left).toBe('220px');
      expect(cursor.style.top).toBe('110px');
    });

    it('renders the cursor at the identity viewport when zoom is 1 and pan is 0', () => {
      const { container } = renderLayer([remote({ cursor: { x: 42, y: 84 } })]);
      const cursor = container.querySelector('[data-testid="presence-cursor"]') as HTMLElement;
      expect(cursor.style.left).toBe('42px');
      expect(cursor.style.top).toBe('84px');
    });

    it('shows the remote user name in the cursor label', () => {
      const { getByText } = renderLayer([remote({ cursor: { x: 0, y: 0 } })]);
      expect(getByText('Grace')).toBeTruthy();
    });

    it('colors the cursor label with the user color', () => {
      const { container } = renderLayer([
        remote({ cursor: { x: 0, y: 0 }, user: { name: 'Grace', color: '#22c55e' } }),
      ]);
      const label = container.querySelector('[data-testid="presence-cursor-label"]') as HTMLElement;
      expect(label.style.background).toBe('rgb(34, 197, 94)'); // #22c55e
    });

    it('does not render a cursor for a remote whose cursor is null', () => {
      const { container } = renderLayer([remote({ cursor: null })]);
      expect(container.querySelectorAll('[data-testid="presence-cursor"]')).toHaveLength(0);
    });

    it('renders cursors for multiple remotes', () => {
      const { container } = renderLayer([
        remote({ clientId: 2, cursor: { x: 0, y: 0 } }),
        remote({ clientId: 3, cursor: { x: 10, y: 10 }, user: { name: 'Alan', color: '#ef4444' } }),
      ]);
      expect(container.querySelectorAll('[data-testid="presence-cursor"]')).toHaveLength(2);
    });

    it('shows a distinct AI badge and the agentClient for an isAI presence', () => {
      const { container, getByText } = renderLayer([
        remote({
          cursor: { x: 0, y: 0 },
          user: { name: 'agent-01', color: '#8b5cf6' },
          isAI: true,
          agentClient: 'claude-code',
        }),
      ]);
      expect(container.querySelector('[data-testid="presence-ai-badge"]')).toBeTruthy();
      expect(getByText(/claude-code/)).toBeTruthy();
    });

    it('does not show an AI badge for a human presence', () => {
      const { container } = renderLayer([remote({ cursor: { x: 0, y: 0 }, isAI: false })]);
      expect(container.querySelector('[data-testid="presence-ai-badge"]')).toBeNull();
    });
  });

  describe('editing outline rendering', () => {
    it('renders an outline around the node named by editingNodeId, at its nodeRect', () => {
      const nodes = [sticky('s1', 10, 20, 200, 100)];
      const { container } = renderLayer([remote({ editingNodeId: 's1' })], nodes, {
        x: 0,
        y: 0,
        zoom: 1,
      });
      const outline = container.querySelector('[data-testid="presence-outline"]') as HTMLElement;
      expect(outline).toBeTruthy();
      // nodeRect: {x:10,y:20,width:200,height:100}; flowToScreen at identity
      // viewport, then a fixed 3px/6px visual padding around the node (ported
      // from the legacy's outline styling) so the border doesn't sit flush
      // against the node's own edge.
      expect(outline.style.left).toBe('7px');
      expect(outline.style.top).toBe('17px');
      expect(outline.style.width).toBe('206px');
      expect(outline.style.height).toBe('106px');
    });

    it('projects the outline through a non-identity viewport', () => {
      const nodes = [sticky('s1', 0, 0, 100, 50)];
      const { container } = renderLayer([remote({ editingNodeId: 's1' })], nodes, {
        x: 5,
        y: 5,
        zoom: 2,
      });
      const outline = container.querySelector('[data-testid="presence-outline"]') as HTMLElement;
      // flowToScreen({x:0,y:0}, vp) = {x:5,y:5}; width/height scale by zoom;
      // then the same 3px/6px visual padding as above.
      expect(outline.style.left).toBe('2px');
      expect(outline.style.top).toBe('2px');
      expect(outline.style.width).toBe('206px');
      expect(outline.style.height).toBe('106px');
    });

    it('colors the outline border with the user color', () => {
      const nodes = [sticky('s1', 0, 0)];
      const { container } = renderLayer(
        [remote({ editingNodeId: 's1', user: { name: 'Grace', color: '#22c55e' } })],
        nodes,
      );
      const outline = container.querySelector('[data-testid="presence-outline"]') as HTMLElement;
      expect(outline.style.borderColor).toBe('rgb(34, 197, 94)');
    });

    it('renders nothing when editingNodeId references a node that does not exist', () => {
      const { container } = renderLayer([remote({ editingNodeId: 'missing' })], []);
      expect(container.querySelectorAll('[data-testid="presence-outline"]')).toHaveLength(0);
    });

    it('renders nothing when editingNodeId is null', () => {
      const nodes = [sticky('s1', 0, 0)];
      const { container } = renderLayer([remote({ editingNodeId: null })], nodes);
      expect(container.querySelectorAll('[data-testid="presence-outline"]')).toHaveLength(0);
    });

    it('renders both a cursor and an outline for the same remote', () => {
      const nodes = [sticky('s1', 0, 0)];
      const { container } = renderLayer(
        [remote({ editingNodeId: 's1', cursor: { x: 5, y: 5 } })],
        nodes,
      );
      expect(container.querySelectorAll('[data-testid="presence-cursor"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-testid="presence-outline"]')).toHaveLength(1);
    });
  });

  it('does not intercept pointer events (overlay is click-through)', () => {
    const { container } = renderLayer([remote({ cursor: { x: 0, y: 0 } })]);
    const overlay = container.querySelector('[data-testid="presence-layer"]') as HTMLElement;
    expect(overlay.style.pointerEvents).toBe('none');
  });
});
