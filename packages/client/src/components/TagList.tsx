// ── TagList (home view — browse by tag) ──────────────────────────────────────
//
// Ported from the original prototype's `src/components/TagList.tsx`.
// Deviations: fetches via `lib/boards-api.ts`'s `listBoards()` instead of raw
// `fetch`; grouping via `lib/tags.ts`'s `groupByTag`. The prototype's fixed
// product-name heading is replaced with "Boards" to stay product-agnostic in
// the new app.
import { useEffect, useState } from 'react';
import { READONLY } from '../app/mode.js';
import { listBoards, type BoardListItem } from '../lib/boards-api.js';
import { groupByTag } from '../lib/tags.js';
import NewBoardModal from './NewBoardModal.js';

interface TagListProps {
  onPickTag: (tag: string) => void;
  onPickUntagged: () => void;
  onPickBoard: (slug: string) => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; boards: BoardListItem[] };

export default function TagList({ onPickTag, onPickUntagged, onPickBoard }: TagListProps) {
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
    onPickBoard(slug);
  };

  const boards = state.status === 'ready' ? state.boards : null;
  const { tagBoards, untagged } = boards
    ? groupByTag(boards)
    : { tagBoards: new Map(), untagged: [] };
  const sortedTags = [...tagBoards.keys()].sort();

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
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: '#0f172a',
              letterSpacing: '-0.02em',
            }}
          >
            Boards
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>
            {READONLY ? 'View only — clone the repo to edit' : 'Browse boards by tag'}
          </p>
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
        {state.status === 'loading' && <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</p>}
        {state.status === 'error' && (
          <p style={{ color: '#dc2626', fontSize: 14 }}>Failed to load boards: {state.message}</p>
        )}

        {state.status === 'ready' && boards !== null && boards.length === 0 && (
          <EmptyState onNew={READONLY ? undefined : () => setShowNewModal(true)} />
        )}

        {state.status === 'ready' && boards !== null && boards.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            {sortedTags.map((tag) => (
              <TagCard
                key={tag}
                tag={tag}
                count={tagBoards.get(tag)!.length}
                onClick={() => onPickTag(tag)}
              />
            ))}
            <TagCard tag="Untagged" count={untagged.length} isUntagged onClick={onPickUntagged} />
          </div>
        )}
      </div>

      {showNewModal && !READONLY && (
        <NewBoardModal onCreated={handleCreated} onClose={() => setShowNewModal(false)} />
      )}
    </div>
  );
}

// ── TagCard ───────────────────────────────────────────────────────────────────

interface TagCardProps {
  tag: string;
  count: number;
  isUntagged?: boolean;
  onClick: () => void;
}

function TagCard({ tag, count, isUntagged = false, onClick }: TagCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
          background: isUntagged ? '#f1f5f9' : '#ede9fe',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
          fontSize: 18,
        }}
      >
        {isUntagged ? '◻' : '#'}
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
        {tag}
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 'auto', paddingTop: 8 }}>
        {count} {count === 1 ? 'board' : 'boards'}
      </div>
    </button>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew?: () => void }) {
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
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>#</div>
      <div style={{ fontWeight: 600, fontSize: 16, color: '#374151', marginBottom: 6 }}>
        No boards yet
      </div>
      <p style={{ fontSize: 13, margin: '0 0 20px', maxWidth: 320 }}>
        Create your first board to get started.
      </p>
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
