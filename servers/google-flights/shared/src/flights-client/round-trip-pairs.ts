import type {
  FlightOffer,
  FlightSegment,
  RoundTripPairsOptions,
  RoundTripPairsResult,
  SearchFlightsOptions,
  SearchFlightsResult,
  SelectedRoundTripPair,
} from './types.js';
import { buildExactRoundTripReviewLink } from './review-links.js';
import {
  buildSelectionTfu,
  buildTfsParam,
  fetchSelectedReturnOffers,
  isBasicEconomy,
  parseAirportList,
  searchFlights,
} from './flights-client.js';

type Searcher = (options: SearchFlightsOptions) => Promise<SearchFlightsResult>;
type ReturnFetcher = (
  tfs: string, tfu: string, currency: string
) => Promise<{ offers: FlightOffer[]; search_url: string }>;

function isPinnableOutbound(
  offer: FlightOffer,
  origins: Set<string>,
  destinations: Set<string>,
  departureDate: string,
  currency: string,
  outboundMaxStops: 'nonstop' | '1'
): boolean {
  const segments = offer.segments;
  const stops = segments.length - 1;
  if (segments.length === 0 || segments.length > 2 ||
      stops !== offer.stops ||
      (outboundMaxStops === 'nonstop' && stops !== 0) ||
      !offer.booking_token || offer.currency !== currency ||
      !Number.isFinite(offer.price) || offer.price <= 0 ||
      !origins.has(segments[0].origin) ||
      !destinations.has(segments[segments.length - 1].destination) ||
      segments[0].departure_date !== departureDate) return false;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!/^[A-Z0-9]{2}[0-9]{1,4}$/.test(segment.flight_number.toUpperCase()) ||
        segment.airline_code.toUpperCase() !== segment.flight_number.slice(0, 2).toUpperCase() ||
        (i > 0 && (segments[i - 1].destination !== segment.origin ||
          segments[i - 1].arrival_date > segment.departure_date)) ||
        segment.departure_date < departureDate) return false;
  }
  return true;
}

/**
 * Prevent Google's initial OUTBOUND options from being misread as returns.
 * Every connection must be continuous, and the return leg must depart on the
 * requested date and end at the requested origin airport.
 */
export function isMatchingReturn(
  offer: FlightOffer,
  returnDate: string,
  origins: Set<string>,
  destinations: Set<string>,
  maxStops: RoundTripPairsOptions['max_stops'],
  currency: string
): boolean {
  const segments = offer.segments;
  if (offer.currency !== currency || !Number.isFinite(offer.price) ||
      offer.price <= 0 || segments.length === 0 ||
      !destinations.has(segments[0].origin) ||
      !origins.has(segments[segments.length - 1].destination) ||
      segments[0].departure_date !== returnDate) return false;

  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].destination !== segments[i + 1].origin) return false;
  }

  const stops = segments.length - 1;
  const max = maxStops === 'any' ? Number.POSITIVE_INFINITY
    : maxStops === 'nonstop' ? 0 : Number(maxStops);
  return stops <= max;
}

/**
 * EXPERIMENTAL Google two-stage return selection (not checkout).
 *
 * Stage 1: a regular Google round-trip outbound search.
 * Stage 2: pin every physical leg (up to one connection) in TFS, wrap its opaque selection token
 * in TFU, fetch compatible return options with their selected-pair display
 * prices. Never add separate one-way fares or claim a verified party total.
 *
 * The injected callbacks are used by deterministic tests, not by production.
 */
export async function searchRoundTripPairs(
  options: RoundTripPairsOptions,
  searcher: Searcher = searchFlights,
  returnFetcher: ReturnFetcher = fetchSelectedReturnOffers
): Promise<RoundTripPairsResult> {
  if (options.seat_class !== 'economy') {
    throw new Error('Experimental selected-return search supports economy only; other cabins cannot be verified with the current TFS parser');
  }
  if (options.return_date < options.departure_date) {
    throw new Error('return_date cannot precede departure_date');
  }
  const outboundMaxStops = options.outbound_max_stops ?? 'nonstop';
  if (outboundMaxStops !== 'nonstop' && outboundMaxStops !== '1') {
    throw new Error('outbound_max_stops must be nonstop or 1');
  }
  const maxOutbounds = Math.max(1, Math.min(options.max_outbounds, 4));
  const maxReturns = Math.max(1, Math.min(options.max_return_options, 15));
  const initial = await searcher({
    origin: options.origin,
    destination: options.destination,
    departure_date: options.departure_date,
    return_date: options.return_date,
    trip_type: 'round_trip',
    seat_class: 'economy',
    adults: options.adults,
    children: options.children,
    infants_in_seat: 0,
    infants_on_lap: 0,
    max_stops: outboundMaxStops,
    sort_by: 'price',
    max_results: Math.max(20, maxOutbounds * 4),
    offset: 0,
    currency: options.currency,
    exclude_basic_economy: options.exclude_basic_economy,
  });

  const origin = String(initial.query.origin);
  const destination = String(initial.query.destination);
  const origins = new Set(parseAirportList(origin));
  const destinations = new Set(parseAirportList(destination));
  if (
    initial.query.trip_type !== 'round_trip' ||
    initial.query.departure_date !== options.departure_date ||
    initial.query.return_date !== options.return_date ||
    initial.quote_status !== 'round_trip_return_unselected' ||
    initial.query.cabin_honored !== true ||
    initial.query.passengers?.adults !== options.adults
  ) {
    throw new Error('Google outbound search did not honor the requested return, cabin, passengers or pricing stage');
  }

  // Fares are not comparable merely because one side matched a route;
  // choose only full, strictly connected outbound identities with selection tokens.
  const candidates = initial.flights
    .filter((offer) => isPinnableOutbound(
      offer, origins, destinations, options.departure_date, options.currency, outboundMaxStops
    ))
    .slice(0, maxOutbounds);
  const pairs: SelectedRoundTripPair[] = [];
  const diagnostics: RoundTripPairsResult['diagnostics'] = [];
  let returnSearches = 0;

  for (const outbound of candidates) {
    const flightId = outbound.segments.map((segment) => segment.flight_number).join('/');
    try {
      const tfs = await buildTfsParam({
        origin: initial.query.origin,
        destination: initial.query.destination,
        departureDate: options.departure_date,
        returnDate: options.return_date,
        tripType: 'round_trip',
        seatClass: 'economy',
        adults: options.adults,
        children: options.children,
        infantsInSeat: 0,
        infantsOnLap: 0,
        selectedOutbound: outbound.segments,
      });
      const tfu = buildSelectionTfu(outbound.booking_token);
      returnSearches++;
      const response = await returnFetcher(tfs, tfu, options.currency);
      const matches = response.offers
        .filter((offer) =>
          isMatchingReturn(offer, options.return_date, origins, destinations, options.max_stops, options.currency) &&
          (!options.exclude_basic_economy || !isBasicEconomy(offer))
        )
        .sort((a, b) => a.price - b.price)
        .slice(0, maxReturns);

      if (matches.length === 0) {
        diagnostics.push({
          outbound_flight: flightId, status: 'no_match',
          note: 'Second-stage response contained no valid return leg for the specified date/airports; no complete pair was inferred.',
        });
        continue;
      }
      for (const inbound of matches) {
        let googleBookingPageUrl: string | null = null;
        try {
          googleBookingPageUrl = buildExactRoundTripReviewLink({
            outbound: outbound.segments,
            inbound: inbound.segments,
            departure_date: options.departure_date,
            return_date: options.return_date,
            origin: outbound.segments[0].origin,
            destination: outbound.segments[outbound.segments.length - 1].destination,
            adults: options.adults,
            children: options.children,
            seat_class: options.seat_class,
            currency: options.currency,
          });
        } catch {
          // A valid matched pair remains useful even if a Google booking-page
          // URL cannot be encoded. Never invent a link or silently hide the pair.
        }
        pairs.push({
          outbound,
          return_flight: inbound,
          displayed_round_trip_price: inbound.price,
          currency: options.currency,
          quote_status: 'round_trip_pair_selected',
          price_basis: 'google_displayed_fare_unverified',
          party_total: null,
          checkout_verified: false,
          google_booking_page_url: googleBookingPageUrl,
          google_booking_page_status: googleBookingPageUrl ? 'encoded_unverified' : 'unavailable',
          search_url: response.search_url,
        });
      }
      diagnostics.push({
        outbound_flight: flightId, status: 'ok',
        note: `Parsed ${matches.length} return selection(s) for the pinned outbound; prices require checkout verification.`,
      });
    } catch (error) {
      diagnostics.push({
        outbound_flight: flightId, status: 'failed',
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }

  pairs.sort((a, b) => a.displayed_round_trip_price - b.displayed_round_trip_price);
  const unique = new Set<string>();
  const selectedPairs = pairs.filter((pair) => {
    const id = [
      pair.outbound.segments.map((s) => s.flight_number).join(','),
      pair.return_flight.segments.map((s) => s.flight_number).join(','),
      pair.displayed_round_trip_price,
    ].join('|');
    if (unique.has(id)) return false;
    unique.add(id);
    return true;
  });
  const failures = diagnostics.some((entry) => entry.status === 'failed');
  const searchStatus: RoundTripPairsResult['search_status'] =
    candidates.length === 0 ? 'no_outbound'
      : selectedPairs.length === 0 ? (failures ? 'partial' : 'no_paired_results')
      : failures ? 'partial' : 'pairs_found';
  const notes = [
    `Google two-stage selection EXPERIMENTAL: economy outbounds with at most ${outboundMaxStops === '1' ? 'one connection' : 'zero connections'} are pinned using every physical leg. Each returned pair contains both directions, unlike first-page round-trip reference prices.`,
    'Google display price is for the selected pair, but is NOT a confirmed booking-provider checkout quote, and the per-passenger vs full-party price basis is unverified.',
    'Do not multiply these display prices by the number of adults to claim a verified party budget. No fare is held or purchased.',
    'google_booking_page_url is a deterministic Google review-page deep link, NOT a provider checkout URL. Confirm exact flights and full-party final price in the opened page.',
  ];
  if (candidates.length === 0) {
    notes.push('No pinnable eligible outbound option with a valid selection token was available; do not interpret this as no round-trip fares.');
  }
  if (failures) {
    notes.push('One or more selected-return requests failed; partial results are research leads only.');
  }

  return {
    source: 'google_selected_return_experimental',
    search_status: searchStatus,
    quote_status: selectedPairs.length > 0 ? 'round_trip_pair_selected' : 'round_trip_return_unselected',
    price_basis: 'google_displayed_fare_unverified',
    party_total: null,
    checkout_verified: false,
    query: {
      origin, destination,
      departure_date: options.departure_date,
      return_date: options.return_date,
      seat_class: 'economy',
      adults: options.adults,
      children: options.children,
    },
    outbound_search_url: initial.search_url,
    outbounds_considered: candidates.length,
    return_searches: returnSearches,
    pairs: selectedPairs,
    cheapest_pair: selectedPairs[0] ?? null,
    diagnostics,
    notes,
  };
}
