// ── SaveIndicator ─────────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's `SaveIndicator`, adapted to the new
// `useAutosave`'s `SaveStatus` union ('idle' | 'dirty' | 'saving' | 'saved' |
// 'error' | 'locked' — see hooks/useAutosave.ts). The legacy only surfaced
// 'error' (with retry) and 'external' (a conflict state this codebase doesn't
// have — the doc-first store's autosave has no separate "changed elsewhere"
// signal); this port keeps that "stay quiet unless something needs
// attention" philosophy and adds a 'locked' state (another AI session holds
// the board's write lock) and a small dirty/saving dot for routine feedback,
// per this task's "reflecting idle/dirty/saving/saved/error/locked" spec.
import type { CSSProperties } from 'react';
import type { SaveStatus } from '../../hooks/useAutosave.js';

const DOT_BASE: CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const DOT_COLORS: Record<SaveStatus, string> = {
  idle: '#cbd5e1',
  dirty: '#f59e0b',
  saving: '#3b82f6',
  saved: '#22c55e',
  error: '#dc2626',
  locked: '#a855f7',
};

const DOT_LABELS: Record<SaveStatus, string> = {
  idle: 'No changes yet',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Save failed',
  locked: 'Board locked by another session',
};

export interface SaveIndicatorProps {
  status: SaveStatus;
  onRetry?: () => void;
}

export function SaveIndicator({ status, onRetry }: SaveIndicatorProps) {
  if (status === 'error') {
    return (
      <button
        type="button"
        style={{
          padding: '6px 12px',
          fontSize: 11,
          fontWeight: 500,
          border: '1px solid #fca5a5',
          borderRadius: 6,
          background: '#fef2f2',
          color: '#dc2626',
          cursor: 'pointer',
        }}
        onClick={onRetry}
        title="Retry save"
      >
        Save failed · Retry
      </button>
    );
  }

  return (
    <span
      data-testid="save-status-dot"
      title={DOT_LABELS[status]}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: '#64748b',
      }}
    >
      <span style={{ ...DOT_BASE, background: DOT_COLORS[status] }} />
      {status === 'locked' && 'Locked'}
    </span>
  );
}
