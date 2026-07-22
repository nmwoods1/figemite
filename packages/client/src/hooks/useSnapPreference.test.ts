// ── useSnapPreference tests ──────────────────────────────────────────────────
//
// A client-only VIEW preference (grid-snap on/off), persisted to localStorage
// under 'figemite:snap' so it survives a refresh but never touches
// board.json — see useSnapPreference.ts's module doc for why.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSnapPreference, SNAP_STORAGE_KEY } from './useSnapPreference.js';

describe('useSnapPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults snapEnabled to true when localStorage is empty', () => {
    const { result } = renderHook(() => useSnapPreference());
    expect(result.current.snapEnabled).toBe(true);
  });

  it('toggle() flips snapEnabled to false and persists the new value', () => {
    const { result } = renderHook(() => useSnapPreference());
    act(() => result.current.toggle());
    expect(result.current.snapEnabled).toBe(false);
    expect(localStorage.getItem(SNAP_STORAGE_KEY)).toBe('0');
  });

  it('toggling twice flips back to true and persists that too', () => {
    const { result } = renderHook(() => useSnapPreference());
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.snapEnabled).toBe(true);
    expect(localStorage.getItem(SNAP_STORAGE_KEY)).toBe('1');
  });

  it('a fresh mount after a toggle reads back the persisted value', () => {
    const first = renderHook(() => useSnapPreference());
    act(() => first.result.current.toggle());
    expect(first.result.current.snapEnabled).toBe(false);

    const second = renderHook(() => useSnapPreference());
    expect(second.result.current.snapEnabled).toBe(false);
  });

  it('treats a stored "0" as false on initial read', () => {
    localStorage.setItem(SNAP_STORAGE_KEY, '0');
    const { result } = renderHook(() => useSnapPreference());
    expect(result.current.snapEnabled).toBe(false);
  });

  it('treats a stored "1" as true on initial read', () => {
    localStorage.setItem(SNAP_STORAGE_KEY, '1');
    const { result } = renderHook(() => useSnapPreference());
    expect(result.current.snapEnabled).toBe(true);
  });

  it('falls back to the true default if localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useSnapPreference());
    expect(result.current.snapEnabled).toBe(true);
  });

  it('does not throw if localStorage.setItem throws on toggle', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useSnapPreference());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    // The in-memory state still flips even though persistence failed.
    expect(result.current.snapEnabled).toBe(false);
  });
});
