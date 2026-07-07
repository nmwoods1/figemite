// ── useFollowMode tests ──────────────────────────────────────────────────────
//
// P5-T30. FigJam-style "watch someone's screen": `follow(clientId)` starts
// mirroring that remote's published `viewport` (awareness field) onto the
// local ReactFlow viewport via the caller-supplied `setViewport`, re-applied
// on every awareness `change` event so it tracks the leader's live pan/zoom.
// Escape (or `stopFollowing()`, wired to ActiveUsersPanel's Stop button)
// clears following; a manual pan/zoom (reported via
// `notifyManualViewportChange`, wired to ReactFlow's `onMoveStart`) also
// stops it — "don't fight the user" — but the follow-triggered
// `setViewport` call itself must NOT be misidentified as a manual move (the
// legacy prototype's `programmaticViewportRef` flag, ported here as internal
// state rather than exposed).
//
// `awareness` is the same minimal structural type as usePresence.ts's
// `PresenceAwareness`, satisfied here by `test/fake-awareness.ts`'s
// `FakeAwareness` double.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FakeAwareness } from '../test/fake-awareness.js';
import { useFollowMode } from './useFollowMode.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFollowMode', () => {
  it('starts with no one followed', () => {
    const awareness = new FakeAwareness(1);
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));
    expect(result.current.followClientId).toBeNull();
  });

  it('follow(clientId) sets followClientId', () => {
    const awareness = new FakeAwareness(1);
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));

    act(() => result.current.follow(2));

    expect(result.current.followClientId).toBe(2);
  });

  it("applies the followed remote's current viewport immediately on follow", () => {
    const awareness = new FakeAwareness(1);
    awareness.setRemoteState(2, {
      user: { name: 'Grace', color: '#22c55e' },
      viewport: { x: 10, y: 20, zoom: 1.5 },
    });
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));

    act(() => result.current.follow(2));

    expect(setViewport).toHaveBeenCalledWith({ x: 10, y: 20, zoom: 1.5 });
  });

  it('re-applies the viewport on every subsequent awareness change', () => {
    const awareness = new FakeAwareness(1);
    awareness.setRemoteState(2, {
      user: { name: 'Grace', color: '#22c55e' },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));
    act(() => result.current.follow(2));
    setViewport.mockClear();

    act(() =>
      awareness.setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
        viewport: { x: 99, y: 88, zoom: 2 },
      }),
    );

    expect(setViewport).toHaveBeenCalledWith({ x: 99, y: 88, zoom: 2 });
  });

  it('does not apply a viewport update while NOT following', () => {
    const awareness = new FakeAwareness(1);
    const setViewport = vi.fn();
    renderHook(() => useFollowMode(awareness, setViewport));

    act(() =>
      awareness.setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
        viewport: { x: 1, y: 1, zoom: 1 },
      }),
    );

    expect(setViewport).not.toHaveBeenCalled();
  });

  it('ignores awareness changes from a client other than the followed one', () => {
    const awareness = new FakeAwareness(1);
    awareness.setRemoteState(2, {
      user: { name: 'Grace', color: '#22c55e' },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));
    act(() => result.current.follow(2));
    setViewport.mockClear();

    act(() =>
      awareness.setRemoteState(3, {
        user: { name: 'Alan', color: '#ef4444' },
        viewport: { x: 500, y: 500, zoom: 3 },
      }),
    );

    expect(setViewport).not.toHaveBeenCalled();
  });

  it('stopFollowing() clears followClientId', () => {
    const awareness = new FakeAwareness(1);
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));
    act(() => result.current.follow(2));

    act(() => result.current.stopFollowing());

    expect(result.current.followClientId).toBeNull();
  });

  it('stops applying viewport updates after stopFollowing()', () => {
    const awareness = new FakeAwareness(1);
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));
    act(() => result.current.follow(2));
    act(() => result.current.stopFollowing());
    setViewport.mockClear();

    act(() =>
      awareness.setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
        viewport: { x: 1, y: 1, zoom: 1 },
      }),
    );

    expect(setViewport).not.toHaveBeenCalled();
  });

  it('if the followed remote disappears, following stops automatically', () => {
    const awareness = new FakeAwareness(1);
    awareness.setRemoteState(2, {
      user: { name: 'Grace', color: '#22c55e' },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const setViewport = vi.fn();
    const { result } = renderHook(() => useFollowMode(awareness, setViewport));
    act(() => result.current.follow(2));

    act(() => awareness.setRemoteState(2, null));

    expect(result.current.followClientId).toBeNull();
  });

  describe('Escape stops following', () => {
    it('pressing Escape while following clears followClientId', () => {
      const awareness = new FakeAwareness(1);
      const setViewport = vi.fn();
      const { result } = renderHook(() => useFollowMode(awareness, setViewport));
      act(() => result.current.follow(2));

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(result.current.followClientId).toBeNull();
    });

    it('pressing Escape while NOT following is a harmless no-op', () => {
      const awareness = new FakeAwareness(1);
      const setViewport = vi.fn();
      const { result } = renderHook(() => useFollowMode(awareness, setViewport));

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(result.current.followClientId).toBeNull();
    });
  });

  describe('manual viewport change stops following', () => {
    it('notifyManualViewportChange() while following stops it', () => {
      const awareness = new FakeAwareness(1);
      const setViewport = vi.fn();
      const { result } = renderHook(() => useFollowMode(awareness, setViewport));
      act(() => result.current.follow(2));

      act(() => result.current.notifyManualViewportChange());

      expect(result.current.followClientId).toBeNull();
    });

    it('does NOT stop following for the programmatic setViewport call follow() itself triggers', () => {
      // Simulates the real integration: the caller wires `setViewport` to
      // ReactFlow's imperative setter AND wires `notifyManualViewportChange`
      // to `onMoveStart`, which ReactFlow fires for EVERY viewport change,
      // including ones caused by the hook's own follow-triggered
      // `setViewport` call. The hook must distinguish "I just moved the
      // viewport myself" from "the user grabbed the canvas" so following
      // doesn't immediately self-cancel on its own first applied update.
      const awareness = new FakeAwareness(1);
      awareness.setRemoteState(2, {
        user: { name: 'Grace', color: '#22c55e' },
        viewport: { x: 5, y: 5, zoom: 1 },
      });
      const setViewport = vi.fn();
      const { result } = renderHook(() => useFollowMode(awareness, setViewport));

      // `follow()` commits, then its effect runs (flags `programmaticRef` and
      // calls `setViewport`) — separate `act()` calls so effects flush
      // between them, matching real timing (ReactFlow's `onMoveStart` fires
      // asynchronously relative to the triggering `setViewport` call, always
      // AFTER this hook's own effect has already flagged the ref).
      act(() => result.current.follow(2));
      expect(setViewport).toHaveBeenCalledWith({ x: 5, y: 5, zoom: 1 });

      // ReactFlow would fire onMoveStart in response to that programmatic move.
      act(() => result.current.notifyManualViewportChange());

      expect(result.current.followClientId).toBe(2);
    });
  });
});
