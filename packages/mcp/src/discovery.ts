// ── PeerDiscovery — mDNS lookup of running easel servers on the LAN ─────────
//
// Ported from the legacy figmalade prototype's
// mcp/airjam-mcp-server/src/discovery.ts, renamed to match this rewrite's
// mDNS service type (`_easel._tcp`, published by `@easel/server`'s
// `MdnsService` — see packages/server/src/services/mdns.ts). TXT record
// shape is unchanged: `name` (advertised hostname) and `boards`
// (comma-separated slugs).
//
// `makeBonjour` is an injectable factory (defaulting to the real
// `bonjour-service`), mirroring the same pattern `MdnsService` already uses
// on the server side — so unit tests never open a real multicast socket.

import { Bonjour } from 'bonjour-service';

export interface PeerInfo {
  /** Display name from the mDNS TXT record, e.g. "nick". */
  name: string;
  /** mDNS hostname, e.g. "nick.local". */
  host: string;
  /** IPv4 addresses resolved from the service record. */
  addresses: string[];
  /** TCP port the easel server is listening on. */
  port: number;
  /** Board slugs from the TXT record. */
  boards: string[];
  /** epoch ms of last 'up' event. */
  lastSeen: number;
}

/** The minimal shape PeerDiscovery needs from a Bonjour-service instance. */
export interface BonjourLike {
  find(opts: { type: string }): BrowserLike;
  destroy(callback?: () => void): void;
}

interface ServiceLike {
  name: string;
  host: string;
  addresses?: string[];
  port: number;
  fqdn: string;
  txt?: Record<string, string>;
}

export interface BrowserLike {
  on(event: 'up' | 'down', listener: (service: ServiceLike) => void): unknown;
}

export interface PeerDiscoveryOptions {
  /** Factory for the Bonjour instance. Defaults to the real `bonjour-service`. Overridable for tests. */
  makeBonjour?: () => BonjourLike;
}

const SERVICE_TYPE = 'easel'; // bonjour-service renders this as `_easel._tcp`
const DEFAULT_PORT = 5400;

function defaultMakeBonjour(): BonjourLike {
  return new Bonjour() as unknown as BonjourLike;
}

export class PeerDiscovery {
  private readonly makeBonjour: () => BonjourLike;
  private bonjour: BonjourLike | null = null;
  private readonly peers = new Map<string, PeerInfo>();
  private warmUpPromise: Promise<void> | null = null;
  private started = false;

  constructor(options?: PeerDiscoveryOptions) {
    this.makeBonjour = options?.makeBonjour ?? defaultMakeBonjour;
  }

  /** Starts browsing for `_easel._tcp` peers. Idempotent — a second call is a no-op. */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Instantiate here so the multicast socket is never opened unless start()
    // is explicitly called — importing this module alone is side-effect free.
    this.bonjour = this.makeBonjour();
    const browser = this.bonjour.find({ type: SERVICE_TYPE });

    browser.on('up', (service) => {
      const txtName = service.txt?.name;
      const txtBoards = service.txt?.boards ?? '';
      const name = txtName || service.name;
      const boards = txtBoards ? txtBoards.split(',').filter(Boolean) : [];
      const info: PeerInfo = {
        name,
        host: service.host,
        addresses: service.addresses ?? [],
        port: service.port,
        boards,
        lastSeen: Date.now(),
      };
      this.peers.set(service.fqdn, info);
    });

    browser.on('down', (service) => {
      this.peers.delete(service.fqdn);
    });
  }

  /**
   * Wait up to `timeoutMs` for the first mDNS broadcast wave to arrive.
   * Starts discovery if it hasn't been already. Safe to call multiple
   * times — only waits on the first call.
   */
  warmUp(timeoutMs = 2_000): Promise<void> {
    if (!this.started) this.start();
    if (!this.warmUpPromise) {
      this.warmUpPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs));
    }
    return this.warmUpPromise;
  }

  /** Return all currently visible peers. */
  getPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }

  /**
   * Find a peer by name (case-insensitive). Also accepts a bare hostname
   * like "nick" or "nick.local". Returns null if not found.
   */
  resolvePeer(nameOrHost: string): PeerInfo | null {
    const q = nameOrHost.replace(/\.local$/i, '').toLowerCase();
    for (const peer of this.peers.values()) {
      if (peer.name.toLowerCase() === q) return peer;
      if (peer.host.replace(/\.local$/i, '').toLowerCase() === q) return peer;
    }
    return null;
  }

  /**
   * Build WebSocket and HTTP URLs for a discovered peer. Prefers the first
   * IPv4 address (more reliable on VPN) over the `.local` hostname.
   */
  buildUrls(peer: PeerInfo): { wsUrl: string; httpUrl: string } {
    const host = peer.addresses[0] ?? peer.host;
    return {
      wsUrl: `ws://${host}:${peer.port}/yjs`,
      httpUrl: `http://${host}:${peer.port}`,
    };
  }

  destroy(): void {
    this.bonjour?.destroy();
  }
}

/**
 * Build WebSocket/HTTP URLs from a directly-supplied address (no mDNS
 * discovery involved) — supports `connect_board(address)` pointing at a peer
 * whose server isn't (or can't be) discovered via mDNS. Accepts "host",
 * "host:port", or a full URL; scheme and path are stripped so a pasted
 * `http://host:port/whatever` still resolves correctly.
 */
export function buildDirectUrls(address: string): { wsUrl: string; httpUrl: string } {
  const stripped = address.replace(/^(ws|wss|http|https):\/\//i, '').replace(/\/.*$/, '');
  const [host, portStr] = stripped.split(':');
  const port = portStr ? Number(portStr) : DEFAULT_PORT;
  return {
    wsUrl: `ws://${host}:${port}/yjs`,
    httpUrl: `http://${host}:${port}`,
  };
}
