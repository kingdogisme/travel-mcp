# P3: exact-itinerary Google review links and open-jaw research link

## Why this is valuable
The MCP already retrieves real selected outbound/return pair prices, but the
number alone does not answer whether Google can still present the same flights
and whether two adults can proceed to provider checkout. A deterministic deep
link allows **manual validation of exactly the selected physical segments**.

The separate `search_multi_city` tool still reports **independent one-way**
display prices. A research link that opens a **genuine Google Multi-city
search UI** provides a side-by-side manual route to test combined-ticket
pricing, without lying that the MCP fetched it.

## New result fields
- `search_round_trip_pairs.pairs[*].google_booking_page_url`: a
  `https://www.google.com/travel/flights/booking?tfs=...` page link that pins
  outbound+return segments and passenger mix. No opaque selection tokens,
  cookies or provider credentials are embedded. Status
  `google_booking_page_status=encoded_unverified|unavailable`.
- `search_multi_city.joint_research_url`: an initial
  `https://www.google.com/travel/flights/search?tfs=...` Multi-city search
  link, containing the requested 2–6 legs and passenger mix. Status
  `joint_research_url_status=unverified_google_ui|unavailable`. The Google
  UI may not retain all legs or return inline flight rows, so this is only a
  human-review route, not an API joint-fare price.

## TFS encoding differences
The original scraper uses a **legacy search-page** TFS schema (seat field 1,
passengers field 6), which works for its currently deployed selection flow.
The exact booking-page link needs Google's **modern URL schema** (markers
1,2,14,16; data field 3; passengers 8; seat 9; trip 19). The new
`review-links.ts` uses a *separate local protobuf schema* to avoid silently
breaking the production search transport. Reference implementations:
- `KasperBuilds/google-flights-proto-mcp`, `proto.py` (modern booking markers,
  pin and repeated selected flights)
- `punitarani/fli`, `fli/search/_tfs.py`, `fli/search/_proto.py`
  (public Google booking-page deep links)

## Critical quote semantics
- A Google URL or status 200 **does not prove** flight availability.
- A page containing the intended flight numbers is not a final provider fare.
- `checkout_verified=false`, `party_total=null` and
  `price_basis=google_displayed_fare_unverified` MUST remain intact.
- Google can drop or change selected options when the page opens; visually
  check the flight numbers **and** dates in the browser before trusting it.
- Neither link is automatically used in `trip-compare` CPP.
- True open-jaw **joint-ticket** pricing still needs the browser's multi-city
  selection flow or a working pricing API. Independent one-ways do not
  become a married itinerary merely because the same route has a research URL.

## Fixtures / acceptance
1. Economy, 2 adults, UA327/UA54 outbound SAN→EWR→CDG Nov 20, 2026 and
   UA986/UA2472 inbound CDG→ORD→SAN Nov 29, 2026:
   - All four physical flight identities present in the TFS payload.
   - `trip=ROUND_TRIP`, passenger list `[ADULT,ADULT]`, booking markers.
   - No `tfu` or raw booking token in URL; no checkout claim.
2. Open jaw SAN→CDG 11/20 and FCO→SAN 11/29:
   - `trip=MULTI_CITY`, two distinct leg records, 2 adults.
   - `joint_ticket_quote` remains `null` despite a URL being present.
   - Failing to build URL never makes a successful split search fail.
3. Broken connection/date → fail closed, return no exact link.
4. Read-only canary `node scripts/smoke-google-review-links.mjs`
   distinguishes HTTP availability from actual route/price verification.
