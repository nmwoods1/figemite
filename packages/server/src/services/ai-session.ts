// ── AiSessionManager ─────────────────────────────────────────────────────────
//
// Tracks the AI-editing lock per board/sub-board. Ported from the figmalade
// prototype's `activeAiSessions` map + begin/end handlers embedded in the
// dev-server Vite plugin (vite.config.ts ~369-392, ~587-638) into a
// standalone, transport-agnostic service: it knows nothing about HTTP or SSE,
// and instead notifies callers of state changes via an `onChange` callback
// (wired to `SseHub.broadcast` by the API layer in P1-T12).
//
// State per key: `{ locked, epoch }`. `epoch` increments on every transition
// (begin, end, and auto-end) so a client that reconnects its SSE stream mid-
// session can reconcile: it receives the current `{ locked, epoch }` as the
// SSE `sync` initial event (see SseHub.subscribe) and compares epochs to
// detect whether it missed a lock/unlock while disconnected.
//
// Semantics decided for this rewrite (the legacy prototype did not model
// these as explicitly since it had no separate epoch/state accessor):
//   - `begin()` on an already-locked key is a "refresh": it still increments
//     the epoch and still fires onChange (matching legacy, which broadcast
//     `{ ok: true, alreadyActive: true }` to the HTTP caller and reset the
//     timer, though the legacy code did NOT re-broadcast 'locked' over SSE
//     for a refresh — this rewrite chooses to fire onChange every time so
//     that epoch bumps are never silently missed by a listener).
//   - `end()` on a key that isn't locked is a pure no-op: no epoch bump, no
//     onChange, no timer changes. This matters because auto-end and an
//     explicit /api/ai/end can race (the auto-end timer fires just before
//     the end() call arrives) — without this, a second end() would bump the
//     epoch again for no real state change.
//   - Auto-end (the timer firing) is implemented as exactly the same
//     transition as end(): unlock, epoch++, onChange. This is the recovery
//     path when an AI client dies mid-session without calling /api/ai/end.

import { sessionKey } from './session-key.js';

export interface AiSessionState {
  locked: boolean;
  epoch: number;
}

export interface AiSessionManagerOptions {
  /** Auto-end timeout in ms. Defaults to 5 minutes, matching legacy AI_SESSION_TIMEOUT_MS. */
  autoEndMs?: number;
  /** Fired on every begin/end/auto-end transition with the affected key and its new state. */
  onChange?: (key: string, state: AiSessionState) => void;
}

const DEFAULT_AUTO_END_MS = 5 * 60 * 1000;

interface SessionRecord {
  locked: boolean;
  epoch: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class AiSessionManager {
  private readonly autoEndMs: number;
  private readonly onChange: (key: string, state: AiSessionState) => void;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: AiSessionManagerOptions) {
    this.autoEndMs = options.autoEndMs ?? DEFAULT_AUTO_END_MS;
    this.onChange = options.onChange ?? (() => {});
  }

  /**
   * Locks the session for `slug`/`subPath` and (re)arms the auto-end timer.
   * If already locked, this refreshes the timer rather than stacking a
   * second one. Always increments the epoch and fires onChange.
   */
  begin(slug: string, subPath: string[]): void {
    const key = sessionKey(slug, subPath);
    const existing = this.sessions.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    const epoch = (existing?.epoch ?? 0) + 1;
    const record: SessionRecord = { locked: true, epoch, timer: null };
    record.timer = setTimeout(() => this.autoEnd(key), this.autoEndMs);
    this.sessions.set(key, record);
    this.onChange(key, { locked: record.locked, epoch: record.epoch });
  }

  /**
   * Unlocks the session for `slug`/`subPath`. A no-op (no epoch bump, no
   * onChange) if the session isn't currently locked.
   */
  end(slug: string, subPath: string[]): void {
    const key = sessionKey(slug, subPath);
    this.transitionToUnlocked(key);
  }

  private autoEnd(key: string): void {
    this.transitionToUnlocked(key);
  }

  private transitionToUnlocked(key: string): void {
    const existing = this.sessions.get(key);
    if (!existing || !existing.locked) return; // safe no-op

    if (existing.timer) clearTimeout(existing.timer);
    const record: SessionRecord = { locked: false, epoch: existing.epoch + 1, timer: null };
    this.sessions.set(key, record);
    this.onChange(key, { locked: record.locked, epoch: record.epoch });
  }

  isLocked(slug: string, subPath: string[]): boolean {
    return this.sessions.get(sessionKey(slug, subPath))?.locked ?? false;
  }

  status(slug: string, subPath: string[]): AiSessionState {
    const record = this.sessions.get(sessionKey(slug, subPath));
    return record ? { locked: record.locked, epoch: record.epoch } : { locked: false, epoch: 0 };
  }

  /**
   * Cancels every pending auto-end `setTimeout` across all sessions, so
   * nothing keeps the process (or a test worker) alive after the owning
   * server shuts down. This is a lifecycle/handle concern only: it does NOT
   * fire `onChange`, does NOT unlock any session, and does NOT clear session
   * state — a disposed manager still answers `isLocked`/`status` queries
   * correctly, it just guarantees no timer will fire after this call.
   */
  dispose(): void {
    for (const record of this.sessions.values()) {
      if (record.timer) {
        clearTimeout(record.timer);
        record.timer = null;
      }
    }
  }
}
