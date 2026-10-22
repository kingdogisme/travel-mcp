import type {
  IFlightsClient,
  SearchFlightsResult,
  FlightOffer,
} from 'google-flights-mcp-server-shared';
import type {
  IPointsYeahClient,
  FlightResult,
  FlightRoute,
  FlightSearchResults,
} from 'pointsyeah-mcp-server-shared';
import type {
  AwardOption,
  AwardSearchStatus,
  CashOption,
  CashSearchStatus,
  CompareOptions,
  CompareResult,
} from './types.js';
import {
  COVERAGE_LAST_VERIFIED,
  SEARCHED_PROGRAM_CODES,
  VERIFICATION_LINKS,
  coverageGapsForCarriers,
  describeCoverageGaps,
  mergeCoverageGaps,
  staticCoverageGaps,
} from './coverage.js';
import type { ISeatsAeroClient, SeatsAeroOption } from './seats-aero.js';
import { normalizeAwardSeatCount } from 'pointsyeah-mcp-server-shared';
import { logDebug, logWarning } from './logging.js';

const SEAT_CLASS: Record<CompareOptions['cabin'], 'economy' | 'premium_economy' | 'business' | 'first'> = {
  Economy: 'economy',
  'Premium Economy': 'premium_economy',
  Business: 'business',
  First: 'first',
};

/** Anything at or above this is generally considered a good use of points. */
const DEFAULT_MIN_CENTS_PER_POINT = 1.5;

/**
 * Only compare apples to apples: a single-adult, one-way Google display price
 * in the requested cabin. Even then this is INDICATIVE CPP, not checkout pricing.
 * Missing provenance MUST fail closed, including for older connector clients.
 */
export function canUseCashForIndicativeCpp(
  result: SearchFlightsResult | null,
  adults: number,
  roundTrip: boolean
): boolean {
  return result !== null &&
    adults === 1 &&
    !roundTrip &&
    result.quote_status === 'indicative_one_way' &&
    result.price_basis === 'google_displayed_fare_unverified' &&
    result.query?.trip_type === 'one_way' &&
    result.query?.cabin_honored === true &&
    result.query?.passengers?.adults === 1;
}

/** Best value first; options with no valuation sink to the bottom. */
function byAwardValue(a: AwardOption, b: AwardOption): number {
  const aValue = a.cents_per_point_with_bonus ?? a.cents_per_point ?? -1;
  const bValue = b.cents_per_point_with_bonus ?? b.cents_per_point ?? -1;
  return bValue - aValue;
}

function toCashOption(offer: FlightOffer, quoteStatus: CashOption['quote_status']): CashOption {
  return {
    price: offer.price,
    quote_status: quoteStatus,
    currency: offer.currency,
    airline: offer.airline,
    stops: offer.stops,
    duration_minutes: offer.duration_minutes,
    departure: offer.departure,
    arrival: offer.arrival,
    fare_brand: offer.fare_brand,
    carry_on_included: offer.extensions.carry_on_included,
    checked_bags_included: offer.extensions.checked_bags_included,
    emissions_delta_percent: offer.emissions?.delta_percent ?? null,
  };
}

function itinerarySummary(route: FlightRoute): string {
  const segments = route.segments ?? [];
  if (segments.length === 0) return '';
  return segments
    .map((segment) => {
      const time = segment.dt.split('T')[1]?.substring(0, 5) ?? '';
      return `${segment.da} ${time} -> ${segment.aa}`;
    })
    .join(', ');
}

function routeDurationMinutes(route: FlightRoute): number {
  const segments = route.segments ?? [];
  if (segments.length === 0) return Number.POSITIVE_INFINITY;
  const start = Date.parse(segments[0].dt);
  const end = Date.parse(segments[segments.length - 1].at);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return segments.reduce((sum, segment) => sum + (segment.duration || 0), 0);
  }
  return Math.round((end - start) / 60000);
}

/**
 * Every program can price several distinct itineraries. Keeping only the
 * cheapest one hid the other candidates — a different connecting city, or the
 * same flight under a different operating carrier — so keep the cheapest few
 * per program and let the caller see them all.
 */
function routesForResult(result: FlightResult): FlightRoute[] {
  const priced = (result.routes ?? []).filter((route) => route.payment);
  if (priced.length === 0) return [];
  const byMiles = [...priced].sort(
    (a, b) => (a.payment?.miles ?? Number.POSITIVE_INFINITY) - (b.payment?.miles ?? Number.POSITIVE_INFINITY)
  );

  const seen = new Set<string>();
  const kept: FlightRoute[] = [];
  for (const route of byMiles) {
    const key = `${route.payment?.miles}|${route.payment?.tax}|${itinerarySummary(route)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(route);
    if (kept.length >= MAX_ROUTES_PER_PROGRAM) break;
  }
  return kept;
}

/** "IB352" -> "IB"; the operating carrier of a segment. */
export function carrierFromFlightNumber(flightNumber: string | undefined): string | null {
  const match = (flightNumber ?? '').trim().toUpperCase().match(/^([A-Z0-9]{2})\d/);
  return match ? match[1] : null;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function todayUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function daysFromToday(date: string): number {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const today = new Date(`${todayUtc()}T00:00:00Z`);
  return Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
}

/** Split a comma-separated airport list into codes, capped for politeness. */
export function splitAirports(value: string, limit = 3): string[] {
  return value
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0)
    .slice(0, limit);
}

/**
 * Cached options are leads, not quotes: they never drive the valuation, and the
 * caller sees the age of the observation instead of a live price.
 */
function toSecondSourceOption(
  option: SeatsAeroOption,
  cabin: CompareOptions['cabin'],
  cashPrice: number | null
): AwardOption {
  const tax = option.tax ?? 0;
  return {
    program: option.program_code,
    program_name: `${option.program_name} (cached)`,
    miles: option.miles,
    tax,
    tax_currency: option.tax_currency,
    cabin,
    seats: normalizeAwardSeatCount(option.seats),
    stops: option.stops,
    duration_minutes: option.duration_minutes ?? 0,
    itinerary: [option.flight_numbers, option.departs_at, '->', option.arrives_at]
      .filter(Boolean)
      .join(' ')
      .trim(),
    transfer_from: [],
    cents_per_point: centsPerPoint(cashPrice, option.miles, tax),
    cents_per_point_with_bonus: null,
    effective_miles: null,
    transfer_bonus: null,
    source: 'seats.aero',
    verification: 'cached',
    data_age_minutes: option.data_age_minutes,
    operating_carriers: option.operating_carriers,
  };
}

/**
 * Value of a mile in cents: the cash fare you avoid, minus the taxes the award
 * still charges, divided by the miles spent.
 */
function centsPerPoint(cashPrice: number | null, miles: number, tax: number): number | null {
  if (cashPrice === null || miles <= 0) return null;
  return Math.round(((cashPrice - tax) / miles) * 10000) / 100;
}

function bonusEndLabel(unixSeconds: number | null | undefined): string | null {
  if (typeof unixSeconds !== 'number') return null;
  return new Date(unixSeconds * 1000).toISOString().split('T')[0];
}

function toAwardOption(
  result: FlightResult,
  route: FlightRoute,
  cashPrice: number | null,
  manualBonusPercent: number | null,
  useBonuses: boolean,
  operatingCarriers: string[]
): AwardOption | null {
  const payment = route.payment;
  if (!payment) return null;

  const transfers = route.transfer ?? [];

  // A manual override wins; otherwise use the best live bonus PointsYeah
  // reported on this route's transfer options (bank-wide, per program).
  let bonusPercent: number | null = null;
  let bonusApplied: AwardOption['transfer_bonus'] = null;
  if (manualBonusPercent && manualBonusPercent > 0 && transfers.length > 0) {
    bonusPercent = manualBonusPercent;
  } else if (useBonuses) {
    for (const transfer of transfers) {
      const percent = transfer.bonus_percentage ?? 0;
      if (percent > 0 && (bonusPercent === null || percent > bonusPercent)) {
        bonusPercent = percent;
        bonusApplied = {
          bank: transfer.bank,
          percentage: percent,
          end_date: bonusEndLabel(transfer.bonus_end_date),
          slogan: transfer.bonus_slogn ?? '',
        };
      }
    }
  }

  const effectiveMiles = bonusPercent
    ? Math.round(payment.miles / (1 + bonusPercent / 100))
    : payment.miles;

  return {
    program: result.code,
    program_name: result.program,
    miles: payment.miles,
    tax: payment.tax,
    tax_currency: payment.currency,
    cabin: payment.cabin,
    seats: normalizeAwardSeatCount(payment.seats),
    stops: (route.segments?.length ?? 1) - 1,
    duration_minutes: routeDurationMinutes(route),
    itinerary: itinerarySummary(route),
    transfer_from: transfers.map((transfer) => ({ bank: transfer.bank, points: transfer.points })),
    cents_per_point: centsPerPoint(cashPrice, payment.miles, payment.tax),
    cents_per_point_with_bonus: bonusPercent
      ? centsPerPoint(cashPrice, effectiveMiles, payment.tax)
      : null,
    effective_miles: bonusPercent ? effectiveMiles : null,
    transfer_bonus: bonusApplied,
    source: 'pointsyeah',
    verification: 'live-search',
    data_age_minutes: null,
    operating_carriers: operatingCarriers,
  };
}

export interface TripCompareClientDeps {
  flights: IFlightsClient;
  pointsYeah: IPointsYeahClient;
  /** Cached second source (Seats.aero); optional so tests can omit it. */
  secondSource?: ISeatsAeroClient;
}

/** How many routes to keep per loyalty program, instead of only the cheapest. */
const MAX_ROUTES_PER_PROGRAM = 3;

/** Days after the comparison date that the cached second source is searched. */
const SECOND_SOURCE_WINDOW_DAYS = 3;

/** Anonymous Seats.aero access covers today through 60 days out, inclusive. */
const SECOND_SOURCE_MAX_DAYS_OUT = 60;

export class TripCompareClient {
  constructor(private deps: TripCompareClientDeps) {}

  /**
   * Probe a flexible departure window for the cheapest cash day and the
   * cheapest award day, so the caller knows where each side is strongest.
   */
  private async probeWindow(
    options: CompareOptions,
    seatClass: 'economy' | 'premium_economy' | 'business' | 'first',
    roundTrip: boolean
  ): Promise<CompareResult['window']> {
    const departDateTo = options.departDateTo as string;
    let cashBest: { date: string | null; price: number | null; airline: string | null } | null = null;
    let pointsBest: {
      date: string | null;
      miles: number | null;
      program: string | null;
      tax: number | null;
    } | null = null;

    try {
      const grid = await this.deps.flights.getDateGrid({
        origin: options.origin,
        destination: options.destination,
        departure_date: options.departDate,
        trip_type: roundTrip ? 'round_trip' : 'one_way',
        seat_class: seatClass,
        adults: options.adults,
        currency: 'USD',
        start_date: options.departDate,
        end_date: departDateTo,
        return_date: options.returnDate,
        sort: 'price',
        max_results: 5,
        max_dates: 5,
        exclude_basic_economy: true,
      });
      // A cheap outbound-only RT display price cannot choose a defensible comparison date.
      const gridComparable = !roundTrip &&
        options.adults === 1 &&
        grid.quote_status === 'indicative_one_way' &&
        grid.price_basis === 'google_displayed_fare_unverified' &&
        grid.cabin_honored === true;
      cashBest = gridComparable && grid.cheapest
        ? { date: grid.cheapest.date, price: grid.cheapest.price, airline: grid.cheapest.airline }
        : null;
    } catch (error) {
      logWarning(
        'compare',
        `Cash window probe failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    try {
      const award = await this.deps.pointsYeah.findCheapestAwardDates({
        departure: options.origin,
        arrival: options.destination,
        departDate: options.departDate,
        departDateTo,
        returnDate: options.returnDate,
        cabins: [options.cabin],
        adults: options.adults,
        children: 0,
        minSeats: options.adults,
        sortBy: 'miles',
        limit: 20,
      });
      pointsBest = award.cheapest
        ? {
            date: award.cheapest.date,
            miles: award.cheapest.miles,
            program: award.cheapest.program,
            tax: award.cheapest.tax,
          }
        : null;
    } catch (error) {
      logWarning(
        'compare',
        `Award window probe failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const comparedDate = cashBest?.date ?? options.departDate;
    const parts = cashBest
      ? [`Compared on the cheapest cash day (${comparedDate}) in ${options.departDate}..${departDateTo}.`]
      : [`No comparable cash date-grid quote was available; kept the requested departure date ${comparedDate}. Unverified round-trip, party or cabin display prices cannot rank cash dates for CPP.`];
    if (pointsBest?.date && pointsBest.date !== comparedDate) {
      parts.push(
        `The cheapest award day was ${pointsBest.date} (${pointsBest.miles} miles on ${pointsBest.program}).`
      );
    }

    return {
      depart_date_to: departDateTo,
      cash: cashBest,
      points: pointsBest,
      compared_date: comparedDate,
      note: parts.join(' '),
    };
  }

  /**
   * Consult the cached second source, once, and only when the live search left
   * a gap worth filling. Its options are marked as cached and never drive the
   * valuation.
   */
  private async checkSecondSource(args: {
    options: CompareOptions;
    seatClass: 'economy' | 'premium_economy' | 'business' | 'first';
    compareDate: string;
    gapDetected: boolean;
    cashPrice: number | null;
    existing: AwardOption[];
  }): Promise<{ info: NonNullable<CompareResult['second_source']>; options: AwardOption[] }> {
    const name = 'seats.aero';
    const skipped = (note: string) => ({
      info: { name, status: 'skipped' as const, error: null, options_found: 0, note },
      options: [] as AwardOption[],
    });

    if (args.options.useSecondSource === false || process.env.TRIP_COMPARE_SECOND_SOURCE === 'off') {
      return skipped('Second source disabled for this call.');
    }
    if (!this.deps.secondSource) {
      return skipped('Second source not configured.');
    }
    if (!args.gapDetected) {
      return skipped('The live search already covers this route, so the cached second source was not queried.');
    }

    const daysOut = daysFromToday(args.compareDate);
    if (daysOut < 0 || daysOut > SECOND_SOURCE_MAX_DAYS_OUT) {
      return skipped(
        `Anonymous access only covers departures from today through ${SECOND_SOURCE_MAX_DAYS_OUT} days out; ${args.compareDate} is outside that window.`
      );
    }

    // The end of the window has to stay inside the anonymous range too.
    const windowEnd = addDays(args.compareDate, SECOND_SOURCE_WINDOW_DAYS);
    const maxDate = addDays(todayUtc(), SECOND_SOURCE_MAX_DAYS_OUT);
    const endDate = windowEnd > maxDate ? maxDate : windowEnd;

    try {
      const found = await this.deps.secondSource.searchFlights({
        origins: splitAirports(args.options.origin),
        destinations: splitAirports(args.options.destination),
        startDate: args.compareDate,
        endDate,
        cabin: args.seatClass,
        maxResults: 20,
      });

      const seen = new Set(args.existing.map((option) => `${option.program}|${option.itinerary}`));
      const options: AwardOption[] = [];
      for (const option of found) {
        if (options.length >= 8) break;
        const mapped = toSecondSourceOption(option, args.options.cabin, args.cashPrice);
        const key = `${mapped.program}|${mapped.itinerary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(mapped);
      }
      options.sort(byAwardValue);

      if (options.length === 0) {
        return {
          info: {
            name,
            status: 'no_results',
            error: null,
            options_found: 0,
            note: 'Seats.aero had no cached observations for this route and window.',
          },
          options,
        };
      }

      const withSeats = options.filter((option) => option.seats !== null).length;
      return {
        info: {
          name,
          status: 'ok',
          error: null,
          options_found: options.length,
          note:
            `Cached Seats.aero observations, not live quotes: ${options.length} option(s) from other programs` +
            `${withSeats > 0 ? ` (${withSeats} with a reported seat count)` : ''}. Verify before booking.`,
        },
        options,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning('compare', `Second source failed: ${message}`);
      return {
        info: {
          name,
          status: 'error',
          error: message,
          options_found: 0,
          note: 'The cached second source could not be reached; the live comparison is unaffected.',
        },
        options: [],
      };
    }
  }

  async comparePointsVsCash(options: CompareOptions): Promise<CompareResult> {
    const seatClass = SEAT_CLASS[options.cabin];
    const roundTrip = Boolean(options.returnDate);

    let compareDate = options.departDate;
    let windowInfo: CompareResult['window'] = null;
    if (options.departDateTo && options.departDateTo > options.departDate) {
      windowInfo = await this.probeWindow(options, seatClass, roundTrip);
      if (windowInfo?.cash?.date) compareDate = windowInfo.cash.date;
    }

    // Cash side — one polite Google Flights request.
    let cashResult: SearchFlightsResult | null = null;
    let cashSearchError: string | null = null;
    try {
      cashResult = await this.deps.flights.searchFlights({
        origin: options.origin,
        destination: options.destination,
        departure_date: compareDate,
        return_date: options.returnDate,
        trip_type: roundTrip ? 'round_trip' : 'one_way',
        seat_class: seatClass,
        adults: options.adults,
        children: 0,
        infants_in_seat: 0,
        infants_on_lap: 0,
        max_stops: 'any',
        sort_by: 'price',
        max_results: options.cashLimit,
        offset: 0,
        currency: 'USD',
        exclude_basic_economy: true,
      });
    } catch (error) {
      cashSearchError = error instanceof Error ? error.message : String(error);
      logWarning('compare', `Cash lookup failed: ${cashSearchError}`);
    }

    const quoteStatus: CashOption['quote_status'] = cashResult?.quote_status ?? 'unknown';
    const priceBasis: CashPriceBasis | 'unknown' = cashResult?.price_basis ?? 'unknown';
    const cashOptions = (cashResult?.flights ?? [])
      .filter((offer) => Number.isFinite(offer.price) && offer.price > 0 && offer.currency === 'USD')
      .map((offer) => toCashOption(offer, quoteStatus));
    const cheapestCash = [...cashOptions].sort((a, b) => a.price - b.price)[0] ?? null;
    const usableForValuation = cheapestCash !== null &&
      canUseCashForIndicativeCpp(cashResult, options.adults, roundTrip);
    // Explicitly separate the visible displayed fare from the price used in CPP.
    const cashPrice = usableForValuation ? cheapestCash.price : null;

    const cashSearchStatus: CashSearchStatus = cashSearchError
      ? 'search_failed'
      : cashOptions.length === 0 ? 'no_fares_returned'
      : usableForValuation ? 'fares_found'
      : 'fares_unverified';

    // Award side — a live PointsYeah search (browser-backed, slow).
    let pointsResult: FlightSearchResults | null = null;
    let awardSearchError: string | null = null;
    try {
      pointsResult = await this.deps.pointsYeah.searchFlights({
        departure: options.origin,
        arrival: options.destination,
        departDate: compareDate,
        returnDate: options.returnDate,
        tripType: roundTrip ? '2' : '1',
        adults: options.adults,
        children: 0,
        cabins: [options.cabin],
        multiday: false,
        transferBonusOnly: false,
        buyPointsPromotionOnly: false,
        excludeRedeye: false,
        sortBy: 'miles',
        maxMiles: options.maxMiles,
        limit: options.pointsLimit,
      });
    } catch (error) {
      awardSearchError = error instanceof Error ? error.message : String(error);
      logWarning('compare', `Award lookup failed: ${awardSearchError}`);
    }

    const awardOptions: AwardOption[] = [];
    const programsSeen: string[] = [];
    const operatingCarriers = new Set<string>();
    for (const result of pointsResult?.results ?? []) {
      programsSeen.push(result.code);
      for (const route of routesForResult(result)) {
        const carriers = (route.segments ?? [])
          .map((segment) => carrierFromFlightNumber(segment.flight_number))
          .filter((code): code is string => code !== null);
        for (const carrier of carriers) operatingCarriers.add(carrier);

        const option = toAwardOption(
          result,
          route,
          cashPrice,
          options.transferBonusPercent ?? null,
          options.useTransferBonuses !== false,
          carriers
        );
        if (option) awardOptions.push(option);
      }
    }

    // The cash side names the airline directly; use it for the coverage check.
    for (const offer of cashResult?.flights ?? []) {
      const code = (offer as { airline_code?: string }).airline_code;
      if (code) operatingCarriers.add(code.toUpperCase());
    }

    awardOptions.sort(byAwardValue);

    const minCpp = options.minCentsPerPoint ?? DEFAULT_MIN_CENTS_PER_POINT;
    // Only a live award search may drive the valuation: cached observations are
    // leads to verify, and an unreported seat count cannot cover a party.
    const liveOptions = awardOptions.filter((option) => option.verification === 'live-search');
    const eligible = liveOptions.filter(
      (option) => option.seats !== null && option.seats >= options.adults
    );
    const best = eligible[0] ?? null;
    const bestValue = best?.cents_per_point_with_bonus ?? best?.cents_per_point ?? null;
    // A mix of insufficient known counts and unknown counts is NOT proof the party cannot fit.
    const hasUnverifiedSeats = liveOptions.some((option) => option.seats === null);

    // "Nothing came back" and "nothing is bookable" are different claims. Track
    // which one the evidence actually supports, so one source's silence never
    // becomes a "cash is the only option" verdict.
    let awardSearchStatus: AwardSearchStatus;
    if (awardSearchError) {
      awardSearchStatus = 'search_failed';
    } else if (liveOptions.length === 0) {
      awardSearchStatus = 'no_awards_returned';
    } else if (eligible.length === 0) {
      awardSearchStatus = hasUnverifiedSeats ? 'seats_unverified' : 'seats_insufficient';
    } else {
      awardSearchStatus = 'awards_found';
    }

    // Coverage check: which programs could hold this trip's award space that
    // the search never queried. The static list is always relevant; the carrier
    // entries are what make it actionable for a specific route.
    const carrierGaps = coverageGapsForCarriers([...operatingCarriers]);
    const gaps = mergeCoverageGaps(carrierGaps, staticCoverageGaps());
    const gapText = describeCoverageGaps(gaps);
    const cashNote = cashPrice !== null
      ? ` The cheapest INDICATIVE one-way displayed cash fare found was ${cashPrice} USD, not a checkout-verified total.`
      : cashSearchStatus === 'fares_unverified'
        ? ` Google returned displayed cash fares, but their full itinerary/passenger/cabin pricing status is unverified.`
        : '';

    // Second source: only when there is a gap worth filling, and only one call.
    const secondSource = await this.checkSecondSource({
      options,
      seatClass,
      compareDate,
      gapDetected: awardSearchStatus !== 'awards_found' || carrierGaps.length > 0,
      cashPrice,
      existing: awardOptions,
    });
    const secondSourceInfo = secondSource.info;
    if (secondSource.options.length > 0) {
      awardOptions.push(...secondSource.options);
      awardOptions.sort(byAwardValue);
    }
    const secondSourceNote =
      secondSourceInfo.status === 'ok'
        ? ` The cached second source (Seats.aero) also lists ${secondSourceInfo.options_found} option(s) from other programs — verify before booking.`
        : '';

    let recommendation: CompareResult['verdict']['recommendation'];
    let reason: string;
    if (awardSearchStatus === 'search_failed') {
      recommendation = 'insufficient_data';
      reason =
        `The live award search did not complete (${awardSearchError}), so no points value could be verified.` +
        `${cashNote} Treat the award side as "not checked", not as "no award space".`;
    } else if (cashSearchStatus === 'fares_unverified') {
      recommendation = 'insufficient_data';
      reason =
        `Google returned a reference cash fare, but it is not a comparable completed ticket price (quote_status=${quoteStatus}, price_basis=${priceBasis}, adults=${options.adults}).` +
        ' A round trip must include a selected return flight; multiple passengers require a verified price basis; the requested cabin must be honored. No cash-vs-points CPP or definitive recommendation is possible yet.' +
        (awardSearchStatus === 'seats_unverified' ? ' Award seat inventory also could not be confirmed.' : '');
    } else if (cashPrice === null) {
      recommendation = 'insufficient_data';
      reason = cashSearchStatus === 'search_failed'
        ? `The cash fare lookup did not complete (${cashSearchError}); no comparable cash price is available, so a cash-vs-points recommendation is not justified. Award options, if any, remain leads to verify.`
        : `The cash lookup returned no comparable fares. That is not proof no cash fare exists, and the award side cannot be valued against a missing cash price. Re-check other dates or sources before making a points-vs-cash decision.`;
    } else if (!best && awardSearchStatus === 'seats_insufficient') {
      recommendation = 'cash';
      // Every option falls short of the party size, so report the roomiest one.
      // Never use a cached second-source seat count to establish live capacity.
      const scarce = liveOptions.reduce((a, b) => ((b.seats ?? -1) > (a.seats ?? -1) ? b : a));
      reason =
        `Award space exists, but the roomiest option (${scarce.program_name}) only offers ${scarce.seats} seat(s) for ${options.adults} traveller(s), so it cannot cover this party.`;
    } else if (!best && awardSearchStatus === 'seats_unverified') {
      recommendation = 'insufficient_data';
      const unverified = liveOptions[0];
      reason =
        `Award options came back (cheapest ${unverified.miles} miles on ${unverified.program_name}), but none reported a seat count, so ${options.adults} seat(s) could not be confirmed.` +
        `${cashNote} Verify seat availability before treating this as bookable.`;
    } else if (!best) {
      recommendation = 'insufficient_data';
      reason =
        `The sources searched (PointsYeah, ${SEARCHED_PROGRAM_CODES.length} programs) returned no award space for this cabin.` +
        `${cashNote}${secondSourceNote} That is not proof none is bookable: ${gapText} are not covered by the search — check those directly before treating cash as the only option.`;
    } else if (bestValue !== null && bestValue >= minCpp) {
      recommendation = 'points';
      const bonusNote = best.transfer_bonus
        ? ` Includes a ${best.transfer_bonus.percentage}% transfer bonus via ${best.transfer_bonus.bank}.`
        : '';
      reason = `${best.program_name} values each mile at ${bestValue.toFixed(2)} cents against the ${cashPrice} USD cash fare (threshold ${minCpp}).${bonusNote}`;
    } else {
      recommendation = 'cash';
      reason =
        bestValue === null
          ? 'Could not value the award options against a cash fare.'
          : `The best award (${best.program_name}) is only worth ${bestValue.toFixed(2)} cents per mile, below the ${minCpp} cent threshold — the cash fare is the better deal.`;
    }

    logDebug('compare', `Verdict: ${recommendation} (${reason})`);

    return {
      route: {
        origin: options.origin,
        destination: options.destination,
        depart_date: compareDate,
        return_date: options.returnDate,
        cabin: options.cabin,
        adults: options.adults,
      },
      cash: {
        cheapest: cheapestCash,
        options: cashOptions,
        price_insights_level: cashResult?.price_insights?.level ?? null,
        price_history_low: cashResult?.price_insights?.range_low ?? null,
        search_url: cashResult?.search_url ?? '',
        search_status: cashSearchStatus,
        quote_status: quoteStatus,
        price_basis: priceBasis,
        party_total: null,
        checkout_verified: false,
        usable_for_valuation: usableForValuation,
        comparable_price: cashPrice,
        search_error: cashSearchError,
      },
      points: {
        options: awardOptions,
        programs_seen: programsSeen,
        unfiltered_total: pointsResult?.unfiltered_total ?? 0,
        search_status: awardSearchStatus,
        search_error: awardSearchError,
        programs_searched: [...SEARCHED_PROGRAM_CODES],
        coverage_gaps: gaps,
        verification_links: gaps.length > 0 ? [...VERIFICATION_LINKS] : [],
        coverage_last_verified: COVERAGE_LAST_VERIFIED,
      },
      verdict: {
        recommendation,
        best_award_program: best?.program_name ?? null,
        cents_per_point: bestValue,
        reason,
        award_search_status: awardSearchStatus,
      },
      second_source: secondSourceInfo,
      transfer_bonus_percent: options.transferBonusPercent ?? null,
      auto_transfer_bonuses: !options.transferBonusPercent && options.useTransferBonuses !== false,
      window: windowInfo,
    };
  }
}
