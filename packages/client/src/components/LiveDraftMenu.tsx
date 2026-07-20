// ── LiveDraftMenu ────────────────────────────────────────────────────────────
//
// The single draft control (dev mode only), embedded into the top-left
// Breadcrumb via its `draftControl` slot. Replaces the old top-right DraftsMenu
// AND the full-width DraftBanner. A pill shows "Live" on the prod board or the
// draft's title (amber) inside a draft; its dropdown lists drafts (each with a
// human-only Promote and Discard, behind ConfirmModal), a "New draft" button,
// and a "Live" row that doubles as the exit-to-live action.
//
// Promotion/discard are browser-only (no MCP tool) — that is what keeps them
// human-gated (see the server promote handler + AGENTS.md).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listDrafts,
  createDraft,
  promoteDraft,
  discardDraft,
  type DraftMeta,
} from '../lib/boards-api.js';
import ConfirmModal from './ConfirmModal.js';

interface LiveDraftMenuProps {
  slug: string;
  /** When set, the current route is editing this draft (pill shows its title). */
  draftId?: string;
  /** Open/switch into a draft of this board. */
  onOpenDraft: (draftId: string) => void;
  /** Leave the current draft back to the live board. */
  onExitDraft: () => void;
}

type Pending = { kind: 'promote' | 'discard'; draft: DraftMeta } | null;

export default function LiveDraftMenu({
  slug,
  draftId,
  onOpenDraft,
  onExitDraft,
}: LiveDraftMenuProps) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    listDrafts(slug)
      .then(setDrafts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [slug]);

  // Load whenever the dropdown opens, and eagerly when inside a draft (so the
  // pill can show the draft's title without the user opening the menu).
  useEffect(() => {
    if (open || draftId) refresh();
  }, [open, draftId, refresh]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, pending]);

  const currentDraft = draftId ? drafts?.find((d) => d.id === draftId) : undefined;
  const pillTitle = draftId ? (currentDraft?.title ?? draftId) : 'Live';

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createDraft(slug);
      setOpen(false);
      onOpenDraft(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runPending = async () => {
    if (!pending) return;
    setBusy(true);
    setPendingError(null);
    try {
      if (pending.kind === 'promote') await promoteDraft(slug, pending.draft.id);
      else await discardDraft(slug, pending.draft.id);
      const actedCurrent = pending.draft.id === draftId;
      setPending(null);
      setOpen(false);
      if (actedCurrent) onExitDraft();
      else refresh();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          fontSize: 12,
          fontWeight: 600,
          background: draftId ? '#fef3c7' : '#ecfdf5',
          color: draftId ? '#92400e' : '#065f46',
          border: `1px solid ${draftId ? '#fcd34d' : '#a7f3d0'}`,
          borderRadius: 7,
          cursor: 'pointer',
          maxWidth: 200,
        }}
        title={draftId ? 'Editing a draft' : 'You are on the live board'}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: draftId ? '#d97706' : '#10b981',
            flex: '0 0 auto',
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pillTitle}
        </span>
        <span style={{ fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: 300,
            background: '#fff',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 6,
            zIndex: 40,
          }}
        >
          {/* Live row — current on prod; the exit-to-live action inside a draft. */}
          <button
            onClick={() => {
              if (draftId) {
                setOpen(false);
                onExitDraft();
              }
            }}
            disabled={!draftId}
            aria-label={draftId ? 'Switch to Live' : 'Live (current)'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 10px',
              background: draftId ? '#fff' : '#ecfdf5',
              border: 'none',
              borderRadius: 8,
              cursor: draftId ? 'pointer' : 'default',
              textAlign: 'left',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Live</span>
              {!draftId && (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  Read-only · create a draft to edit
                </span>
              )}
            </span>
            {!draftId && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>current</span>
            )}
          </button>

          {drafts && drafts.length > 0 && (
            <>
              <div style={{ height: 1, background: '#f1f5f9', margin: '6px 4px' }} />
              <p style={{ margin: '2px 6px 6px', fontSize: 11, color: '#94a3b8' }}>Drafts</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {drafts.map((d) => {
                  const isCurrent = d.id === draftId;
                  return (
                    <div
                      key={d.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 6px 6px 10px',
                        background: isCurrent ? '#fffbeb' : 'transparent',
                        borderRadius: 8,
                      }}
                    >
                      <button
                        onClick={() => {
                          setOpen(false);
                          onOpenDraft(d.id);
                        }}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          flex: 1,
                          minWidth: 0,
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          padding: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#0f172a',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {d.title}
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          by {d.createdBy === 'agent' ? 'an agent' : 'a person'}
                          {isCurrent ? ' · current' : ''}
                        </span>
                      </button>
                      <button
                        aria-label={`Promote draft ${d.title} to live`}
                        title="Promote to Live"
                        onClick={() => {
                          setPendingError(null);
                          setPending({ kind: 'promote', draft: d });
                        }}
                        style={miniBtn}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Discard draft ${d.title}`}
                        title="Discard"
                        onClick={() => {
                          setPendingError(null);
                          setPending({ kind: 'discard', draft: d });
                        }}
                        style={{ ...miniBtn, color: '#dc2626' }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ height: 1, background: '#f1f5f9', margin: '6px 4px' }} />
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
            }}
          >
            {busy ? 'Creating…' : '+ New draft'}
          </button>

          {error && (
            <div style={{ padding: '6px 4px 2px', fontSize: 12, color: '#dc2626' }}>{error}</div>
          )}
          {drafts === null && !error && (
            <p style={{ padding: '6px 4px 2px', margin: 0, fontSize: 12, color: '#94a3b8' }}>
              Loading…
            </p>
          )}
        </div>
      )}

      {pending && (
        <ConfirmModal
          title={pending.kind === 'promote' ? 'Promote to live?' : 'Discard draft?'}
          body={
            pending.kind === 'promote'
              ? `This overwrites the live board with "${pending.draft.title}". The current live board is saved to history first, so you can roll back.`
              : `This permanently deletes the draft "${pending.draft.title}". The live board is not affected.`
          }
          confirmLabel={pending.kind === 'promote' ? 'Promote to live' : 'Discard'}
          tone={pending.kind === 'promote' ? 'primary' : 'danger'}
          busy={busy}
          error={pendingError}
          onConfirm={runPending}
          onCancel={() => {
            if (!busy) {
              setPending(null);
              setPendingError(null);
            }
          }}
        />
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  flex: '0 0 auto',
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  background: '#f8fafc',
  color: '#475569',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  cursor: 'pointer',
};
