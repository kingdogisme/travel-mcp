// Read-only live canary: no purchase, credentials, or booking operations.
// If the public Google HTML selection format changes, FAIL rather than invent a fare.
import { searchRoundTripPairs } from '../servers/google-flights/shared/build/flights-client/round-trip-pairs.js';

const result = await searchRoundTripPairs({
  origin: 'SFO',
  destination: 'LAX',
  departure_date: '2026-11-10',
  return_date: '2026-11-14',
  seat_class: 'economy',
  adults: 1,
  children: 0,
  currency: 'USD',
  max_stops: 'nonstop',
  exclude_basic_economy: false,
  max_outbounds: 1,
  max_return_options: 5,
});

const diagnostics = {
  status: result.search_status,
  quote_status: result.quote_status,
  considered: result.outbounds_considered,
  return_searches: result.return_searches,
  paired_results: result.pairs.length,
  prices: result.pairs.slice(0, 5).map((pair) => ({
    outbound_flight: pair.outbound.segments.map((s) => s.flight_number).join(','),
    outbound_date: pair.outbound.segments[0]?.departure_date,
    return_flight: pair.return_flight.segments.map((s) => s.flight_number).join(','),
    return_date: pair.return_flight.segments[0]?.departure_date,
    price: pair.displayed_round_trip_price,
    price_basis: pair.price_basis,
    checkout_verified: pair.checkout_verified,
  })),
  diagnostics: result.diagnostics,
};
console.log(JSON.stringify(diagnostics, null, 2));
// An HTTP 200 or page parse is not enough: require a date-matched, complete pair.
if (result.pairs.length === 0 || result.quote_status !== 'round_trip_pair_selected') {
  console.error('GOOGLE_TWO_STAGE_CANARY_FAILED: no matching, complete outbound/return pair');
  process.exitCode = 1;
}
