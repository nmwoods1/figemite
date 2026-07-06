// ── Tag grouping/normalization helpers ───────────────────────────────────────
//
// Pure functions operating on `BoardListItem[]` (from `./boards-api.js`) —
// no fetching here, that's `fetchTags`/`saveTags` in `boards-api.ts`. Ported
// from the figmalade prototype's `src/lib/tags-io.ts`, minus the fetch/save
// wrappers which are superseded by the new data-access layer.

import type { BoardListItem } from './boards-api.js';

/** Lowercases, trims, and collapses internal whitespace runs to a single space. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalizes every tag and de-duplicates, preserving first-seen order. Drops empties. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Groups boards by each of their tags, and collects boards with no tags separately. */
export function groupByTag(boards: BoardListItem[]): {
  tagBoards: Map<string, BoardListItem[]>;
  untagged: BoardListItem[];
} {
  const tagBoards = new Map<string, BoardListItem[]>();
  const untagged: BoardListItem[] = [];

  for (const b of boards) {
    if (!b.tags || b.tags.length === 0) {
      untagged.push(b);
    } else {
      for (const tag of b.tags) {
        if (!tagBoards.has(tag)) tagBoards.set(tag, []);
        tagBoards.get(tag)!.push(b);
      }
    }
  }

  return { tagBoards, untagged };
}

/** Collects every unique tag across all boards, sorted alphabetically. */
export function allTags(boards: BoardListItem[]): string[] {
  const seen = new Set<string>();
  for (const b of boards) {
    for (const t of b.tags ?? []) seen.add(t);
  }
  return [...seen].sort();
}
