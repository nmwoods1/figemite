// ── Top-level view switch ────────────────────────────────────────────────────
//
// Ported from the figmalade prototype's `src/App.tsx`. Deviations:
//   - Driven by the new `app/router.ts`'s `useAppView()` (view union field is
//     `slug` for the board view, not `board` as upstream — see that module's
//     doc comment).
//   - The `board` view is a PLACEHOLDER for this task (P2-T16): it resolves
//     the route, fetches the board label via `lib/boards-api.ts`'s
//     `getBoard()` so the breadcrumb has a real label, and renders a
//     Breadcrumb + a "Canvas — coming in Phase 3" message instead of a real
//     canvas. `BoardCanvas` lands in Phase 3; nothing canvas-shaped (nodes,
//     dirty state, drill-in) is implemented here. `Breadcrumb`'s `isDirty` is
//     hardcoded `false` — real dirty-tracking arrives with the canvas.
//   - Delete-sub-board is wired to `deleteSubBoard` from `lib/boards-api.ts`
//     and only offered (via `Breadcrumb`'s optional `onDelete`) when not in
//     READONLY mode and `path.length > 0`, matching the "every write
//     affordance hidden in READONLY" requirement.
import { useEffect, useState } from 'react';
import TagList from './components/TagList.js';
import Dashboard from './components/Dashboard.js';
import Breadcrumb from './components/Breadcrumb.js';
import { useAppView } from './app/router.js';
import { READONLY } from './app/mode.js';
import { getBoard, deleteSubBoard } from './lib/boards-api.js';

export default function App() {
  const [view, navigate] = useAppView();

  if (view.view === 'tagList') {
    return (
      <TagList
        onPickTag={(tag) => navigate({ view: 'tagDetail', tag })}
        onPickUntagged={() => navigate({ view: 'untagged' })}
        onPickBoard={(slug) => navigate({ view: 'board', slug, path: [] })}
      />
    );
  }

  if (view.view === 'tagDetail') {
    return (
      <Dashboard
        filter={{ kind: 'tag', name: view.tag }}
        onPick={(slug) => navigate({ view: 'board', slug, path: [] })}
        onGoHome={() => navigate({ view: 'tagList' })}
      />
    );
  }

  if (view.view === 'untagged') {
    return (
      <Dashboard
        filter={{ kind: 'untagged' }}
        onPick={(slug) => navigate({ view: 'board', slug, path: [] })}
        onGoHome={() => navigate({ view: 'tagList' })}
      />
    );
  }

  // ── Board route: placeholder pending Phase 3's BoardCanvas ───────────────
  //
  // Keyed by slug+path so navigating to a different board/sub-board remounts
  // the placeholder (a fresh `loading` state) instead of needing to reset
  // state imperatively inside an effect.
  return (
    <BoardRoutePlaceholder
      key={[view.slug, ...view.path].join('/')}
      slug={view.slug}
      path={view.path}
      onGoHome={() => navigate({ view: 'tagList' })}
      onNavigate={(nextPath) => navigate({ view: 'board', slug: view.slug, path: nextPath })}
    />
  );
}

// ── BoardRoutePlaceholder ─────────────────────────────────────────────────────

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; boardLabel: string }
  | { status: 'error'; message: string };

interface BoardRoutePlaceholderProps {
  slug: string;
  path: string[];
  onGoHome: () => void;
  onNavigate: (path: string[]) => void;
}

function BoardRoutePlaceholder({ slug, path, onGoHome, onNavigate }: BoardRoutePlaceholderProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getBoard(slug, path)
      .then((board) => {
        if (!cancelled) setState({ status: 'ready', boardLabel: board.boardLabel });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `path` is a fresh array each render; the component is remounted via `key` (slug+path) on navigation instead.
  }, [slug]);

  const handleDelete = async () => {
    try {
      await deleteSubBoard(slug, path);
    } finally {
      onNavigate(path.slice(0, -1));
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#f8fafc' }}>
      <Breadcrumb
        boardLabel={state.status === 'ready' ? state.boardLabel : slug}
        path={path}
        onNavigate={onNavigate}
        onGoHome={onGoHome}
        onDelete={!READONLY && path.length > 0 ? handleDelete : undefined}
        isDirty={false}
      />
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {state.status === 'loading' && <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</p>}
        {state.status === 'error' && (
          <p style={{ color: '#dc2626', fontSize: 14 }}>Failed to load board: {state.message}</p>
        )}
        {state.status === 'ready' && (
          <div style={{ textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Canvas — coming in Phase 3
            </div>
            <p style={{ fontSize: 13, margin: '0 0 16px' }}>
              Board editing isn&apos;t implemented yet in this rewrite.
            </p>
            <button
              onClick={onGoHome}
              style={{
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 600,
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              ← Back to dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
