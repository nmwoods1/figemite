// ── usePresence tests ─────────────────────────────────────────────────────────
//
// P5-T30. Publishes the local user's live presence (cursor, editingNodeId,
// viewport, isAI: false) into a room's awareness, and subscribes to every
// OTHER client's awareness state as a `remotes` list — the shared data layer
// both PresenceLayer (cursors/outlines) and ActiveUsersPanel (who's online)
// render from.
//
// `awareness` is accepted as a minimal structural type (mirrors
// hooks/useSyncStatus.ts's `SyncStatusProvider` pattern) so tests drive a
// `FakeAwareness` double (test/fake-awareness.ts) rather than a real Yjs
// Awareness/WebsocketProvider.

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FakeAwareness } from '../test/fake-awareness.js';
import { usePresence } from './usePresence.js';

const LOCAL_USER = { name: 'Ada', color: '#3b82f6' };
/** Mirrors usePresence.ts's internal `CURSOR_THROTTLE_MS` (~30Hz). */
const CURSOR_THROTTLE_MS = 33;

describe('usePresence', () => {
  describe('publishing local state', () => {
    it('publishes the local user on mount', () => {
      const awareness = new FakeAwareness(1);
      renderHook(() => usePresence(awareness, LOCAL_USER));
      expect(awareness.getLocalState()?.user).toEqual(LOCAL_USER);
    });

    it('publishes isAI: false for a human local user', () => {
      const awareness = new FakeAwareness(1);
      renderHook(() => usePresence(awareness, LOCAL_USER));
      expect(awareness.getLocalState()?.isAI).toBe(false);
    });

    it('publishCursor sets the cursor field on local awareness state', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => result.current.publishCursor({ x: 12, y: 34 }));

      expect(awareness.getLocalState()?.cursor).toEqual({ x: 12, y: 34 });
    });

    it('publishCursor(null) clears the cursor field', () => {
      vi.useFakeTimers();
      try {
        const awareness = new FakeAwareness(1);
        const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

        act(() => result.current.publishCursor({ x: 1, y: 2 }));
        act(() => vi.advanceTimersByTime(CURSOR_THROTTLE_MS));
        act(() => result.current.publishCursor(null));
        act(() => vi.advanceTimersByTime(CURSOR_THROTTLE_MS));

        expect(awareness.getLocalState()?.cursor).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('setEditingNodeId sets the editingNodeId field on local awareness state', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => result.current.setEditingNodeId('node-1'));

      expect(awareness.getLocalState()?.editingNodeId).toBe('node-1');
    });

    it('setEditingNodeId(null) clears the editingNodeId field', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => result.current.setEditingNodeId('node-1'));
      act(() => result.current.setEditingNodeId(null));

      expect(awareness.getLocalState()?.editingNodeId).toBeNull();
    });

    it('publishViewport sets the viewport field on local awareness state', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => result.current.publishViewport({ x: 10, y: 20, zoom: 1.5 }));

      expect(awareness.getLocalState()?.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
    });
  });

  describe('cursor throttling', () => {
    it('throttles rapid publishCursor calls to ~30Hz (33ms), publishing only the latest value', () => {
      vi.useFakeTimers();
      try {
        const awareness = new FakeAwareness(1);
        const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

        act(() => {
          result.current.publishCursor({ x: 1, y: 1 });
          result.current.publishCursor({ x: 2, y: 2 });
          result.current.publishCursor({ x: 3, y: 3 });
        });

        // First call publishes immediately (no prior publish to throttle against).
        expect(awareness.getLocalState()?.cursor).toEqual({ x: 1, y: 1 });

        act(() => vi.advanceTimersByTime(33));

        // The trailing calls coalesce into a single flush of the LATEST value.
        expect(awareness.getLocalState()?.cursor).toEqual({ x: 3, y: 3 });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not publish more than once within the throttle window', () => {
      vi.useFakeTimers();
      try {
        const awareness = new FakeAwareness(1);
        const setFieldSpy = vi.spyOn(awareness, 'setLocalStateField');
        const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));
        setFieldSpy.mockClear();

        act(() => {
          result.current.publishCursor({ x: 1, y: 1 });
          result.current.publishCursor({ x: 2, y: 2 });
        });

        const cursorPublishCount = setFieldSpy.mock.calls.filter(
          ([field]) => field === 'cursor',
        ).length;
        expect(cursorPublishCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('publishes a new cursor immediately once the throttle window has elapsed', () => {
      vi.useFakeTimers();
      try {
        const awareness = new FakeAwareness(1);
        const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

        act(() => result.current.publishCursor({ x: 1, y: 1 }));
        act(() => vi.advanceTimersByTime(40));
        act(() => result.current.publishCursor({ x: 9, y: 9 }));

        expect(awareness.getLocalState()?.cursor).toEqual({ x: 9, y: 9 });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('remotes', () => {
    it('is empty when no other client has published presence', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));
      expect(result.current.remotes).toEqual([]);
    });

    it('excludes self from the remotes list', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => result.current.publishCursor({ x: 5, y: 5 }));

      expect(result.current.remotes.some((r) => r.clientId === 1)).toBe(false);
    });

    it('lists a remote client that has published a user', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => awareness.setRemoteState(2, { user: { name: 'Grace', color: '#22c55e' } }));

      expect(result.current.remotes).toEqual([
        expect.objectContaining({
          clientId: 2,
          user: { name: 'Grace', color: '#22c55e' },
          cursor: null,
          editingNodeId: null,
          viewport: null,
          isAI: false,
        }),
      ]);
    });

    it('ignores a remote state with no `user` field (not yet bootstrapped)', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => awareness.setRemoteState(2, { cursor: { x: 1, y: 1 } }));

      expect(result.current.remotes).toEqual([]);
    });

    it('reflects a remote cursor', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() =>
        awareness.setRemoteState(2, {
          user: { name: 'Grace', color: '#22c55e' },
          cursor: { x: 42, y: 84 },
        }),
      );

      expect(result.current.remotes[0]?.cursor).toEqual({ x: 42, y: 84 });
    });

    it('reflects a remote editingNodeId', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() =>
        awareness.setRemoteState(2, {
          user: { name: 'Grace', color: '#22c55e' },
          editingNodeId: 'node-7',
        }),
      );

      expect(result.current.remotes[0]?.editingNodeId).toBe('node-7');
    });

    it('reflects a remote viewport', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() =>
        awareness.setRemoteState(2, {
          user: { name: 'Grace', color: '#22c55e' },
          viewport: { x: 1, y: 2, zoom: 3 },
        }),
      );

      expect(result.current.remotes[0]?.viewport).toEqual({ x: 1, y: 2, zoom: 3 });
    });

    it('marks an AI peer via isAI and surfaces agentClient', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() =>
        awareness.setRemoteState(2, {
          user: { name: 'agent-01', color: '#8b5cf6' },
          isAI: true,
          agentClient: 'claude-code',
        }),
      );

      expect(result.current.remotes[0]).toEqual(
        expect.objectContaining({ isAI: true, agentClient: 'claude-code' }),
      );
    });

    it('updates the remotes list when awareness changes', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => awareness.setRemoteState(2, { user: { name: 'Grace', color: '#22c55e' } }));
      expect(result.current.remotes).toHaveLength(1);

      act(() => awareness.setRemoteState(2, null));
      expect(result.current.remotes).toHaveLength(0);
    });

    it('lists multiple remotes', () => {
      const awareness = new FakeAwareness(1);
      const { result } = renderHook(() => usePresence(awareness, LOCAL_USER));

      act(() => {
        awareness.setRemoteState(2, { user: { name: 'Grace', color: '#22c55e' } });
        awareness.setRemoteState(3, { user: { name: 'Alan', color: '#ef4444' } });
      });

      expect(result.current.remotes.map((r) => r.clientId).sort()).toEqual([2, 3]);
    });
  });

  describe('null awareness (no room / not yet joined)', () => {
    it('remotes is empty', () => {
      const { result } = renderHook(() => usePresence(null, LOCAL_USER));
      expect(result.current.remotes).toEqual([]);
    });

    it('publish functions are safe no-ops', () => {
      const { result } = renderHook(() => usePresence(null, LOCAL_USER));
      expect(() => {
        result.current.publishCursor({ x: 1, y: 1 });
        result.current.setEditingNodeId('x');
        result.current.publishViewport({ x: 0, y: 0, zoom: 1 });
      }).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('unsubscribes the change listener on unmount', () => {
      const awareness = new FakeAwareness(1);
      const offSpy = vi.spyOn(awareness, 'off');
      const { unmount } = renderHook(() => usePresence(awareness, LOCAL_USER));
      unmount();
      expect(offSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });
});
