# P2: connecting-outbound Google return selection and adult-fare evidence

## Background
- P0 cash-price contracts and CPP guards are on `main` (merged PR #1).
- P1 experimentally selected a specific NONSTOP Google outbound then retrieved matching return choices (merged PR #4). SFO→LAX 2026-11-10 / 11-14 yielded Frontier F92858 + F94593 at a Google **display** price $48, unverified at checkout.
- A 2026-10-22 exploration of `KasperBuilds/google-flights-proto-mcp` confirmed Google TFS `FlightData` **field 4 is repeated SelectedFlight**; one entry per physical segment, not one entry for the whole itinerary. This enables one-connection outbound selection without truncation.

## Implementation
- `buildTfsParam({ selectedOutbound })` accepts one segment OR up to two correctly connected segments, and serializes repeated `selectedFlights`.
- Each physical segment includes origin, actual segment departure date (including overnight connections), destination, marketing airline and flight number.
- For a search result, check that the outbound's first airport/date matches the requested origin/departure and its last airport matches the requested destination; no gaps, negative date progression, or missing token.
- `search_round_trip_pairs` adds optional `outbound_max_stops: "1"`; defaults to `"nonstop"` for backward compatibility. `max_stops` still filters *return* itineraries.
- Keep the existing live-selection callback, strict return validation, failure statuses and checkout/party-price disclaimer unchanged. This is experimental and is not used by `trip-compare`.

## Live canary / acceptance
```
node scripts/smoke-google-connecting.mjs
```
The script searches **SAN→CDG 2026-11-20, CDG→SAN 2026-11-29**, selecting one connecting economy outbound. It must obtain a second-stage **CDG→SAN** matching return and validate that two distinct physical SAN→hub→CDG segments were pinned. No one-way fare summing is permitted.

After a 1-adult success, the probe repeats with 2 adults and attempts to match the *exact same outbound+return flight numbers*. It reports whether Google's displayed prices match across passenger counts, but deliberately **does not** infer `party_total` or assert the vendor's per-traveler policy from price parity alone.

Because Google has an undocumented HTML and protobuf contract, the canary is nonblocking in GitHub Actions, and a CI pass by itself is not evidence of a successful live pairing. Inspect `CONNECTING_CANARY_FAILED` / `PRICE_BASIS_PROBE` output and gate release on a verified matching return.

## Known limitations
- Selected one-stop outbound only, up to one connection. Some married-segment or codeshare selections may not return valid options.
- Price basis and provider checkout are still unverified; all results are research leads.
- No combined multi-city/open-jaw quote is implemented, and no downstream CPP assertion is relaxed.
