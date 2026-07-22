// ── ConfirmModal ─────────────────────────────────────────────────────────────
//
// Generic confirmation dialog. Mirrors NewBoardModal's overlay pattern (fixed
// backdrop, click-outside + Escape to cancel, white rounded card). Used by
// LiveDraftMenu for the human-only Discard and Promote confirmations, replacing
// the old DraftBanner's window.confirm() calls.
import { useEffect } from 'react';
import type { ReactNode } from 'react';

export interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** Tone of the confirm button — 'danger' (red) for destructive actions. */
  tone?: 'primary' | 'danger';
  /** While true, the confirm button is disabled and shows a busy label. */
  busy?: boolean;
  /** Inline error surfaced under the body (e.g. a failed API call). */
  error?: string | null;
  /** Optional extra content rendered between the body and the action buttons —
   * e.g. an opt-in checkbox for a per-action option. */
  extra?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  body,
  confirmLabel,
  tone = 'primary',
  busy = false,
  error = null,
  extra = null,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const confirmBg = tone === 'danger' ? '#dc2626' : '#0f172a';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          width: '100%',
          maxWidth: 400,
          padding: '24px 24px 20px',
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
          {title}
        </h2>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{body}</p>

        {extra && <div style={{ marginBottom: 16 }}>{extra}</div>}

        {error && (
          <div
            style={{
              marginBottom: 14,
              padding: '9px 12px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              fontSize: 13,
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 500,
              background: '#fff',
              color: '#374151',
              border: '1.5px solid #e2e8f0',
              borderRadius: 8,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: confirmBg,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
