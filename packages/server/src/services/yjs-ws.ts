// ── YjsWebsocketService ──────────────────────────────────────────────────────
//
// Mounts a y-websocket-compatible relay on an existing `http.Server`. Each
// board (and sub-board) gets its own room, keyed by `<slug>` or
// `<slug>.<NodeId>.<SubId>` — clients connect to `ws://<host>:<port>/yjs/<room>`.
// Ported from the original prototype's `yjsPlugin()` Vite plugin
// (vite.config.ts ~785-806).
//
// Vite's HMR (Phase 2) uses the same HTTP server for its own WebSocket
// upgrades. We share the port by creating the `WebSocketServer` with
// `noServer: true` and only completing the handshake for upgrade requests
// whose URL path starts with `/yjs/` — every other upgrade request is left
// untouched (no `socket.destroy()`, no response written) so another
// `'upgrade'` listener mounted on the same server can still handle it.
//
// y-websocket's server-side room/doc bookkeeping lives in its CJS-only
// `y-websocket/bin/utils` subpath export (there is no ESM build of it — see
// the package's `exports` map). `@figemite/server` is an ESM package
// (`"type": "module"`), but Node's ESM loader supports named imports from a
// CJS module via static analysis of its `module.exports` shape (cjs-module-
// lexer), so `import { setupWSConnection } from 'y-websocket/bin/utils'`
// works directly with no `createRequire` needed — verified by the
// integration test below actually relaying updates end-to-end.
//
// Benign side-effect of this interop: `bin/utils.cjs` reaches `yjs` via its
// own CJS `require('yjs')`, a separate module-registry entry from our ESM
// `import * as Y from 'yjs'` even though both resolve to the identical file
// on disk (confirmed via `require.resolve`). Yjs logs a one-time "Yjs was
// already imported" warning for this (see yjs/yjs#438) — cosmetic here, since
// nothing on our side does `instanceof Y.Doc` across the two instances; the
// wire protocol (sync/awareness messages) is what actually carries updates,
// and the integration test proves those converge correctly end-to-end.
//
// ── Server-side persistence (P5-T28) ─────────────────────────────────────────
//
// Before this phase, the Yjs room was in-memory only: `setupWSConnection`
// creates a `Y.Doc` per room name on first connect and keeps it alive only
// while clients are connected, with nothing seeding it from disk and nothing
// writing it back. Every client had to POST its own board content to seed a
// cold room. This phase makes the SERVER the single writer of board content:
// it seeds a fresh room doc from `board.json` (or leaves it empty for a
// brand-new board) and debounced-persists the doc back to disk on every edit.
//
// `setPersistence({ bindState, writeState })` vs. a manual `on('update')`
// hook — we use BOTH, for different halves of the job, because they solve
// different problems:
//
//   - `bindState(docName, doc)` is exactly the seed hook: `bin/utils.cjs`'s
//     `getYDoc` calls it exactly once, synchronously at doc-creation time
//     (inside `map.setIfUndefined`), before the doc is registered in its
//     module-level `docs` map or handed to any connection. That "runs exactly
//     once per doc, before any client can observe it" guarantee is precisely
//     the double-seed protection the spec asks for, and reimplementing it by
//     hand (tracking "have I seeded this room" ourselves) would just be
//     duplicating what `getYDoc` already does correctly. So: use it.
//
//   - `writeState(docName, doc)`, by contrast, is NOT a per-update hook — it
//     is called from `closeConn` only once `doc.conns.size === 0` (the LAST
//     websocket for that room disconnects), as a "flush before evicting the
//     doc from memory" step. That is a real and useful moment (we do want to
//     flush there — see `dispose`/idle-flush notes below), but it does not
//     fire on every edit while clients are connected, so it cannot alone
//     satisfy "debounce-serialise back to board.json on every update". Using
//     `setPersistence` for that half would mean either polling or silently
//     under-persisting until the room empties out.
//
//   Instead, `bindState` itself — which already has the one `(docName, doc)`
//   pair we need — registers a plain `doc.on('update', ...)` listener that
//   debounces and calls `persistNow`. This is the "equivalent per-doc
//   `on('update')` hook" the spec allows for, applied surgically to the half
//   of the job `setPersistence`'s hooks don't cover, rather than replacing
//   `setPersistence` altogether (which would forfeit the free double-seed
//   guarantee described above). `writeState` also calls `persistNow`
//   (awaited, per its Promise contract) so the doc is flushed before
//   `bin/utils.cjs` destroys it when the room empties out.
//
// Module-level global, single-instance caveat: `setPersistence` sets a
// variable at module scope in `y-websocket/bin/utils` — it is process-global,
// not scoped to a `YjsWebsocketService` instance. Constructing a second
// `YjsWebsocketService` in the same module registry replaces the first
// service's persistence hooks with its own. This is fine for production (one
// `YjsWebsocketService` per server process) and is why every test in this
// codebase that needs persistence creates its own isolated harness rather
// than running two `YjsWebsocketService`s concurrently in one process.
//
// Two documented subtleties in `bin/utils.cjs`'s OWN doc lifecycle (not bugs
// introduced here, but worth naming so a future reader isn't surprised):
//
//   1. `closeConn` calls `persistence.writeState(doc.name, doc)` (unawaited)
//      and then IMMEDIATELY (synchronously, not after the write settles)
//      does `docs.delete(doc.name)` when the last connection for a room
//      closes. In principle a reconnect landing inside that window would
//      create a brand-new doc (re-running `bindState`, re-reading disk)
//      before the old doc's flush had completed, which could theoretically
//      race with the new bind's read. In practice our `writeState`
//      (`flushRoom`) performs only synchronous `fs` calls (via
//      `BoardRepository`), so the write is already complete by the time the
//      `async writeState` function returns its (immediately-resolved)
//      promise — there is no real await boundary for a reconnect to land
//      inside. This is fragile only if `BoardRepository`'s write path ever
//      becomes genuinely asynchronous; flagged here so that change doesn't
//      silently reopen the window.
//
//   2. `this.rooms` is keyed by room/doc NAME, not by `Y.Doc` identity. If a
//      doc is evicted (room emptied) and a new doc for the SAME name is
//      created before the old doc's debounce timer fires, `dispose()`
//      (which iterates `this.rooms.values()`, i.e. the latest entry per
//      name) flushes the NEW doc's pending state but does not reach into the
//      old, now-orphaned timer/closure. That old timer still fires on its
//      own schedule and still correctly persists the OLD doc's own content
//      (each `RoomPersistState.flush` closes over its own `doc`/`slug`/
//      `subPath`, so there's no cross-contamination between the two) — it is
//      just not force-flushed early by `dispose()`. This can only happen
//      across a full room-eviction-then-recreation cycle within one
//      process's lifetime, which the current test suite does not exercise
//      (each test harness is torn down before that could occur).

import type http from 'node:http';
import { WebSocketServer } from 'ws';
// y-websocket has no types for its CJS `bin/utils` subpath; the runtime
// import works via Node's CJS/ESM interop (see module doc above).
// @ts-expect-error -- untyped CJS subpath export, see module doc above
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import * as Y from 'yjs';
import { FORMAT_VERSION, getSnapshot, loadBoardIntoDoc, type BoardFile } from '@figemite/shared';
import type { BoardRepository } from '../repository/board-repo.js';
import type { SnapshotHistoryService } from './snapshot-history.js';
import { parseRoomName } from './room-name.js';

const YJS_PREFIX = '/yjs/';

/** Default debounce window (ms) between a doc update and the write-back to disk. */
const DEFAULT_PERSIST_DEBOUNCE_MS = 1000;

export interface YjsWebsocketServiceOptions {
  /** Reads the current on-disk board (for seeding + preserving metadata) and writes the persisted result. */
  repo: BoardRepository;
  /** Takes a `'save'` snapshot after each debounced persist. */
  history: SnapshotHistoryService;
  /** The file-watcher's self-write suppression hook — called immediately before `repo.write`. */
  suppress: (slug: string, subPath: string[]) => void;
  /** Debounce window (ms) between a doc update and the write-back to disk. Defaults to 1000. */
  debounceMs?: number;
}

/**
 * Extracts the Yjs room name from an upgrade request's URL path, or `null`
 * if the path isn't under `/yjs/`. Pure — no sockets involved — so it's
 * unit-testable on its own. Handles a trailing query string and URL-decodes
 * the room segment.
 */
export function roomFromUpgradeUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (!url.startsWith(YJS_PREFIX)) return null;

  const withoutQuery = url.slice(YJS_PREFIX.length).split('?')[0];
  if (!withoutQuery) return null;

  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return null; // malformed percent-encoding
  }
}

/** Per-room bookkeeping for the debounced persist-on-update hook. */
interface RoomPersistState {
  timer: ReturnType<typeof setTimeout> | null;
  /** True once this doc has at least one update pending a flush. */
  dirty: boolean;
  /** Runs the write immediately and clears `dirty`/`timer`. Idempotent when not dirty. */
  flush: () => void;
}

export class YjsWebsocketService {
  private readonly wss = new WebSocketServer({ noServer: true });
  private httpServer: http.Server | null = null;
  private readonly repo: BoardRepository | undefined;
  private readonly history: SnapshotHistoryService | undefined;
  private readonly suppress: ((slug: string, subPath: string[]) => void) | undefined;
  private readonly debounceMs: number;
  private readonly rooms = new Map<string, RoomPersistState>();

  constructor(options?: YjsWebsocketServiceOptions) {
    this.repo = options?.repo;
    this.history = options?.history;
    this.suppress = options?.suppress;
    this.debounceMs = options?.debounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;

    if (this.repo && this.history && this.suppress) {
      setPersistence({
        bindState: (docName: string, doc: Y.Doc) => this.bindState(docName, doc),
        writeState: async (docName: string) => this.flushRoom(docName),
      });
    }
  }

  private readonly handleUpgrade = (
    req: InstanceType<typeof http.IncomingMessage>,
    socket: import('node:net').Socket,
    head: Buffer,
  ): void => {
    const room = roomFromUpgradeUrl(req.url);
    if (room === null) return; // not for us — leave it for another upgrade handler

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      setupWSConnection(ws, req, { docName: room });
    });
  };

  // ── Seed (bindState) ────────────────────────────────────────────────────────

  /**
   * Called once by `bin/utils.cjs`'s `getYDoc`, synchronously at doc-creation
   * time, before the doc is registered anywhere or handed to a connection —
   * see the module doc for why that ordering is the double-seed guard. Loads
   * the on-disk board (if any) into the fresh doc, then arms the debounced
   * persist-on-update listener for this doc's lifetime.
   *
   * A malformed room name (fails `parseRoomName`) is treated as "nothing to
   * seed, nothing to persist" — we never touch disk for it. This can't
   * actually happen via the real upgrade path (`roomFromUpgradeUrl` feeds
   * `docName` straight from the URL and `parseRoomName` uses the identical
   * grammar `BoardRepository`'s own path builders already enforce), but a
   * directly-constructed `Y.Doc`/room name (e.g. in a test, or a future
   * caller) gets the same safe treatment rather than throwing.
   */
  private bindState(docName: string, doc: Y.Doc): void {
    let parsed: { slug: string; subPath: string[] };
    try {
      parsed = parseRoomName(docName);
    } catch {
      return; // invalid room name — do not touch disk, do not arm persistence
    }
    const { slug, subPath } = parsed;

    // Guard against double-seeding: if the doc already has content (e.g. a
    // peer's sync step landed before this ran — bindState is synchronous
    // within getYDoc so this is mostly theoretical today, but is cheap
    // insurance against a future y-websocket version that awaits here), don't
    // clobber it with disk content.
    const snapshot = getSnapshot(doc);
    const alreadyHasContent = snapshot.nodes.length > 0 || snapshot.edges.length > 0;

    if (!alreadyHasContent && this.repo!.exists(slug, subPath)) {
      try {
        const board = this.repo!.read(slug, subPath);
        loadBoardIntoDoc(doc, { nodes: board.nodes, edges: board.edges });
      } catch {
        // Corrupt/invalid on-disk file — leave the doc empty rather than
        // throw during doc creation (the room still works; the next
        // persist-on-update will overwrite the corrupt file once the room
        // has real content).
      }
    }
    // No file on disk (or already seeded) — leave the doc as-is (empty for a
    // brand-new board).

    this.armPersist(docName, doc, slug, subPath);
  }

  // ── Persist-on-update (debounced) ───────────────────────────────────────────

  /** Registers the debounced `on('update')` writeback listener for one doc's lifetime. */
  private armPersist(docName: string, doc: Y.Doc, slug: string, subPath: string[]): void {
    const state: RoomPersistState = {
      timer: null,
      dirty: false,
      flush: () => {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        if (!state.dirty) return;
        state.dirty = false;
        this.persistNow(doc, slug, subPath);
      },
    };
    this.rooms.set(docName, state);

    doc.on('update', () => {
      state.dirty = true;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => state.flush(), this.debounceMs);
    });
  }

  /**
   * Builds the full `BoardFile` from the doc's current CRDT content plus
   * on-disk metadata (`boardLabel`/`viewport` are not stored in the doc), then
   * suppresses the file watcher and writes it through the repository — the
   * sole content-write path for a Yjs-backed room. Errors are swallowed
   * (logged) rather than thrown: this runs off a timer/doc-update, with no
   * caller to propagate a rejection to, and a transient write failure
   * shouldn't crash the process — the next debounced update will retry.
   */
  private persistNow(doc: Y.Doc, slug: string, subPath: string[]): void {
    try {
      let boardLabel = '';
      let viewport = { x: 0, y: 0, zoom: 1 };
      if (this.repo!.exists(slug, subPath)) {
        try {
          const existing = this.repo!.read(slug, subPath);
          boardLabel = existing.boardLabel;
          viewport = existing.viewport;
        } catch {
          // Current on-disk file is corrupt/unreadable — fall back to
          // defaults rather than aborting the persist (the doc content is
          // still authoritative and must reach disk).
        }
      }

      const { nodes, edges } = getSnapshot(doc);
      const board: BoardFile = {
        formatVersion: FORMAT_VERSION,
        boardLabel,
        viewport,
        nodes,
        edges,
      };

      this.suppress!(slug, subPath);
      this.repo!.write(slug, subPath, board);
      this.history!.snapshot(slug, subPath, 'save');
    } catch (err) {
      console.error(`YjsWebsocketService: failed to persist room (slug=${slug})`, err);
    }
  }

  /** Flushes a pending debounced write for `docName` immediately, if one exists. Used by `writeState` and `dispose`. */
  private flushRoom(docName: string): void {
    this.rooms.get(docName)?.flush();
  }

  /**
   * Registers an `'upgrade'` listener on `httpServer` that handles requests
   * under `/yjs/` and ignores everything else. Safe to call once per
   * service instance; calling it again attaches a second listener (the
   * caller is expected to call this exactly once per server).
   */
  attachUpgrade(httpServer: http.Server): void {
    this.httpServer = httpServer;
    httpServer.on('upgrade', this.handleUpgrade);
  }

  /**
   * Closes the WebSocketServer (and every open `/yjs/` connection), detaches
   * the upgrade listener, and — when persistence is configured — flushes
   * every room with a pending debounced write and clears its timer, so no
   * edit made just before shutdown is lost and no timer keeps the process
   * alive.
   */
  dispose(): void {
    if (this.httpServer) {
      this.httpServer.off('upgrade', this.handleUpgrade);
      this.httpServer = null;
    }
    for (const client of this.wss.clients) {
      client.terminate();
    }
    this.wss.close();

    for (const state of this.rooms.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      state.flush();
    }
    this.rooms.clear();
  }
}
