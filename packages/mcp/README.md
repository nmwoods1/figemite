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

All three env vars are optional. `FIGEMITE_HTTP_URL` defaults to
`http://localhost:5400`; `FIGEMITE_NAME` is the display name shown in the
browser (default `"AI"`); `FIGEMITE_CLIENT` tags the agent client (e.g.
`cursor`).

Once connected, an agent can do things like: "connect to the `spend` board
and add a sticky note next to the Q3 numbers summarizing the variance."

## Tools

`connect_board`, `disconnect`, `list_boards`, `create_board`, `get_board`,
`get_node`, `list_nodes`, `move_cursor`, `set_editing`, `set_viewport`,
`add_node`, `add_drawing`, `update_node`, `move_node`, `delete_node`,
`set_node_text`, `set_description`, `add_edge`, `update_edge`, `delete_edge`.

See the [main repository](https://github.com/nmwoods1/figemite) for the full
tool contract, board data model, and how to run your own Figemite server.

## License

MIT
