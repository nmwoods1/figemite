# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - YYYY-MM-DD

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
