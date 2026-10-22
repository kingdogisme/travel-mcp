# PointsYeah seat-count sentinel policy

## Reproduction

On 2026-10-21, the PointsYeah Explorer API returned an AA Economy candidate
for SAN to CDG departing 2026-11-21 with `seats: 9999`. An AS candidate
returned `seats: 9`. The upstream semantics of 9999 are not documented:
it must **not** be interpreted as 9,999 seats, nor automatically as zero seats.

## Output contract

- Missing/invalid seat counts and values **>= 9999** are normalized to
  `null` ("unverified"), not to a numeric inventory guarantee.
- Explorer and recommendation results retain routes/prices, and use
  `seat_count_status: "unverified"` on records where a sentinel was replaced.
- Live search displays "seat count unverified". `minSeats` filters cannot
  accept unknown counts as proof of enough seats; filtered-out unknown counts
  do not mean that no award space exists.
- Flexible-date options carry nullable `seats`.
- `trip-compare` does not call an award bookable for a party solely based
  on a sentinel value; it returns `seats_unverified` /
  `insufficient_data` when the candidate with unknown inventory might matter.
- Cached Seats.aero inventory uses the same conservative parser.

## Verification

Use the full party size on the actual airline loyalty-program checkout
before transferring miles. Explorer data are candidates, not bookings.
