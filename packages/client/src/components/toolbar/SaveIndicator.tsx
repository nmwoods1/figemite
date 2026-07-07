// ── SaveIndicator ─────────────────────────────────────────────────────────────
//
// P5-T29: repurposed from the legacy/Phase-4 content-autosave status
// ('idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'locked' — see the
// removed `hooks/useAutosave.ts`) to the realtime PROVIDER's connection/sync
// status (`hooks/useSyncStatus.ts`'s `SyncStatus`). The server, not the
// client, now persists board content (P5-T28's `YjsWebsocketService`), so
// there is no client-side "save failed"/"retry" state anymore — a failed
// persist is a server-side concern with its own retry-on-next-edit behavior.
// What this indicator now answers is "is my view of the board live", i.e.
// connected + caught up with the room ('synced'), still connecting/
// resyncing ('connecting'), or disconnected ('offline').
import type { CSSProperties } from 'react';
import type { SyncStatus } from '../../hooks/useSyncStatus.js';

const DOT_BASE: CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const DOT_COLORS: Record<SyncStatus, string> = {
  connecting: '#f59e0b',
  synced: '#22c55e',
  offline: '#dc2626',
};

const DOT_LABELS: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  synced: 'All changes saved',
  offline: 'Offline — reconnecting…',
};

export interface SaveIndicatorProps {
  status: SyncStatus;
}

export function SaveIndicator({ status }: SaveIndicatorProps) {
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
      {status === 'offline' && 'Offline'}
    </span>
  );
}
