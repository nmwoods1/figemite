// ── CommentLayer: the comment placement + pin overlay ────────────────────────
//
// Rendered as a sibling of `<ReactFlow>` inside the same measured container
// (mirrors PresenceLayer/MultiSelectResizer's pattern — see those modules'
// docs). Two responsibilities:
//
//   1. PLACEMENT (comment mode only, and never in read-only mode): an
//      invisible full-pane overlay captures the next click. Hit-testing the
//      click against `nodes`' `nodeRect`s (topmost/last-in-array wins, same
//      as the legacy) decides whether the new comment targets that node
//      (`{ type: 'node', nodeId, offset }`, offset measured from the node's
//      CENTER so it tracks the node if it later moves/resizes) or the bare
//      canvas position (`{ type: 'canvas', pos }`). All screen<->flow math
//      goes through `canvas/coords.ts`'s `flowToScreen`/`screenToFlow` — the
//      one place that transform lives in this codebase (see that module's
//      doc) — rather than re-deriving it inline as the legacy prototype did.
//
//   2. PINS: every comment (regardless of comment mode) renders a
//      `CommentPin` at its target's screen position. Clicking a pin opens
//      its `CommentThread` (this component owns "which thread is open" —
//      exactly one at a time, closed by clicking elsewhere via the thread's
//      own close button).
//
// Identity gating: `lib/identity.ts`'s `hasStoredUser()` is checked before a
// placement click is allowed to open the new-comment text box — a first-time
// user (no stored name) sees `IdentityPrompt` first; once they confirm (or
// an already-returning user clicks), the SAME pending target proceeds to the
// text box. This mirrors the legacy CommentLayer's `awaitingIdentity`/
// `pendingTargetAfterAuth` flow.
//
// Mutations (`onAddComment`/`onReply`/`onToggleResolved`/`onDelete`) are
// passed in — this component doesn't know about `useComments` or
// `saveComments`; it only forwards user intent, keeping it pure enough to
// unit test without mocking the data layer (see CommentLayer.test.tsx).
import { useEffect, useRef, useState } from 'react';
import { useViewport } from '@xyflow/react';
import type { RefObject } from 'react';
import type { BoardComment, BoardNode, CommentTarget } from '@figemite/shared';
import { flowToScreen, getFlowPointer, nodeRect } from '../canvas/coords.js';
import { hasStoredUser } from '../lib/identity.js';
import { CommentPin } from './CommentPin.js';
import { CommentThread } from './CommentThread.js';
import IdentityPrompt from './IdentityPrompt.js';

export interface CommentLayerProps {
  comments: BoardComment[];
  nodes: BoardNode[];
  /** True while the toolbar's comment-mode toggle is active. */
  commentMode: boolean;
  /** Ref to the measured container (same element `<ReactFlow>` is mounted
   * inside) so clicks/pins can be positioned relative to its bounds. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** True in read-only mode — placement is disabled entirely (existing pins
   * still render, view-only: `CommentThread` itself hides write affordances). */
  readonly: boolean;
  onAddComment: (target: CommentTarget, text: string) => void;
  onReply: (commentId: string, text: string) => void;
  onToggleResolved: (commentId: string) => void;
  onDelete: (commentId: string) => void;
}

/** Lightweight inline form for a new comment's text, positioned at the click
 * point — ported (visual design) from the original prototype's
 * `NewCommentForm`. */
function NewCommentForm({
  screenX,
  screenY,
  onSubmit,
  onCancel,
}: {
  screenX: number;
  screenY: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: screenX + 14,
        top: screenY - 26,
        zIndex: 25,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.16)',
        border: '1px solid #e2e8f0',
        width: 260,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        rows={3}
        placeholder="Add a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 13,
          padding: '6px 8px',
          resize: 'none',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          outline: 'none',
          fontFamily: 'inherit',
          color: '#0f172a',
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#fff',
            color: '#64748b',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            borderRadius: 6,
            background: text.trim() ? '#0f172a' : '#e2e8f0',
            color: text.trim() ? '#fff' : '#94a3b8',
            cursor: text.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** The flow-space center of a node's rect (`nodeRect`'s x/y is its top-left). */
function nodeCenter(node: BoardNode): { x: number; y: number } {
  const rect = nodeRect(node);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Hit-tests a flow-space point against every node's rect, last-in-array
 * (topmost-painted) wins — mirrors the legacy's `hitTestNode`. A zero-size
 * rect (text nodes — see `nodeRect`'s doc) never matches, same as upstream. */
function hitTestNode(pos: { x: number; y: number }, nodes: BoardNode[]): BoardNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const rect = nodeRect(node);
    if (rect.width === 0 && rect.height === 0) continue;
    if (
      pos.x >= rect.x &&
      pos.x <= rect.x + rect.width &&
      pos.y >= rect.y &&
      pos.y <= rect.y + rect.height
    ) {
      return node;
    }
  }
  return null;
}

/** The flow-space screen position a comment's target resolves to: a canvas
 * target's `pos` directly, or a node target's center + offset (falling back
 * to the node's raw `pos` — an "orphaned" comment whose node was deleted —
 * so it never throws; BoardCanvas simply won't have that node to look up,
 * which surfaces as `undefined` here and skips rendering that pin). */
function targetFlowPos(target: CommentTarget, nodesById: Map<string, BoardNode>) {
  if (target.type === 'canvas') return target.pos;
  const node = nodesById.get(target.nodeId);
  if (!node) return null;
  const center = nodeCenter(node);
  const offset = target.offset ?? { x: 0, y: 0 };
  return { x: center.x + offset.x, y: center.y + offset.y };
}

export function CommentLayer({
  comments,
  nodes,
  commentMode,
  containerRef,
  readonly,
  onAddComment,
  onReply,
  onToggleResolved,
  onDelete,
}: CommentLayerProps) {
  const viewport = useViewport();
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{
    target: CommentTarget;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [awaitingIdentity, setAwaitingIdentity] = useState(false);
  const pendingTargetAfterAuth = useRef<{
    target: CommentTarget;
    screenX: number;
    screenY: number;
  } | null>(null);

  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const flowPos = getFlowPointer(e, rect, viewport);
    const hitNode = hitTestNode(flowPos, nodes);
    const target: CommentTarget = hitNode
      ? {
          type: 'node',
          nodeId: hitNode.id,
          offset: {
            x: flowPos.x - nodeCenter(hitNode).x,
            y: flowPos.y - nodeCenter(hitNode).y,
          },
        }
      : { type: 'canvas', pos: flowPos };
    const placement = { target, screenX: e.clientX, screenY: e.clientY };

    if (!hasStoredUser()) {
      pendingTargetAfterAuth.current = placement;
      setAwaitingIdentity(true);
      return;
    }
    setPendingTarget(placement);
  };

  const handleIdentityConfirm = () => {
    setAwaitingIdentity(false);
    const placement = pendingTargetAfterAuth.current;
    pendingTargetAfterAuth.current = null;
    if (placement) setPendingTarget(placement);
  };

  const handleIdentityCancel = () => {
    setAwaitingIdentity(false);
    pendingTargetAfterAuth.current = null;
  };

  const handleNewCommentSubmit = (text: string) => {
    if (!pendingTarget) return;
    onAddComment(pendingTarget.target, text);
    setPendingTarget(null);
  };

  return (
    <>
      {commentMode && !readonly && (
        <div
          data-testid="comment-placement-overlay"
          onClick={handleOverlayClick}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 15,
            cursor: 'crosshair',
          }}
        />
      )}

      {comments.map((comment) => {
        const flowPos = targetFlowPos(comment.target, nodesById);
        if (!flowPos) return null;
        const screenPos = flowToScreen(flowPos, viewport);
        return (
          <CommentPin
            key={comment.id}
            comment={comment}
            screenX={screenPos.x}
            screenY={screenPos.y}
            onClick={() => setOpenThreadId((id) => (id === comment.id ? null : comment.id))}
          />
        );
      })}

      {openThreadId &&
        (() => {
          const comment = comments.find((c) => c.id === openThreadId);
          if (!comment) return null;
          const flowPos = targetFlowPos(comment.target, nodesById);
          if (!flowPos) return null;
          const screenPos = flowToScreen(flowPos, viewport);
          return (
            <div
              style={{
                position: 'absolute',
                left: screenPos.x + 14,
                top: screenPos.y - 26,
                zIndex: 25,
              }}
            >
              <CommentThread
                comment={comment}
                onReply={onReply}
                onToggleResolved={onToggleResolved}
                onDelete={(id) => {
                  onDelete(id);
                  setOpenThreadId(null);
                }}
                onClose={() => setOpenThreadId(null)}
                readonly={readonly}
              />
            </div>
          );
        })()}

      {pendingTarget && (
        <NewCommentForm
          screenX={pendingTarget.screenX}
          screenY={pendingTarget.screenY}
          onSubmit={handleNewCommentSubmit}
          onCancel={() => setPendingTarget(null)}
        />
      )}

      {awaitingIdentity && (
        <IdentityPrompt onConfirm={handleIdentityConfirm} onCancel={handleIdentityCancel} />
      )}
    </>
  );
}
