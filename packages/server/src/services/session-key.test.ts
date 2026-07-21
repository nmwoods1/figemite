import { describe, expect, it } from 'vitest';
import { sessionKey } from './session-key.js';

describe('sessionKey', () => {
  it('is just the slug for the root board (empty subPath)', () => {
    expect(sessionKey('my-board', [])).toBe('my-board');
  });

  it('joins the subPath segments with "." and appends after a "|" for a sub-board', () => {
    expect(sessionKey('my-board', ['frame1'])).toBe('my-board|frame1');
    expect(sessionKey('my-board', ['frame1', 'inner1'])).toBe('my-board|frame1.inner1');
  });

  it('prefixes a draft-scoped key with "<draftId>~" so it is distinct from prod', () => {
    expect(sessionKey('my-board', [], 'd1')).toBe('d1~my-board');
    expect(sessionKey('my-board', ['frame1'], 'd1')).toBe('d1~my-board|frame1');
  });

  it('gives prod, and two different drafts, three distinct keys for the same board', () => {
    const keys = new Set([
      sessionKey('my-board', []),
      sessionKey('my-board', [], 'd1'),
      sessionKey('my-board', [], 'd2'),
    ]);
    expect(keys.size).toBe(3);
  });
});
