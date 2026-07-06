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
});
