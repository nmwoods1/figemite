// ── useSnapPreference: grid-snap on/off, persisted per-browser ──────────────
//
// Grid-snapping toggle for canvas interactions (drag/resize) — CLIENT-ONLY
// VIEW state. This is a per-browser interaction preference, not board
// content: it deliberately does NOT live in board.json (nothing about the
// board data model changes for this feature), does not sync over the realtime
// room, and is not shared between collaborators — each person's browser
// remembers its own snap preference, the same way `figemite:author` (see
// lib/identity.ts) remembers a display name per-browser rather than per-board.
//
// Defaults to ON (`true`) so grid-snapping is the out-of-the-box experience;
// a user who turns it off gets that choice remembered on their next visit.
// localStorage access is guarded with try/catch on both read AND write so a
// backend-less static build (`npm run build:static`, no real `localStorage`)
// never throws — mirrors lib/identity.ts's best-effort/never-throw contract.
import { useCallback, useState } from 'react';

/** The localStorage key this hook reads/writes. Exported for tests. */
export const SNAP_STORAGE_KEY = 'figemite:snap';

export interface UseSnapPreferenceResult {
  /** Whether grid-snapping is currently enabled. */
  snapEnabled: boolean;
  /** Flip `snapEnabled` and persist the new value to localStorage. */
  toggle(): void;
}

function readStoredPreference(): boolean {
  try {
    const raw = localStorage.getItem(SNAP_STORAGE_KEY);
    return raw !== '0';
  } catch {
    return true;
  }
}

function writeStoredPreference(enabled: boolean): void {
  try {
    localStorage.setItem(SNAP_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore — best-effort persistence, same as lib/identity.ts */
  }
}

export function useSnapPreference(): UseSnapPreferenceResult {
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => readStoredPreference());

  const toggle = useCallback(() => {
    setSnapEnabled((prev) => {
      const next = !prev;
      writeStoredPreference(next);
      return next;
    });
  }, []);

  return { snapEnabled, toggle };
}
