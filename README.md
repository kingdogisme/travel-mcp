# travel-mcp

Our monorepo of travel-related MCP servers. Built on the PulseMCP server
architecture (`servers/<name>/{local,shared}`), trimmed to the servers we care
about and free to evolve independently.

## Servers

| Server | Package | Tools | Auth |
| --- | --- | --- | --- |
| [pointsyeah](./servers/pointsyeah) | `pointsyeah-mcp-server` | `search_flights`, `find_cheapest_award_dates`, `find_transfer_bonuses`, `explore_award_routes`, `recommend_award_destinations`, `get_search_history`, `manage_price_alerts`, `set_refresh_token` | PointsYeah Cognito refresh token (`POINTSYEAH_REFRESH_TOKEN`) |
| [google-flights](./servers/google-flights) | `google-flights-mcp-server` | `search_flights`, `search_multi_city`, `get_date_grid`, `get_round_trip_grid`, `find_airport_code` | None |
| [trip-compare](./servers/trip-compare) | `trip-compare-mcp-server` | `compare_points_vs_cash` | PointsYeah token (for the award half) |

- **pointsyeah** — award (points/miles) flight search across 20+ loyalty programs, with bank transfer options, flexible-date award pricing, and a live transfer-bonus finder.
- **google-flights** — cash-price flight search, date-price grids, airport IATA lookup, plus airline / time-of-day / duration / layover filters and cabin-aware pricing.
- **trip-compare** — runs a cash search and an award search for the same trip, values each award in cents per point, and recommends points or cash.

Together they cover both sides of the same question: "what does this trip cost
in points vs. in cash?"

### What each server can search

**pointsyeah** (`search_flights`): one-way, round-trip and two-leg multi-city
award searches; scoped to specific banks (`banks`) or airline programs
(`airlineProgram`); flexible date windows (`multiday` + `departDateTo`); and
local result filters (`maxMiles`, `maxTax`, `maxStops`, `minSeats`,
`maxLayoverMinutes`, `excludeRedeye`, `sortBy`, `limit`).

- `find_cheapest_award_dates` prices a whole window of departure dates in one
  flexible-date search and reports the cheapest award per day plus the cheapest
  program per date.
- `find_transfer_bonuses` harvests live bank transfer bonuses (percentage,
  expiry, PointsYeah's slogan, effective points cost) off a single award search.
- `explore_award_routes` and `recommend_award_destinations` use the same
  endpoints the PointsYeah website's Explorer calls
  (`api2.pointsyeah.com/explorer/...`) with the same login, so they need no
  extra credentials. They are plain JSON over HTTPS and answer in
  about a second, versus 30-90s for the browser-driven live search.
  - `explore_award_routes` searches awards across whole regions — airports,
    countries, continents, regions or states on each end, plus a date window.
    Filters take codes: airports `["NRT"]`, countries `["JP"]`, continents
    `["AS", "EU"]`, states `["CA"]` — full names match nothing.
  - `recommend_award_destinations` answers "where can I go on points from SFO?".
- `manage_price_alerts` lists, creates and deletes PointsYeah price alerts
  through the account API (`api.pointsyeah.com/v2/live`).

**google-flights** (`search_flights`): multi-airport legs (`"SFO,OAK"`),
one-way and round-trip, all four cabins, stop limits, emissions-aware sorting,
and local filters for `airlines` / `exclude_airlines`, `alliances` /
`exclude_alliances` (Star Alliance / oneworld / SkyTeam), `departure_after` /
`departure_before`, `arrival_after` / `arrival_before`, `max_duration_minutes`,
`max_layover_minutes`, `layover_airports` / `exclude_layover_airports` and
`require_checked_bag`. Every offer carries segments, layovers, emissions
and a booking token.

- `get_date_grid` prices each date in a window with a live lookup (default 7
  dates, hard cap 14) and returns the cheapest itinerary per date, the cheapest
  dates, Google's historical low-price series and its price verdict. It accepts
  the same airline / time / duration / layover filters.
- `get_round_trip_grid` crosses a departure-date window with a range of trip
  lengths and prices each cell as its own round trip, returning the cheapest
  fare per (departure date, nights) plus the best date and best trip length.
  Live lookups are capped (default 12, hard max 18).
- `find_airport_code` resolves a city or airport name to IATA codes.

## Hosted endpoints (Vercel)

Production: **https://travel-mcp-mocha.vercel.app**

| Endpoint | Transport |
| --- | --- |
| `POST /api/pointsyeah/mcp` | streamable HTTP (stateless, JSON responses) |
| `POST /api/google-flights/mcp` | streamable HTTP (stateless, JSON responses) |
| `POST /api/trip-compare/mcp` | streamable HTTP (stateless, JSON responses) |
| `GET /api/health` | service status |

The functions in [`api/`](./api) wrap the same `shared` server code that the
stdio binaries use. Each request gets a fresh server + transport, which is what
the MCP SDK requires in stateless mode.

Serverless notes:

- `POINTSYEAH_REFRESH_TOKEN` is set as an encrypted Vercel env var for the
  project, so the pointsyeah endpoint is authenticated on every cold start.
- The pointsyeah and trip-compare functions run a real Chromium in the function
  sandbox via `@sparticuz/chromium` + `playwright-core`; `vercel.json` bundles
  the Chromium binaries and raises the function limit to 300s / 2048 MB.
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
npm --prefix servers/trip-compare run build
```

Run a server over stdio:

```bash
node servers/pointsyeah/local/build/index.js
node servers/google-flights/local/build/index.js
node servers/trip-compare/local/build/index.js
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
    },
    "trip-compare": {
      "command": "node",
      "args": ["servers/trip-compare/local/build/index.js"],
      "env": { "POINTSYEAH_REFRESH_TOKEN": "<token>" }
    }
  }
}
```

## Behaviour notes

- **Cabins.** Google ignores the cabin enum inside its protobuf query, so
  business and first searches are issued through Google's natural-language
  endpoint, which honours the cabin but returns a smaller fare list. Premium
  economy is not understood there; when that happens the response carries
  `cabin_honored: false` and a note in `notes`.
- **PointsYeah filters.** PointsYeah applies neither the cabin nor the airline
  program filter server-side, so both are enforced locally and the response
  says how many options were hidden.
- **Explorer API.** Those calls go to `api2.pointsyeah.com` with the
  Cognito ID token in the `Authorization` header (no Bearer prefix), serialized
  with a short gap and a 30s timeout. `POINTSYEAH_API_BASE` overrides the base.
- **Politeness.** Google Flights requests are serialized with a ~1.5s gap plus
  jitter, retried with exponential backoff on 429/403/5xx and on consent or
  captcha interstitials, and the date grid caps live lookups per call.

## Notes

- `npm install` may need `--legacy-peer-deps` on some Node/npm versions to avoid
  an arborist `edgesOut` crash in the peer graph.
- The PointsYeah refresh token is a secret; keep it out of version control.

## License

MIT. Portions derived from [PulseMCP's MCP Servers](https://github.com/pulsemcp/mcp-servers) (MIT).
