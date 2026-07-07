// ── HistoryPanel: version-history list (time-travel, P6-T36) ────────────────
//
// Ported (visual design + affordances) from the legacy figmalade prototype's
// `src/components/HistoryPanel.tsx`, adapted to take plain data
// (`versions`/`loading`) and callbacks (`onSelect`/`onClose`) rather than
// fetching `/api/history` itself — matching this codebase's existing split
// between a data hook (hooks/useHistory.ts owns the fetch + preview/restore/
// discard state machine) and a pure-render panel (ActiveUsersPanel.tsx is the
// closest analog: usePresence.ts owns state, the panel just renders props).
//
// Snapshot triggers: 'save' (a plain autosave/edit snapshot) renders as
// "Human"; 'preai'/'ai' are the AI-session boundary snapshots (the state
// right before an AI session started editing, and right after it finished) —
// both render an "AI" chip, with a distinguishing sub-label ("Before AI
// changes" / "After AI changes") so the two AI-boundary triggers read
// distinctly from each other, not just from 'save'.
import { useEffect, useRef } from 'react';
import type { HistoryVersion } from '../lib/boards-api.js';

export interface HistoryPanelProps {
  versions: HistoryVersion[];
  loading: boolean;
  error?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatAbsolute(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

const CHIP_HUMAN: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background: '#dbeafe',
  color: '#1d4ed8',
  marginLeft: 6,
  letterSpacing: '0.02em',
  flexShrink: 0,
};

const CHIP_AI: React.CSSProperties = {
  ...CHIP_HUMAN,
  background: '#fef3c7',
  color: '#92400e',
};

const SUB_LABEL: React.CSSProperties = {
  fontSize: 10,
  color: '#94a3b8',
  marginTop: 1,
};

export function HistoryPanel({ versions, loading, error, onSelect, onClose }: HistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        bottom: 60,
        right: 12,
        zIndex: 100,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        minWidth: 280,
        maxWidth: 340,
        maxHeight: 420,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #f1f5f9',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Version history</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 4px',
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      <div style={{ overflowY: 'auto', flexGrow: 1 }}>
        {loading && (
          <div
            style={{ padding: '20px 14px', color: '#64748b', fontSize: 12, textAlign: 'center' }}
          >
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: '20px 14px', color: '#dc2626', fontSize: 12 }}>{error}</div>
        )}
        {!loading && !error && versions.length === 0 && (
          <div
            style={{ padding: '20px 14px', color: '#94a3b8', fontSize: 12, textAlign: 'center' }}
          >
            No history yet
          </div>
        )}
        {!loading &&
          !error &&
          versions.map((v, i) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              title={formatAbsolute(v.timestamp)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                borderBottom: i < versions.length - 1 ? '1px solid #f8fafc' : 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 12, color: '#334155' }}>
                  {i === 0 ? <span style={{ fontWeight: 600 }}>Latest — </span> : null}
                  {relativeTime(v.timestamp)}
                </span>
                {v.trigger !== 'save' && (
                  <span style={SUB_LABEL}>
                    {v.trigger === 'preai' ? 'Before AI changes' : 'After AI changes'}
                  </span>
                )}
              </span>
              <span style={v.trigger === 'save' ? CHIP_HUMAN : CHIP_AI}>
                {v.trigger === 'save' ? 'Human' : 'AI'}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
