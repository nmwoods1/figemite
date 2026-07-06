// ── Top-level view switch ────────────────────────────────────────────────────
//
// Ported from the figmalade prototype's `src/App.tsx`. Deviations:
//   - Driven by the new `app/router.ts`'s `useAppView()` (view union field is
//     `slug` for the board view, not `board` as upstream — see that module's
//     doc comment).
//   - The `board` view resolves the route, fetches the full `BoardFile` via
//     `lib/boards-api.ts`'s `getBoard()`, and renders a Breadcrumb + the
//     read-only `canvas/BoardCanvas.tsx` (P3-T20). `Breadcrumb`'s `isDirty`
//     is hardcoded `false` — real dirty-tracking is Phase 4 (interaction
//     handlers land there too; this canvas only renders).
//   - Delete-sub-board is wired to `deleteSubBoard` from `lib/boards-api.ts`
//     and only offered (via `Breadcrumb`'s optional `onDelete`) when not in
//     READONLY mode and `path.length > 0`, matching the "every write
//     affordance hidden in READONLY" requirement.
import { useEffect, useState } from 'react';
import type { BoardFile } from '@easel/shared';
import TagList from './components/TagList.js';
import Dashboard from './components/Dashboard.js';
import Breadcrumb from './components/Breadcrumb.js';
import { BoardCanvas } from './canvas/BoardCanvas.js';
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

  // ── Board route ────────────────────────────────────────────────────────────
  //
  // Keyed by slug+path so navigating to a different board/sub-board remounts
  // the route (a fresh `loading` state) instead of needing to reset state
  // imperatively inside an effect.
  return (
    <BoardRoute
      key={[view.slug, ...view.path].join('/')}
      slug={view.slug}
      path={view.path}
      onGoHome={() => navigate({ view: 'tagList' })}
      onNavigate={(nextPath) => navigate({ view: 'board', slug: view.slug, path: nextPath })}
    />
  );
}

// ── BoardRoute ────────────────────────────────────────────────────────────────

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; board: BoardFile }
  | { status: 'error'; message: string };

interface BoardRouteProps {
  slug: string;
  path: string[];
  onGoHome: () => void;
  onNavigate: (path: string[]) => void;
}

function BoardRoute({ slug, path, onGoHome, onNavigate }: BoardRouteProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getBoard(slug, path)
      .then((board) => {
        if (!cancelled) setState({ status: 'ready', board });
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
        boardLabel={state.status === 'ready' ? state.board.boardLabel : slug}
        path={path}
        onNavigate={onNavigate}
        onGoHome={onGoHome}
        onDelete={!READONLY && path.length > 0 ? handleDelete : undefined}
        isDirty={false}
      />
      {state.status === 'loading' && (
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
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</p>
        </div>
      )}
      {state.status === 'error' && (
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
          <p style={{ color: '#dc2626', fontSize: 14 }}>Failed to load board: {state.message}</p>
        </div>
      )}
      {state.status === 'ready' && <BoardCanvas board={state.board} readonly={READONLY} />}
    </div>
  );
}
