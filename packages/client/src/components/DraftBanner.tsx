// ── Draft banner ─────────────────────────────────────────────────────────────
//
// Shown while editing a DRAFT of a board (dev mode only). Makes the draft state
// unmistakable and hosts the human-only "Approve" action that overwrites prod
// with the draft, plus "Discard" and a plain "Back to board" exit.
//
// Approve is intentionally a browser-only action — there is no MCP tool for it,
// which is what keeps promotion human-gated (see the server's promote handler
// and AGENTS.md). Both Approve and Discard confirm first, since each is
// destructive to one side (prod, or the draft respectively).

import { useEffect, useState } from 'react';
import { listDrafts, promoteDraft, discardDraft, type DraftMeta } from '../lib/boards-api.js';

interface DraftBannerProps {
  slug: string;
  draftId: string;
  /** Called after approve/discard/exit to leave the draft back to the prod board. */
  onDone: () => void;
}

export default function DraftBanner({ slug, draftId, onDone }: DraftBannerProps) {
  const [meta, setMeta] = useState<DraftMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDrafts(slug)
      .then((drafts) => {
        if (!cancelled) setMeta(drafts.find((d) => d.id === draftId) ?? null);
      })
      .catch(() => {
        /* title is cosmetic — fall back to the id */
      });
    return () => {
      cancelled = true;
    };
  }, [slug, draftId]);

  const run = async (op: () => Promise<void>, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      await op();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const title = meta?.title ?? draftId;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#7c3aed',
        color: '#fff',
        fontFamily: 'Helvetica, Arial, sans-serif',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>Draft</span>
      <span style={{ fontSize: 13, opacity: 0.95, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {title}
        {meta?.createdBy === 'agent' ? ' · made by an agent' : ''}
      </span>
      <span style={{ flex: 1 }} />

      {error && <span style={{ fontSize: 12, color: '#fde68a' }}>{error}</span>}

      <button
        onClick={onDone}
        disabled={busy}
        style={ghostBtn}
        title="Leave the draft without changing it"
      >
        Back to board
      </button>
      <button
        onClick={() =>
          run(
            () => discardDraft(slug, draftId),
            `Discard draft "${title}"? This deletes the draft and cannot be undone. Prod is not affected.`,
          )
        }
        disabled={busy}
        style={ghostBtn}
      >
        Discard
      </button>
      <button
        onClick={() =>
          run(
            () => promoteDraft(slug, draftId),
            `Approve draft "${title}"? This overwrites the live board with the draft's content. Prod's current state is saved to history first.`,
          )
        }
        disabled={busy}
        style={{
          padding: '6px 14px',
          fontSize: 13,
          fontWeight: 700,
          background: '#fff',
          color: '#6d28d9',
          border: 'none',
          borderRadius: 7,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Working…' : 'Approve → prod'}
      </button>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  background: 'rgba(255,255,255,0.15)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.4)',
  borderRadius: 7,
  cursor: 'pointer',
};
