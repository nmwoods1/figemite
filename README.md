# Figemite

Figemite is a local-first, collaborative whiteboard. It runs on your own
machine, supports real-time multiplayer with live cursors, and lets AI agents
edit the board alongside you as a peer over MCP. Boards are stored as plain,
git-diffable JSON — no proprietary format, no server-side database, no
lock-in.

<!--
  Drop a screenshot or short screen-recording GIF of the board here (e.g.
  export it to docs/hero.gif) and it will show up below.
-->

![Figemite](docs/hero.gif)

## Quickstart (60 seconds)

Requires Node 20+ (see `.nvmrc`).

```bash
git clone https://github.com/nmwoods1/figemite.git && cd figemite
nvm use          # if you use nvm — picks up Node 20 from .nvmrc
npm ci
npm run dev
```

Open the dashboard URL Vite prints (defaults to `http://localhost:5173`),
then create a board from the dashboard. That's it — edits autosave to
`boards/<slug>/board.json` on disk.

## Multiplayer

Open the same board in two browser tabs and edit in one — the other updates
live, with a visible cursor and name pill for each peer.

By default the server only binds to `127.0.0.1`, so multiplayer works across
tabs on one machine but not across the network. Sharing a board with other
devices on your LAN is an **explicit opt-in** (off by default) — see
[SECURITY.md](SECURITY.md) for what that opt-in means before you turn it on.

## AI agents (MCP)

Figemite ships an MCP server (`@figemite/mcp`) that connects to a running
board as a multiplayer peer: the AI gets its own visible cursor and name
pill, and its edits sync live and persist just like a human's.

Add it to Claude Code, Cursor, or any MCP-compatible client:

```json
{
  "mcpServers": {
    "figemite": {
      "command": "npx",
      "args": ["-y", "@figemite/mcp"],
      "env": {
        "FIGEMITE_HTTP_URL": "http://localhost:5400",
        "FIGEMITE_NAME": "Claude Code",
        "FIGEMITE_CLIENT": "claude-code"
      }
    }
  }
}
```

All three env vars are optional. `FIGEMITE_HTTP_URL` defaults to
`http://localhost:5400`; `FIGEMITE_NAME` is the display name shown in the
browser (default `"AI"`); `FIGEMITE_CLIENT` tags the agent client (e.g.
`cursor`).

Once connected, an agent can do things like: "connect to the `spend` board
and add a sticky note next to the Q3 numbers summarizing the variance." See
[AGENTS.md](AGENTS.md) for the full tool contract.

## Features

- **7 node types** — sticky notes, text, shapes, frames, emoji, icons, and
  freehand drawings
- **Edges** — arrows and ER-style cardinality connectors between nodes
- **Comments** — threaded discussion pinned to a node or a canvas position,
  stored separately from the board so they're never touched by AI edits
- **Pencil / annotation** — persisted freehand strokes, plus ephemeral
  discussion scribbles that sync live but never save
- **History / time-travel** — every save is a version you can preview and
  restore, including snapshots around AI editing sessions
- **Tags** — per-board labels for organizing a dashboard of boards

## Static sharing

`npm run build:static` produces a read-only build in `public/` — no backend,
no writes, just the boards baked in as static JSON — suitable for hosting on
GitHub Pages (or GitLab Pages as a documented alternative). See
[CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Project layout

This is an npm-workspaces monorepo with four packages:

- `@figemite/shared` — board data model, CRDT ops, and types shared by every other package
- `@figemite/server` — the HTTP/WebSocket backend: board persistence, multiplayer sync, history
- `@figemite/client` — the React + ReactFlow whiteboard UI
- `@figemite/mcp` — the MCP server that lets AI agents join a board as a peer

## More

- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup and conventions
- [SECURITY.md](SECURITY.md) — the trust model, especially before enabling LAN sharing
- [RELEASING.md](RELEASING.md) — release checklist and definition-of-done
