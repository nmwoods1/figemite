// ── usePresence: publish + subscribe to a room's Yjs awareness ─────────────
//
// P5-T30. The shared data layer behind both PresenceLayer (remote cursors +
// editing outlines) and ActiveUsersPanel (who's online): publishes this
// client's own live presence fields into `awareness`'s local state, and
// projects every OTHER client's awareness state into a `remotes` array that
// re-renders on every `awareness.on('change', ...)` event.
//
// Bootstrap (`lib/realtime.ts`'s `joinBoardRoom`) already seeds local
// awareness with `{ user: getLocalUser() }` before this hook ever mounts —
// this hook's mount effect re-asserts `user` (harmless if already set; keeps
// it correct if `localUser` changes, e.g. after IdentityPrompt updates it)
// and adds `isAI: false`, since every human client publishes that literal
// value (only the MCP/AI peer sets `isAI: true`, from a different codebase).
//
// `awareness` is accepted as a minimal STRUCTURAL type (mirrors
// hooks/useSyncStatus.ts's `SyncStatusProvider` — a plain test double
// satisfies it without depending on y-protocols/yjs) rather than the real
// `Awareness` class, and may be `null` (no room joined yet, or a read-only
// board that never joins one at all) — in which case `remotes` stays empty
// and every publish function is a safe no-op.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AwarenessState, PresenceCursor, PresenceUser } from '@figemite/shared';
import type { Viewport } from '../canvas/coords.js';

/** The minimal awareness surface this hook needs — satisfied by both the
 * real y-protocols `Awareness` (via `WebsocketProvider.awareness`) and
 * `test/fake-awareness.ts`'s `FakeAwareness` double. */
export interface PresenceAwareness {
  readonly clientID: number;
  getStates(): Map<number, unknown>;
  setLocalState(state: Record<string, unknown> | null): void;
  setLocalStateField(field: string, value: unknown): void;
  on(event: 'change', listener: (arg: unknown) => void): void;
  off(event: 'change', listener: (arg: unknown) => void): void;
}

export interface RemotePresence {
  clientId: number;
  user: PresenceUser;
  cursor: PresenceCursor | null;
  editingNodeId: string | null;
  viewport: Viewport | null;
  isAI: boolean;
  agentClient?: string;
}

export interface UsePresenceResult {
  /** Every OTHER connected client's live presence (self excluded). */
  remotes: RemotePresence[];
  /** Publish (or, given `null`, clear) the local cursor — throttled to
   * ~30Hz (33ms) so a fast mousemove stream doesn't flood awareness updates. */
  publishCursor(cursor: PresenceCursor | null): void;
  /** Publish (or clear) which node this client is currently editing. */
  setEditingNodeId(nodeId: string | null): void;
  /** Publish the local ReactFlow viewport (for remote followers). */
  publishViewport(vp: Viewport): void;
}

/** ~30Hz — matches the legacy PresenceLayer's `PUBLISH_INTERVAL_MS`. */
const CURSOR_THROTTLE_MS = 33;

/** Build the `remotes` snapshot from `awareness`'s current states, excluding
 * `ownClientId` and any state that hasn't published a `user` yet (i.e. a
 * client whose bootstrap awareness write hasn't landed). */
function computeRemotes(awareness: PresenceAwareness): RemotePresence[] {
  const remotes: RemotePresence[] = [];
  awareness.getStates().forEach((rawState, clientId) => {
    if (clientId === awareness.clientID) return;
    const state = rawState as AwarenessState | undefined;
    if (!state?.user) return;
    remotes.push({
      clientId,
      user: state.user,
      cursor: state.cursor ?? null,
      editingNodeId: state.editingNodeId ?? null,
      viewport: state.viewport ?? null,
      isAI: state.isAI === true,
      ...(state.agentClient !== undefined ? { agentClient: state.agentClient } : {}),
    });
  });
  return remotes;
}

export function usePresence(
  awareness: PresenceAwareness | null,
  localUser: PresenceUser,
): UsePresenceResult {
  const [remotes, setRemotes] = useState<RemotePresence[]>(() =>
    awareness ? computeRemotes(awareness) : [],
  );

  // Derived-during-render "reset on prop change" (React's own recommended
  // alternative to calling setState synchronously inside an effect body —
  // see react-hooks/set-state-in-effect, and hooks/useSyncStatus.ts's
  // identical pattern for a `provider` swap): if `awareness` changed since
  // the last render (including becoming null — e.g. the room was torn
  // down), reset `remotes` for the NEW awareness directly during render
  // rather than via an effect.
  const [lastAwareness, setLastAwareness] = useState(awareness);
  if (awareness !== lastAwareness) {
    setLastAwareness(awareness);
    setRemotes(awareness ? computeRemotes(awareness) : []);
  }

  // Bootstrap/refresh `user` + `isAI: false` on mount (and whenever
  // `awareness`/`localUser` identity changes). Bootstrap in `joinBoardRoom`
  // already set a non-null local state before this hook ever runs, so
  // `setLocalStateField` here is never a no-op (see that module's doc for why
  // non-null-first matters).
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField('user', localUser);
    awareness.setLocalStateField('isAI', false);
  }, [awareness, localUser]);

  // Subscribe to remote presence changes.
  useEffect(() => {
    if (!awareness) return;
    const recompute = () => setRemotes(computeRemotes(awareness));
    awareness.on('change', recompute);
    recompute();
    return () => awareness.off('change', recompute);
  }, [awareness]);

  // ── Cursor throttling (~30Hz) ───────────────────────────────────────────
  // Leading-edge publish (the first call in a burst goes out immediately, so
  // a single/rare movement isn't delayed) + trailing-edge coalesce (rapid
  // subsequent calls within the window collapse to one flush of the LATEST
  // value once the window elapses) — matches the legacy PresenceLayer's
  // pending-ref + setTimeout flush pattern.
  const lastPublishedAtRef = useRef(0);
  const pendingCursorRef = useRef<PresenceCursor | null | undefined>(undefined);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  const publishCursor = useCallback(
    (cursor: PresenceCursor | null) => {
      if (!awareness) return;

      const flush = () => {
        flushTimerRef.current = null;
        if (pendingCursorRef.current === undefined) return;
        const next = pendingCursorRef.current;
        pendingCursorRef.current = undefined;
        lastPublishedAtRef.current = Date.now();
        awareness.setLocalStateField('cursor', next);
      };

      pendingCursorRef.current = cursor;
      const elapsed = Date.now() - lastPublishedAtRef.current;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        flush();
      } else if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flush, CURSOR_THROTTLE_MS - elapsed);
      }
    },
    [awareness],
  );

  const setEditingNodeId = useCallback(
    (nodeId: string | null) => {
      awareness?.setLocalStateField('editingNodeId', nodeId);
    },
    [awareness],
  );

  const publishViewport = useCallback(
    (vp: Viewport) => {
      awareness?.setLocalStateField('viewport', vp);
    },
    [awareness],
  );

  return { remotes, publishCursor, setEditingNodeId, publishViewport };
}
