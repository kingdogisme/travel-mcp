# Google Flights price integrity: stages and comparison policy

## Observed failure (2026-10-21)
- `search_flights(trip_type=round_trip, SFO→LAX 11/10, return 11/14)` returned a display price of $48 but only the outbound Frontier flight's segments.
- The one-way search for the same departure flight returned $29.
- `search_multi_city` was summing separate one-way prices, and when sorted by `best` or `duration` the first displayed option was not necessarily the lowest fare.
- SAN→CDG 11/20 returned the same displayed $760 for one and two adults. This **does not prove** a price bug: Google's passenger pricing convention may be per person, but this scraper does not independently establish the basis.

## Current API contract
| Search | quote_status | Semantics |
| --- | --- | --- |
| `search_flights(one_way)` | `indicative_one_way` | Complete departure leg, reference display price; not checkout verified |
| `search_flights(round_trip)` | `round_trip_return_unselected` | Outbound selection only; returned price may be a round-trip reference but the return flight has NOT been chosen |
| `get_date_grid(round_trip)`, `get_round_trip_grid`, `search_anywhere(round_trip)` | `round_trip_return_unselected` | Date/destination *research*, not completed round-trip quotes |
| `search_multi_city` | `pricing_mode=separate_one_ways` | Independent one-way fare leads. `joint_ticket_quote=null`. Cheapest sum is shown only when all segments provide valid same-cabin one-way minima |

All Google cash price consumers get `price_basis=google_displayed_fare_unverified`, `party_total=null`, `checkout_verified=false`. The original numeric `price` is preserved only as an indicative displayed fare; this patch does not invent a per-passenger or full-party ticket total.

## Downstream safeguards
`trip-compare` may use a Google fare for **indicative** CPP research only if it is a one-way result for **one adult**, matches the requested cabin and carries the expected quote metadata. Round-trip, multi-adult, missing provenance or ignored-cabin results remain visible as leads, but get `cash.search_status=fares_unverified`, `cash.usable_for_valuation=false`, `cash.comparable_price=null`. The verdict must be `insufficient_data` and award CPP must remain null. For an unverified cash grid, keep the user-requested departure date, not a falsely comparable 'cheapest' date.

## Not yet supported
The real Google Flights flow requires selecting an outbound token and requesting **return-flight choices**, then selecting a complete pair; for Multi-city it requires choosing each segment within the same session. The existing HTML/DS1 parser does not implement those second stages. Do not mark those prices as confirmed; do not silently substitute two separate one-ways.

## Acceptance
- `sort_by=duration` and pagination never change the computed **full-filter-set** minimum.
- Cabin fallback and leg errors produce partial outcomes, not a fabricated complete split ticket.
- Round trip is always marked `round_trip_return_unselected`, and `trip-compare` never computes CPP from it.
- 2-adult indicative cash values are not multiplied or treated as verified totals.
- Single-passenger one-way still supports *indicative* CPP for research, subject to checkout verification.
- Preview build and tests pass before merge; deployment must be a separate explicit action.
