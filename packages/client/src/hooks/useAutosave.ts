// ── useAutosave: debounced, coalescing, lock-aware board autosave ────────────
//
// Plan v2 §3. Ported from the legacy client's flushNow/submitCurrent
// (src/components/BoardCanvas.tsx) and the seq-based staleness guard in
// src/lib/autosave.ts (`shouldApplySaveResult`), adapted to the doc-first store:
//
//   - O(1) DIRTY DETECTION. The legacy computed `boardSignature(board) ===
//     savedSignatureRef.current`, a `JSON.stringify` of every node/edge — O(n)
//     on every render/keystroke. Here a monotonic `dirtyEpoch` increments once
//     per Y.Doc `update` event (however many keys changed in that transaction),
//     and `lastSavedEpoch` records the epoch that was last durably saved.
//     `isDirty = dirtyEpoch > lastSavedEpoch` is an integer compare — no
//     serialization, no board traversal. Both epochs live in React state (not
//     refs) so `isDirty`/`saveStatus` can be derived directly during render —
//     reading a ref's `.current` during render is unsound (react-hooks/refs)
//     since it isn't tracked as a render dependency. A mirrored ref pair
//     (`dirtyEpochRef`/`lastSavedEpochRRef`) exists ONLY for the async save
//     logic (effects/callbacks/promise continuations), which needs the
//     up-to-the-tick value without depending on the latest closure.
//
//   - DEBOUNCED COALESCING SAVE. Becoming dirty (re)starts a ~1.5s timer
//     (mirrors the legacy's SAVE_DEBOUNCE_MS). If a save is already in flight
//     when the timer fires (or when `flushNow` is called), we don't start a
//     second concurrent request — we set a `pending` flag and, when the
//     in-flight request settles, immediately re-check dirtiness and save again
//     if still dirty. This is the legacy's `saveInFlightRef`/`pendingDirtyRef`
//     pair, ported 1:1.
//
//   - SEQ / STALE-RESPONSE GUARD. Each save captures `dirtyEpoch` at
//     save-start as its own request's target epoch, and a monotonically
//     increasing `seq` identifies "the most recent request issued." On
//     success we only advance `lastSavedEpoch` to the captured epoch if this
//     request is still the latest one issued (`seq === latestSeqRef.current`)
//     — this is `shouldApplySaveResult(requestSeq, latestSeq)` from the legacy
//     src/lib/autosave.ts, ported directly. A superseded response is simply
//     dropped: it neither advances `lastSavedEpoch` (which could wrongly mark
//     newer edits as saved) nor regresses it. Each request also gets its own
//     `AbortController`, aborted if a newer request starts, matching the
//     legacy's `saveAbortRef`.
//
//     NOTE on reachability: `performSave` is only ever invoked while
//     `savingRef.current` is false (both the debounce timer and `flushNow`
//     check it synchronously before calling), so under this hook's own API
//     two `saveBoard` calls are never truly concurrent — a same-tick
//     `flushNow` race can't happen in JS's single-threaded model either, since
//     `savingRef.current = true` is set synchronously inside `performSave`
//     before any `await`. That makes the seq guard defense-in-depth rather
//     than reachable-by-construction here: `targetEpoch`, captured at
//     save-start, already prevents a stale response from marking newer edits
//     saved even without it. We keep `shouldApplySaveResult` anyway because
//     (a) it's the direct, tested port of the legacy contract the task calls
//     out by name, and (b) it's the correct guard if a future change (e.g. a
//     retry path, or a caller bypassing the hook's serialization) ever does
//     introduce overlapping requests — at that point this is what keeps a
//     late-arriving stale response from resurrecting `lastSavedEpoch`.
//
//   - 409 LOCKED. `saveBoard` throwing an `ApiError` with `status === 409`
//     (another AI session holds the board — packages/server's write lock)
//     flips `saveStatus` to `'locked'` and PAUSES autosave: the dirty-triggered
//     debounce effect no longer schedules new timers while locked. Full
//     AI-lock UI/SSE-driven resume is a later Phase 5 task; this hook only
//     exposes the status and stops scheduling, per the task's scope.
//
//   - FLUSH POINTS. `flushNow()` (Cmd+S, navigation) saves immediately,
//     bypassing the debounce timer. `visibilitychange`→hidden and
//     `beforeunload` also call it (best-effort — matches the legacy's
//     belt-and-braces flush).
//
//   - DISABLED. `enabled: false` (read-only board) never saves; status stays
//     `'idle'` and doc updates don't bump `dirtyEpoch` into a save cycle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSnapshot } from '@easel/shared';
import type { BoardFile } from '@easel/shared';
import type { BoardStore } from '../store/board-store.js';
import { saveBoard, ApiError } from '../lib/boards-api.js';

/** ~1.5s: mirrors the legacy client's debounce window. */
const SAVE_DEBOUNCE_MS = 1500;

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'locked';

export interface UseAutosaveOptions {
  slug: string;
  path: string[];
  /** Disabled (e.g. read-only board) → never saves; status stays 'idle'. */
  enabled: boolean;
  /** Board metadata not carried by the doc-first store (nodes/edges/viewport
   * live in `store`; format/label are board-file-level concerns the caller
   * already has from the originally-loaded `BoardFile`). */
  formatVersion: number;
  boardLabel: string;
}

export interface Autosave {
  saveStatus: SaveStatus;
  /** Save immediately, bypassing the debounce timer. Safe to call any time. */
  flushNow(): void;
  isDirty: boolean;
}

/** Whether a completed save's target epoch should become `lastSavedEpoch` —
 * i.e. whether `requestSeq` is still the most recently issued request. Ported
 * from the legacy `shouldApplySaveResult` (src/lib/autosave.ts). */
function shouldApplySaveResult(requestSeq: number, latestSeq: number): boolean {
  return requestSeq === latestSeq;
}

export function useAutosave(store: BoardStore, options: UseAutosaveOptions): Autosave {
  const { slug, path, enabled, formatVersion, boardLabel } = options;

  // ── State that drives render output (isDirty / saveStatus) ─────────────────
  const [dirtyEpoch, setDirtyEpoch] = useState(0);
  const [lastSavedEpoch, setLastSavedEpoch] = useState(0);
  const [phase, setPhase] = useState<'saving' | 'saved' | 'error' | 'locked' | null>(null);

  const isDirty = enabled && dirtyEpoch > lastSavedEpoch;

  // ── Mirrored refs for the async save machinery (never read during render) ──
  // These exist because effects/promise continuations need the CURRENT value
  // without depending on (and re-subscribing to) React's render cycle, and
  // without risking a stale value captured in an old closure.
  const dirtyEpochRef = useRef(0);
  const lastSavedEpochRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const lockedRef = useRef(false);
  const latestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // `scheduleSave` and `performSave` are mutually referential (a settled save
  // with a pending change re-schedules; a fired timer performs a save), so
  // both are routed through stable refs rather than depending on each other's
  // `useCallback` identity directly — avoids a temporal-dead-zone ordering
  // problem and keeps both callbacks' own dependency arrays honest.
  const scheduleSaveRef = useRef<() => void>(() => {});
  const performSaveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const scheduleSave = useCallback(() => {
    if (!enabled || lockedRef.current) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void performSaveRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, [enabled, clearTimer]);

  useEffect(() => {
    scheduleSaveRef.current = scheduleSave;
  }, [scheduleSave]);

  // The actual save: snapshots the board at call time, issues the request,
  // and applies the seq/epoch bookkeeping around it.
  const performSave = useCallback((): Promise<void> => {
    const targetEpoch = dirtyEpochRef.current;
    const seq = ++latestSeqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    savingRef.current = true;
    setPhase('saving');

    const snapshot = getSnapshot(store.doc);
    const board: BoardFile = {
      formatVersion,
      boardLabel,
      viewport: store.getViewport(),
      ...snapshot,
    };

    return saveBoard(slug, path, board)
      .then(() => {
        if (ac.signal.aborted) return;
        if (shouldApplySaveResult(seq, latestSeqRef.current)) {
          lastSavedEpochRef.current = targetEpoch;
          setLastSavedEpoch(targetEpoch);
          setPhase('saved');
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError && err.status === 409) {
          lockedRef.current = true;
          setPhase('locked');
          return;
        }
        setPhase('error');
      })
      .finally(() => {
        savingRef.current = false;
        if (destroyedRef.current) return;

        if (pendingRef.current) {
          pendingRef.current = false;
          if (!lockedRef.current && dirtyEpochRef.current > lastSavedEpochRef.current) {
            scheduleSaveRef.current();
          }
        }
      });
  }, [slug, path, store, formatVersion, boardLabel]);

  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  const flushNow = useCallback(() => {
    if (!enabled || lockedRef.current) return;
    clearTimer();
    if (dirtyEpochRef.current <= lastSavedEpochRef.current) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    void performSave();
  }, [enabled, clearTimer, performSave]);

  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = flushNow;
  }, [flushNow]);

  // ── Wire the doc's `update` → dirtyEpoch bump → schedule ────────────────
  useEffect(() => {
    if (!enabled) return;
    const doc = store.doc;
    const onUpdate = () => {
      dirtyEpochRef.current += 1;
      setDirtyEpoch(dirtyEpochRef.current);
      if (!lockedRef.current) scheduleSave();
    };
    doc.on('update', onUpdate);
    return () => {
      doc.off('update', onUpdate);
    };
  }, [store, enabled, scheduleSave]);

  // ── Flush points: visibilitychange (hidden) + beforeunload ──────────────
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushRef.current();
    };
    const onUnload = () => {
      flushRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [enabled]);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      destroyedRef.current = true;
      clearTimer();
      abortRef.current?.abort();
    },
    [clearTimer],
  );

  // ── Derive the public status purely from render-tracked state ──────────────
  const saveStatus: SaveStatus = !enabled
    ? 'idle'
    : phase === 'locked'
      ? 'locked'
      : phase === 'saving'
        ? 'saving'
        : isDirty
          ? 'dirty'
          : phase === 'saved'
            ? 'saved'
            : phase === 'error'
              ? 'error'
              : 'idle';

  return useMemo(() => ({ saveStatus, flushNow, isDirty }), [saveStatus, flushNow, isDirty]);
}
