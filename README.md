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

## Hosted endpoints (Vercel)

Production: **https://travel-mcp-mocha.vercel.app**

| Endpoint | Transport |
| --- | --- |
| `POST /api/pointsyeah/mcp` | streamable HTTP (stateless, JSON responses) |
| `POST /api/google-flights/mcp` | streamable HTTP (stateless, JSON responses) |
| `GET /api/health` | service status |

The functions in [`api/`](./api) wrap the same `shared` server code that the
stdio binaries use. Each request gets a fresh server + transport, which is what
the MCP SDK requires in stateless mode.

Serverless notes:

- `POINTSYEAH_REFRESH_TOKEN` is set as an encrypted Vercel env var for the
  project, so the pointsyeah endpoint is authenticated on every cold start.
- The pointsyeah function runs a real Chromium in the function sandbox via
  `@sparticuz/chromium` + `playwright-core`; `vercel.json` bundles the Chromium
  binaries and raises the function limit to 300s / 2048 MB.
- Pushes to `main` deploy automatically (the project is Git-linked).

Connecting it to ChatGPT: add a custom MCP server pointing at
`https://travel-mcp-mocha.vercel.app/api/pointsyeah/mcp` (or the google-flights
path) and choose "No authentication" — the credentials live in the deployment,
not in the client.

## Layout

```
servers/<name>/
  local/    # the runnable MCP server (src -> build/index.js)
  shared/   # shared code, compiled into local/shared via a symlink
api/        # Vercel serverless MCP endpoints (streamable HTTP)
public/     # static service index served by the Vercel project
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
