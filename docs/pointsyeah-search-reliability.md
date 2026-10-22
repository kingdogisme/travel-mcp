# PointsYeah live-search reliability, output contract and telemetry

## Decision: same-city alternate airports are ALLOWED

HND searches may surface NRT departures, and SAN searches may include nearby
alternates returned by the upstream PointsYeah city search. This is intentional
user preference; do **not** add a strict per-airport filter. Show actual segment
airports, so the traveler can evaluate a cross-airport transfer before booking.

## Fixed failure modes

### Bounded polling with an explicit completion state
Previously PointsYeah waited up to 120 polls × 3 seconds = **360 seconds** plus
network and Playwright overhead, exceeding the Vercel Function `maxDuration=300`
seconds. The new total **210-second** deadline starts before auth and browser
creation. Each poll is allowed only if 3s delay + **35s request guard** fit
inside the overall deadline, leaving ~90 seconds for response serialization,
other trip-compare sources and serverless lifecycle jitter.

`completion_status` is one of:
- `completed`: the upstream returned `status=done` (may legitimately be empty)
- `partial_timeout`: the task has not reported done before its safe deadline
- `partial_error`: a poll failed/rejected after task creation; preserve any
  previously observed itineraries, but do NOT claim complete availability

Partial results are preserved as *research leads*. No zero-availability claim
is justified by a partial response. An upstream failure before any results is
also represented as `partial_error`, not a false "no awards" claim.

`trip-compare` treats both partial statuses as `search_incomplete`: any
observed awards remain visible but their CPP is null, no ranking is a complete
market ranking, and the verdict is `insufficient_data`. The initial cash
reference remains subject to the separate Google quote provenance guard.

### Correct group vs itinerary counts
A PointsYeah `FlightResult` is one program/date/route **group** that can
contain dozens of `routes`. The legacy `limit` is retained for compatibility
as a **group cap**. New `maxOptions` caps actual flight itinerary count
**across all groups**, after existing filters and sorting, without modifying
caller arrays. The public `search_flights` MCP defaults `maxOptions=40` and
permits up to 200. `trip-compare` explicitly caps its points search between
10 and 80 concrete itineraries, in addition to the existing group limit.

Exposed fields:
- `total`, `unfiltered_total`: result group counts (legacy)
- `option_total`: displayed itinerary count
- `matched_option_total`: number after local filters + group limit, before `maxOptions`
- `unfiltered_option_total`: all accumulated upstream itineraries
- `omitted_option_total`: omitted by `maxOptions` alone
- `poll_count`, `elapsed_ms`, `unverified_seat_count`, `completion_status`
- `notes`: explicit warning when incomplete or truncated

### Incremental poll accumulation
Older code keyed by `program+date+origin+destination` but replaced the full
group every poll. When one poll contained incremental routes, earlier
itineraries were discarded. New code merges routes by program/date/city and
unique flight segment + price identity, deduping repeats. The newest inventory
is retained for duplicate itinerary IDs (even if latest seat count becomes
unknown); the 9999 sentinel is still normalized to null, and minSeats never
accepts unknown inventory.

### Structured, low-noise telemetry
Expected 9999 normalization **does not log as a Vercel error**. Instead, emit
one summary metric per search and explorer operation to function stdout when
`VERCEL` is present:

- `[METRIC] {event:"pointsyeah.search",completion,elapsed_ms,polls,groups_raw,itineraries_raw,groups_shown,itineraries_shown,itineraries_matched,itineraries_omitted,invalid_seat_values,mismatched_cabin_options}`
- `[METRIC] {event:"pointsyeah.award_seats_normalized",source,unverified_seats}`

No JWT, refresh token, request/task ID, passenger identity, itinerary text, or
route coordinates are recorded in these metrics. Local stdio MCP mode keeps
stdout exclusively for protocol messages (debug metrics use stderr only in
DEBUG/development). **Vercel Hobby's short log retention still prevents a
verified seven-day success-rate report** without an external retention store.

### Adjacent tools
- `find_transfer_bonuses` includes `completion_status`, carries upstream
  notes and avoids claiming no bank bonus if the route search was partial.
- `find_cheapest_award_dates` includes `completion_status` and avoids
  inferring that omitted dates have no award space after a partial search.

## Verification and release gating
- Deterministic tests cover repeated batches, incremental new itineraries,
  latest seat changes, completed empty searches, deadline/partial error cases,
  output truncation without mutation and trip-compare CPP fail-closed behavior.
- PR CI builds all MCP servers and runs the complete unit suite.
- Run a live PointsYeah search for two adults, economy, HND→SAN on 2026-12-13
  and inspect completion status, 40-option cap and route groups.
- Do not call a route fully covered unless `completion_status=completed`.
- A configured 210-second budget is not proof the upstream can always finish:
  timeout is safely **visible**, rather than silently being called "done".
