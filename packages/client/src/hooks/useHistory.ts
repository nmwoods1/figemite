// ── useHistory: time-travel state machine (list / preview / restore / discard) ─
//
// P6-T36. Backs the History panel (components/HistoryPanel.tsx). Owns the
// snapshot list (fetched once per `slug`/`path` via `lib/boards-api.ts`'s
// `fetchHistory`) and the "am I previewing an old version" state.
//
// ── Preview stays isolated from the live doc (critical invariant) ───────────
//
// `preview(id)` only fetches the snapshot's `BoardFile` (via `fetchVersion`)
// and stores it in `previewedBoard` — it NEVER touches `store.doc`. The caller
// (BoardCanvas's EditableCanvas) is expected to render THAT board through the
// existing read-only pane (a SEPARATE store/doc instance — see
// `canvas/BoardCanvas.tsx`'s `ReadOnlyCanvas`) while the live doc keeps
// syncing underneath, unseen. This mirrors the legacy prototype's mistake in
// reverse: the legacy (`src/components/BoardCanvas.tsx` ~L1713-1765) actually
// replaced its single React `board` state with the fetched snapshot — because
// that codebase had ONE mutable board state shared by the canvas and autosave,
// "preview" and "the live board" were the same variable, and previewing an old
// version raced with (and could clobber) the live board's own autosave. This
// This rewrite's doc-first store makes that impossible BY CONSTRUCTION as long as
// this hook never calls any `store` mutation method while previewing — which
// it doesn't (there is no `store` reference in this module at all).
//
// ── Restore ───────────────────────────────────────────────────────────────
//
// `restore()` applies the CURRENTLY PREVIEWED board to the live doc via
// `loadBoardIntoDoc(store.doc, previewedBoard)` (clears the three CRDT maps
// then repopulates them, all in one transaction — see
// `@figemite/shared`'s `loadBoardIntoDoc` doc, "used for initial load and history
// restore"). That transaction is a normal LOCAL_ORIGIN write, so it
// CRDT-merges into the room like any other edit — every peer sees the
// restored state, and the server's own persistence debounce picks it up same
// as any other edit (P5-T28). Immediately after, `undo.clear()` wipes the
// undo/redo stacks: a hard reset like this makes the pre-restore undo history
// meaningless (mirrors `useAiLock`'s `onExternalChange` -> `undo.clear()` for
// the same "external, non-incremental change" reason). Finally, `discard()`'s
// logic exits preview (no need to re-fetch the live board — the live doc was
// never replaced, it was already right there the whole time).
//
// ── Discard ───────────────────────────────────────────────────────────────
//
// `discard()` just clears `previewedBoard`/`previewId` — no doc mutation at
// all, since (per the isolation invariant above) nothing was ever touched.

import { useCallback, useState } from 'react';
import { loadBoardIntoDoc } from '@figemite/shared';
import type { BoardFile } from '@figemite/shared';
import type { BoardStore } from '../store/board-store.js';
import type { UndoRedo } from './useUndoRedo.js';
import { fetchHistory, fetchVersion } from '../lib/boards-api.js';
import type { HistoryVersion } from '../lib/boards-api.js';

export type { HistoryVersion };

export interface UseHistoryOptions {
  /** The board's slug. `undefined` for the no-room unit-test convenience path
   * (canvas/BoardCanvas.tsx's `EditablePaneProps.slug` doc) — history is
   * unavailable there too (there's nothing to fetch history FOR), mirrored by
   * `UseHistory.available` below. Always `undefined` in READONLY mode: the
   * caller never even constructs this hook's containing component tree in
   * that mode (BoardCanvas's read-only pane has no Toolbar/history at all),
   * but the guard here is cheap defense-in-depth against the "history is NOT
   * available in READONLY" requirement regardless of caller wiring. */
  slug: string | undefined;
  path: string[];
  /** Draft scope: when set, history lists/reads the draft's own `.history/`
   * rather than prod's (editing — and therefore snapshots — happen in a draft;
   * the live board is read-only). Undefined = prod. */
  draftId?: string;
  store: BoardStore;
  undo: Pick<UndoRedo, 'clear'>;
}

export interface UseHistory {
  /** False when history isn't available at all (no slug) — callers should
   * hide the History button entirely rather than calling `openPanel`. */
  available: boolean;
  /** Whether the history panel is open. */
  panelOpen: boolean;
  openPanel(): void;
  closePanel(): void;
  /** Snapshot metadata, newest-first (whatever the server returned). */
  versions: HistoryVersion[];
  /** True while `openPanel`'s `fetchHistory` call is in flight. */
  versionsLoading: boolean;
  /** Set if the last `fetchHistory` call failed; cleared on the next successful fetch. */
  versionsError: string | null;
  /** The id of the version currently loading/previewed, or null. */
  previewId: string | null;
  /** The fetched BoardFile for `previewId`, or null before it resolves / when
   * not previewing. Render this READ-ONLY in place of the live canvas while
   * non-null — see this module's doc for why the live doc is untouched. */
  previewedBoard: BoardFile | null;
  /** Fetch and enter preview for a given snapshot id. */
  preview(id: string): Promise<void>;
  /** Apply the previewed snapshot to the live doc, clear undo, exit preview. */
  restore(): void;
  /** Exit preview without changing anything. */
  discard(): void;
}

export function useHistory({ slug, path, draftId, store, undo }: UseHistoryOptions): UseHistory {
  const [panelOpen, setPanelOpen] = useState(false);
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewedBoard, setPreviewedBoard] = useState<BoardFile | null>(null);

  const openPanel = useCallback(() => {
    if (!slug) return;
    setPanelOpen(true);
    setVersionsLoading(true);
    setVersionsError(null);
    fetchHistory(slug, path, draftId)
      .then((list) => {
        setVersions(list);
        setVersionsLoading(false);
      })
      .catch((err: unknown) => {
        setVersionsError(err instanceof Error ? err.message : String(err));
        setVersionsLoading(false);
      });
  }, [slug, path, draftId]);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const preview = useCallback(
    async (id: string) => {
      if (!slug) return;
      setPreviewId(id);
      setPanelOpen(false);
      const board = await fetchVersion(slug, path, id, draftId);
      setPreviewedBoard(board);
    },
    [slug, path, draftId],
  );

  const restore = useCallback(() => {
    if (!previewedBoard) return;
    store.doc.transact(() => {
      loadBoardIntoDoc(store.doc, previewedBoard);
    });
    undo.clear();
    setPreviewId(null);
    setPreviewedBoard(null);
  }, [previewedBoard, store, undo]);

  const discard = useCallback(() => {
    setPreviewId(null);
    setPreviewedBoard(null);
  }, []);

  return {
    available: !!slug,
    panelOpen,
    openPanel,
    closePanel,
    versions,
    versionsLoading,
    versionsError,
    previewId,
    previewedBoard,
    preview,
    restore,
    discard,
  };
}
