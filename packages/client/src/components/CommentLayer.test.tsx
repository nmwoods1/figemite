// ── CommentLayer tests ────────────────────────────────────────────────────────
//
// The comment overlay — a sibling of `<ReactFlow>` inside the same measured
// container (mirrors PresenceLayer/MultiSelectResizer's pattern: rendered
// inside a real `<ReactFlow>` so `useViewport()` resolves, with the container
// element's `getBoundingClientRect` stubbed for deterministic screen-space
// math). In COMMENT MODE, a click on empty canvas targets a canvas position
// (via `screenToFlow`/`getFlowPointer`); a click that hits a node's rect
// targets that node instead — either way, a small inline text box appears
// (mirrors the legacy's `NewCommentForm`) and submitting it calls
// `onAddComment(target, text)`. Pins render at their computed screen
// position (canvas target -> `flowToScreen`; node target -> `nodeRect` +
// offset, then `flowToScreen`). Not in comment mode, or in read-only mode,
// clicks never place a comment (read-only still shows existing pins,
// view-only).
//
// Ported behavior (hit-testing a click against node rects, offsetting from
// node center) from the original prototype's
// `src/components/CommentLayer.tsx`, rewired onto `canvas/coords.ts`'s shared
// `flowToScreen`/`screenToFlow`/`nodeRect` (this rewrite's one source of that
// math) and this rewrite's `useComments`-shaped mutation callbacks instead of
// the legacy's local `comment-io.ts` mutate-and-persist helpers.

import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import type { BoardComment, BoardNode } from '@figemite/shared';
import { CommentLayer } from './CommentLayer.js';

const identityMock = vi.hoisted(() => ({
  hasStoredUser: vi.fn(),
  setLocalUser: vi.fn(),
}));
vi.mock('../lib/identity.js', () => identityMock);

afterEach(() => {
  cleanup();
});

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

function fixtureComment(overrides: Partial<BoardComment> = {}): BoardComment {
  return {
    id: 'comment1',
    target: { type: 'canvas', pos: { x: 50, y: 60 } },
    author: 'Ada',
    createdAt: '2024-01-01T00:00:00.000Z',
    text: 'hello',
    resolved: false,
    replies: [],
    ...overrides,
  };
}

function renderLayer({
  comments = [] as BoardComment[],
  nodes = [] as BoardNode[],
  commentMode = true,
  readonly = false,
  onAddComment = vi.fn(),
  onReply = vi.fn(),
  onToggleResolved = vi.fn(),
  onDelete = vi.fn(),
  viewport = { x: 0, y: 0, zoom: 1 },
} = {}) {
  const containerRef = createRef<HTMLDivElement>();
  const utils = render(
    <div ref={containerRef} style={{ width: 800, height: 600, position: 'relative' }}>
      <ReactFlow nodes={[]} edges={[]} defaultViewport={viewport}>
        <CommentLayer
          comments={comments}
          nodes={nodes}
          commentMode={commentMode}
          containerRef={containerRef}
          readonly={readonly}
          onAddComment={onAddComment}
          onReply={onReply}
          onToggleResolved={onToggleResolved}
          onDelete={onDelete}
        />
      </ReactFlow>
    </div>,
  );
  vi.spyOn(containerRef.current as HTMLDivElement, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON() {},
  });
  return { ...utils, containerRef, onAddComment, onReply, onToggleResolved, onDelete };
}

describe('CommentLayer', () => {
  beforeEach(() => {
    identityMock.hasStoredUser.mockReset().mockReturnValue(true);
  });

  describe('placement in comment mode', () => {
    it('clicking empty canvas opens a new-comment box; submitting places a canvas-target comment', () => {
      const { onAddComment } = renderLayer({ commentMode: true, nodes: [] });
      const overlay = screen.getByTestId('comment-placement-overlay');
      fireEvent.click(overlay, { clientX: 100, clientY: 50 });

      fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
        target: { value: 'new comment text' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(onAddComment).toHaveBeenCalledWith(
        { type: 'canvas', pos: { x: 100, y: 50 } },
        'new comment text',
      );
    });

    it('clicking a node targets it with an offset from center; submitting places a node-target comment', () => {
      const nodes = [sticky('s1', 0, 0, 100, 80)];
      const { onAddComment } = renderLayer({ commentMode: true, nodes });
      const overlay = screen.getByTestId('comment-placement-overlay');
      // Node center at (50, 40); click at (60, 40) -> offset (10, 0).
      fireEvent.click(overlay, { clientX: 60, clientY: 40 });

      fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
        target: { value: 'on the node' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(onAddComment).toHaveBeenCalledWith(
        { type: 'node', nodeId: 's1', offset: { x: 10, y: 0 } },
        'on the node',
      );
    });

    it('accounts for a non-identity viewport when placing a canvas comment', () => {
      const { onAddComment } = renderLayer({
        commentMode: true,
        nodes: [],
        viewport: { x: 20, y: 10, zoom: 2 },
      });
      const overlay = screen.getByTestId('comment-placement-overlay');
      fireEvent.click(overlay, { clientX: 120, clientY: 110 });
      fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
        target: { value: 'text' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      // screenToFlow({x:120,y:110}, {x:20,y:10,zoom:2}) = {x:50,y:50}
      expect(onAddComment).toHaveBeenCalledWith({ type: 'canvas', pos: { x: 50, y: 50 } }, 'text');
    });

    it('does not call onAddComment while the new-comment text box is empty', () => {
      const { onAddComment } = renderLayer({ commentMode: true });
      const overlay = screen.getByTestId('comment-placement-overlay');
      fireEvent.click(overlay, { clientX: 100, clientY: 50 });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it('cancelling the new-comment box discards the pending target', () => {
      const { onAddComment } = renderLayer({ commentMode: true });
      const overlay = screen.getByTestId('comment-placement-overlay');
      fireEvent.click(overlay, { clientX: 100, clientY: 50 });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument();
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it('prompts for identity before opening the new-comment box when no name is stored', () => {
      identityMock.hasStoredUser.mockReturnValue(false);
      const { onAddComment } = renderLayer({ commentMode: true });
      const overlay = screen.getByTestId('comment-placement-overlay');
      fireEvent.click(overlay, { clientX: 100, clientY: 50 });

      expect(screen.getByText(/who are you/i)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument();
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it('opens the new-comment box after confirming identity', () => {
      identityMock.hasStoredUser.mockReturnValue(false);
      renderLayer({ commentMode: true });
      const overlay = screen.getByTestId('comment-placement-overlay');
      fireEvent.click(overlay, { clientX: 100, clientY: 50 });

      fireEvent.change(screen.getByPlaceholderText(/your name/i), {
        target: { value: 'Grace' },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      expect(screen.getByPlaceholderText(/add a comment/i)).toBeInTheDocument();
    });
  });

  describe('not in comment mode', () => {
    it('does not render a placement overlay, so clicks never place a comment', () => {
      const { onAddComment } = renderLayer({ commentMode: false });
      expect(screen.queryByTestId('comment-placement-overlay')).not.toBeInTheDocument();
      expect(onAddComment).not.toHaveBeenCalled();
    });
  });

  describe('pin rendering', () => {
    it('renders a pin for a canvas-target comment at flowToScreen(pos, viewport)', () => {
      const comments = [fixtureComment({ target: { type: 'canvas', pos: { x: 50, y: 60 } } })];
      renderLayer({ comments, commentMode: false, viewport: { x: 10, y: 5, zoom: 2 } });
      const pin = screen.getByTestId('comment-pin-comment1');
      // flowToScreen({x:50,y:60}, {x:10,y:5,zoom:2}) = {x:110, y:125}
      expect(pin.style.left).toBe('110px');
      expect(pin.style.top).toBe('125px');
    });

    it('renders a pin for a node-target comment at its nodeRect + offset', () => {
      const nodes = [sticky('s1', 0, 0, 100, 80)];
      const comments = [
        fixtureComment({ target: { type: 'node', nodeId: 's1', offset: { x: 10, y: 0 } } }),
      ];
      renderLayer({ comments, nodes, commentMode: false, viewport: { x: 0, y: 0, zoom: 1 } });
      const pin = screen.getByTestId('comment-pin-comment1');
      // node center (50,40) + offset (10,0) = (60,40); identity viewport.
      expect(pin.style.left).toBe('60px');
      expect(pin.style.top).toBe('40px');
    });

    it('clicking a pin opens its thread', () => {
      const comments = [fixtureComment()];
      renderLayer({ comments, commentMode: false });
      fireEvent.click(screen.getByTestId('comment-pin-comment1'));
      expect(screen.getByTestId('comment-thread-comment1')).toBeInTheDocument();
    });
  });

  describe('read-only mode', () => {
    it('still renders existing pins', () => {
      const comments = [fixtureComment()];
      renderLayer({ comments, commentMode: false, readonly: true });
      expect(screen.getByTestId('comment-pin-comment1')).toBeInTheDocument();
    });

    it('never places a comment even if commentMode is somehow true', () => {
      const { onAddComment } = renderLayer({ commentMode: true, readonly: true });
      expect(screen.queryByTestId('comment-placement-overlay')).not.toBeInTheDocument();
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it('opened thread hides write affordances', () => {
      const comments = [fixtureComment()];
      renderLayer({ comments, commentMode: false, readonly: true });
      fireEvent.click(screen.getByTestId('comment-pin-comment1'));
      expect(screen.queryByPlaceholderText(/reply/i)).not.toBeInTheDocument();
    });
  });
});
