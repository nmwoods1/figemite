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
  renameDraft,
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
  /** When set, the user is viewing this history version (a snapshot id) on the
   * live board: "New draft" then forks THAT version instead of current Live. */
  fromVersion?: string;
}

type Pending = { kind: 'promote' | 'discard'; draft: DraftMeta } | null;

export default function LiveDraftMenu({
  slug,
  draftId,
  onOpenDraft,
  onExitDraft,
  fromVersion,
}: LiveDraftMenuProps) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  // Promote-only option: delete the draft after a successful promote. Unchecked
  // by default — a promoted draft is kept unless the user opts in.
  const [deleteAfterPromote, setDeleteAfterPromote] = useState(false);
  // Promote-only: an optional commit-style message recorded on the new Live
  // version (alongside the draft's title) in version history.
  const [promoteMessage, setPromoteMessage] = useState('');
  // Inline rename: which draft's title is being edited, and the working value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const renamingRef = useRef(false);
  // Re-entry guard for the promote/discard confirm action (see runPending).
  const runningRef = useRef(false);
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
      // When previewing an old version on Live, fork THAT version; otherwise
      // copy current Live (fromVersion is undefined).
      const id = await createDraft(slug, undefined, fromVersion);
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
    // Guard against a double-submit of a destructive confirm: `busy` disables
    // the button, but that state update is async, so a second synchronous click
    // (or a stray double-fire) could otherwise slip through and fire promote/
    // discard twice — the second hitting an already-deleted draft (a 404).
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setPendingError(null);
    try {
      if (pending.kind === 'promote')
        await promoteDraft(slug, pending.draft.id, deleteAfterPromote, promoteMessage.trim() || undefined);
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
      runningRef.current = false;
    }
  };

  const startEdit = (d: DraftMeta) => {
    setError(null);
    setEditingId(d.id);
    setEditValue(d.title);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };
  const commitEdit = async (d: DraftMeta) => {
    if (renamingRef.current) return;
    const title = editValue.trim();
    if (!title || title === d.title) {
      cancelEdit();
      return;
    }
    renamingRef.current = true;
    try {
      await renameDraft(slug, d.id, title);
      cancelEdit();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      renamingRef.current = false;
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
                  const isEditing = editingId === d.id;
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
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          aria-label={`Rename draft ${d.title}`}
                          onChange={(e) => setEditValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitEdit(d);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              cancelEdit();
                            }
                          }}
                          onBlur={() => void commitEdit(d)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#0f172a',
                            padding: '4px 6px',
                            border: '1.5px solid #6366f1',
                            borderRadius: 6,
                            outline: 'none',
                          }}
                        />
                      ) : (
                        <>
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
                            aria-label={`Rename draft ${d.title}`}
                            title="Rename"
                            onClick={() => startEdit(d)}
                            style={miniBtn}
                          >
                            ✎
                          </button>
                          <button
                            aria-label={`Promote draft ${d.title} to live`}
                            title="Promote to Live"
                            onClick={() => {
                              setPendingError(null);
                              setDeleteAfterPromote(false);
                              setPromoteMessage('');
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
                        </>
                      )}
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
            {busy ? 'Creating…' : fromVersion ? '+ New draft from this version' : '+ New draft'}
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
              ? `This overwrites the live board with "${pending.draft.title}". The live board's previous version stays in history, so you can roll back.`
              : `This permanently deletes the draft "${pending.draft.title}". The live board is not affected.`
          }
          confirmLabel={pending.kind === 'promote' ? 'Promote to live' : 'Discard'}
          tone={pending.kind === 'promote' ? 'primary' : 'danger'}
          busy={busy}
          error={pendingError}
          extra={
            pending.kind === 'promote' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, color: '#334155' }}>
                    Message <span style={{ color: '#94a3b8' }}>(optional)</span>
                  </span>
                  <textarea
                    value={promoteMessage}
                    disabled={busy}
                    onChange={(e) => setPromoteMessage(e.target.value)}
                    placeholder="What changed in this version?"
                    rows={2}
                    maxLength={500}
                    style={{
                      resize: 'vertical',
                      fontSize: 13,
                      padding: '6px 8px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontFamily: 'inherit',
                    }}
                  />
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: '#334155',
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteAfterPromote}
                    disabled={busy}
                    onChange={(e) => setDeleteAfterPromote(e.target.checked)}
                  />
                  Delete this draft after promotion
                </label>
              </div>
            ) : null
          }
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
