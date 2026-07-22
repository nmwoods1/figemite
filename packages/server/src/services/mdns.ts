// ── MdnsService ───────────────────────────────────────────────────────────
//
// Advertises this board host on the LAN via mDNS/Bonjour so peers (e.g. an
// MCP server running elsewhere on the network) can discover it without a
// hardcoded IP or URL. Ported from the original prototype's `mdnsPlugin()`
// Vite plugin (vite.config.ts ~866-990): service type `_figemite._tcp`
// (a different service name in the legacy prototype), TXT record carrying
// `name` (the advertised hostname) and `boards` (comma-separated slugs).
//
// Deviation from the legacy prototype — DEFAULT OFF: the legacy plugin was
// unconditionally wired into `plugins: [...]` in vite.config.ts regardless of
// what the docs said about it being opt-in, so it silently ran mDNS
// broadcasts on every dev-server start. In this rewrite, `enabled` defaults
// to `false` and `start()` is a hard no-op — no Bonjour instance is even
// constructed — unless the caller explicitly passes `enabled: true`. This
// closes that gap structurally rather than relying on a doc comment.
//
// Other simplifications versus the legacy plugin (left for a later phase or
// deliberately out of scope for P1-T11, which only needs the core
// publish/TXT/dispose behaviour, config-gated):
//   - No VPN-aware interface picking (`pickMdnsInterface`/the legacy `*_MDNS_INTERFACE` env var).
//   - No automatic re-publish on boards-directory watch (`scheduleRepublish`).
//   - No uncaughtException safety net for stray multicast dgram errors.
// `getBoards()` is read fresh on every `start()`/publish, so whatever wires
// this up later can still re-publish on a schedule or a file-watch trigger
// by calling `start()` again (dispose + re-publish), or a future revision can
// extend this service with the above.

import os from 'node:os';
import { Bonjour } from 'bonjour-service';

/** The TXT record advertised for a figemite instance. All values are strings (mDNS TXT). */
export interface InstanceTxt {
  /** Stable per-process instance id — the registry keys on this. */
  id: string;
  /** Human-readable advertised name (defaults to `os.hostname()`). */
  name: string;
  /** Full HTTP base URL, e.g. `http://192.168.1.5:5400`. Empty until the port is known. */
  url: string;
  /** Advertised version string. */
  version: string;
  /** Comma-separated board-slug preview (capped — the full list comes from `/api/instance`). */
  boards: string;
}

/** The minimal shape MdnsService needs from a Bonjour-service instance. */
export interface BonjourLike {
  publish(config: { name: string; type: string; port: number; txt: InstanceTxt }): unknown;
  unpublishAll(callback?: () => void): void;
  destroy(callback?: () => void): void;
}

export interface MdnsServiceOptions {
  /** Master switch. Defaults to `false` — mDNS is genuinely off unless enabled. */
  enabled?: boolean;
  /**
   * Fallback TCP port to advertise. The real bound port is normally supplied to
   * `start({ port })` after `listen()` (see `startServer`); this is only used
   * when `start()` is called with no runtime override.
   */
  port?: number;
  /** Returns the current board slugs; read fresh at every publish. */
  getBoards: () => string[];
  /** Stable instance id advertised in the TXT record. */
  id: string;
  /** Version advertised in the TXT record. */
  version: string;
  /** Advertised host name. Defaults to `os.hostname()`. */
  name?: string;
  /** Factory for the Bonjour instance. Defaults to the real `bonjour-service`. Overridable for tests. */
  makeBonjour?: () => BonjourLike;
}

const SERVICE_TYPE = 'figemite'; // bonjour-service renders this as `_figemite._tcp`

/**
 * Cap the comma-joined board preview so the TXT record stays small (a single
 * TXT string is bounded and the whole record shares one UDP packet). The full,
 * authoritative board list is served by `GET /api/instance`.
 */
const TXT_BOARDS_MAX_LEN = 200;

function capBoards(slugs: string[]): string {
  const joined = slugs.join(',');
  if (joined.length <= TXT_BOARDS_MAX_LEN) return joined;
  return joined.slice(0, TXT_BOARDS_MAX_LEN).replace(/,[^,]*$/, '');
}

function defaultMakeBonjour(): BonjourLike {
  return new Bonjour();
}

export class MdnsService {
  private readonly enabled: boolean;
  private readonly getBoards: () => string[];
  private readonly id: string;
  private readonly version: string;
  private readonly name: string;
  private readonly makeBonjour: () => BonjourLike;

  private lastPort: number;
  private lastUrl = '';
  private bonjour: BonjourLike | null = null;

  constructor(options: MdnsServiceOptions) {
    this.enabled = options.enabled ?? false;
    this.lastPort = options.port ?? 0;
    this.getBoards = options.getBoards;
    this.id = options.id;
    this.version = options.version;
    this.name = options.name ?? os.hostname();
    this.makeBonjour = options.makeBonjour ?? defaultMakeBonjour;
  }

  /**
   * Publishes (or re-publishes) the `_figemite._tcp` service. A no-op unless
   * `enabled` was passed as `true`. Pass `{ port, url }` — normally the real
   * values known only after `http.Server#listen()` — to advertise the true
   * bound port and full URL; both persist across later re-publish calls (e.g.
   * on a board-list change). `boards` is re-read on every call.
   */
  start(runtime?: { port?: number; url?: string }): void {
    if (!this.enabled) return;
    if (runtime?.port !== undefined) this.lastPort = runtime.port;
    if (runtime?.url !== undefined) this.lastUrl = runtime.url;

    // Re-publish path: drop the previous advertisement before re-announcing so
    // stale port/board data never lingers on the network.
    if (this.bonjour) this.bonjour.unpublishAll();
    else this.bonjour = this.makeBonjour();

    this.bonjour.publish({
      name: this.name,
      type: SERVICE_TYPE,
      port: this.lastPort,
      txt: {
        id: this.id,
        name: this.name,
        url: this.lastUrl,
        version: this.version,
        boards: capBoards(this.getBoards()),
      },
    });
  }

  /** Unpublishes and destroys the Bonjour instance. Safe to call whether or not `start()` ran. */
  dispose(): void {
    if (!this.bonjour) return;
    const bonjour = this.bonjour;
    this.bonjour = null;
    bonjour.unpublishAll(() => bonjour.destroy());
  }
}
