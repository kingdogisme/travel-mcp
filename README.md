# travel-mcp

Our monorepo of travel-related MCP servers. Built on the PulseMCP server
architecture (`servers/<name>/{local,shared}`), trimmed to the servers we care
about and free to evolve independently.

## Servers

| Server | Package | Tools | Auth |
| --- | --- | --- | --- |
| [pointsyeah](./servers/pointsyeah) | `pointsyeah-mcp-server` | `search_flights`, `find_cheapest_award_dates`, `find_transfer_bonuses`, `explore_award_routes`, `recommend_award_destinations`, `search_hotels`, `hotel_availability_calendar`, `get_hotel_detail`, `get_search_history`, `set_refresh_token`, `set_api_key` | PointsYeah Cognito refresh token (`POINTSYEAH_REFRESH_TOKEN`) + developer API key (`POINTSYEAH_API_KEY`) |
| [google-flights](./servers/google-flights) | `google-flights-mcp-server` | `search_flights`, `get_date_grid`, `find_airport_code` | None |
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
- `explore_award_routes`, `recommend_award_destinations`, `search_hotels`,
  `hotel_availability_calendar` and `get_hotel_detail` use PointsYeah's public
  developer API (`ai-api.pointsyeah.com`) — plain JSON over HTTPS, so they
  answer in seconds. They need an API key: create one at
  `pointsyeah.com/account/api-key` (premium tier, 1000 calls/day), then set
  `POINTSYEAH_API_KEY` or call the `set_api_key` tool. Without a key they return
  a message saying exactly that.
  - `explore_award_routes` searches awards across whole regions — airports,
    countries, continents, regions or states on each end, plus a date window.
  - `recommend_award_destinations` answers "where can I go on points from SFO?".
  - `search_hotels` returns hotel award availability with points price, cash
    price, room type, loyalty program, brand and transfer partners.
  - `hotel_availability_calendar` shows a property's points price per night for
    a month; `get_hotel_detail` returns images, address and description.

**google-flights** (`search_flights`): multi-airport legs (`"SFO,OAK"`),
one-way and round-trip, all four cabins, stop limits, emissions-aware sorting,
and local filters for `airlines` / `exclude_airlines`, `departure_after` /
`departure_before`, `arrival_after` / `arrival_before`, `max_duration_minutes`
and `max_layover_minutes`. Every offer carries segments, layovers, emissions
and a booking token.

- `get_date_grid` prices each date in a window with a live lookup (default 7
  dates, hard cap 14) and returns the cheapest itinerary per date, the cheapest
  dates, Google's historical low-price series and its price verdict. It accepts
  the same airline / time / duration / layover filters.
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
- `POINTSYEAH_API_KEY` (optional) enables the developer-API tools — the award
  explorer, destination recommendations and hotel search. Add it the same way
  once you have created a key.
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
      "env": {
        "POINTSYEAH_REFRESH_TOKEN": "<token>",
        "POINTSYEAH_API_KEY": "<optional developer API key>"
      }
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
- **Developer API.** The award explorer and hotel tools talk to
  `ai-api.pointsyeah.com` with an `X-API-Key` header. Calls are serialized with a
  short gap, retried on 429/5xx, and a 403 is reported as "the key was rejected
  (premium tier required)". `POINTSYEAH_API_BASE` overrides the base URL.
- **Politeness.** Google Flights requests are serialized with a ~1.5s gap plus
  jitter, retried with exponential backoff on 429/403/5xx and on consent or
  captcha interstitials, and the date grid caps live lookups per call.

## Notes

- `npm install` may need `--legacy-peer-deps` on some Node/npm versions to avoid
  an arborist `edgesOut` crash in the peer graph.
- The PointsYeah refresh token is a secret; keep it out of version control.

## License

MIT. Portions derived from [PulseMCP's MCP Servers](https://github.com/pulsemcp/mcp-servers) (MIT).
