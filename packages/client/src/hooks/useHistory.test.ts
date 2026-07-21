// ── useHistory tests ──────────────────────────────────────────────────────────
//
// Time-travel state machine backing components/HistoryPanel.tsx. The critical
// invariant under test: PREVIEWING a snapshot never mutates the live doc
// (`store.doc`) — only RESTORING does, via `loadBoardIntoDoc` + `undo.clear()`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { BoardFile } from '@figemite/shared';
import { createBoardStore } from '../store/board-store.js';
import type { BoardStore } from '../store/board-store.js';
import { useHistory } from './useHistory.js';

const boardsApiMock = vi.hoisted(() => ({
  fetchHistory: vi.fn(),
  fetchVersion: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => boardsApiMock);

function liveBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Live board',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'live text',
        color: '#fef3c7',
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function snapshotBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Live board',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 999, y: 888 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'old text',
        color: '#fef3c7',
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

const versionList = [
  { id: 'v3', timestamp: '2026-07-06T10:00:00.000Z', trigger: 'save' as const },
  { id: 'v2', timestamp: '2026-07-06T09:00:00.000Z', trigger: 'ai' as const },
  { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'preai' as const },
];

let store: BoardStore;
let clear: ReturnType<typeof vi.fn>;

beforeEach(() => {
  boardsApiMock.fetchHistory.mockReset().mockResolvedValue(versionList);
  boardsApiMock.fetchVersion.mockReset().mockResolvedValue(snapshotBoard());
  store = createBoardStore(liveBoard(), { readonly: false });
  clear = vi.fn();
});

afterEach(() => {
  store.destroy();
  vi.restoreAllMocks();
});

function setup(overrides: Partial<{ slug: string | undefined; path: string[] }> = {}) {
  return renderHook(() =>
    useHistory({
      slug: 'slug' in overrides ? overrides.slug : 'spend',
      path: overrides.path ?? [],
      store,
      undo: { clear },
    }),
  );
}

describe('useHistory', () => {
  it('starts closed, with no versions and no preview', () => {
    const { result } = setup();
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.versions).toEqual([]);
    expect(result.current.previewId).toBeNull();
    expect(result.current.previewedBoard).toBeNull();
  });

  it('is available when a slug is given', () => {
    const { result } = setup();
    expect(result.current.available).toBe(true);
  });

  it('is NOT available without a slug (no-room convenience path / READONLY defense-in-depth)', () => {
    const { result } = setup({ slug: undefined });
    expect(result.current.available).toBe(false);
  });

  it('openPanel is a no-op without a slug — never calls fetchHistory', () => {
    const { result } = setup({ slug: undefined });
    act(() => result.current.openPanel());
    expect(result.current.panelOpen).toBe(false);
    expect(boardsApiMock.fetchHistory).not.toHaveBeenCalled();
  });

  it('openPanel fetches history for the given slug/path (newest-first, as returned)', async () => {
    const { result } = setup({ slug: 'spend', path: ['nodeA'] });

    act(() => result.current.openPanel());

    expect(result.current.panelOpen).toBe(true);
    await vi.waitFor(() => expect(result.current.versions).toEqual(versionList));
    // Trailing `undefined` = prod scope (no draftId) — history threads a draft
    // scope through now (undefined on the live board).
    expect(boardsApiMock.fetchHistory).toHaveBeenCalledWith('spend', ['nodeA'], undefined);
  });

  it('is loading synchronously after openPanel, then resolves', async () => {
    const { result } = setup();

    act(() => result.current.openPanel());
    expect(result.current.versionsLoading).toBe(true);

    await vi.waitFor(() => expect(result.current.versionsLoading).toBe(false));
    expect(result.current.versions).toEqual(versionList);
    expect(result.current.versionsError).toBeNull();
  });

  it('sets versionsError when fetchHistory rejects', async () => {
    boardsApiMock.fetchHistory.mockReset().mockRejectedValue(new Error('network down'));
    const { result } = setup();

    act(() => result.current.openPanel());

    await vi.waitFor(() => expect(result.current.versionsLoading).toBe(false));
    expect(result.current.versionsError).toBe('network down');
    expect(result.current.versions).toEqual([]);
  });

  it('closePanel closes the panel without touching versions/preview', async () => {
    const { result } = setup();
    act(() => result.current.openPanel());
    await vi.waitFor(() => expect(result.current.versions.length).toBeGreaterThan(0));

    act(() => result.current.closePanel());

    expect(result.current.panelOpen).toBe(false);
    expect(result.current.versions).toEqual(versionList);
  });

  // ── Preview: isolated from the live doc ────────────────────────────────────

  it('preview(id) fetches the version and exposes it as previewedBoard', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.preview('v2');
    });

    expect(boardsApiMock.fetchVersion).toHaveBeenCalledWith('spend', [], 'v2', undefined);
    expect(result.current.previewId).toBe('v2');
    expect(result.current.previewedBoard).toEqual(snapshotBoard());
  });

  it('preview closes the panel', async () => {
    const { result } = setup();
    act(() => result.current.openPanel());

    await act(async () => {
      await result.current.preview('v2');
    });

    expect(result.current.panelOpen).toBe(false);
  });

  it('entering preview does NOT mutate the live doc', async () => {
    const { result } = setup();
    const before = store.getSnapshot();

    await act(async () => {
      await result.current.preview('v2');
    });

    // Same cached snapshot reference — board-store.ts only recomputes this on
    // an actual doc `update` event, so an unchanged reference here proves no
    // mutation reached `store.doc` at all.
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().nodes[0].pos).toEqual({ x: 0, y: 0 });
    expect(store.getSnapshot().nodes[0]).toMatchObject({ text: 'live text' });
    // undo.clear() is a restore-only side effect — preview must never call it.
    expect(clear).not.toHaveBeenCalled();
  });

  // ── Restore ─────────────────────────────────────────────────────────────

  it('restore() applies the previewed snapshot to the live doc', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.preview('v2');
    });

    act(() => result.current.restore());

    const snap = store.getSnapshot();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].pos).toEqual({ x: 999, y: 888 });
    expect(snap.nodes[0]).toMatchObject({ text: 'old text' });
  });

  it('restore() clears the undo/redo stack', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.preview('v2');
    });

    act(() => result.current.restore());

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('restore() exits preview', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.preview('v2');
    });

    act(() => result.current.restore());

    expect(result.current.previewId).toBeNull();
    expect(result.current.previewedBoard).toBeNull();
  });

  it('restore() with nothing previewed is a no-op (no doc mutation, no undo.clear())', () => {
    const { result } = setup();
    const before = store.getSnapshot();

    act(() => result.current.restore());

    expect(store.getSnapshot()).toBe(before);
    expect(clear).not.toHaveBeenCalled();
  });

  // ── Discard ─────────────────────────────────────────────────────────────

  it('discard() exits preview without changing the live doc', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.preview('v2');
    });
    const before = store.getSnapshot();

    act(() => result.current.discard());

    expect(result.current.previewId).toBeNull();
    expect(result.current.previewedBoard).toBeNull();
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().nodes[0]).toMatchObject({ text: 'live text' });
    expect(clear).not.toHaveBeenCalled();
  });
});
