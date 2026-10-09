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
import type { AwardOption, CashOption, CompareOptions, CompareResult } from './types.js';
import { logDebug, logWarning } from './logging.js';

const SEAT_CLASS: Record<CompareOptions['cabin'], 'economy' | 'premium_economy' | 'business' | 'first'> = {
  Economy: 'economy',
  'Premium Economy': 'premium_economy',
  Business: 'business',
  First: 'first',
};

/** Anything at or above this is generally considered a good use of points. */
const DEFAULT_MIN_CENTS_PER_POINT = 1.5;

function toCashOption(offer: FlightOffer): CashOption {
  return {
    price: offer.price,
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

function bestRoute(result: FlightResult): FlightRoute | null {
  const routes = result.routes ?? [];
  if (routes.length === 0) return null;
  return routes.reduce((cheapest, route) => {
    const a = cheapest.payment?.miles ?? Number.POSITIVE_INFINITY;
    const b = route.payment?.miles ?? Number.POSITIVE_INFINITY;
    return b < a ? route : cheapest;
  });
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
  useBonuses: boolean
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
    seats: payment.seats,
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
  };
}

export interface TripCompareClientDeps {
  flights: IFlightsClient;
  pointsYeah: IPointsYeahClient;
}

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
      cashBest = grid.cheapest
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
    const parts = [`Compared on the cheapest cash day (${comparedDate}) in ${options.departDate}..${departDateTo}.`];
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
      logWarning(
        'compare',
        `Cash lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const cashOptions = (cashResult?.flights ?? []).map(toCashOption);
    const cheapestCash = cashOptions[0] ?? null;
    const cashPrice = cheapestCash?.price ?? null;

    // Award side — a live PointsYeah search (browser-backed, slow).
    let pointsResult: FlightSearchResults | null = null;
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
      logWarning(
        'compare',
        `Award lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const awardOptions: AwardOption[] = [];
    const programsSeen: string[] = [];
    for (const result of pointsResult?.results ?? []) {
      programsSeen.push(result.code);
      const route = bestRoute(result);
      if (!route) continue;
      const option = toAwardOption(
        result,
        route,
        cashPrice,
        options.transferBonusPercent ?? null,
        options.useTransferBonuses !== false
      );
      if (option) awardOptions.push(option);
    }

    awardOptions.sort((a, b) => {
      const aValue = a.cents_per_point_with_bonus ?? a.cents_per_point ?? -1;
      const bValue = b.cents_per_point_with_bonus ?? b.cents_per_point ?? -1;
      return bValue - aValue;
    });

    const minCpp = options.minCentsPerPoint ?? DEFAULT_MIN_CENTS_PER_POINT;
    const eligible = awardOptions.filter((option) => option.seats >= options.adults);
    const best = eligible[0] ?? null;
    const bestValue = best?.cents_per_point_with_bonus ?? best?.cents_per_point ?? null;

    let recommendation: CompareResult['verdict']['recommendation'];
    let reason: string;
    if (cashPrice === null && best) {
      recommendation = 'points';
      reason = 'No cash fare was returned, so the award option is the only way to take this trip.';
    } else if (!best) {
      recommendation = 'cash';
      reason = 'No award space was found for this cabin, so paying cash is the only option.';
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
      },
      points: {
        options: awardOptions,
        programs_seen: programsSeen,
        unfiltered_total: pointsResult?.unfiltered_total ?? 0,
      },
      verdict: {
        recommendation,
        best_award_program: best?.program_name ?? null,
        cents_per_point: bestValue,
        reason,
      },
      transfer_bonus_percent: options.transferBonusPercent ?? null,
      auto_transfer_bonuses: !options.transferBonusPercent && options.useTransferBonuses !== false,
      window: windowInfo,
    };
  }
}
