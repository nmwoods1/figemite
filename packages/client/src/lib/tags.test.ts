import { describe, expect, it } from 'vitest';
import { normalizeTag, normalizeTags, groupByTag, allTags } from './tags.js';
import type { BoardListItem } from './boards-api.js';

function board(overrides: Partial<BoardListItem> & { slug: string }): BoardListItem {
  return {
    label: overrides.slug,
    tags: [],
    subBoardPaths: [],
    lastModifiedMs: 0,
    ...overrides,
  };
}

describe('normalizeTag', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeTag('  Roadmap  ')).toBe('roadmap');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeTag('q3   planning')).toBe('q3 planning');
  });
});

describe('normalizeTags', () => {
  it('normalizes and de-duplicates, preserving first-seen order', () => {
    expect(normalizeTags(['Roadmap', ' roadmap ', 'Q3'])).toEqual(['roadmap', 'q3']);
  });

  it('drops empty/whitespace-only entries', () => {
    expect(normalizeTags(['', '   ', 'ok'])).toEqual(['ok']);
  });
});

describe('groupByTag', () => {
  it('groups boards under each of their tags', () => {
    const boards = [
      board({ slug: 'a', tags: ['roadmap'] }),
      board({ slug: 'b', tags: ['roadmap', 'q3'] }),
    ];
    const { tagBoards } = groupByTag(boards);
    expect(tagBoards.get('roadmap')?.map((b) => b.slug)).toEqual(['a', 'b']);
    expect(tagBoards.get('q3')?.map((b) => b.slug)).toEqual(['b']);
  });

  it('collects boards with no tags into untagged', () => {
    const boards = [board({ slug: 'a', tags: [] }), board({ slug: 'b', tags: ['x'] })];
    const { untagged } = groupByTag(boards);
    expect(untagged.map((b) => b.slug)).toEqual(['a']);
  });
});

describe('allTags', () => {
  it('returns every unique tag across boards, sorted', () => {
    const boards = [
      board({ slug: 'a', tags: ['zeta', 'roadmap'] }),
      board({ slug: 'b', tags: ['roadmap'] }),
    ];
    expect(allTags(boards)).toEqual(['roadmap', 'zeta']);
  });

  it('returns an empty array when no boards have tags', () => {
    expect(allTags([board({ slug: 'a', tags: [] })])).toEqual([]);
  });
});
