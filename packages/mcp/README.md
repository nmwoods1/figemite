# @figemite/mcp

MCP server that lets AI agents join a [Figemite](https://github.com/nmwoods1/figemite)
board as a live multiplayer peer — the AI gets its own visible cursor and name
pill, and its edits sync live and persist just like a human's.

Requires a running Figemite server (`@figemite/server`, or `npm run dev` from
a clone of the monorepo) to connect to.

## Usage

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

All three env vars are optional. `FIGEMITE_HTTP_URL` is the URL of your own
localhost server, registered as the synthetic `local` instance (default
`http://localhost:5400`); `FIGEMITE_NAME` is the display name shown in the
browser (default `"AI"`); `FIGEMITE_CLIENT` tags the agent client (e.g.
`cursor`).

One MCP process can drive **any number of figemite servers at once**. Servers
are discovered over the local network (mDNS) and always include your own
localhost server. Call `list_instances` to see them, then pass an `instanceId`
to every board/draft tool — there is no hidden "active server", and stopped
instances drop off automatically via health checks.

Once connected, an agent can do things like: "list instances, connect to the
`spend` board on the `local` instance, and add a sticky note next to the Q3
numbers summarizing the variance."

## Tools

`list_instances`, `connect_board`, `disconnect`, `list_boards`, `create_board`,
`list_drafts`, `create_draft`, `get_board`, `get_node`, `list_nodes`,
`move_cursor`, `set_editing`, `set_viewport`, `add_node`, `add_drawing`,
`update_node`, `move_node`, `delete_node`, `set_node_text`, `set_description`,
`add_edge`, `update_edge`, `delete_edge`.

All tools except `list_instances` take a required `instanceId`.

See the [main repository](https://github.com/nmwoods1/figemite) for the full
tool contract, board data model, and how to run your own Figemite server.

## License

MIT
