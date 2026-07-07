import { describe, expect, it } from 'vitest';
import { roomNameFor } from '@figemite/shared';
import { parseRoomName } from './room-name.js';

describe('parseRoomName', () => {
  it('parses a root board room into { slug, subPath: [] }', () => {
    expect(parseRoomName('spend')).toEqual({ slug: 'spend', subPath: [] });
  });

  it('parses a single-segment sub-board room', () => {
    expect(parseRoomName('spend.frame1')).toEqual({ slug: 'spend', subPath: ['frame1'] });
  });

  it('parses a multi-segment (nested) sub-board room', () => {
    expect(parseRoomName('spend.frame1.inner1')).toEqual({
      slug: 'spend',
      subPath: ['frame1', 'inner1'],
    });
  });

  it('round-trips against roomNameFor for a root board', () => {
    const room = roomNameFor('my-board', []);
    expect(parseRoomName(room)).toEqual({ slug: 'my-board', subPath: [] });
  });

  it('round-trips against roomNameFor for a nested sub-board', () => {
    const room = roomNameFor('my-board', ['NodeA', 'NodeB']);
    expect(parseRoomName(room)).toEqual({ slug: 'my-board', subPath: ['NodeA', 'NodeB'] });
  });

  it('round-trips for every slug/subPath the reverse direction too', () => {
    const cases: Array<{ slug: string; subPath: string[] }> = [
      { slug: 'spend', subPath: [] },
      { slug: 'spend', subPath: ['frame1'] },
      { slug: 'a1', subPath: ['b2', 'c3', 'd4'] },
      { slug: 'my_board-1', subPath: ['Node_A-1'] },
    ];
    for (const { slug, subPath } of cases) {
      const room = roomNameFor(slug, subPath);
      expect(parseRoomName(room)).toEqual({ slug, subPath });
    }
  });

  it('rejects an empty room name', () => {
    expect(() => parseRoomName('')).toThrow();
  });

  it('rejects a room name with an invalid slug (path traversal attempt)', () => {
    expect(() => parseRoomName('../etc')).toThrow();
  });

  it('rejects a room name with an invalid segment character', () => {
    expect(() => parseRoomName('spend.frame/1')).toThrow();
  });

  it('rejects a room name with a leading dot (empty slug segment)', () => {
    expect(() => parseRoomName('.frame1')).toThrow();
  });

  it('rejects a room name with a trailing dot (empty final segment)', () => {
    expect(() => parseRoomName('spend.frame1.')).toThrow();
  });

  it('rejects a room name with consecutive dots (empty middle segment)', () => {
    expect(() => parseRoomName('spend..frame1')).toThrow();
  });

  it('rejects a room name containing whitespace', () => {
    expect(() => parseRoomName('my board')).toThrow();
  });
});
