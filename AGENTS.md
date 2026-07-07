# AGENTS.md

This is the contract for AI agents collaborating on a Figemite board through
`@figemite/mcp`. It's generated from the real tool registrations in
`packages/mcp/src/server.ts` — if you're extending the MCP server, update
this file to match; don't let it drift into aspirational documentation.

## The board data model

A board is a set of **nodes** and **edges**, synced live over a shared CRDT
(Yjs) room and persisted to `boards/<slug>/board.json`.

Node types (the `type` discriminant on every node):

- `sticky` — a colored sticky note with text
- `text` — free text, no background
- `shape` — a filled/outlined shape (`rect`, `ellipse`, `diamond`, and other
  kinds) with optional text
- `frame` — a titled container box
- `emoji` — a single emoji glyph at a chosen pixel size
- `icon` — a glyph from the built-in icon registry
- `drawing` — a persisted freehand pencil stroke (absolute points, computed
  bbox)

Every node has a stable `id`, a flow-space `pos` ({x, y}), an explicit
z-`order`, and an optional Markdown `description` (shown behind the ≡ badge
in the UI).

Edges connect two node ids (`source` -> `target`) and are either directional
`arrow`s (with an `arrow` style: `none` | `end` | `both`) or ER-style
`cardinality` connectors (`1:1` | `1:N` | `N:1` | `N:N`), each with a `solid`
or `dashed` line style and an optional label.

**Comments and tags are human-owned.** They live in separate files
(`comments.json`, `tags.json`) precisely so that an AI agent rewriting board
content never touches them. There are no MCP tools for comments or tags —
this is enforced by omission, not just convention. Don't add any.

## The collaboration loop

1. **Connect** — call `connect_board` with a board slug. This joins the
   board as a real multiplayer peer: you get a visible cursor and an "AI"
   name pill in every connected browser, exactly like a human collaborator.
2. **Read** — inspect current state with `get_board` / `get_node` /
   `list_nodes` before deciding what to change.
3. **Edit via ops** — call the node/edge tools below. Each call is a real
   CRDT operation on the shared room: the same op the browser client itself
   uses, not a side-channel API.
4. **Your edits sync live and persist** — every connected human sees your
   change immediately (with a small cursor-lead delay so it reads as
   deliberate, not a teleporting mutation), and the server debounces a
   writeback to `board.json` on disk. There is no separate "save" step.
5. **Disconnect** when done, or just let the session end — `disconnect`
   removes your presence cleanly, but the server also auto-ends stale AI
   sessions on its own.

## Tools

### Connection

| Tool            | Purpose                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `connect_board` | Connect to a board as a multiplayer AI peer; call this first. Returns the current snapshot. |
| `disconnect`    | Disconnect from the current board and clear this peer's presence.                           |

### Board management (HTTP, no connection required)

| Tool           | Purpose                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `list_boards`  | List every board on the targeted server (slug, label, tags, last-modified, sub-boards). |
| `create_board` | Create a new, empty board by slug (and optional label).                                 |

### Read

| Tool         | Purpose                                            |
| ------------ | -------------------------------------------------- |
| `get_board`  | Return every node and edge currently on the board. |
| `get_node`   | Return a single node by id.                        |
| `list_nodes` | List nodes, optionally filtered by type.           |

### Presence

| Tool           | Purpose                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `move_cursor`  | Move the AI's cursor to a flow-space position; humans see it move live.            |
| `set_editing`  | Show (or clear) an "editing" outline on a node, with an "[AI name] editing" label. |
| `set_viewport` | Publish the AI's viewport so humans can optionally follow it.                      |

### Node ops

| Tool              | Purpose                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `add_node`        | Add a node (any of the 7 types) at a position; returns its new id.                |
| `add_drawing`     | Add a freehand `drawing` node from absolute points; the server computes the bbox. |
| `update_node`     | Merge a patch of fields into an existing node.                                    |
| `move_node`       | Move a node to a new position.                                                    |
| `delete_node`     | Delete a node.                                                                    |
| `set_node_text`   | Set a node's text (or a frame's title).                                           |
| `set_description` | Set a node's Markdown description (the ≡ badge).                                  |

### Edge ops

| Tool          | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `add_edge`    | Add an arrow or cardinality edge between two nodes; returns its new id. |
| `update_edge` | Merge a patch of fields into an existing edge.                          |
| `delete_edge` | Delete an edge.                                                         |

## Configuration

The MCP entry point (`packages/mcp/src/index.ts`) reads, in order of
precedence (CLI flag, then env var, then default):

- `--http` / `FIGEMITE_HTTP_URL` — default HTTP base URL for board-management
  tools and for `connect_board` calls with no `address`. Default
  `http://localhost:5400`.
- `--name` / `FIGEMITE_NAME` — display name shown in the browser. Default
  `"AI"`.
- `--client` / `FIGEMITE_CLIENT` — agent-client tag (e.g. `cursor`,
  `claude-code`). Default `"claude-code"`.

`connect_board` also takes an optional `address` (an mDNS peer name, IP, or
hostname) to reach a board on a different figemite server than the default
local one — see [SECURITY.md](SECURITY.md) for what that requires on the
host side.
