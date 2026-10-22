# PointsYeah `seats: 9999` — root cause and handling

## Reproduction
On October 21, 2026, the live `explore_award_routes` MCP query for SAN to
France/Italy, November 19–22 (2 adults, economy), returned:

- AA SAN–CDG, November 21, 30,000 miles, `seats: 9999`.
- AS SAN–MXP, November 19, 35,000 miles, `seats: 9`.

The special value originates in the PointsYeah Explorer response, not a
locally generated default. There is no verified vendor specification for the
meaning of 9999, so do not convert it to 9,999 bookable award seats.

## Contract
- Returned award counts `>= 9999`, missing or invalid → `seats: null`.
  Existing numbers such as 1, 2 and 9 remain unchanged.
- A `minSeats` constraint MUST NOT include null/unknown counts.
- Unknown-count awards may still be displayed as research leads, with a warning.
- Both live search `payment.seats` and Explorer `result.seats` are sanitized.
- `trip-compare` also normalizes its inputs defensively (mocked and cached).
- Mixed known-insufficient and unknown counts return `seats_unverified` /
  `insufficient_data`, not a confident sold-out or points recommendation.
- Warning logs include source and aggregate counts, not account tokens or
  personal query details.

## Limitations
Unknown is not the same as unavailable. A fare being visible does not prove
airline checkout can ticket it; confirm with the booking program before
transferring points. Vercel Hobby runtime logging is retained for roughly an
hour, so earlier request logs are not reconstructable via runtime logs.
The unrelated multi-city cash pricing P0 work is in draft PR #1.
