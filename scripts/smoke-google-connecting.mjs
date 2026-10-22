// Read-only live canary: verify a genuine connecting outbound is pinned in Google.
// Do not log Google selection tokens, passenger details, or provider cookies.
import { searchRoundTripPairs } from '../servers/google-flights/shared/build/flights-client/round-trip-pairs.js';

const base = {
  origin: 'SAN',
  destination: 'CDG',
  departure_date: '2026-11-20',
  return_date: '2026-11-29',
  seat_class: 'economy',
  children: 0,
  currency: 'USD',
  outbound_max_stops: '1',
  max_stops: '1',
  exclude_basic_economy: false,
  max_outbounds: 1,
  max_return_options: 3,
};

const summarize = (r) => ({
  status: r.search_status,
  stage: r.quote_status,
  outbounds_considered: r.outbounds_considered,
  return_searches: r.return_searches,
  pair_count: r.pairs.length,
  pairs: r.pairs.slice(0, 3).map((pair) => ({
    outbound_flights: pair.outbound.segments.map((segment) => segment.flight_number),
    outbound_airports: pair.outbound.segments.map((segment) => [segment.origin, segment.destination]),
    outbound_date: pair.outbound.segments[0]?.departure_date,
    return_flights: pair.return_flight.segments.map((segment) => segment.flight_number),
    return_date: pair.return_flight.segments[0]?.departure_date,
    displayed_price: pair.displayed_round_trip_price,
    currency: pair.currency,
    checkout_verified: pair.checkout_verified,
    party_total: pair.party_total,
  })),
  diagnostics: r.diagnostics,
});

const one = await searchRoundTripPairs({ ...base, adults: 1 });
const oneSummary = summarize(one);
console.log('ONE_ADULT_CONNECTING_CANARY', JSON.stringify(oneSummary, null, 2));
const connectingPair = one.pairs.find((p) => p.outbound.segments.length === 2);
if (!connectingPair) {
  console.error('CONNECTING_CANARY_FAILED: no validated two-leg outbound + return pair');
  process.exitCode = 1;
} else {
  // A controlled second-party-size comparison is descriptive, NOT an
  // independently verified price basis or a bookable two-passenger fare.
  const two = await searchRoundTripPairs({ ...base, adults: 2 });
  const twoSummary = summarize(two);
  console.log('TWO_ADULT_CONNECTING_CANARY', JSON.stringify(twoSummary, null, 2));
  const identity = (p) => [
    p.outbound.segments.map((x) => x.flight_number).join('/'),
    p.return_flight.segments.map((x) => x.flight_number).join('/'),
  ].join(' : ');
  const matched = two.pairs.find((p) => identity(p) === identity(connectingPair));
  console.log('PRICE_BASIS_PROBE', JSON.stringify({
    evidence: matched ? 'matched_same_itinerary' : 'no_identical_itinerary',
    adult_1_display_price: connectingPair.displayed_round_trip_price,
    adult_2_display_price: matched?.displayed_round_trip_price ?? null,
    equal_display_price: matched ? connectingPair.displayed_round_trip_price === matched.displayed_round_trip_price : null,
    interpretation: 'descriptive_only; no verified party total or per-passenger contract',
  }, null, 2));
  if (two.pairs.length === 0) {
    console.error('TWO_ADULT_CANARY_INCONCLUSIVE: no validated return pair for two adults');
    process.exitCode = 1;
  }
}
