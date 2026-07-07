// ── useAiLock: the AI-session lock (SSE + reconnect + status reconcile) ──────
//
// P5-T31 (plan v2 rough-edge b). With server-side doc persistence (P5-T28) and
// MCP edits flowing through the Yjs room (P5-T32), an AI session's writes
// CRDT-merge into the room and sync live to every open browser — there is
// nothing left for the client to re-fetch when the AI finishes. The AI lock is
// therefore purely a UX affordance: while an AI session is active, the
// editable canvas shows an "AI editing" banner and YIELDS (interactions
// gated) so a human editor's gestures don't fight the agent's; on unlock the
// room already reflects the AI's result.
//
// ── Server contract (packages/server/src/services/sse-hub.ts,
//    packages/server/src/api/handlers/{events,ai}.ts) ────────────────────────
//   - `GET /api/events?board=&path=` — an SSE stream. The FIRST frame is
//     always `sync`, carrying the CURRENT `{ locked, epoch }`
//     (`AiSessionState`, services/ai-session.ts) so a fresh (or reconnecting)
//     client is correct without waiting for anything else. Thereafter:
//       - `locked`   `{ epoch }` — an AI session began.
//       - `unlocked` `{ epoch, board? }` — an AI session ended; `board` (when
//         present) is the fresh post-AI content, included for a client that
//         wants to re-render immediately, but THIS hook deliberately never
//         looks at `board` — the caller's room already merged the AI's edits
//         live via the Yjs doc (P5-T28/T32), so there is no re-fetch to do.
//       - `external-change` `{ board? }` — a raw on-disk edit (e.g. a human
//         editing the JSON file directly, or the MCP editing OUTSIDE a live
//         room) was detected. This is a soft signal, not new content this
//         hook applies: the caller may want to clear its undo stack (an
//         external edit invalidates "my last local change" as an undo
//         target), which is exactly what `opts.onExternalChange` is for.
//         KNOWN LIMITATION: if the room is currently live (a provider
//         connected, doc in memory), an external raw-file edit is NOT merged
//         into that in-memory doc — there is no re-seeding of a live room
//         from disk in this codebase. `onExternalChange` can only clear undo;
//         it cannot pull the on-disk change into the live doc. Solving that
//         (room re-seeding) is explicitly out of scope for this task.
//   - `GET /api/ai/status?board=&path=` -> `{ locked, epoch }` — the
//     authoritative, poll-based reconciliation endpoint. This is the fix for
//     the reconnect hole: an SSE connection can silently drop (network blip,
//     laptop sleep, proxy timeout) and, per the classic race, exactly the
//     `unlocked` frame that would have cleared this hook's `aiLocked` can be
//     the one frame that gets lost — leaving the browser "locked forever"
//     even though the AI session is long over. This hook eliminates that
//     hole structurally: EVERY (re)connect (including the very first one)
//     immediately fetches `/api/ai/status` and sets `aiLocked` from its
//     answer, regardless of what SSE frames were or weren't seen in between.
//
// ── Epoch staleness ──────────────────────────────────────────────────────────
// `epoch` (server: services/ai-session.ts) increments on every begin/end/
// auto-end transition. This hook tracks the last-known epoch and ignores any
// incoming event (SSE frame OR status poll) whose epoch is OLDER than that —
// this guards against a re-ordered/duplicated frame (e.g. a buffered SSE
// frame arriving after a newer status poll already resolved) stomping newer
// state with stale state. An event with an epoch >= the last-known epoch is
// always accepted (">=", not ">", so a status poll reporting the SAME epoch
// as the last-seen event — the common case — still authoritatively sets
// `aiLocked`, since the poll is the reconciliation source of truth).
//
// ── Reconnect backoff ────────────────────────────────────────────────────────
// `EventSource` has no built-in backoff hook for a rewritten reconnect (its
// native auto-reconnect doesn't let us intercept "a reconnect is about to
// happen" to run the status-reconcile fetch), so this hook closes the errored
// EventSource itself and schedules its OWN reconnect via `setTimeout`, with a
// simple capped exponential backoff (1s, 2s, 4s, ... capped at 30s), reset to
// the base delay on every successful (re)connect (`sync` observed).
//
// ── Disabled paths ───────────────────────────────────────────────────────────
// No `slug` (no board to subscribe to) or `readonly` (static/read-only mode:
// no server, so no `/api/*` at all — app/mode.ts's `READONLY`) means this hook
// never opens an EventSource and `aiLocked` stays permanently `false`.

import { useEffect, useRef, useState } from 'react';

export interface UseAiLockOptions {
  /** True in the read-only static build (app/mode.ts) — disables SSE entirely. */
  readonly?: boolean;
  /** Called on an `external-change` SSE frame — a soft signal the caller may
   * use to invalidate local state (e.g. clear undo). See this module's doc
   * for the known live-room-reseeding limitation. */
  onExternalChange?(): void;
}

export interface AiLock {
  /** True while an AI session holds the write lock for this board/sub-board. */
  aiLocked: boolean;
}

/** `AiSessionState`, mirrored client-side (server: services/ai-session.ts). */
interface AiSessionState {
  locked: boolean;
  epoch: number;
}

const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

/** Builds the dotted `path` query param the server expects (boards-api.ts's
 * own `pathParam` convention, re-derived here rather than imported since it
 * isn't exported from that module). */
function pathParam(path: string[]): string | undefined {
  return path.length > 0 ? path.join('.') : undefined;
}

function eventsUrl(slug: string, path: string[]): string {
  const params = new URLSearchParams({ board: slug });
  const p = pathParam(path);
  if (p) params.set('path', p);
  return `/api/events?${params.toString()}`;
}

function statusUrl(slug: string, path: string[]): string {
  const params = new URLSearchParams({ board: slug });
  const p = pathParam(path);
  if (p) params.set('path', p);
  return `/api/ai/status?${params.toString()}`;
}

export function useAiLock(
  slug: string | undefined,
  path: string[],
  opts: UseAiLockOptions,
): AiLock {
  const [aiLocked, setAiLocked] = useState(false);

  // Read through refs so the connect/reconnect closures always see the
  // LATEST callback/path without needing to tear down and re-open the
  // EventSource on every render (same technique as useBoardInteractions.ts's
  // optionsRef / useEditableCanvas.ts's onOpenDescription ref).
  const onExternalChangeRef = useRef(opts.onExternalChange);
  useEffect(() => {
    onExternalChangeRef.current = opts.onExternalChange;
  });

  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  });

  useEffect(() => {
    if (!slug || opts.readonly) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = BASE_RECONNECT_MS;
    // The last-known epoch — used to reject a stale/out-of-order event.
    // Starts at -1 (lower than any real epoch, including 0) so the very
    // first event/poll this hook ever sees is always accepted.
    let lastEpoch = -1;

    const acceptEpoch = (epoch: number | undefined): boolean => {
      if (typeof epoch !== 'number') return true; // no epoch on this frame — accept it
      if (epoch < lastEpoch) return false;
      lastEpoch = epoch;
      return true;
    };

    const reconcileStatus = (): void => {
      fetch(statusUrl(slug, pathRef.current))
        .then((res) => (res.ok ? (res.json() as Promise<AiSessionState>) : null))
        .then((state) => {
          if (cancelled || !state) return;
          // The poll is the authoritative reconciliation source: it wins ties
          // (epoch === lastEpoch) against a possibly-stale event already
          // observed for that same epoch, which is why this check is `<`
          // (reject only strictly OLDER), not `<=`.
          if (state.epoch < lastEpoch) return;
          lastEpoch = state.epoch;
          setAiLocked(state.locked);
        })
        .catch(() => {
          // Network hiccup on the reconcile fetch itself — the next
          // reconnect (or the next successful poll) will retry. Nothing to
          // do here; do not let a rejected promise become an unhandled
          // rejection.
        });
    };

    const scheduleReconnect = (): void => {
      if (cancelled) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
        connect();
      }, reconnectDelay);
    };

    const connect = (): void => {
      if (cancelled) return;
      const source = new EventSource(eventsUrl(slug, pathRef.current));
      es = source;

      // Reconcile against the authoritative endpoint on EVERY (re)connect
      // attempt, independent of whether/when the new connection's own `sync`
      // frame arrives. This is the actual fix for "unlocked fired while the
      // socket was down": the SSE stream alone can't prove nothing was
      // missed BEFORE this connection was established — only the poll can —
      // so it must not wait on a frame that might itself be delayed or (in
      // principle) never arrive.
      reconcileStatus();

      source.addEventListener('sync', (event: MessageEvent) => {
        const data = JSON.parse(event.data) as AiSessionState;
        // The fresh connection's own initial sync is authoritative for
        // itself — always accept it and reset backoff, so a client is
        // correct immediately without waiting on the status poll (which may
        // still be in flight).
        lastEpoch = data.epoch;
        setAiLocked(data.locked);
        reconnectDelay = BASE_RECONNECT_MS;
      });

      source.addEventListener('locked', (event: MessageEvent) => {
        const data = JSON.parse(event.data) as { epoch?: number };
        if (!acceptEpoch(data.epoch)) return;
        setAiLocked(true);
      });

      source.addEventListener('unlocked', (event: MessageEvent) => {
        const data = JSON.parse(event.data) as { epoch?: number };
        if (!acceptEpoch(data.epoch)) return;
        // Deliberately ignore any `board` payload — the room already has the
        // AI's edits live (see module doc); there is nothing to re-fetch.
        setAiLocked(false);
      });

      source.addEventListener('external-change', () => {
        onExternalChangeRef.current?.();
      });

      source.onerror = () => {
        source.close();
        if (es === source) es = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
    // `opts.onExternalChange` is read via `onExternalChangeRef` and `path` via
    // `pathRef` (both set in their own effects above) precisely so this effect
    // only reconnects on `slug`/`opts.readonly` changing, not on every render
    // (`path` is a fresh array each render — same caveat as BoardCanvas.tsx's
    // `path` prop — and a caller may pass a fresh `onExternalChange` closure
    // each render too).
  }, [slug, opts.readonly]);

  return { aiLocked };
}
