// ── InstanceRegistry — the MCP's live view of running figemite servers ────────
//
// One MCP process talks to ANY number of local figemite servers. This registry
// is that fan-out's source of truth: it ingests mDNS-discovered peers (via
// `PeerDiscovery`), always includes a synthetic "local" instance for the
// configured localhost server, and periodically health-checks every known
// instance by hitting its `GET /api/instance` endpoint. Instances that stop
// responding are evicted automatically — this is how a killed/crashed server
// (which never sends a clean mDNS `down`) disappears from `list_instances`.
//
// Everything IO-shaped is injectable (the `PeerDiscovery` instance and the
// instance-fetch function) so tests drive the whole lifecycle without opening a
// multicast socket or a real HTTP connection — mirroring the `makeBonjour` /
// `makeProvider` factory pattern used elsewhere in this package.

import { PeerDiscovery, buildDirectUrls, type PeerInfo } from './discovery.js';
import { getInstance, type InstanceInfoResult } from './board-http.js';

/** A running figemite server the MCP can address by `id`. */
export interface Instance {
  /** Stable instance id — the key every board/draft tool addresses. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** HTTP base URL, e.g. `http://10.0.0.5:5400`. */
  httpUrl: string;
  /** WebSocket base URL for Yjs rooms, e.g. `ws://10.0.0.5:5400/yjs`. */
  wsUrl: string;
  /** Board slugs currently on the server (from the last successful health check). */
  boards: string[];
  /** Advertised version. */
  version: string;
  /** epoch ms of the last successful health check. */
  lastSeen: number;
  /** Whether the last health check succeeded. */
  healthy: boolean;
}

type Source = 'local' | 'mdns';

/** Internal record: an `Instance` plus health-tracking bookkeeping. */
interface Entry extends Instance {
  source: Source;
  failures: number;
}

export interface InstanceRegistryOptions {
  /** URL of the always-present synthetic localhost instance (from FIGEMITE_HTTP_URL / default). */
  localUrl?: string;
  /** Id of the synthetic localhost instance. Defaults to `"local"`. */
  localId?: string;
  /** Injectable PeerDiscovery. Defaults to a fresh one. Tests supply a fake-backed instance. */
  discovery?: PeerDiscovery;
  /** Injectable instance fetch (health probe). Defaults to `board-http`'s `getInstance`. */
  fetchInstance?: (httpUrl: string, signal?: AbortSignal) => Promise<InstanceInfoResult>;
  /** Health-check interval in ms. Default 5000. */
  healthIntervalMs?: number;
  /** Per-check timeout in ms. Default 2000. */
  healthTimeoutMs?: number;
  /** Consecutive failed checks before an instance is evicted. Default 2. */
  maxFailures?: number;
}

const DEFAULT_LOCAL_ID = 'local';
const DEFAULT_HEALTH_INTERVAL_MS = 5_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_FAILURES = 2;

/** Derives `{ wsUrl }` from an http base URL (http→ws, `/yjs` room path). */
function wsUrlFor(httpUrl: string): string {
  return `${httpUrl.replace(/^http/, 'ws')}/yjs`;
}

export class InstanceRegistry {
  private readonly discovery: PeerDiscovery;
  private readonly fetchInstance: (httpUrl: string, signal?: AbortSignal) => Promise<InstanceInfoResult>;
  private readonly localUrl: string | undefined;
  private readonly localId: string;
  private readonly healthIntervalMs: number;
  private readonly healthTimeoutMs: number;
  private readonly maxFailures: number;

  private readonly entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(options: InstanceRegistryOptions = {}) {
    this.discovery = options.discovery ?? new PeerDiscovery();
    this.fetchInstance = options.fetchInstance ?? getInstance;
    this.localUrl = options.localUrl;
    this.localId = options.localId ?? DEFAULT_LOCAL_ID;
    this.healthIntervalMs = options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
    this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  }

  /** Starts mDNS discovery and the periodic health loop. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.discovery.start();
    // The interval must never keep the MCP process alive on its own.
    this.timer = setInterval(() => void this.tick(), this.healthIntervalMs);
    this.timer.unref?.();
  }

  /**
   * Wait up to `timeoutMs` for the first mDNS wave, then run one health tick so
   * discovered peers and the synthetic local instance are probed before the
   * first `list()`/`get()`.
   */
  async warmUp(timeoutMs = 2_000): Promise<void> {
    if (!this.started) this.start();
    await this.discovery.warmUp(timeoutMs);
    await this.tick();
  }

  /** All currently healthy instances. */
  list(): Instance[] {
    return [...this.entries.values()].filter((e) => e.healthy).map(toInstance);
  }

  /** A healthy instance by id, or `null` if unknown/unhealthy. */
  get(id: string): Instance | null {
    const entry = this.entries.get(id);
    return entry && entry.healthy ? toInstance(entry) : null;
  }

  /** Ids of every healthy instance — handy for building "did you mean" errors. */
  healthyIds(): string[] {
    return this.list().map((i) => i.id);
  }

  /** Stops the health loop and tears down mDNS. */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.discovery.destroy();
    this.entries.clear();
    this.started = false;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Ingest current mDNS peers + the synthetic local candidate, then health-check everyone. */
  private async tick(): Promise<void> {
    this.ingestCandidates();
    await Promise.allSettled([...this.entries.keys()].map((id) => this.checkOne(id)));
  }

  /** Upsert the local candidate and every mDNS peer into `entries` (URL/id only; health set by checkOne). */
  private ingestCandidates(): void {
    if (this.localUrl) {
      this.upsertCandidate(this.localId, this.localUrl, wsUrlFor(this.localUrl), 'local');
    }
    for (const peer of this.discovery.getPeers()) {
      const { httpUrl, wsUrl } = this.discovery.buildUrls(peer);
      const id = candidateId(peer, httpUrl);
      this.upsertCandidate(id, httpUrl, wsUrl, 'mdns', peer);
    }
  }

  private upsertCandidate(
    id: string,
    httpUrl: string,
    wsUrl: string,
    source: Source,
    peer?: PeerInfo,
  ): void {
    const existing = this.entries.get(id);
    if (existing) {
      // Refresh addressing (the server may have re-advertised a new URL), keep health state.
      existing.httpUrl = httpUrl;
      existing.wsUrl = wsUrl;
      return;
    }
    this.entries.set(id, {
      id,
      name: peer?.name ?? id,
      httpUrl,
      wsUrl,
      boards: peer?.boards ?? [],
      version: peer?.version ?? '',
      lastSeen: 0,
      healthy: false,
      source,
      failures: 0,
    });
  }

  /** Probe one instance's `/api/instance`; refresh metadata on success, evict after `maxFailures`. */
  private async checkOne(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.healthTimeoutMs);
    try {
      const info = await this.fetchInstance(entry.httpUrl, controller.signal);
      entry.healthy = true;
      entry.failures = 0;
      entry.lastSeen = Date.now();
      entry.name = info.name || entry.name;
      entry.boards = info.boards ?? entry.boards;
      entry.version = info.version || entry.version;
    } catch {
      entry.failures += 1;
      entry.healthy = false;
      if (entry.failures >= this.maxFailures) {
        this.entries.delete(id);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Strip internal bookkeeping fields before handing an entry to callers. */
function toInstance(entry: Entry): Instance {
  const { id, name, httpUrl, wsUrl, boards, version, lastSeen, healthy } = entry;
  return { id, name, httpUrl, wsUrl, boards, version, lastSeen, healthy };
}

/**
 * Registry key for an mDNS peer: its advertised id when present, else a stable
 * key derived from its resolved URL (defends against a legacy server that
 * didn't advertise an id — it still gets a consistent, deduplicated entry).
 */
function candidateId(peer: PeerInfo, httpUrl: string): string {
  return peer.id || `mdns:${httpUrl}`;
}

export { buildDirectUrls };
