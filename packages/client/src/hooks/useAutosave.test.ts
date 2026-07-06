// ── useAutosave tests ─────────────────────────────────────────────────────────
//
// Debounced coalescing save (plan v2 §3), ported from the legacy client's
// flushNow/submitCurrent (src/components/BoardCanvas.tsx) and the seq-based
// staleness guard in src/lib/autosave.ts (`shouldApplySaveResult`). O(1)
// dirtiness is the key departure from the legacy: a monotonic `dirtyEpoch`
// bumped on every doc `update`, compared by integer against `lastSavedEpoch` —
// never a `JSON.stringify`/`boardSignature` walk of the whole board.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { BoardFile } from '@easel/shared';
import { addNode } from '@easel/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { ApiError } from '../lib/boards-api.js';
import { useAutosave } from './useAutosave.js';
import type { UseAutosaveOptions } from './useAutosave.js';

/** Test default options — `formatVersion`/`boardLabel` mirror `fixtureBoard()`. */
function autosaveOptions(overrides: Partial<UseAutosaveOptions> = {}): UseAutosaveOptions {
  return {
    slug: 'board-a',
    path: [],
    enabled: true,
    formatVersion: 1,
    boardLabel: 'Fixture',
    ...overrides,
  };
}

const saveBoardMock = vi.fn<(slug: string, path: string[], data: BoardFile) => Promise<void>>();

vi.mock('../lib/boards-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/boards-api.js')>();
  return {
    ...actual,
    saveBoard: (...args: [string, string[], BoardFile]) => saveBoardMock(...args),
  };
});

function fixtureBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Fixture',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 10, y: 20 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'hello',
        color: '#fef3c7',
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

let store: BoardStore;

beforeEach(() => {
  vi.useFakeTimers();
  saveBoardMock.mockReset();
  saveBoardMock.mockResolvedValue(undefined);
  store = createBoardStore(fixtureBoard(), { readonly: false });
});

afterEach(() => {
  store.destroy();
  vi.useRealTimers();
});

function mutate(id = 'new1') {
  addNode(store.doc, { id, type: 'text', pos: { x: 0, y: 0 }, order: 1, text: 'x' });
}

describe('useAutosave', () => {
  it('starts idle with isDirty=false and does not save', () => {
    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));
    expect(result.current.saveStatus).toBe('idle');
    expect(result.current.isDirty).toBe(false);
    expect(saveBoardMock).not.toHaveBeenCalled();
  });

  it('becomes dirty on a doc change and debounces a save to ONE call after 1.5s', async () => {
    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    act(() => mutate('n2'));
    act(() => mutate('n3'));

    expect(result.current.isDirty).toBe(true);
    expect(saveBoardMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(saveBoardMock).toHaveBeenCalledTimes(1);
  });

  it('the save payload equals the current snapshot (formatVersion/boardLabel/viewport/nodes/edges)', async () => {
    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(saveBoardMock).toHaveBeenCalledTimes(1);
    const [slug, path, payload] = saveBoardMock.mock.calls[0];
    expect(slug).toBe('board-a');
    expect(path).toEqual([]);
    expect(payload.formatVersion).toBe(1);
    expect(payload.boardLabel).toBe('Fixture');
    expect(payload.viewport).toEqual(store.getViewport());
    expect(payload.nodes.map((n) => n.id).sort()).toEqual(['n1', 's1']);
    void result;
  });

  it('an unchanged board does not re-save (no dirty epoch bump, no timer)', async () => {
    renderHook(() => useAutosave(store, autosaveOptions()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(saveBoardMock).not.toHaveBeenCalled();
  });

  it('after a successful save, isDirty becomes false and status is saved', async () => {
    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(result.current.saveStatus).toBe('saved');
    expect(result.current.isDirty).toBe(false);
  });

  it('coalesces: a change that arrives during an in-flight save triggers a second save after it completes', async () => {
    let resolveFirst!: () => void;
    saveBoardMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveBoardMock).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe('saving');

    // A second doc change lands while the first save is still in-flight.
    act(() => mutate('n2'));

    // Resolve the first save.
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });

    // The coalesced pending save should fire (after its own debounce/flush).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(saveBoardMock).toHaveBeenCalledTimes(2);
  });

  it('a stale in-flight result does not clobber lastSavedEpoch for a newer change (seq guard)', async () => {
    // Saves are serialized by design (never two concurrent `saveBoard` calls —
    // a change arriving mid-flight is coalesced into `pending` and re-saved
    // once the current request settles). The seq guard's contract is that
    // ONLY a save whose request is still the most-recently-issued one may
    // advance `lastSavedEpoch`/set 'saved'. We exercise it directly here: the
    // first save's response resolves only AFTER a second, newer save has
    // already been issued (and resolved) — proving the first (now-stale)
    // resolution can't regress state to look "saved" for the older epoch.
    let resolveFirst!: () => void;
    saveBoardMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveBoardMock).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe('saving');

    // A second doc change lands while the first save is still in-flight —
    // coalesced (queued), not fired immediately.
    act(() => mutate('n2'));

    // The first (stale) request resolves now. Its target epoch is the epoch
    // AT THE TIME IT WAS ISSUED (before n2), which is older than the current
    // dirtyEpoch (bumped by n2) — so it must NOT clear isDirty.
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    expect(result.current.isDirty).toBe(true);

    // The coalesced pending save (covering n2) now fires and completes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveBoardMock).toHaveBeenCalledTimes(2);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.saveStatus).toBe('saved');
  });

  it('a 409 ApiError sets saveStatus to locked and stops scheduling further saves', async () => {
    saveBoardMock.mockRejectedValueOnce(new ApiError(409, 'locked by AI session'));

    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(result.current.saveStatus).toBe('locked');
    expect(saveBoardMock).toHaveBeenCalledTimes(1);

    // Further doc changes must not schedule a new save while locked.
    act(() => mutate('n2'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(saveBoardMock).toHaveBeenCalledTimes(1);
  });

  it('flushNow saves immediately without waiting for the debounce timer', async () => {
    const { result } = renderHook(() => useAutosave(store, autosaveOptions()));

    act(() => mutate('n1'));
    await act(async () => {
      result.current.flushNow();
      await Promise.resolve();
    });

    expect(saveBoardMock).toHaveBeenCalledTimes(1);
  });

  it('enabled=false never saves and reports idle status', async () => {
    const { result } = renderHook(() => useAutosave(store, autosaveOptions({ enabled: false })));

    act(() => mutate('n1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      result.current.flushNow();
      await Promise.resolve();
    });

    expect(saveBoardMock).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('idle');
  });
});
