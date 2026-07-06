// ── Server configuration ─────────────────────────────────────────────────────
//
// Later phases add ports, feature flags, etc. — kept minimal for now since
// this phase only needs the file-persistence layer.

export interface ServerConfig {
  /** Absolute path to the directory containing one subdirectory per board. */
  boardsRoot: string;
}
