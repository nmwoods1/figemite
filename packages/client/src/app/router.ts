// ── Client-side hash router ──────────────────────────────────────────────────
//
// Ported from the original prototype's `src/lib/router.ts`. The hash router
// maps URL fragments to one of four views:
//   #/                       → tagList   (default — the tag cards screen)
//   #/untagged               → untagged  (boards with no tags)
//   #/tag/<encoded>          → tagDetail (boards filtered to one tag)
//   #/<slug>[/<seg>/<seg>…]  → board     (canvas for a board or sub-board)
//
// Deviation from the legacy shape: the `board` view's slug field is named
// `slug` here (matching the P2-T15 spec), not `board` as in the prototype's
// `AppView`. Everything else — routes, encoding, round-trip behaviour — is
// ported faithfully.

import { useEffect, useState } from 'react';

export type AppView =
  | { view: 'tagList' }
  | { view: 'untagged' }
  | { view: 'tagDetail'; tag: string }
  | { view: 'board'; slug: string; path: string[] };

// ── Serialization ─────────────────────────────────────────────────────────────

export function viewToHash(v: AppView): string {
  switch (v.view) {
    case 'tagList':
      return '#/';
    case 'untagged':
      return '#/untagged';
    case 'tagDetail':
      return `#/tag/${encodeURIComponent(v.tag)}`;
    case 'board': {
      const parts = [v.slug, ...v.path].map((seg) => encodeURIComponent(seg));
      return '#/' + parts.join('/');
    }
  }
}

export function parseHash(hash: string): AppView {
  const stripped = hash.replace(/^#\/?/, '');
  if (!stripped) return { view: 'tagList' };

  const parts = stripped.split('/').filter(Boolean);
  const first = parts[0];

  if (first === 'untagged') return { view: 'untagged' };
  if (first === 'tag') {
    const raw = parts[1] ?? '';
    return { view: 'tagDetail', tag: decodeURIComponent(raw) };
  }
  // Fall through: treat as a board slug (+ optional sub-board path segments).
  const decoded = parts.map((seg) => decodeURIComponent(seg));
  return { view: 'board', slug: decoded[0] ?? '', path: decoded.slice(1) };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppView(): [AppView, (next: AppView) => void] {
  const [view, setView] = useState<AppView>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handler = () => setView(parseHash(window.location.hash));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = (next: AppView) => {
    const target = viewToHash(next);
    if (target !== window.location.hash) {
      window.location.hash = target;
    } else {
      setView(next);
    }
  };

  return [view, navigate];
}
