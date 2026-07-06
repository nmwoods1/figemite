// ── React bindings for the doc-first board store ──────────────────────────────
//
// Thin `useSyncExternalStore` wrappers. `BoardStore.getSnapshot`/`getViewport`
// are already referentially stable (see board-store.ts's module doc), which is
// what makes this safe: React's `useSyncExternalStore` re-renders exactly when
// the store notifies AND the snapshot reference actually changed.

import { useSyncExternalStore } from 'react';
import type { BoardStore, BoardSnapshot, Viewport } from './board-store.js';

/** The current `{ nodes, edges }` for `store`, re-rendering on every doc change. */
export function useBoardStore(store: BoardStore): BoardSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The current viewport for `store`, re-rendering on every `setViewport` call. */
export function useBoardViewport(store: BoardStore): Viewport {
  return useSyncExternalStore(store.subscribeViewport, store.getViewport);
}
