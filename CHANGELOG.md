# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-22

This release is a **major** version bump because the MCP tool contract
changed in a backward-incompatible way — see **Changed** below. Boards
written by 1.0.0 open unchanged: the on-disk `board.json` format
(`formatVersion` 1) is untouched, and the new drafts/sub-board data lives in
new sibling files. See [RELEASING.md](RELEASING.md) for the versioning policy
that classifies this as a major release.

### Changed

- **BREAKING (MCP): every board, draft, and content tool now takes a
  required `instanceId`.** Figemite can now address multiple running servers
  at once, so tools no longer act on a single implicit "active" server — each
  call names its target instance. Only `list_instances` takes no arguments.

  _Migration:_ an agent must first call `list_instances` to discover
  reachable servers, then pass the chosen `instanceId` to `connect_board` and
  every subsequent tool. Clients written against 1.0.0 (which called these
  tools without `instanceId`) will be rejected until updated. See
  [AGENTS.md](AGENTS.md).

### Added

- **Multi-instance MCP registry** with a new `list_instances` tool: discover
  every reachable Figemite server (id, name, url, boards, version, health)
  over mDNS and address each independently by `instanceId`; connect to
  several at once, each with its own peer connection.
- **Board drafts and a read-only "Live" board**: branch a board into a draft
  (human- or agent-created), edit it in isolation, and promote it back to
  live. The live board is read-only via the Live dropdown, with a human-only
  promote gate. New MCP tools `create_draft` and `list_drafts`.
- **Version history on live boards**: every save is a browsable, restorable
  version on the live board, including snapshots bracketing AI editing
  sessions.
- **Node sub-boards (drill-in)**: any node can open its own nested board,
  stored as a dotted-path sibling file — no change to the parent
  `board.json`.
- **Pressure-simulated freehand strokes**: pencil and annotation strokes
  render with simulated pen pressure for a more natural line. Rendering-only
  — the `drawing` node model and the MCP `add_drawing` contract are
  unchanged.
- **Board descriptions** and assorted draft/description handling.
- Implementation plans for grid snapping and floating-arrow edges
  (`docs/superpowers/plans/`), both designed as zero-migration changes.
- **Versioning policy** (RELEASING.md) and an MCP **stability** guarantee
  (AGENTS.md): tool names and required params are stable within a major
  version.

### Fixed

- Server no longer crashes on recursive `fs.watch` `'error'` events.
- Client board UI: sub-board access, connector reconnect, frame drag, and
  body font fixes.
- `npm run dev` / `build:static` now work from a cold clone.

## [1.0.0] - 2026-07-08

Initial release.

### Added

- **Whiteboard canvas** with 7 node types — sticky notes, text, shapes,
  frames, emoji, icons, and freehand drawings — plus arrow and ER-style
  cardinality edges between nodes.
- **Real-time multiplayer** over a shared CRDT (Yjs) room: edits from every
  connected peer (human or AI) converge live and persist to disk, with
  live cursors, editing outlines, and a "who's here" presence panel,
  including follow-mode to track another peer's viewport.
- **Comments and tags**, stored separately from board content
  (`comments.json`, `tags.json`) so they're never touched by AI edits.
- **Pencil and annotation tools**: persisted freehand drawing nodes, and
  ephemeral discussion scribbles that sync live but are never saved.
- **History and time-travel**: every save is a browsable, restorable
  version, including snapshots bracketing AI editing sessions.
- **AI agents via MCP** (`@figemite/mcp`): an MCP server that joins a board
  as a first-class multiplayer peer — connect, read board state, and create/
  update/move/delete nodes and edges, all through the same operations the
  browser client uses.
- **Local-first server** (`@figemite/server`): binds to `127.0.0.1` by
  default, with LAN sharing and mDNS advertisement as explicit, off-by-
  default opt-ins.
- **Static, read-only sharing**: `npm run build:static` produces a
  self-contained `public/` build (no backend) suitable for GitHub Pages or
  GitLab Pages.
- **Plain, git-diffable board storage**: every board is a `board.json` (plus
  `comments.json`/`tags.json`) under `boards/<slug>/` — no database, no
  proprietary format.
