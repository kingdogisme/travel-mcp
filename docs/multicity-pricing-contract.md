# Multi-city cash pricing contract (P0)

The `search_multi_city` MCP tool currently queries **independent one-way fares**. It does not query or price the actual Google Flights Multi-city/Open-jaw checkout flow.

## Output guarantees
- `pricing_mode: "separate_one_ways"` and `joint_ticket_quote: null` on every result.
- `cheapest_total` is a **reference sum of the lowest Google-displayed one-way fares**, not a ticket quotation. Its `party_total` is **null**.
- `price_basis: "google_displayed_fare_unverified"`: the scraper currently cannot prove whether Google's raw price represents per-passenger or party-wide pricing. Never multiply this value by `adults` to create a verified budget.
- Lowest displayed fare is calculated **before sort and pagination**, after all normal filtering. Thus it does not depend on `sort_by` or `max_results`.
- `status` for each leg distinguishes `ok`, `no_results`, `unpriced`, and `failed`. `coverage_status: "partial"` means a complete reference sum is unavailable, and `cheapest_total` is null.
- No results or scraper errors are **not** proof of zero seat availability.

## Follow-up scope (separate PoC / PR)
1. Obtain an actual jointly priced Google Flights Multi-city quote, with a bookable checkout verification; do not substitute the split-ticket sum.
2. Verify Google fare per-passenger vs party price semantics across 1 and 2 adults, including taxes, fare brands and same flight.
3. Only after proof of (1) and (2), extend trip-compare to compare combined cash, split cash, split awards and hybrid cash+points.
4. Do not silently fall back to split tickets if the joint quote retrieval fails.

## Primary manual acceptance fixture
- Two adults, economy, SAN to CDG on 2026-11-20 and FCO to SAN on 2026-11-29 or 2026-11-30.
- Try `sort_by=best` and `sort_by=duration`; lowest fare is independent from display order.
- Simulate a failed search for only the second leg and confirm the first leg remains available and `cheapest_total=null`.
