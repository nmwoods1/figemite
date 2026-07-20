// ── Drafts menu ──────────────────────────────────────────────────────────────
//
// Shown on a prod board's root canvas (dev mode only). Lets a user create a new
// draft of the board or open an existing one. A draft is a full, editable copy
// of the board that syncs live like any board; a human later approves it (via
// the DraftBanner) to overwrite prod. Agents create drafts too (over MCP) and
// they appear here alongside human-made ones.
//
// Styling mirrors the inline-style idiom used across the client (Dashboard,
// NewBoardModal): no CSS modules, Helvetica, the same slate palette.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listDrafts, createDraft, type DraftMeta } from '../lib/boards-api.js';

interface DraftsMenuProps {
  slug: string;
  onOpenDraft: (draftId: string) => void;
}

export default function DraftsMenu({ slug, onOpenDraft }: DraftsMenuProps) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    listDrafts(slug)
      .then(setDrafts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [slug]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createDraft(slug);
      onOpenDraft(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 20,
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          background: '#fff',
          color: '#0f172a',
          border: '1.5px solid #e2e8f0',
          borderRadius: 8,
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        Drafts {drafts && drafts.length > 0 ? `(${drafts.length})` : ''} ▾
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            width: 280,
            background: '#fff',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 8,
          }}
        >
          <button
            onClick={handleCreate}
            disabled={busy}
            style={{
              width: '100%',
              padding: '9px 12px',
              fontSize: 13,
              fontWeight: 600,
              background: '#0f172a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
              marginBottom: 8,
            }}
          >
            {busy ? 'Creating…' : '+ New draft'}
          </button>

          {error && (
            <div style={{ padding: '6px 4px', fontSize: 12, color: '#dc2626' }}>{error}</div>
          )}

          {drafts === null && (
            <p style={{ padding: '6px 4px', margin: 0, fontSize: 12, color: '#94a3b8' }}>Loading…</p>
          )}
          {drafts && drafts.length === 0 && (
            <p style={{ padding: '6px 4px', margin: 0, fontSize: 12, color: '#94a3b8' }}>
              No drafts yet. Create one to edit safely without touching the live board.
            </p>
          )}
          {drafts && drafts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {drafts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onOpenDraft(d.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    padding: '8px 10px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{d.title}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    by {d.createdBy === 'agent' ? 'an agent' : 'a person'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
