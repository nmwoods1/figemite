// ── MdnsService ───────────────────────────────────────────────────────────
//
// Advertises this board host on the LAN via mDNS/Bonjour so peers (e.g. an
// MCP server running elsewhere on the network) can discover it without a
// hardcoded IP or URL. Ported from the figmalade prototype's `mdnsPlugin()`
// Vite plugin (vite.config.ts ~866-990): service type `_easel._tcp`
// (`_airjam._tcp` in the legacy prototype), TXT record carrying `name` (the
// advertised hostname) and `boards` (comma-separated slugs).
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
//   - No VPN-aware interface picking (`pickMdnsInterface`/`AIRJAM_MDNS_INTERFACE`).
//   - No automatic re-publish on boards-directory watch (`scheduleRepublish`).
//   - No uncaughtException safety net for stray multicast dgram errors.
// `getBoards()` is read fresh on every `start()`/publish, so whatever wires
// this up later can still re-publish on a schedule or a file-watch trigger
// by calling `start()` again (dispose + re-publish), or a future revision can
// extend this service with the above.

import os from 'node:os';
import { Bonjour } from 'bonjour-service';

/** The minimal shape MdnsService needs from a Bonjour-service instance. */
export interface BonjourLike {
  publish(config: {
    name: string;
    type: string;
    port: number;
    txt: { name: string; boards: string };
  }): unknown;
  unpublishAll(callback?: () => void): void;
  destroy(callback?: () => void): void;
}

export interface MdnsServiceOptions {
  /** Master switch. Defaults to `false` — mDNS is genuinely off unless enabled. */
  enabled?: boolean;
  /** TCP port to advertise (the board server's listen port). */
  port: number;
  /** Returns the current board slugs; read fresh at every publish. */
  getBoards: () => string[];
  /** Advertised host name. Defaults to `os.hostname()`. */
  name?: string;
  /** Factory for the Bonjour instance. Defaults to the real `bonjour-service`. Overridable for tests. */
  makeBonjour?: () => BonjourLike;
}

const SERVICE_TYPE = 'easel'; // bonjour-service renders this as `_easel._tcp`

function defaultMakeBonjour(): BonjourLike {
  return new Bonjour();
}

export class MdnsService {
  private readonly enabled: boolean;
  private readonly port: number;
  private readonly getBoards: () => string[];
  private readonly name: string;
  private readonly makeBonjour: () => BonjourLike;

  private bonjour: BonjourLike | null = null;

  constructor(options: MdnsServiceOptions) {
    this.enabled = options.enabled ?? false;
    this.port = options.port;
    this.getBoards = options.getBoards;
    this.name = options.name ?? os.hostname();
    this.makeBonjour = options.makeBonjour ?? defaultMakeBonjour;
  }

  /** Publishes the `_easel._tcp` service. A no-op unless `enabled` was passed as `true`. */
  start(): void {
    if (!this.enabled) return;

    this.bonjour = this.makeBonjour();
    this.bonjour.publish({
      name: this.name,
      type: SERVICE_TYPE,
      port: this.port,
      txt: { name: this.name, boards: this.getBoards().join(',') },
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
