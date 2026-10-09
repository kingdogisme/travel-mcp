# travel-mcp

Our monorepo of travel-related MCP servers. Built on the PulseMCP server
architecture (`servers/<name>/{local,shared}`), trimmed to the servers we care
about and free to evolve independently.

## Servers

| Server | Package | Tools | Auth |
| --- | --- | --- | --- |
| [pointsyeah](./servers/pointsyeah) | `pointsyeah-mcp-server` | `search_flights`, `get_search_history`, `set_refresh_token` | PointsYeah Cognito refresh token (`POINTSYEAH_REFRESH_TOKEN`) |
| [google-flights](./servers/google-flights) | `google-flights-mcp-server` | `search_flights`, `get_date_grid`, `find_airport_code` | None |

- **pointsyeah** — award (points/miles) flight search across 20+ loyalty programs, with bank transfer options.
- **google-flights** — cash-price flight search, date-price grids, and airport IATA lookup.

Together they cover both sides of the same question: "what does this trip cost
in points vs. in cash?"

## Layout

```
servers/<name>/
  local/    # the runnable MCP server (src -> build/index.js)
  shared/   # shared code, compiled into local/shared via a symlink
scripts/    # build-mcp-server.js and helpers
libs/       # shared libraries (elicitation)
```

## Build

Requires Node.js 18+.

```bash
npm install          # installs workspace deps
npm run build        # builds shared then local for every server
```

Per-server:

```bash
npm --prefix servers/pointsyeah run build
npm --prefix servers/google-flights run build
```

Run a server over stdio:

```bash
node servers/pointsyeah/local/build/index.js
node servers/google-flights/local/build/index.js
```

## MCP client config (example)

```json
{
  "mcpServers": {
    "pointsyeah": {
      "command": "node",
      "args": ["servers/pointsyeah/local/build/index.js"],
      "env": { "POINTSYEAH_REFRESH_TOKEN": "<token>" }
    },
    "google-flights": {
      "command": "node",
      "args": ["servers/google-flights/local/build/index.js"]
    }
  }
}
```

## Notes

- `npm install` may need `--legacy-peer-deps` on some Node/npm versions to avoid
  an arborist `edgesOut` crash in the peer graph.
- The PointsYeah refresh token is a secret; keep it out of version control.

## License

MIT. Portions derived from [PulseMCP's MCP Servers](https://github.com/pulsemcp/mcp-servers) (MIT).
