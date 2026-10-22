# Google Flights two-stage round-trip selection (P1 experimental)

## Why
Previous MCP returned an outbound-only `search_flights(round_trip)` list (e.g. SFO-LAX outbound at a $48 displayed reference price) without a selected inbound itinerary. The P0 contract explicitly labels that incomplete price and blocks `trip-compare` valuation.

## What the experimental tool does
`search_round_trip_pairs` performs:
1. Search Google Flights as **round trip**, with dates, passengers and cabin.
2. Select up to four exact **nonstop economy outbound** itineraries with an opaque Google selection token.
3. Encode a `FlightData.selectedFlight` into TFS and wrap the **upstream** selection token in a TFU envelope.
4. Fetch the second-stage search and verify the returned first segment departs from the destination on the requested return date; all intermediate connections are continuous and the final segment ends at the original airport.
5. Only then return the outbound + return pair at Google's **second-stage display price**, not the sum of separate one-way fares.

The wire format was cross-checked against `nickvanw/flights` (MIT), notably `encode_return.go`, `SearchReturn`; upstream selection fields are undocumented and may change. We implement our own TypeScript encoder in the existing `protobufjs` dependency.

## Conservative limits
- Economy only. The current TFS path has been known to ignore premium-cabin choices; reject higher-cabin selection instead of silently pricing economy.
- Nonstop **outbounds only**. Encoding just the first segment of a connection would not pin an entire itinerary.
- A maximum of four additional return-stage Google requests; serialised by the existing rate limiter.
- Each return has to be a real matching LAX→SFO route on the requested date; a repeated outbound or wrong-day flight is invalid.
- `booking_token` on the initial `FlightOffer` is the selection token used in the second stage; we never fabricate it.
- Failures and no-match results are preserved under `diagnostics`; no fake round-trip quote is emitted.
- The `displayed_round_trip_price` remains a **Google reference display price**. `price_basis` is unverified; `party_total=null` and `checkout_verified=false`.
- No automatic consumption in `trip-compare`. P0 CPP safety gate remains active.

## Acceptance
```
search_round_trip_pairs({
  "origin": "SFO",
  "destination": "LAX",
  "departure_date": "2026-11-10",
  "return_date": "2026-11-14",
  "seat_class": "economy",
  "adults": 1,
  "max_outbounds": 1,
  "max_stops": "nonstop",
  "exclude_basic_economy": false
})
```

Expect `pairs[*].outbound` to include SFO→LAX November 10, `return_flight` to include LAX→SFO November 14, and `displayed_round_trip_price` to be a **single second-stage Google price**, not a sum. If no pairs appear, inspect `diagnostics` without inferring zero seats.

Run `node scripts/smoke-google-roundtrip.mjs` after `npm run build:google-flights`; the PR's optional CI canary is non-blocking because Google may rate-limit GitHub runners. The canary's failure must **not** be interpreted as validation success. Do not merge as a supported quote source until the canary actually yields matching inbound pairs, and perform a separate provider checkout check before describing any fare as bookable.

## Multi-city
True multi-city joint ticket selection likely uses an additional Google RPC and can be gated or client-side. This work does **not** pretend that PR #1's independent one-way sum is a joint open-jaw quotation. That limitation remains explicit.
