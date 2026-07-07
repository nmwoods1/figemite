// ── CommentThread: the expanded comment + replies view ───────────────────────
//
// Ported (structure/behavior, visual design kept close) from the legacy
// original prototype's `src/components/CommentThread.tsx`, rewired onto this
// rewrite's `useComments`-shaped callbacks (`onReply`/`onToggleResolved`/
// `onDelete`, all keyed by the comment's own id) instead of the legacy's
// bespoke mutate-and-persist closures, and a `readonly` prop (rather than
// importing `app/mode.ts`'s `READONLY` directly) so this stays pure
// presentation — CommentLayer decides whether write affordances show.
import { useState } from 'react';
import type { BoardComment } from '@figemite/shared';

export interface CommentThreadProps {
  comment: BoardComment;
  onReply: (commentId: string, text: string) => void;
  onToggleResolved: (commentId: string) => void;
  onDelete: (commentId: string) => void;
  onClose: () => void;
  readonly: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        flexShrink: 0,
        background: avatarColor(name),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        color: '#fff',
        userSelect: 'none',
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function CommentThread({
  comment,
  onReply,
  onToggleResolved,
  onDelete,
  onClose,
  readonly,
}: CommentThreadProps) {
  const [replyText, setReplyText] = useState('');

  const submitReply = () => {
    const text = replyText.trim();
    if (!text) return;
    onReply(comment.id, text);
    setReplyText('');
  };

  return (
    <div
      data-testid={`comment-thread-${comment.id}`}
      style={{
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
        border: '1px solid #e2e8f0',
        width: 280,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px 8px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {comment.resolved && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#16a34a',
                background: '#dcfce7',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              RESOLVED
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {!readonly && (
            <button
              type="button"
              onClick={() => onToggleResolved(comment.id)}
              aria-label={comment.resolved ? 'Reopen' : 'Resolve'}
              title={comment.resolved ? 'Reopen' : 'Resolve'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#64748b',
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              {comment.resolved ? '↩' : '✓'}
            </button>
          )}
          {!readonly && (
            <button
              type="button"
              onClick={() => {
                onDelete(comment.id);
                onClose();
              }}
              aria-label="Delete thread"
              title="Delete thread"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: '#94a3b8',
                padding: '2px 4px',
                borderRadius: 4,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: '#94a3b8',
              padding: '2px 4px',
              borderRadius: 4,
              lineHeight: 1,
            }}
          >
            –
          </button>
        </div>
      </div>

      {/* ── Root comment ───────────────────────────────────────────────── */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
        <Avatar name={comment.author} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 12 }}>
              {comment.author}
            </span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{formatTime(comment.createdAt)}</span>
          </div>
          <div style={{ color: '#334155', lineHeight: 1.5, wordBreak: 'break-word' }}>
            {comment.text}
          </div>
        </div>
      </div>

      {/* ── Replies ────────────────────────────────────────────────────── */}
      {comment.replies.length > 0 && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          {comment.replies.map((r) => (
            <div key={r.id} style={{ padding: '8px 12px', display: 'flex', gap: 8 }}>
              <Avatar name={r.author} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 12 }}>
                    {r.author}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>{formatTime(r.createdAt)}</span>
                </div>
                <div style={{ color: '#334155', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {r.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Reply input ────────────────────────────────────────────────── */}
      {!readonly && (
        <div
          style={{
            borderTop: '1px solid #f1f5f9',
            padding: '8px 10px',
            display: 'flex',
            gap: 6,
          }}
        >
          <textarea
            rows={2}
            placeholder="Reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitReply();
              }
            }}
            style={{
              flex: 1,
              fontSize: 12,
              padding: '5px 8px',
              resize: 'none',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              outline: 'none',
              fontFamily: 'inherit',
              color: '#0f172a',
            }}
          />
          <button
            type="button"
            onClick={submitReply}
            disabled={!replyText.trim()}
            style={{
              alignSelf: 'flex-end',
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              background: replyText.trim() ? '#0f172a' : '#e2e8f0',
              color: replyText.trim() ? '#fff' : '#94a3b8',
            }}
          >
            Reply
          </button>
        </div>
      )}
    </div>
  );
}
