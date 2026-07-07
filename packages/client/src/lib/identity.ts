// ── Local user identity ───────────────────────────────────────────────────────
//
// Ported from the legacy figmalade prototype's `getStoredAuthor`/
// `setStoredAuthor` (src/lib/comment-io.ts) and `getLocalUser`
// (src/lib/realtime.ts), unified behind one module since this rewrite's
// presence/awareness identity IS the comment-author identity (one display
// name per browser, not two independently-tracked ones).
//
// `colorForName` (from `@easel/shared`'s identity/color.ts) deterministically
// derives a cursor/presence color from the name, so two tabs/sessions with the
// same stored name always render the same color — no server round-trip needed
// to agree on identity.
import { colorForName } from '@easel/shared';
import type { PresenceUser } from '@easel/shared';

const NAME_KEY = 'easel:author';

/** Stable per-browser fallback so awareness always has a non-empty name, even
 * before IdentityPrompt has ever run (e.g. a test harness, or a user who
 * dismisses the prompt) — mirrors the legacy realtime.ts's `guest-xxxxx`
 * fallback. Generated once and cached in module state for this session (NOT
 * persisted — a real name, once set via `setLocalUser`, always wins on the
 * next read). */
let sessionGuestName: string | null = null;

function guestName(): string {
  if (!sessionGuestName) {
    sessionGuestName = `guest-${Math.random().toString(36).slice(2, 7)}`;
  }
  return sessionGuestName;
}

function readStoredName(): string | null {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    return raw && raw.trim().length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Whether a real (non-fallback) name has already been stored — used to gate
 * IdentityPrompt so a returning user isn't prompted again. */
export function hasStoredUser(): boolean {
  return readStoredName() !== null;
}

/** The current local user: the stored display name (if any) and its
 * deterministically-derived color. Falls back to a stable per-session guest
 * name when nothing has been stored yet, so awareness can always bootstrap
 * with a non-null identity (see `lib/realtime.ts`'s bootstrap comment for why
 * that non-null requirement is critical). */
export function getLocalUser(): PresenceUser {
  const name = readStoredName() ?? guestName();
  return { name, color: colorForName(name) };
}

/** Persist `name` (trimmed) as the local user's display name. A no-op (never
 * throws) if localStorage is unavailable — matches the legacy's
 * best-effort/never-throw persistence contract. */
export function setLocalUser(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(NAME_KEY, trimmed);
  } catch {
    /* ignore — best-effort persistence, same as the legacy */
  }
}
