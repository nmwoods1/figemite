// ── Dashboard (board list, filtered by tag or untagged) ─────────────────────
//
// Ported from the original prototype's `src/components/Dashboard.tsx`
// (there named `BoardList`). Deviations:
//   - Fetches via `lib/boards-api.ts`'s `listBoards()` instead of a raw
//     `fetch('/api/boards')` / `fetch('boards/index.json')` — the READONLY
//     vs dev branching now lives entirely in that module.
//   - Grouping helpers (`groupByTag`, `allTags`) moved to `lib/tags.ts`.
//   - `BoardWithTags` is superseded by the new `BoardListItem` type from
//     `lib/boards-api.ts` (same shape: slug/label/tags/lastModifiedMs, plus
//     `subBoardPaths` which this view doesn't use).
import { useEffect, useRef, useState } from 'react';
import NewBoardModal from './NewBoardModal.js';
import TagEditor from './TagEditor.js';
import { READONLY } from '../app/mode.js';
import { listBoards, type BoardListItem } from '../lib/boards-api.js';
import { groupByTag, allTags } from '../lib/tags.js';

export type BoardFilter = { kind: 'tag'; name: string } | { kind: 'untagged' };

interface DashboardProps {
  filter: BoardFilter;
  onPick: (slug: string) => void;
  onGoHome: () => void;
}

function relativeTime(ms: number): string {
  if (ms === 0) return 'Unknown';
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'Just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo === 1) return '1 month ago';
  return `${mo} months ago`;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; boards: BoardListItem[] };

export default function Dashboard({ filter, onPick, onGoHome }: DashboardProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listBoards()
      .then((boards) => {
        if (!cancelled) setState({ status: 'ready', boards });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreated = (slug: string) => {
    setShowNewModal(false);
    onPick(slug);
  };

  const handleTagsUpdated = (slug: string, newTags: string[]) => {
    setState((prev) =>
      prev.status === 'ready'
        ? {
            ...prev,
            boards: prev.boards.map((b) => (b.slug === slug ? { ...b, tags: newTags } : b)),
          }
        : prev,
    );
  };

  const allBoards = state.status === 'ready' ? state.boards : null;

  let visibleBoards: BoardListItem[] = [];
  if (allBoards) {
    const { tagBoards, untagged } = groupByTag(allBoards);
    visibleBoards = filter.kind === 'untagged' ? untagged : (tagBoards.get(filter.name) ?? []);
  }

  const knownTags = allBoards ? allTags(allBoards) : [];

  const heading = filter.kind === 'untagged' ? 'Untagged' : `# ${filter.name}`;
  const subheading =
    filter.kind === 'untagged' ? 'Boards without any tags' : `Boards tagged "${filter.name}"`;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        background: '#f8fafc',
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 32px 20px',
          borderBottom: '1px solid #e2e8f0',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onGoHome}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              fontSize: 13,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
            }}
          >
            ← All tags
          </button>
          <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              {heading}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>
              {READONLY ? 'View only' : subheading}
            </p>
          </div>
        </div>
        {!READONLY && (
          <button
            onClick={() => setShowNewModal(true)}
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: '#0f172a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              letterSpacing: '-0.01em',
            }}
          >
            + New board
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '28px 32px' }}>
        {state.status === 'loading' && (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading boards…</p>
        )}
        {state.status === 'error' && (
          <p style={{ color: '#dc2626', fontSize: 14 }}>Failed to load boards: {state.message}</p>
        )}

        {state.status === 'ready' && visibleBoards.length === 0 && (
          <EmptyState
            message={
              filter.kind === 'untagged'
                ? 'All boards have tags.'
                : `No boards tagged "${filter.name}".`
            }
            onNew={READONLY ? undefined : () => setShowNewModal(true)}
          />
        )}

        {state.status === 'ready' && visibleBoards.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {visibleBoards.map((b) => (
              <BoardCard
                key={b.slug}
                board={b}
                allKnownTags={knownTags}
                onTagsUpdated={(newTags) => handleTagsUpdated(b.slug, newTags)}
                onClick={() => onPick(b.slug)}
              />
            ))}

            {!READONLY && (
              <button
                onClick={() => setShowNewModal(true)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: '#fff',
                  border: '2px dashed #cbd5e1',
                  borderRadius: 12,
                  padding: '32px 20px',
                  cursor: 'pointer',
                  color: '#64748b',
                  fontSize: 13,
                  fontWeight: 500,
                  minHeight: 120,
                }}
              >
                <span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
                New board
              </button>
            )}
          </div>
        )}
      </div>

      {showNewModal && !READONLY && (
        <NewBoardModal onCreated={handleCreated} onClose={() => setShowNewModal(false)} />
      )}
    </div>
  );
}

// ── BoardCard ─────────────────────────────────────────────────────────────────

interface BoardCardProps {
  board: BoardListItem;
  allKnownTags: string[];
  onTagsUpdated: (newTags: string[]) => void;
  onClick: () => void;
}

function BoardCard({ board, allKnownTags, onTagsUpdated, onClick }: BoardCardProps) {
  const [hovered, setHovered] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const tagBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onClick}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          textAlign: 'left',
          padding: '20px 20px 16px',
          background: '#fff',
          border: `1.5px solid ${hovered ? '#0f172a' : '#e2e8f0'}`,
          borderRadius: 12,
          cursor: 'pointer',
          boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
          width: '100%',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
            fontSize: 18,
          }}
        >
          ⬜
        </div>
        <div
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: '#0f172a',
            marginBottom: 4,
            lineHeight: 1.3,
          }}
        >
          {board.label}
        </div>

        {board.tags && board.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {board.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  display: 'inline-block',
                  background: '#ede9fe',
                  color: '#5b21b6',
                  padding: '2px 7px',
                  borderRadius: 20,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 'auto', paddingTop: 12 }}>
          Updated {relativeTime(board.lastModifiedMs)}
        </div>
      </button>

      {!READONLY && hovered && (
        <button
          ref={tagBtnRef}
          onClick={(e) => {
            e.stopPropagation();
            setShowTagEditor((v) => !v);
          }}
          title="Edit tags"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            background: '#f1f5f9',
            border: '1.5px solid #e2e8f0',
            borderRadius: 6,
            cursor: 'pointer',
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 600,
            color: '#64748b',
          }}
        >
          # tags
        </button>
      )}

      {showTagEditor && (
        <TagEditor
          slug={board.slug}
          currentTags={board.tags ?? []}
          allKnownTags={allKnownTags}
          anchorRef={tagBtnRef}
          onSaved={onTagsUpdated}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ message, onNew }: { message: string; onNew?: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px',
        textAlign: 'center',
        color: '#64748b',
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>⬜</div>
      <p style={{ fontSize: 14, margin: '0 0 20px', maxWidth: 320, color: '#374151' }}>{message}</p>
      {onNew && (
        <button
          onClick={onNew}
          style={{
            padding: '10px 22px',
            fontSize: 14,
            fontWeight: 600,
            background: '#0f172a',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          + New board
        </button>
      )}
    </div>
  );
}
