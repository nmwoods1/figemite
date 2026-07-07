// ── lib/identity.ts tests ────────────────────────────────────────────────────
//
// getLocalUser/setLocalUser persist a display name to localStorage and derive
// a stable color from it via @figemite/shared's colorForName. Ported intent from
// the original prototype's getStoredAuthor/setStoredAuthor
// (src/lib/comment-io.ts) + realtime.ts's getLocalUser, ADAPTED so a name is
// never silently invented (no `guest-xxxxx` random fallback) — P29's
// IdentityPrompt is what asks a first-time user for a name; getLocalUser's
// contract here is just "read/derive from whatever is stored right now".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { colorForName } from '@figemite/shared';
import { getLocalUser, setLocalUser, hasStoredUser } from './identity.js';

describe('identity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('setLocalUser / getLocalUser', () => {
    it('persists a name to localStorage and getLocalUser reflects it', () => {
      setLocalUser('Ada');
      const user = getLocalUser();
      expect(user.name).toBe('Ada');
    });

    it('derives color via colorForName, matching the shared identity palette', () => {
      setLocalUser('Grace');
      const user = getLocalUser();
      expect(user.color).toBe(colorForName('Grace'));
    });

    it('is stable across repeated getLocalUser calls (same name -> same color)', () => {
      setLocalUser('Alan');
      const a = getLocalUser();
      const b = getLocalUser();
      expect(a).toEqual(b);
    });

    it('trims whitespace from the stored name', () => {
      setLocalUser('  Margaret  ');
      expect(getLocalUser().name).toBe('Margaret');
    });

    it('a later setLocalUser call overwrites the previous name', () => {
      setLocalUser('Ada');
      setLocalUser('Grace');
      expect(getLocalUser().name).toBe('Grace');
    });

    it('survives a fresh read (simulating a new session) via localStorage', () => {
      setLocalUser('Katherine');
      // Simulate "a new session" by not holding onto any in-memory state —
      // getLocalUser must re-derive purely from localStorage each call.
      expect(getLocalUser().name).toBe('Katherine');
      expect(getLocalUser().color).toBe(colorForName('Katherine'));
    });
  });

  describe('getLocalUser with nothing stored yet', () => {
    it('falls back to a non-empty guest name so awareness can still bootstrap', () => {
      const user = getLocalUser();
      expect(user.name.length).toBeGreaterThan(0);
    });

    it('derives a color for the fallback name via colorForName', () => {
      const user = getLocalUser();
      expect(user.color).toBe(colorForName(user.name));
    });
  });

  describe('hasStoredUser', () => {
    it('is false before any name has been set', () => {
      expect(hasStoredUser()).toBe(false);
    });

    it('is true after setLocalUser has been called', () => {
      setLocalUser('Ada');
      expect(hasStoredUser()).toBe(true);
    });
  });
});
