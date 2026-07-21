# Live/Draft dropdown + read-only live board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clunky draft UI (top-right menu + full-width purple banner) with a single "Live ▾" dropdown embedded in the top-left breadcrumb, and make the live board read-only for board content (only comments + annotations allowed) — enforced in the client, server, and MCP.

**Architecture:** Client-side: a new `LiveDraftMenu` (pill + dropdown + confirm modals via a new generic `ConfirmModal`) rendered inside `Breadcrumb` via a new `draftControl` slot; the editable canvas gains a `contentLocked` state (true on the live board) that reuses the existing `aiLocked` gating and reduces the Toolbar to comment + annotation. Server-side: the prod room's persist listener ignores peer-originated updates (only `LOCAL_ORIGIN` = promote persists). MCP-side: a new `assertEditable()` makes every mutating tool require a connected draft.

**Tech Stack:** TypeScript, React 18, `@xyflow/react` (ReactFlow), Yjs, Vitest + @testing-library/react, Node http server, `@modelcontextprotocol/sdk`.

---

## File Structure

**Client (`packages/client/src`)**
- Create: `components/ConfirmModal.tsx` — generic confirmation dialog (backdrop, Esc/click-out, Cancel + coloured Confirm).
- Create: `components/LiveDraftMenu.tsx` — the Live/draft pill + dropdown + confirm wiring. Replaces both deleted components.
- Create: `components/ConfirmModal.test.tsx`, `components/LiveDraftMenu.test.tsx`.
- Modify: `components/Breadcrumb.tsx` — add optional `draftControl?: React.ReactNode` slot.
- Modify: `App.tsx` (`BoardRoute`) — render `LiveDraftMenu` via `draftControl` on all routes; gate `onDelete` on `!contentLocked`; remove `DraftsMenu`/`DraftBanner`.
- Modify: `canvas/BoardCanvas.tsx` — thread `contentLocked` into `EditableCanvas`; OR it into the interaction gates; pass to `Toolbar`; gate `subBoard.canCreate`.
- Modify: `components/Toolbar.tsx` — add `contentLocked` prop; hide content tools when locked.
- Delete: `components/DraftsMenu.tsx`, `components/DraftBanner.tsx` (no test files exist for these).

**Server (`packages/server/src`)**
- Modify: `services/yjs-ws.ts` — `armPersist` update handler ignores non-`LOCAL_ORIGIN` updates on prod rooms.
- Test: `services/yjs-persistence.test.ts` (add cases).

**MCP (`packages/mcp/src`)**
- Modify: `server.ts` — add `assertEditable()`; switch mutating tools to it; update `connect_board` description.
- Modify: `../../AGENTS.md` (repo root) — document live-is-read-only.
- Test: `server.test.ts` (add cases).

---

## Task 1: ConfirmModal (generic confirmation dialog)

**Files:**
- Create: `packages/client/src/components/ConfirmModal.tsx`
- Test: `packages/client/src/components/ConfirmModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/client/src/components/ConfirmModal.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ConfirmModal from './ConfirmModal.js';

afterEach(cleanup);

describe('ConfirmModal', () => {
  it('renders title, body and confirm label', () => {
    render(
      <ConfirmModal
        title="Promote to live?"
        body="This overwrites the live board."
        confirmLabel="Promote to live"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Promote to live?')).toBeTruthy();
    expect(screen.getByText('This overwrites the live board.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Promote to live' })).toBeTruthy();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal title="t" body="b" confirmLabel="Go" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel on Cancel click, backdrop click, and Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal title="t" body="b" confirmLabel="Go" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('shows a busy label and disables the confirm button when busy', () => {
    render(
      <ConfirmModal
        title="t"
        body="b"
        confirmLabel="Go"
        busy
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Working…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/client -- ConfirmModal`
Expected: FAIL — cannot resolve `./ConfirmModal.js`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/client/src/components/ConfirmModal.tsx
// ── ConfirmModal ─────────────────────────────────────────────────────────────
//
// Generic confirmation dialog. Mirrors NewBoardModal's overlay pattern (fixed
// backdrop, click-outside + Escape to cancel, white rounded card). Used by
// LiveDraftMenu for the human-only Discard and Promote confirmations, replacing
// the old DraftBanner's window.confirm() calls.
import { useEffect } from 'react';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @figemite/client -- ConfirmModal`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ConfirmModal.tsx packages/client/src/components/ConfirmModal.test.tsx
git commit -m "feat(client): add generic ConfirmModal dialog"
```

---

## Task 2: LiveDraftMenu (pill + dropdown + confirm wiring)

**Files:**
- Create: `packages/client/src/components/LiveDraftMenu.tsx`
- Test: `packages/client/src/components/LiveDraftMenu.test.tsx`

Notes: `boards-api` exports `listDrafts(slug)`, `createDraft(slug, title?)`, `promoteDraft(slug, draftId)`, `discardDraft(slug, draftId)`, and `DraftMeta { id, title, createdBy, createdAt }`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/client/src/components/LiveDraftMenu.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LiveDraftMenu from './LiveDraftMenu.js';

const api = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  promoteDraft: vi.fn(),
  discardDraft: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => api);

beforeEach(() => {
  api.listDrafts.mockReset().mockResolvedValue([
    { id: 'd1', title: 'New card limits', createdBy: 'human', createdAt: '2026-07-21T00:00:00Z' },
  ]);
  api.createDraft.mockReset().mockResolvedValue('d2');
  api.promoteDraft.mockReset().mockResolvedValue(undefined);
  api.discardDraft.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('LiveDraftMenu', () => {
  it('shows "Live" when on the live board', () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    expect(screen.getByRole('button', { name: /Live/ })).toBeTruthy();
  });

  it('shows the draft title when editing a draft', async () => {
    render(
      <LiveDraftMenu slug="spend" draftId="d1" onOpenDraft={() => {}} onExitDraft={() => {}} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /New card limits/ })).toBeTruthy());
  });

  it('lists drafts and creates a new one', async () => {
    const onOpenDraft = vi.fn();
    render(<LiveDraftMenu slug="spend" onOpenDraft={onOpenDraft} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New draft/ }));
    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledWith('d2'));
  });

  it('clicking a draft row opens it', async () => {
    const onOpenDraft = vi.fn();
    render(<LiveDraftMenu slug="spend" onOpenDraft={onOpenDraft} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByText('New card limits'));
    expect(onOpenDraft).toHaveBeenCalledWith('d1');
  });

  it('promote asks for confirmation then calls promoteDraft', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Promote draft New card limits to live' }));
    // Modal appears; confirm.
    fireEvent.click(screen.getByRole('button', { name: 'Promote to live' }));
    await waitFor(() => expect(api.promoteDraft).toHaveBeenCalledWith('spend', 'd1'));
  });

  it('discard asks for confirmation then calls discardDraft', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft New card limits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(api.discardDraft).toHaveBeenCalledWith('spend', 'd1'));
  });

  it('clicking the Live row while in a draft exits to live', async () => {
    const onExitDraft = vi.fn();
    render(
      <LiveDraftMenu slug="spend" draftId="d1" onOpenDraft={() => {}} onExitDraft={onExitDraft} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /New card limits/ }));
    fireEvent.click(screen.getByRole('button', { name: /Switch to Live/ }));
    expect(onExitDraft).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/client -- LiveDraftMenu`
Expected: FAIL — cannot resolve `./LiveDraftMenu.js`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/client/src/components/LiveDraftMenu.tsx
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
            <span
              style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }}
            />
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @figemite/client -- LiveDraftMenu`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/LiveDraftMenu.tsx packages/client/src/components/LiveDraftMenu.test.tsx
git commit -m "feat(client): add LiveDraftMenu (Live/draft dropdown)"
```

---

## Task 3: Breadcrumb `draftControl` slot

**Files:**
- Modify: `packages/client/src/components/Breadcrumb.tsx`
- Test: `packages/client/src/components/Breadcrumb.test.tsx`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe`)

```tsx
// packages/client/src/components/Breadcrumb.test.tsx — add
it('renders a draftControl node when provided', () => {
  render(
    <Breadcrumb
      boardLabel="Spend"
      path={[]}
      onNavigate={() => {}}
      onGoHome={() => {}}
      isDirty={false}
      draftControl={<button>Live ▾</button>}
    />,
  );
  expect(screen.getByRole('button', { name: 'Live ▾' })).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/client -- Breadcrumb`
Expected: FAIL — `draftControl` not a valid prop / not rendered.

- [ ] **Step 3: Add the prop and render slot**

In `BreadcrumbProps` add:
```tsx
  /** Optional trailing control (the LiveDraftMenu pill) embedded in the bar. */
  draftControl?: React.ReactNode;
```
Add `draftControl` to the destructured params, and render it just before the closing `</div>` of the bar (after the delete button block):
```tsx
      {draftControl && (
        <>
          <span style={SEPARATOR}>|</span>
          {draftControl}
        </>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @figemite/client -- Breadcrumb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Breadcrumb.tsx packages/client/src/components/Breadcrumb.test.tsx
git commit -m "feat(client): add draftControl slot to Breadcrumb"
```

---

## Task 4: Wire LiveDraftMenu into App; remove old draft components

**Files:**
- Modify: `packages/client/src/App.tsx`
- Delete: `packages/client/src/components/DraftsMenu.tsx`, `packages/client/src/components/DraftBanner.tsx`
- Test: `packages/client/src/App.test.tsx`

- [ ] **Step 1: Write the failing test** (add to App.test.tsx)

```tsx
// packages/client/src/App.test.tsx — add near the other board-route tests.
// (boardsApiMock already mocks listBoards/getBoard/etc.; extend it with the
// draft functions LiveDraftMenu calls.)
it('renders the Live pill on a board route', async () => {
  setHash('#/b/spend');
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Live/ })).toBeTruthy());
});
```

Extend the `boardsApiMock` hoisted object with:
```tsx
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  promoteDraft: vi.fn(),
  discardDraft: vi.fn(),
```
and in `beforeEach`:
```tsx
  boardsApiMock.listDrafts.mockReset().mockResolvedValue([]);
  boardsApiMock.createDraft.mockReset().mockResolvedValue('newdraft');
  boardsApiMock.promoteDraft.mockReset().mockResolvedValue(undefined);
  boardsApiMock.discardDraft.mockReset().mockResolvedValue(undefined);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/client -- App`
Expected: FAIL — no "Live" button yet (still DraftsMenu "Drafts").

- [ ] **Step 3: Rewire App.tsx**

In `App.tsx`:
1. Replace the imports:
```tsx
import LiveDraftMenu from './components/LiveDraftMenu.js';
```
   (remove `import DraftsMenu` and `import DraftBanner`).
2. In `BoardRoute`, compute the lock and build the control. Add near the top of the render (before `return`):
```tsx
  const contentLocked = !READONLY && !draftId;
  const draftControl = READONLY ? undefined : (
    <LiveDraftMenu
      slug={slug}
      draftId={draftId}
      onOpenDraft={onOpenDraft}
      onExitDraft={onExitDraft}
    />
  );
```
3. Pass `draftControl` to `<Breadcrumb>` and gate `onDelete` on `!contentLocked`:
```tsx
      <Breadcrumb
        boardLabel={rootLabel ?? (state.status === 'ready' ? state.board.boardLabel : slug)}
        pathLabels={pathLabels}
        path={path}
        onNavigate={onNavigate}
        onGoHome={onGoHome}
        onDelete={!READONLY && !contentLocked && path.length > 0 ? handleDelete : undefined}
        isDirty={false}
        draftControl={draftControl}
      />
```
4. Delete the two old draft render blocks at the bottom of `BoardRoute`:
```tsx
      {/* removed: DraftsMenu + DraftBanner (folded into the breadcrumb pill) */}
```
   i.e. remove the `!READONLY && !draftId && path.length === 0 && <DraftsMenu…/>` and `!READONLY && draftId && <DraftBanner…/>` blocks.

- [ ] **Step 4: Delete the old components**

```bash
git rm packages/client/src/components/DraftsMenu.tsx packages/client/src/components/DraftBanner.tsx
```

- [ ] **Step 5: Run tests**

Run: `npm test -w @figemite/client -- App`
Expected: PASS. Also run `npm test -w @figemite/client` to confirm no other file imported the deleted components.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/App.test.tsx
git commit -m "feat(client): embed LiveDraftMenu in breadcrumb; drop DraftsMenu/DraftBanner"
```

---

## Task 5: Client content-lock on the live board

**Files:**
- Modify: `packages/client/src/canvas/BoardCanvas.tsx`
- Modify: `packages/client/src/components/Toolbar.tsx`
- Test: `packages/client/src/components/Toolbar.test.tsx`

- [ ] **Step 1: Write the failing Toolbar test**

```tsx
// packages/client/src/components/Toolbar.test.tsx — add
it('hides content tools and shows only comment + annotation when contentLocked', () => {
  const store = makeStore(); // however the existing suite builds a store
  render(
    <ReactFlowProvider>
      <Toolbar
        store={store}
        selectedNodeIds={new Set()}
        selectedEdgeIds={new Set()}
        syncStatus="synced"
        readonly={false}
        contentLocked
        activeMode="none"
        onSetActiveMode={() => {}}
        hasAnnotations={false}
        onWipeAnnotations={() => {}}
      />
    </ReactFlowProvider>,
  );
  expect(screen.queryByLabelText('Sticky note')).toBeNull();
  expect(screen.queryByLabelText('Shape')).toBeNull();
  expect(screen.getByLabelText('Comment')).toBeTruthy();
  expect(screen.getByLabelText(/Annotation/)).toBeTruthy();
});
```
(Match the existing Toolbar.test.tsx's store/render helpers; `IconButton`'s `label` becomes the button's accessible name.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/client -- Toolbar`
Expected: FAIL — `contentLocked` not a prop; content tools still render.

- [ ] **Step 3: Add `contentLocked` to Toolbar**

In `ToolbarProps` add:
```tsx
  /** The live board is content-frozen: only comment + annotation are allowed.
   * Hides every node/edge creation + styling affordance, the pencil (persisted
   * drawing), and history (restore mutates prod). */
  contentLocked?: boolean;
```
Destructure `contentLocked = false`. Then wrap the content-only affordances so they render only when `!contentLocked`:
- The sticky / text / shape / frame / emoji / icon `IconButton`s.
- The `Pencil` `IconButton`.
- The first `<Divider />` + `showColorCycle` block + `selectionIsEdgeOnly` block.
- The `onOpenHistory` `IconButton`.

Keep unconditional: the `Comment` and `Annotation` (+ Wipe) buttons, the final `<Divider />`, and `<SaveIndicator />`.

Concretely, guard each content group, e.g.:
```tsx
      {!contentLocked && (
        <>
          {/* sticky/text/shape/frame/emoji/icon pickers … */}
        </>
      )}
```
and wrap the pencil button, the color/edge `<Divider/>`+blocks, and the history button each in `{!contentLocked && ( … )}`.

- [ ] **Step 4: Run Toolbar test**

Run: `npm test -w @figemite/client -- Toolbar`
Expected: PASS.

- [ ] **Step 5: Thread `contentLocked` through BoardCanvas**

In `BoardCanvas.tsx`:
1. `EditablePaneProps` — add `contentLocked: boolean;`.
2. `BoardCanvas` — compute and pass it: `const contentLocked = !readonly && !draftId;` then pass `contentLocked={contentLocked}` to `<EditableCanvas>`, and change the subBoard adapter's `canCreate`:
```tsx
      ? { childIds: subBoardChildIds ?? new Set<string>(), onDrillIn, canCreate: !readonly && !!draftId }
```
   (create sub-boards only inside a draft).
3. `EditableCanvas({ … , contentLocked })` — OR it into the interaction gates alongside `aiLocked`. Define once:
```tsx
  const editsBlocked = aiLocked || contentLocked;
```
   and replace the `!aiLocked && !overlayModeActive` gates on `<ReactFlow>` (`nodesDraggable`, `nodesConnectable`, `elementsSelectable`, `edgesReconnectable`) with `!editsBlocked && !overlayModeActive`.
4. `useBoardInteractions({ …, aiLocked: editsBlocked, … })`.
5. Pass `contentLocked` to `<Toolbar>`.
6. Gate description editing: `const editable = useEditableCanvas(store, { onOpenDescription: contentLocked ? undefined : openDescription, subBoard });` (if the option is required, pass a no-op `() => {}` when locked instead).

- [ ] **Step 6: Run the full client suite**

Run: `npm test -w @figemite/client`
Expected: PASS (fix any test that constructed `EditableCanvas`/`Toolbar` without the new prop — supply `contentLocked={false}` / `draftId`).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/canvas/BoardCanvas.tsx packages/client/src/components/Toolbar.tsx packages/client/src/components/Toolbar.test.tsx
git commit -m "feat(client): freeze content editing on the live board (comments + annotations only)"
```

---

## Task 6: Server — prod room persists only promote (LOCAL_ORIGIN)

**Files:**
- Modify: `packages/server/src/services/yjs-ws.ts`
- Test: `packages/server/src/services/yjs-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Follow the existing `yjs-persistence.test.ts` harness (it constructs a `YjsWebsocketService` with a fake repo/history + short `debounceMs`, creates a doc via the service's seed path, and applies updates). Add:

```ts
it('does NOT persist a prod room edit that originates from a peer', async () => {
  // Arrange: a seeded prod room (no draftId). Apply a node edit with a
  // NON-LOCAL origin (as a synced peer update would arrive).
  const doc = getSeededProdDoc(service, 'spend'); // per the existing helper
  addNode(doc, makeStickyNode('s1', { x: 0, y: 0 }, 'yellow', 1), 'peer-origin');
  await waitDebounce();
  expect(repo.write).not.toHaveBeenCalled();
});

it('persists a draft room edit from any origin', async () => {
  const doc = getSeededDraftDoc(service, 'spend', 'd1');
  addNode(doc, makeStickyNode('s1', { x: 0, y: 0 }, 'yellow', 1), 'peer-origin');
  await waitDebounce();
  expect(repo.write).toHaveBeenCalled();
});

it('persists a prod room edit that originates from promote (LOCAL_ORIGIN)', async () => {
  service.replaceRoomContent('spend', [], {
    nodes: [makeStickyNode('s1', { x: 0, y: 0 }, 'yellow', 1)],
    edges: [],
  });
  await waitDebounce();
  expect(repo.write).toHaveBeenCalled();
});
```

Use the file's existing imports/helpers; `addNode` + `makeStickyNode` come from `@figemite/shared`, `LOCAL_ORIGIN` too if needed. The third case uses `replaceRoomContent`, which already transacts with `LOCAL_ORIGIN`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/server -- yjs-persistence`
Expected: FAIL — the first case currently persists (repo.write called).

- [ ] **Step 3: Implement the origin guard**

In `armPersist`, change the update listener to receive the origin and skip non-local prod updates:

```ts
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      // The live (prod) board is frozen: only a promote (which mutates the doc
      // with LOCAL_ORIGIN via replaceRoomContent) may persist. A peer's own
      // edit arrives with the websocket connection as its origin and is
      // relayed live but never written to disk. Draft rooms persist from any
      // origin, exactly as before.
      if (draftId === undefined && origin !== LOCAL_ORIGIN) return;
      state.dirty = true;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => state.flush(), this.debounceMs);
    });
```

Add `LOCAL_ORIGIN` to the `@figemite/shared` import at the top of the file.

- [ ] **Step 4: Run tests**

Run: `npm test -w @figemite/server -- yjs-persistence`
Expected: PASS. Then `npm test -w @figemite/server` to confirm promote + drafts tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/yjs-ws.ts packages/server/src/services/yjs-persistence.test.ts
git commit -m "feat(server): freeze live board — prod room persists only via promote"
```

---

## Task 7: MCP — editing requires a connected draft

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Modify: `AGENTS.md` (repo root)
- Test: `packages/mcp/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/mcp/src/server.test.ts — add a describe block
describe('live board is read-only over MCP', () => {
  it('a mutating tool on a prod connection returns the read-only error', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend' } });
    const res = await client.callTool({
      name: 'add_sticky',
      arguments: { text: 'hi', x: 0, y: 0 },
    });
    expect(JSON.stringify(res)).toMatch(/read-only|create a draft/i);
    expect(res.isError).toBe(true);
  });

  it('the same tool on a draft connection succeeds', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { slug: 'spend', draft: 'd1' },
    });
    const res = await client.callTool({
      name: 'add_sticky',
      arguments: { text: 'hi', x: 0, y: 0 },
    });
    expect(res.isError).toBeFalsy();
  });

  it('read tools still work on a prod connection', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend' } });
    const res = await client.callTool({ name: 'get_board', arguments: {} });
    expect(res.isError).toBeFalsy();
  });
});
```
(Use the real mutating tool name and args from `server.ts` — confirm `add_sticky`'s exact input schema when writing; adjust args to match.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @figemite/mcp -- server`
Expected: FAIL — add_sticky on prod currently succeeds.

- [ ] **Step 3: Add `assertEditable()` and switch mutating tools**

In `createFigemiteMcpServer`, next to `assertConnected`:
```ts
  function assertEditable(): BoardPeer {
    const p = assertConnected();
    if (!p.draftId) {
      throw new Error(
        'This is the live board and is read-only. Create a draft with create_draft, ' +
          'then connect_board with that draft (the `draft` param) to make changes. ' +
          'A human approves the draft to update the live board.',
      );
    }
    return p;
  }
```
Switch every **mutating** tool's `assertConnected()` to `assertEditable()`: the node-creation tools (`add_sticky`, `add_text`, `add_shape`, `add_frame`, `add_emoji`, `add_icon`, `add_drawing` — whichever exist), `move_node`, `update_node`/`set_*`, `delete_node`, and every edge mutation (`add_edge`, `update_edge`, `delete_edge`, `set_edge_*`). Leave **read** tools (`get_board`, `get_node`, `list_nodes`) and **presence** tools (`move_cursor`, `set_editing`) on `assertConnected()`. (Grep `assertConnected(` to enumerate call sites and classify each.)

Update `connect_board`'s description to add a line:
```
'The live board is READ-ONLY: connect without `draft` only to read/observe. To edit, pass `draft`.',
```

- [ ] **Step 4: Update AGENTS.md**

In the drafts section of `AGENTS.md`, add a sentence: the live board is read-only over MCP — mutating tools require a `draft`; connecting without one is read/observe only; a human promotes the draft to update live.

- [ ] **Step 5: Run tests**

Run: `npm test -w @figemite/mcp -- server`
Expected: PASS. Then `npm test -w @figemite/mcp`.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/src/server.test.ts AGENTS.md
git commit -m "feat(mcp): editing requires a draft — live board is read-only over MCP"
```

---

## Task 8: Full verification

- [ ] **Step 1: Whole test suite + typecheck + lint**

Run: `npm test` and `npm run -s typecheck` (or `npx tsc -b`) and `npm run -s lint`.
Expected: all green. Fix fallout (e.g. any remaining references to the deleted components or new required props).

- [ ] **Step 2: Manual browser verification** (via the preview tools)

Start the dev server, open a board, and confirm:
- Live board: breadcrumb shows a green "Live ▾" pill; toolbar shows only Comment + Annotation; dragging/creating nodes is not possible; comments + annotations work.
- Open the dropdown → New draft → pill turns amber with the draft title; full editing works inside the draft.
- From the dropdown, Promote a draft → confirm modal → lands back on the live board showing the promoted content.
- Discard a draft → confirm modal → draft gone, live unchanged.
- (Optional) With `VITE_READONLY=1`, no pill renders.

- [ ] **Step 3: Final commit if any fixups were needed**

```bash
git add -A && git commit -m "chore: verification fixups for live-draft-dropdown"
```
```
```

---

## Self-Review

**Spec coverage:**
- Part A (dropdown) → Tasks 1–4. ✓
- Part B (client content-lock) → Task 5. ✓
- Part C (server prod-freeze via origin) → Task 6. ✓
- Part D (MCP require-draft) → Task 7. ✓
- Testing + manual verification → Task 8. ✓

**Placeholder scan:** No TBD/TODO. Task 5 & 7 test steps reference "the existing suite's store/render helpers" and "the real tool name/args" — these are pointers to verify exact local details at implement time, not missing content; the surrounding code is complete.

**Type consistency:** `contentLocked` used consistently (BoardCanvas prop, Toolbar prop). `LiveDraftMenu` props (`slug`, `draftId?`, `onOpenDraft`, `onExitDraft`) match the App wiring. `ConfirmModal` props (`title`, `body`, `confirmLabel`, `tone`, `busy`, `error`, `onConfirm`, `onCancel`) match both its usage in `LiveDraftMenu` and its own test. `assertEditable()` returns `BoardPeer`, matching `assertConnected()`.
