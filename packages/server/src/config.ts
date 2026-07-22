// ── Server configuration ─────────────────────────────────────────────────────
//
// Extended by P1-T11 (YjsWebsocketService, MdnsService) with the fields those
// services need. Still just a type — nothing in this phase actually calls
// `http.Server#listen()` with these values; that wiring belongs to the API
// layer (P1-T12) and later phases. Recorded here now so the intent is fixed
// in one place as the config type grows.

/**
 * Version advertised for this server when `ServerConfig.version` is unset.
 * Kept in sync with `packages/server/package.json`'s `version` field.
 */
export const SERVER_VERSION = '0.0.0';

export interface ServerConfig {
  /** Absolute path to the directory containing one subdirectory per board. */
  boardsRoot: string;
  /** TCP port for the HTTP/WS server. */
  port?: number;
  /**
   * Stable identifier for this running instance, advertised over mDNS and
   * returned by `GET /api/instance`. Generated as a per-process
   * `crypto.randomUUID()` by `createServer` when unset — this disambiguates
   * multiple servers on one host (the mDNS `instanceName` defaults to
   * `os.hostname()` and would otherwise collide). A restarted server is a new
   * instance; the MCP registry evicts the old id via its health check.
   */
  instanceId?: string;
  /**
   * Human-readable name advertised over mDNS / `/api/instance`. Defaults to
   * `os.hostname()`.
   */
  instanceName?: string;
  /** Version string advertised over mDNS / `/api/instance`. Defaults to `SERVER_VERSION`. */
  version?: string;
  /**
   * Bind host for the HTTP server. Defaults to `127.0.0.1` — the plan's
   * local-first-safe-default: the server binds to loopback only unless a
   * caller explicitly opts into a LAN-reachable host (e.g. `0.0.0.0`, as the
   * original prototype dev server did unconditionally). Not wired to an actual
   * `listen()` call in this phase.
   */
  host?: string;
  /** Enables `MdnsService` LAN advertisement. Defaults to `false` — genuinely off unless set. */
  mdns?: boolean;
  /**
   * Socket-level timeout budget in ms, applied by `startServer` to the
   * underlying `http.Server`'s `requestTimeout` / `headersTimeout` /
   * `keepAliveTimeout`. Bounds how long a slow/stalled client (a slowloris-
   * style connection that opens a socket and trickles bytes, or never sends a
   * full request) can hold a connection open. Defaults to 30 seconds.
   */
  requestTimeoutMs?: number;
  /** File-watcher debounce window in ms — see `FileWatcher`. Configurable here so tests can shrink it. */
  debounceMs?: number;
  /** File-watcher self-write suppression window in ms — see `FileWatcher`. */
  suppressMs?: number;
  /**
   * Debounce window in ms between a Yjs room doc update and its write-back to
   * `board.json` — see `YjsWebsocketService`. Defaults to ~1000ms. Configurable
   * here so tests can shrink it.
   */
  yjsPersistDebounceMs?: number;
  /** AI auto-end timeout in ms — see `AiSessionManager`. */
  autoEndMs?: number;
  /** SSE heartbeat interval in ms — see `SseHub`. */
  heartbeatMs?: number;
}
