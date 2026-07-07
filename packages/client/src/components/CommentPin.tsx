// ── CommentPin: a small pin/badge for a placed comment ───────────────────────
//
// Ported (visual design) from the legacy figmalade prototype's
// `src/components/CommentPin.tsx`: a teardrop-shaped bubble positioned at a
// given screen coordinate, showing the reply count and dimming when the
// comment is resolved. This rewrite's version is pure presentation — no
// internal open/close state, no portal — CommentLayer owns "which pin's
// thread is open" and renders `CommentThread` itself; this component only
// reports clicks via `onClick`.
import type { BoardComment } from '@easel/shared';

export interface CommentPinProps {
  comment: BoardComment;
  /** Screen-space x (pixels from left of the measured container). */
  screenX: number;
  /** Screen-space y (pixels from top of the measured container). */
  screenY: number;
  onClick: () => void;
}

export function CommentPin({ comment, screenX, screenY, onClick }: CommentPinProps) {
  const replyCount = comment.replies.length;
  const label = replyCount > 0 ? String(replyCount) : '';

  return (
    <div
      data-testid={`comment-pin-${comment.id}`}
      data-resolved={comment.resolved ? 'true' : 'false'}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        zIndex: 20,
        transform: 'translate(-50%, -100%)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50% 50% 50% 0',
          transform: 'rotate(-45deg)',
          background: comment.resolved ? '#94a3b8' : '#6366f1',
          opacity: comment.resolved ? 0.6 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          border: '2px solid #fff',
        }}
      >
        <span
          style={{
            transform: 'rotate(45deg)',
            fontSize: 9,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
