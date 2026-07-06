import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHash, viewToHash, useAppView, type AppView } from './router.js';

describe('parseHash / viewToHash round-trip', () => {
  const cases: Array<{ name: string; view: AppView; hash: string }> = [
    { name: 'tagList (root)', view: { view: 'tagList' }, hash: '#/' },
    { name: 'untagged', view: { view: 'untagged' }, hash: '#/untagged' },
    {
      name: 'tagDetail simple tag',
      view: { view: 'tagDetail', tag: 'roadmap' },
      hash: '#/tag/roadmap',
    },
    {
      name: 'tagDetail URL-encoded tag (space + slash)',
      view: { view: 'tagDetail', tag: 'q3 planning/2026' },
      hash: `#/tag/${encodeURIComponent('q3 planning/2026')}`,
    },
    {
      name: 'board root (no sub-path)',
      view: { view: 'board', slug: 'spend', path: [] },
      hash: '#/spend',
    },
    {
      name: 'board with a multi-segment sub-board path',
      view: { view: 'board', slug: 'spend', path: ['nodeA', 'subB'] },
      hash: '#/spend/nodeA/subB',
    },
    {
      name: 'board with URL-encoded slug and path segments',
      view: {
        view: 'board',
        slug: 'my board',
        path: ['seg one', 'seg/two'],
      },
      hash: `#/${encodeURIComponent('my board')}/${encodeURIComponent('seg one')}/${encodeURIComponent('seg/two')}`,
    },
  ];

  for (const { name, view, hash } of cases) {
    it(`viewToHash produces the expected hash: ${name}`, () => {
      expect(viewToHash(view)).toBe(hash);
    });

    it(`parseHash inverts viewToHash: ${name}`, () => {
      expect(parseHash(viewToHash(view))).toEqual(view);
    });

    it(`parseHash parses the literal expected hash: ${name}`, () => {
      expect(parseHash(hash)).toEqual(view);
    });
  }

  it('parseHash treats an empty hash the same as "#/" (tagList)', () => {
    expect(parseHash('')).toEqual({ view: 'tagList' });
  });
});

describe('useAppView', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('initializes from the current window.location.hash', () => {
    window.location.hash = '#/tag/urgent';
    const { result } = renderHook(() => useAppView());
    expect(result.current[0]).toEqual({ view: 'tagDetail', tag: 'urgent' });
  });

  it('updates the view when a hashchange event fires', () => {
    const { result } = renderHook(() => useAppView());
    expect(result.current[0]).toEqual({ view: 'tagList' });

    act(() => {
      window.location.hash = '#/untagged';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current[0]).toEqual({ view: 'untagged' });
  });

  it('navigate() writes the corresponding hash to window.location', () => {
    const { result } = renderHook(() => useAppView());

    act(() => {
      result.current[1]({ view: 'board', slug: 'roadmap', path: ['a', 'b'] });
    });

    expect(window.location.hash).toBe('#/roadmap/a/b');
  });

  it('navigate() updates state directly when the target hash equals the current one (no hashchange fires in that case)', () => {
    window.location.hash = '#/tag/design';
    const { result } = renderHook(() => useAppView());
    expect(result.current[0]).toEqual({ view: 'tagDetail', tag: 'design' });

    act(() => {
      // Same resulting hash as the current one — assigning window.location.hash
      // to an unchanged value does not dispatch `hashchange`, so navigate()
      // must update the view via its state-setter fallback instead.
      result.current[1]({ view: 'tagDetail', tag: 'design' });
    });

    expect(result.current[0]).toEqual({ view: 'tagDetail', tag: 'design' });
  });
});
