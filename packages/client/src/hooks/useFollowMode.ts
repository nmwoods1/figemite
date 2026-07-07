// ── useFollowMode: FigJam-style "watch someone's screen" ────────────────────
//
// P5-T30. Ported from the legacy figmalade prototype's BoardCanvas.tsx follow-
// mode block (`followingClientId` state + the two effects that publish the
// local viewport and apply the followed remote's), factored into its own
// hook and adapted to this codebase's conventions:
//   - `awareness` is the minimal structural `PresenceAwareness` type (see
//     usePresence.ts), not a real y-protocols Awareness — a plain
//     `FakeAwareness` test double satisfies it.
//   - `setViewport` is caller-supplied (the real caller wires ReactFlow's
//     `useReactFlow().setViewport`) rather than this hook reaching into RF
//     itself, keeping it testable without a `<ReactFlowProvider>`.
//   - The legacy's `programmaticViewportRef` (used to distinguish "I just
//     moved the viewport myself" from "the user grabbed the canvas", so
//     follow's OWN `setViewport` call doesn't immediately self-cancel
//     following) is reproduced here as an internal ref, and exposed to the
//     caller as `notifyManualViewportChange()` — wire this to ReactFlow's
//     `onMoveStart`, which fires for every viewport change including the
//     ones this hook itself triggers.
//
// Snaps instantly (no animation): the leader's viewport publishes at up to
// ~60Hz during a drag/zoom gesture (BoardCanvas publishes on every RF
// `useViewport()` tick — see the caller wiring), so any per-step animation
// here would lag visibly behind the leader by more than the gap between
// their updates.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AwarenessState } from '@easel/shared';
import type { Viewport } from '../canvas/coords.js';
import type { PresenceAwareness } from './usePresence.js';

export interface UseFollowModeResult {
  /** The clientId currently being followed, or `null`. */
  followClientId: number | null;
  /** Start following `clientId` — replaces any client currently followed. */
  follow(clientId: number): void;
  /** Stop following (a no-op if not currently following anyone). */
  stopFollowing(): void;
  /** Call from ReactFlow's `onMoveStart` (or any "the viewport just changed"
   * signal). Stops following UNLESS the change was this hook's own
   * follow-triggered `setViewport` call. */
  notifyManualViewportChange(): void;
}

export function useFollowMode(
  awareness: PresenceAwareness | null,
  setViewport: (vp: Viewport) => void,
): UseFollowModeResult {
  const [followClientId, setFollowClientId] = useState<number | null>(null);

  // Set just before THIS hook calls `setViewport` (inside the apply effect
  // below); consumed (and cleared) by `notifyManualViewportChange` so that
  // specific, self-triggered move isn't mistaken for the user grabbing the
  // canvas. Any OTHER call to `notifyManualViewportChange` (the flag not
  // set) really is a manual pan/zoom, and stops following.
  const programmaticRef = useRef(false);

  const stopFollowing = useCallback(() => setFollowClientId(null), []);

  const follow = useCallback((clientId: number) => setFollowClientId(clientId), []);

  const notifyManualViewportChange = useCallback(() => {
    if (programmaticRef.current) {
      programmaticRef.current = false;
      return;
    }
    setFollowClientId(null);
  }, []);

  // Apply the followed remote's viewport on every awareness change (and
  // immediately on follow/awareness-instance change) — mirrors the legacy's
  // apply-on-change effect. `hasSeenStateRef` distinguishes "this client's
  // state hasn't arrived/published YET" (harmless — e.g. `follow()` was
  // called just before the remote's first awareness update lands; keep
  // following) from "this client's state WAS there and is now gone" (they
  // left the room — stop following), so calling `follow()` on a clientId
  // with no state yet doesn't immediately self-cancel.
  const hasSeenStateRef = useRef(false);
  // The last viewport actually applied for the CURRENT followClientId — lets
  // `apply()` skip a redundant `setViewport` call when awareness changed for
  // an unrelated reason (e.g. a DIFFERENT client's cursor moved) but the
  // followed client's own viewport is unchanged since we last applied it.
  const lastAppliedRef = useRef<Viewport | null>(null);

  useEffect(() => {
    hasSeenStateRef.current = false;
    lastAppliedRef.current = null;
  }, [followClientId]);

  useEffect(() => {
    if (!awareness || followClientId === null) return;

    const apply = () => {
      const rawState = awareness.getStates().get(followClientId);
      if (!rawState) {
        if (hasSeenStateRef.current) {
          // The followed client WAS present and just disappeared (left the
          // room) — stop following.
          setFollowClientId(null);
        }
        return;
      }
      hasSeenStateRef.current = true;
      const vp = (rawState as AwarenessState).viewport;
      if (!vp) return;
      const last = lastAppliedRef.current;
      if (last && last.x === vp.x && last.y === vp.y && last.zoom === vp.zoom) return;
      lastAppliedRef.current = vp;
      programmaticRef.current = true;
      setViewport(vp);
    };

    awareness.on('change', apply);
    apply();
    return () => awareness.off('change', apply);
  }, [awareness, followClientId, setViewport]);

  // Escape stops following.
  useEffect(() => {
    if (followClientId === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFollowClientId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [followClientId]);

  return { followClientId, follow, stopFollowing, notifyManualViewportChange };
}
