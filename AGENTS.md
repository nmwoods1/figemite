# AGENTS.md

This is the contract for AI agents collaborating on a Figemite board through
`@figemite/mcp`. It's generated from the real tool registrations in
`packages/mcp/src/server.ts` — if you're extending the MCP server, update
this file to match; don't let it drift into aspirational documentation.

**Stability.** Tool names and their required parameters are a public contract
and are stable within a major version: they won't be removed, renamed, or
repurposed except in a new MAJOR release. New tools and new *optional*
parameters may be added in MINOR releases. See the versioning policy in
[RELEASING.md](RELEASING.md).

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
or `dashed` line style and an optional label. Either kind may set a `routing`
of `bezier` (default) | `straight` | `elbow`, controlling how the connector is
drawn between the two nodes.

**Comments and tags are human-owned.** They live in separate files
(`comments.json`, `tags.json`) precisely so that an AI agent rewriting board
content never touches them. There are no MCP tools for comments or tags —
this is enforced by omission, not just convention. Don't add any.

**Approving a draft is human-owned in the same way.** An agent can create and
edit drafts, but promoting one to overwrite prod is a browser-only action with
no MCP tool. Don't add one.

## Work in a draft, not on prod

A board's live `board.json` is "prod", and **prod is read-only** — for humans
and agents alike. You cannot edit the live board: every content-mutating tool
(`add_node`, `move_node`, `update_node`, `delete_node`, edges, drawings, …)
requires a connection to a **draft** and errors on a prod connection. So **work
in a draft**: a full, editable copy of the board stored at
`boards/<slug>/.drafts/<draftId>/`. You edit the draft live (same collaboration
loop as any board); a **human** later reviews it and, in their browser,
**approves** it to overwrite prod. (Comments and annotations are the only
changes allowed on the live board.)

The default workflow:

1. **Make (or find) a draft** — `create_draft` with the `instanceId` and board
   slug returns a new `draftId` (a copy of current prod); `list_drafts` lists
   existing ones.
2. **Connect to the draft** — `connect_board` with the same `instanceId`, the
   `slug`, **and** `draft: <draftId>`. Your edits now land in the draft, never
   prod.
3. **A human approves** — only a person can promote a draft to prod, from their
   browser. **There is deliberately no `promote`/`approve` tool** — the same way
   comments and tags stay human-owned by having no tools (see below). Don't ask
   for one; it won't be added.

You *can* still `connect_board` to prod directly (no `draft`) — but only to
**read/observe** it (get the snapshot, move your cursor). Any content edit on a
prod connection is rejected with a "create a draft" error. To change anything,
connect with a `draft`.

## Instances — pick a server first

A single MCP process can talk to **any number of figemite servers at once**.
Each running server is an **instance** with a stable `id`, discovered over the
local network (mDNS) or included automatically as your own localhost server
(id `local`). **Every board and draft operation is addressed by `instanceId`** —
there is no hidden "active server".

1. **List** — call `list_instances` to see every reachable server: its `id`,
   `name`, `url`, `boards`, `version`, and health. Stopped or crashed instances
   drop off this list automatically (a background health check evicts anything
   that stops responding to `GET /api/instance`).
2. **Address by id** — pass the `instanceId` from that list to `connect_board`
   and to the board/draft management tools (`list_boards`, `create_board`,
   `list_drafts`, `create_draft`). Read, presence, and content tools operate on
   the connection you opened for that `instanceId`.
3. **Many at once** — you may `connect_board` to several instances
   concurrently; each holds its own connection, keyed by `instanceId`.
   Re-connecting with the same `instanceId` replaces that instance's
   connection (e.g. to switch board or draft on that server).

## The collaboration loop

1. **Connect** — call `connect_board` with an `instanceId` (from
   `list_instances`) and a board slug (and, preferably, a `draft` id — see
   above). This joins the board/draft as a real multiplayer peer: you get a
   visible cursor and an "AI" name pill in every connected browser, exactly like
   a human collaborator.
2. **Read** — inspect current state with `get_board` / `get_node` /
   `list_nodes` before deciding what to change.
3. **Edit via ops** — call the node/edge tools below. Each call is a real
   CRDT operation on the shared room: the same op the browser client itself
   uses, not a side-channel API.
4. **Your edits sync live and persist** — every connected human sees your
   change immediately (with a small cursor-lead delay so it reads as
   deliberate, not a teleporting mutation), and the server debounces a
   writeback to `board.json` on disk (or the draft's copy). There is no
   separate "save" step.
5. **Disconnect** when done, or just let the session end — `disconnect`
   removes your presence cleanly, but the server also auto-ends stale AI
   sessions on its own.

## Tools

Every tool below except `list_instances` takes a required **`instanceId`** (from
`list_instances`) naming which server it acts on.

### Instances

| Tool             | Purpose                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `list_instances` | List every reachable figemite server (id, name, url, boards, version, health). Takes no arguments. Stopped instances are dropped automatically via health checks. |

### Connection

| Tool            | Purpose                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `connect_board` | Connect to a board (or a draft, via `draft`) on a given `instanceId` as a multiplayer AI peer. Returns the current snapshot. |
| `disconnect`    | Disconnect from an instance's board and clear this peer's presence.                          |

### Board & draft management (HTTP, no connection required)

| Tool           | Purpose                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `list_boards`  | List every board on the given instance (slug, label, tags, last-modified, sub-boards).  |
| `create_board` | Create a new, empty board by slug (and optional label) on the given instance.           |
| `list_drafts`  | List a board's drafts on the given instance (id, title, who created it, when).           |
| `create_draft` | Create a new draft (a copy) of a board; returns its `draftId` to pass to `connect_board`. |

**There is deliberately no promote/approve tool.** Approving a draft to
overwrite prod is a human-only browser action — enforced, like comments and
tags, by omission (see below).

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

- `--http` / `FIGEMITE_HTTP_URL` — HTTP base URL of your own localhost server,
  registered as the synthetic `local` instance. Default `http://localhost:5400`.
- `--name` / `FIGEMITE_NAME` — display name shown in the browser. Default
  `"AI"`.
- `--client` / `FIGEMITE_CLIENT` — agent-client tag (e.g. `cursor`,
  `claude-code`). Default `"claude-code"`.

Other instances are discovered automatically over mDNS (`_figemite._tcp`); each
server advertises its `id`, `name`, `url`, `version`, and a board preview, and
also serves the authoritative `GET /api/instance`. Use `list_instances` to see
what's reachable and pass an `instanceId` to every board/draft tool — see
[SECURITY.md](SECURITY.md) for what reaching another host's server requires.
