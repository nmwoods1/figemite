// ── Top-level view switch ────────────────────────────────────────────────────
//
// Ported from the original prototype's `src/App.tsx`. Deviations:
//   - Driven by the new `app/router.ts`'s `useAppView()` (view union field is
//     `slug` for the board view, not `board` as upstream — see that module's
//     doc comment).
//   - The `board` view resolves the route, fetches the full `BoardFile` via
//     `lib/boards-api.ts`'s `getBoard()` (for metadata + existence/404), and
//     renders a Breadcrumb + `canvas/BoardCanvas.tsx`. `slug`/`path` are
//     threaded straight through to BoardCanvas — its EDITABLE pane uses them
//     to join the server's realtime room (P5-T29: `lib/realtime.ts`'s
//     `joinBoardRoom`, via `board-store.ts`'s `room` option) rather than
//     seeding content from the fetched `BoardFile`; the READ-ONLY pane
//     ignores them (it hydrates directly from the fetch, no room joined).
//     `Breadcrumb`'s `isDirty` is still hardcoded `false`: there is no
//     client-side "unsaved changes" concept anymore now that the server is
//     the sole content writer — surfacing the realtime connection's own
//     status on the Breadcrumb (rather than just the Toolbar) would need a
//     callback seam this task didn't add; left as a follow-up.
//   - Delete-sub-board is wired to `deleteSubBoard` from `lib/boards-api.ts`
//     and only offered (via `Breadcrumb`'s optional `onDelete`) when not in
//     READONLY mode and `path.length > 0`, matching the "every write
//     affordance hidden in READONLY" requirement.
import { useCallback, useEffect, useState } from 'react';
import type { BoardFile } from '@figemite/shared';
import TagList from './components/TagList.js';
import Dashboard from './components/Dashboard.js';
import Breadcrumb from './components/Breadcrumb.js';
import IdentityPrompt from './components/IdentityPrompt.js';
import LiveDraftMenu from './components/LiveDraftMenu.js';
import { BoardCanvas } from './canvas/BoardCanvas.js';
import { useAppView } from './app/router.js';
import { READONLY } from './app/mode.js';
import { getBoard, deleteSubBoard, createSubBoard, listBoards } from './lib/boards-api.js';
import { nodeLabel } from './canvas/node-label.js';
import { hasStoredUser } from './lib/identity.js';

export default function App() {
  const [view, navigate] = useAppView();

  // P5-T30: a first-time user (no stored display name) is asked to set one
  // before presence has anything meaningful to publish — `hasStoredUser()`
  // gates a RETURNING user out entirely, matching IdentityPrompt's own
  // contract (it only captures/persists a name; callers decide whether to
  // mount it at all). Mounted once at the App level (not per board route)
  // so navigating between boards never re-prompts within a session, and
  // skipped entirely in READONLY mode (static boards have no presence, and
  // no write affordance should be offered at all in that mode).
  const [identityDismissed, setIdentityDismissed] = useState(false);
  const showIdentityPrompt = !READONLY && !identityDismissed && !hasStoredUser();

  const identityPrompt = showIdentityPrompt ? (
    <IdentityPrompt
      onConfirm={() => setIdentityDismissed(true)}
      onCancel={() => setIdentityDismissed(true)}
    />
  ) : null;

  if (view.view === 'tagList') {
    return (
      <>
        {identityPrompt}
        <TagList
          onPickTag={(tag) => navigate({ view: 'tagDetail', tag })}
          onPickUntagged={() => navigate({ view: 'untagged' })}
          onPickBoard={(slug) => navigate({ view: 'board', slug, path: [] })}
        />
      </>
    );
  }

  if (view.view === 'tagDetail') {
    return (
      <>
        {identityPrompt}
        <Dashboard
          filter={{ kind: 'tag', name: view.tag }}
          onPick={(slug) => navigate({ view: 'board', slug, path: [] })}
          onGoHome={() => navigate({ view: 'tagList' })}
        />
      </>
    );
  }

  if (view.view === 'untagged') {
    return (
      <>
        {identityPrompt}
        <Dashboard
          filter={{ kind: 'untagged' }}
          onPick={(slug) => navigate({ view: 'board', slug, path: [] })}
          onGoHome={() => navigate({ view: 'tagList' })}
        />
      </>
    );
  }

  // ── Board route ────────────────────────────────────────────────────────────
  //
  // Keyed by slug+path so navigating to a different board/sub-board remounts
  // the route (a fresh `loading` state) instead of needing to reset state
  // imperatively inside an effect.
  return (
    <>
      {identityPrompt}
      <BoardRoute
        key={[view.draftId ?? '', view.slug, ...view.path].join('/')}
        slug={view.slug}
        path={view.path}
        draftId={view.draftId}
        onGoHome={() => navigate({ view: 'tagList' })}
        onNavigate={(nextPath) =>
          navigate({ view: 'board', slug: view.slug, path: nextPath, draftId: view.draftId })
        }
        onOpenDraft={(draftId) =>
          navigate({ view: 'board', slug: view.slug, path: [], draftId })
        }
        onExitDraft={() => navigate({ view: 'board', slug: view.slug, path: [] })}
      />
    </>
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
  /** When set, this route edits a draft of the board rather than prod. */
  draftId?: string;
  onGoHome: () => void;
  onNavigate: (path: string[]) => void;
  /** Navigate into a draft of the current board. */
  onOpenDraft: (draftId: string) => void;
  /** Leave the current draft back to the prod board. */
  onExitDraft: () => void;
}

function BoardRoute({
  slug,
  path,
  draftId,
  onGoHome,
  onNavigate,
  onOpenDraft,
  onExitDraft,
}: BoardRouteProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Ids of nodes at THIS board level that already have a sub-board — derived
  // from `listBoards()`'s `subBoardPaths` (available in dev AND the static
  // read-only build via boards/index.json). Drives the always-visible drill
  // badge; empty until the list resolves (and on any fetch failure), which
  // only means "no existing-sub-board badges yet", never blocks drilling in.
  const [subBoardChildIds, setSubBoardChildIds] = useState<Set<string>>(() => new Set());
  // The ROOT board's label (from the board list). On a sub-board route
  // `getBoard`/`state.board` is the SUB-board — its `boardLabel` is the leaf
  // segment's name, not the root's — so the breadcrumb's root crumb needs the
  // root label from elsewhere. `listBoards()` already carries it per slug.
  const [rootLabel, setRootLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getBoard(slug, path, draftId)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `path` is a fresh array each render; the component is remounted via `key` (draftId+slug+path) on navigation instead.
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    listBoards()
      .then((boards) => {
        if (cancelled) return;
        const entry = boards.find((b) => b.slug === slug);
        setRootLabel(entry?.label);
        const ids = new Set<string>();
        // Keep only sub-board paths that are DIRECT children of the current
        // level: one segment longer than `path`, sharing `path` as a prefix.
        // That extra segment is a node id at this level that has a sub-board.
        for (const p of entry?.subBoardPaths ?? []) {
          if (p.length === path.length + 1 && path.every((seg, i) => p[i] === seg)) {
            ids.add(p[path.length]);
          }
        }
        setSubBoardChildIds(ids);
      })
      .catch(() => {
        if (!cancelled) setSubBoardChildIds(new Set());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed remount on slug+path (see the getBoard effect above); `path` is captured per mount.
  }, [slug]);

  const handleDelete = async () => {
    try {
      await deleteSubBoard(slug, path);
    } finally {
      onNavigate(path.slice(0, -1));
    }
  };

  const handleDrillIn = useCallback(
    async (nodeId: string) => {
      const nextPath = [...path, nodeId];
      // Auto-create the sub-board on first drill-in, but ONLY inside a draft:
      // the live (prod) board is content-locked, so sub-boards can only be
      // created in a draft (and READONLY never creates at all — its badge only
      // appears for existing sub-boards). The seed MUST target the SAME scope
      // we're viewing (`draftId`), or navigation — which stays in the draft —
      // would 404 on a sub-board that was seeded in prod instead. POST
      // /api/create is idempotent (a no-op when the sub-board already exists),
      // so we call it unconditionally in a draft rather than gating on the
      // prod-scoped `subBoardChildIds`, which fixes drilling into a sub-board
      // that prod gained after this draft was branched.
      const inDraft = !READONLY && !!draftId;
      if (inDraft) {
        const board = state.status === 'ready' ? state.board : undefined;
        const label = nodeLabel(board?.nodes.find((n) => n.id === nodeId));
        try {
          await createSubBoard(slug, nextPath, label || undefined, draftId);
        } catch {
          // Navigate anyway — the sub-board route's own getBoard surfaces any
          // real error there rather than swallowing the drill-in silently.
        }
      }
      onNavigate(nextPath);
    },
    [slug, path, draftId, state, onNavigate],
  );

  // Breadcrumb label polish: show the current sub-board's own label (set from
  // the node's text at creation) for the LAST crumb; ancestors fall back to
  // their node id (Breadcrumb does `pathLabels[i] || seg`).
  const pathLabels =
    state.status === 'ready' && path.length > 0
      ? path.map((seg, i) => (i === path.length - 1 ? state.board.boardLabel : seg))
      : undefined;

  // The live (prod) board is content-locked: only comments + annotations are
  // allowed, so a sub-board can't be deleted from it either (that's a draft-only
  // edit). Locked whenever we're editable and NOT inside a draft.
  const contentLocked = !READONLY && !draftId;
  const draftControl = READONLY ? undefined : (
    <LiveDraftMenu
      slug={slug}
      draftId={draftId}
      onOpenDraft={onOpenDraft}
      onExitDraft={onExitDraft}
    />
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#f8fafc' }}>
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
      {state.status === 'loading' && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Helvetica, Arial, sans-serif',
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
            fontFamily: 'Helvetica, Arial, sans-serif',
          }}
        >
          <p style={{ color: '#dc2626', fontSize: 14 }}>Failed to load board: {state.message}</p>
        </div>
      )}
      {state.status === 'ready' && (
        <BoardCanvas
          board={state.board}
          readonly={READONLY}
          slug={slug}
          path={path}
          draftId={draftId}
          onDrillIn={handleDrillIn}
          subBoardChildIds={subBoardChildIds}
        />
      )}
      {/* Draft affordances (dev only) now live in the top-left breadcrumb via
          `draftControl` (LiveDraftMenu) — no separate menu or banner. */}
    </div>
  );
}
