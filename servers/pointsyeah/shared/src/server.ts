import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerResources } from './resources.js';
import { createRegisterTools } from './tools.js';
import { getServerState } from './state.js';
import type {
  FlightSearchParams,
  FlightResult,
  FlightRoute,
  FlightSearchResults,
  CognitoTokens,
  FindTransferBonusesParams,
  TransferBonus,
  TransferBonusSearchResult,
  FindCheapestAwardDatesParams,
  AwardDateOption,
  CheapestAwardDatesResult,
  ManagePriceAlertsParams,
  PriceAlert,
  PriceAlertList,
} from './types.js';
import { FlightSearchParamsSchema } from './types.js';
import { refreshCognitoTokens } from './pointsyeah-client/lib/auth.js';
import { createSearchTask } from './pointsyeah-client/lib/search.js';
import type { PlaywrightSearchDeps } from './pointsyeah-client/lib/search.js';
import { fetchSearchResults } from './pointsyeah-client/lib/fetch-results.js';
import { getSearchHistory } from './pointsyeah-client/lib/user-api.js';
import { logDebug, logWarning } from './logging.js';
import {
  API2_BASE,
  LIVE_BASE,
  DEFAULT_BANKS,
  DEFAULT_ALERT_CABINS,
  FETCH_TIMEOUT_MS,
} from './constants.js';

// =============================================================================
// AWARD EXPLORER API (api2.pointsyeah.com)
//
// The website's Explorer (award map) is served by api2 with the same Cognito
// token the live search uses, so no extra credentials are needed. Responses
// are plain JSON — a second or two per call, versus 30-90s for the
// browser-driven live search.
// =============================================================================

/** Gap between explorer calls; these hit the same API as the rest of the app. */
const EXPLORER_MIN_INTERVAL_MS = 250;

let lastExplorerCall = 0;
let explorerChain: Promise<void> = Promise.resolve();

async function explorerSlot(): Promise<void> {
  const previous = explorerChain;
  let release: () => void = () => {};
  explorerChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const elapsed = Date.now() - lastExplorerCall;
  const wait = EXPLORER_MIN_INTERVAL_MS + Math.floor(Math.random() * 150) - elapsed;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastExplorerCall = Date.now();
  release();
}

async function api2Post<T>(path: string, body: unknown, idToken: string): Promise<T> {
  await explorerSlot();
  logDebug('explorer', `POST ${path}`);

  const response = await fetch(`${API2_BASE}${path}`, {
    method: 'POST',
    headers: {
      // The API expects the raw Cognito ID token, no Bearer prefix.
      Authorization: idToken,
      'Content-Type': 'application/json',
      Origin: 'https://www.pointsyeah.com',
      Referer: 'https://www.pointsyeah.com/',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`PointsYeah API ${path} failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    code?: number;
    success?: boolean;
    error?: string;
    message?: string;
    data?: unknown;
  };

  if (payload.success === false) {
    throw new Error(`PointsYeah API ${path} error: ${payload.error ?? payload.message ?? 'unknown'}`);
  }
  return (payload.data !== undefined ? payload.data : payload) as T;
}

// =============================================================================
// LIVE ACCOUNT API (api.pointsyeah.com/v2/live)
//
// Price alerts, preferences and the transfer-bonus catalog are served here.
// Same Cognito ID token as the search API, plain JSON, no browser involved.
// =============================================================================

/** Gap between live-account calls, so we stay polite to the API. */
const LIVE_MIN_INTERVAL_MS = 250;

let lastLiveCall = 0;
let liveChain: Promise<void> = Promise.resolve();

async function liveSlot(): Promise<void> {
  const previous = liveChain;
  let release: () => void = () => {};
  liveChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const elapsed = Date.now() - lastLiveCall;
  const wait = LIVE_MIN_INTERVAL_MS + Math.floor(Math.random() * 150) - elapsed;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastLiveCall = Date.now();
  release();
}

async function liveCall<T>(
  method: 'GET' | 'POST',
  path: string,
  idToken: string,
  body?: unknown
): Promise<T> {
  await liveSlot();
  logDebug('live', `${method} ${path}`);

  const response = await fetch(`${LIVE_BASE}${path}`, {
    method,
    headers: {
      // Same convention as the search API: raw Cognito ID token, no Bearer prefix.
      Authorization: idToken,
      'Content-Type': 'application/json',
      Origin: 'https://www.pointsyeah.com',
      Referer: 'https://www.pointsyeah.com/',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`PointsYeah API ${path} failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    code?: number;
    success?: boolean;
    error?: string;
    message?: string;
    data?: unknown;
  };

  if (payload.success === false) {
    throw new Error(`PointsYeah API ${path} error: ${payload.error ?? payload.message ?? 'unknown'}`);
  }
  return (payload.data !== undefined ? payload.data : payload) as T;
}

/** Shape the web app posts to /flight/alert/create. */
function buildPriceAlertPayload(params: ManagePriceAlertsParams): Record<string, unknown> {
  const filterCriteria: Record<string, unknown> = {
    max_miles: params.maxMiles,
    exclude_cabins: [],
    include_cabins: [],
    cabins: params.cabins ?? DEFAULT_ALERT_CABINS,
    banks: params.banks ?? DEFAULT_BANKS,
  };
  if (params.maxStops !== undefined) filterCriteria.stops = params.maxStops;
  if (params.airlines && params.airlines.length > 0) filterCriteria.airlines = params.airlines;
  if (params.maxTax !== undefined) filterCriteria.tax = params.maxTax;
  if (params.maxDurationHours !== undefined) filterCriteria.max_duration = params.maxDurationHours;
  if (params.flightNumbers && params.flightNumbers.length > 0) {
    filterCriteria.flight_number = params.flightNumbers;
  }
  if (params.excludeAirlines && params.excludeAirlines.length > 0) {
    filterCriteria.carrier_exclusion = params.excludeAirlines;
  }

  return {
    filter_criteria: filterCriteria,
    info: {
      departure: params.origin,
      arrival: params.destination,
      departureDate: params.departDate,
      departureDateSec: params.departDateTo ?? params.departDate,
      passengers_v2: { adults: params.adults, children: params.children },
    },
  };
}

// =============================================================================
// RESULT FILTERS
//
// PointsYeah returns every program it searched; these filters trim the payload
// locally so the caller only sees options that fit their constraints.
// =============================================================================

function layoverMinutes(route: FlightRoute): number[] {
  const segments = route.segments ?? [];
  const gaps: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const arrived = Date.parse(segments[i - 1].at);
    const departs = Date.parse(segments[i].dt);
    if (Number.isNaN(arrived) || Number.isNaN(departs)) continue;
    gaps.push(Math.round((departs - arrived) / 60000));
  }
  return gaps;
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

function isRedeye(route: FlightRoute): boolean {
  const first = route.segments?.[0];
  if (!first) return false;
  const hour = Number(first.dt.split('T')[1]?.substring(0, 2));
  if (Number.isNaN(hour)) return false;
  return hour >= 21 || hour < 5;
}

function routePassesFilters(route: FlightRoute, params: FlightSearchParams): boolean {
  const payment = route.payment;
  const segments = route.segments ?? [];

  if (params.maxMiles !== undefined && (payment === null || payment.miles > params.maxMiles)) {
    return false;
  }
  if (params.maxTax !== undefined && (payment === null || payment.tax > params.maxTax)) {
    return false;
  }
  if (params.minSeats !== undefined && (payment === null || payment.seats < params.minSeats)) {
    return false;
  }
  if (params.maxStops !== undefined && segments.length - 1 > params.maxStops) {
    return false;
  }
  if (params.maxLayoverMinutes !== undefined) {
    const gaps = layoverMinutes(route);
    if (gaps.some((gap) => gap > params.maxLayoverMinutes!)) return false;
  }
  if (params.excludeRedeye && isRedeye(route)) {
    return false;
  }
  return true;
}

function bestRouteValue(route: FlightRoute, sortBy: FlightSearchParams['sortBy']): number {
  switch (sortBy) {
    case 'miles':
      return route.payment?.miles ?? Number.POSITIVE_INFINITY;
    case 'tax':
      return route.payment?.tax ?? Number.POSITIVE_INFINITY;
    case 'duration':
      return routeDurationMinutes(route);
    default:
      return Number.POSITIVE_INFINITY;
  }
}

// PointsYeah only applies `airlineProgram` as a browser-side display filter —
// the encrypted API request carries banks and the promotion flags but not the
// program list — so we honour it locally instead.
const PROGRAM_PSEUDO_VALUES = ['Bank transfer promotion only', 'Buy points promotion only'];

function matchesAirlineProgram(result: FlightResult, wanted: string[]): boolean {
  const codes = wanted.map((value) => value.trim().toUpperCase());
  const names = wanted.map((value) => value.trim().toLowerCase());
  return (
    codes.includes(result.code.toUpperCase()) || names.includes(result.program.toLowerCase())
  );
}

/** Normalize a cabin label so "Business" and "business" match. */
function normalizeCabin(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, ' ');
}

/**
 * PointsYeah does not filter by cabin server-side either — a Business search
 * comes back with economy and premium-economy awards mixed in — so we match the
 * award's cabin locally.
 */
function routeMatchesCabins(route: FlightRoute, wanted: string[]): boolean {
  const cabin = route.payment?.cabin;
  if (!cabin) return false;
  return wanted.includes(normalizeCabin(cabin));
}

export function applyResultFilters(
  results: FlightResult[],
  params: FlightSearchParams,
  stats?: { droppedByCabin?: number }
): FlightResult[] {
  let scoped = results;
  const programs = (params.airlineProgram ?? []).filter(
    (value) => !PROGRAM_PSEUDO_VALUES.includes(value)
  );
  if (programs.length > 0) {
    scoped = scoped.filter((result) => matchesAirlineProgram(result, programs));
  }

  const wantedCabins = (params.cabins ?? []).map(normalizeCabin);
  const filterCabins = wantedCabins.length > 0;

  const hasRouteFilters =
    filterCabins ||
    params.maxMiles !== undefined ||
    params.maxTax !== undefined ||
    params.minSeats !== undefined ||
    params.maxStops !== undefined ||
    params.maxLayoverMinutes !== undefined ||
    params.excludeRedeye;

  const filtered: FlightResult[] = [];
  for (const result of scoped) {
    let routes = result.routes ?? [];
    if (hasRouteFilters) {
      routes = routes.filter((route) => routePassesFilters(route, params));
    }
    if (filterCabins) {
      const before = routes.length;
      routes = routes.filter((route) => routeMatchesCabins(route, wantedCabins));
      if (stats) stats.droppedByCabin = (stats.droppedByCabin ?? 0) + (before - routes.length);
    }
    if (routes.length === 0) continue;

    if (params.sortBy !== 'program') {
      routes = [...routes].sort(
        (a, b) => bestRouteValue(a, params.sortBy) - bestRouteValue(b, params.sortBy)
      );
    }
    filtered.push({ ...result, routes });
  }

  if (params.sortBy !== 'program') {
    filtered.sort(
      (a, b) =>
        Math.min(...(a.routes ?? []).map((r) => bestRouteValue(r, params.sortBy))) -
        Math.min(...(b.routes ?? []).map((r) => bestRouteValue(r, params.sortBy)))
    );
  }

  return params.limit !== undefined ? filtered.slice(0, params.limit) : filtered;
}

// =============================================================================
// CLIENT INTERFACE
// =============================================================================

export interface AwardExplorerResult {
  total: number;
  results: unknown[];
  [key: string]: unknown;
}

export interface IPointsYeahClient {
  searchFlights(params: FlightSearchParams): Promise<FlightSearchResults>;
  getSearchHistory(): Promise<unknown>;
  findTransferBonuses(params: FindTransferBonusesParams): Promise<TransferBonusSearchResult>;
  findCheapestAwardDates(params: FindCheapestAwardDatesParams): Promise<CheapestAwardDatesResult>;
  // Award explorer API (api2, same Cognito token)
  exploreAwardRoutes(body: Record<string, unknown>): Promise<AwardExplorerResult>;
  exploreAwardAggregate(body: Record<string, unknown>): Promise<AwardExplorerResult>;
  exploreAwardCount(): Promise<{ count: number }>;
  exploreAwardRecommend(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  exploreFilterRange(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  // Live account API (price alerts)
  listPriceAlerts(): Promise<PriceAlertList>;
  createPriceAlert(params: ManagePriceAlertsParams): Promise<PriceAlert>;
  deletePriceAlert(alertId: string): Promise<void>;
}

function bonusEndDateLabel(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString().split('T')[0];
}

function awardItinerary(route: FlightRoute): string {
  return (route.segments ?? [])
    .map((segment) => {
      const time = segment.dt.split('T')[1]?.substring(0, 5) ?? '';
      return `${segment.da} ${time} -> ${segment.aa}`;
    })
    .join(', ');
}

function toAwardDateOption(result: FlightResult, route: FlightRoute): AwardDateOption | null {
  const payment = route.payment;
  if (!payment) return null;
  return {
    date: result.date,
    program: result.program,
    program_code: result.code,
    miles: payment.miles,
    tax: payment.tax,
    cabin: payment.cabin,
    seats: payment.seats,
    stops: (route.segments?.length ?? 1) - 1,
    itinerary: awardItinerary(route),
  };
}

// =============================================================================
// CLIENT IMPLEMENTATION
// =============================================================================

export class PointsYeahClient implements IPointsYeahClient {
  private tokens: CognitoTokens | null = null;
  private refreshPromise: Promise<CognitoTokens> | null = null;
  private playwright: PlaywrightSearchDeps;

  constructor(playwright: PlaywrightSearchDeps) {
    this.playwright = playwright;
  }

  private get refreshToken(): string {
    const { refreshToken } = getServerState();
    if (!refreshToken) {
      throw new Error(
        'Refresh token expired or revoked. Please re-login to PointsYeah and update POINTSYEAH_REFRESH_TOKEN.'
      );
    }
    return refreshToken;
  }

  /**
   * Ensure we have valid tokens, refreshing if needed.
   * Uses a mutex (refreshPromise) to prevent concurrent refresh calls.
   */
  private async ensureTokens(): Promise<CognitoTokens> {
    const now = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER = 5 * 60; // 5 minutes

    if (!this.tokens || this.tokens.expiresAt - now < REFRESH_BUFFER) {
      if (!this.refreshPromise) {
        logDebug('client', 'Tokens expired or expiring soon, refreshing...');
        this.refreshPromise = refreshCognitoTokens(this.refreshToken)
          .then((tokens) => {
            this.tokens = tokens;
            this.refreshPromise = null;
            return tokens;
          })
          .catch((err) => {
            this.refreshPromise = null;
            throw err;
          });
      }
      return this.refreshPromise;
    }

    return this.tokens;
  }

  /**
   * Make an API call with automatic token refresh on 401.
   */
  private async withAuth<T>(fn: (idToken: string) => Promise<T>): Promise<T> {
    const tokens = await this.ensureTokens();
    try {
      return await fn(tokens.idToken);
    } catch (error) {
      // If we get a 401, force a token refresh and retry once
      if (error instanceof Error && error.message.includes('401')) {
        logWarning('client', 'Got 401, refreshing tokens and retrying...');
        this.tokens = null;
        this.refreshPromise = null;
        const freshTokens = await this.ensureTokens();
        return await fn(freshTokens.idToken);
      }
      throw error;
    }
  }

  async searchFlights(params: FlightSearchParams): Promise<FlightSearchResults> {
    const tokens = await this.ensureTokens();

    // Step 1: Create search task via Playwright (handles encrypted request).
    // Note: createSearchTask doesn't use withAuth() because it passes tokens as browser
    // cookies to the PointsYeah website, not as API headers. A 401 retry would require
    // re-launching the browser. The 5-minute refresh buffer in ensureTokens() mitigates
    // the risk of token expiry between refresh and browser navigation.
    const task = await createSearchTask(
      params,
      tokens.accessToken,
      tokens.idToken,
      this.refreshToken,
      this.playwright
    );

    // Step 2: Poll for results until search is done.
    // Results arrive in batches across polls, so we accumulate them.
    const POLL_INTERVAL_MS = 3000;
    const MAX_POLLS = 120; // Up to 6 minutes of polling
    const allResults = new Map<string, FlightResult>();
    let done = false;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollResponse = await this.withAuth((idToken) =>
        fetchSearchResults(task.task_id, idToken)
      );

      if (!pollResponse.success) {
        throw new Error(`Search polling failed (code: ${pollResponse.code})`);
      }

      // Guard against null/undefined data envelope from API
      const pollData = pollResponse.data;
      if (!pollData) {
        logWarning('search', `Poll ${i + 1}: response.data is null/undefined, skipping`);
        continue;
      }

      // Accumulate results using program+date+departure+arrival as key
      const pollResults = pollData.result ?? [];
      for (const result of pollResults) {
        const key = `${result.code}-${result.date}-${result.departure}-${result.arrival}`;
        allResults.set(key, result);
      }

      logDebug(
        'search',
        `Poll ${i + 1}: status=${pollData.status}, ${pollResults.length} results this poll, ${allResults.size} total`
      );

      if (pollData.status === 'done') {
        done = true;
        break;
      }
    }

    if (!done) {
      logWarning('search', `Search timed out after ${MAX_POLLS} polls`);
    }

    const unfiltered = Array.from(allResults.values());
    const stats: { droppedByCabin?: number } = {};
    const results = applyResultFilters(unfiltered, params, stats);

    const notes: string[] = [];
    if (stats.droppedByCabin) {
      notes.push(
        `${stats.droppedByCabin} award option(s) in other cabins were hidden locally — PointsYeah does not apply the cabin filter server-side.`
      );
    }

    return {
      total: results.length,
      unfiltered_total: unfiltered.length,
      results,
      notes,
    };
  }

  async getSearchHistory(): Promise<unknown> {
    return this.withAuth((idToken) => getSearchHistory(idToken));
  }

  // --- Explorer (award map), on api2 ---

  async exploreAwardRoutes(body: Record<string, unknown>): Promise<AwardExplorerResult> {
    return this.withAuth((idToken) => api2Post<AwardExplorerResult>('/explorer/search', body, idToken));
  }

  async exploreAwardAggregate(body: Record<string, unknown>): Promise<AwardExplorerResult> {
    return this.withAuth((idToken) =>
      api2Post<AwardExplorerResult>('/explorer/search/aggregate', body, idToken)
    );
  }

  async exploreAwardCount(): Promise<{ count: number }> {
    return this.withAuth((idToken) => api2Post<{ count: number }>('/explorer/count', {}, idToken));
  }

  async exploreAwardRecommend(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withAuth((idToken) =>
      api2Post<Record<string, unknown>>('/explorer/recommend', body, idToken)
    );
  }

  async exploreFilterRange(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withAuth((idToken) =>
      api2Post<Record<string, unknown>>('/explorer/get_filter_range', body, idToken)
    );
  }

  // --- Live account API (price alerts) ---

  async listPriceAlerts(): Promise<PriceAlertList> {
    return this.withAuth(async (idToken) => {
      const data = await liveCall<{
        items?: PriceAlert[];
        alert_limit?: number;
        alert_used?: number;
      }>('GET', '/flight/alerts', idToken);
      return {
        items: data.items ?? [],
        alert_limit: data.alert_limit ?? null,
        alert_used: data.alert_used ?? null,
      };
    });
  }

  async createPriceAlert(params: ManagePriceAlertsParams): Promise<PriceAlert> {
    const body = buildPriceAlertPayload(params);
    return this.withAuth((idToken) => liveCall<PriceAlert>('POST', '/flight/alert/create', idToken, body));
  }

  async deletePriceAlert(alertId: string): Promise<void> {
    await this.withAuth((idToken) =>
      liveCall<unknown>('POST', '/flight/alert/delete', idToken, { alert_id: alertId })
    );
  }

  /**
   * Transfer bonuses are bank-wide, but PointsYeah only reveals them alongside
   * awards it can actually price, so we probe a route and read the bonus fields
   * off each transfer option.
   */
  async findTransferBonuses(params: FindTransferBonusesParams): Promise<TransferBonusSearchResult> {
    const searchParams = FlightSearchParamsSchema.parse({
      departure: params.origin,
      arrival: params.destination,
      departDate: params.departDate,
      returnDate: params.returnDate,
      tripType: params.returnDate ? '2' : '1',
      adults: params.adults,
      children: params.children,
      cabins: params.cabins,
      banks: params.banks,
      multiday: false,
      transferBonusOnly: false,
      buyPointsPromotionOnly: false,
      excludeRedeye: false,
      sortBy: 'program',
    });

    const results = await this.searchFlights(searchParams);
    const found = new Map<string, TransferBonus>();

    for (const result of results.results) {
      for (const route of result.routes ?? []) {
        for (const transfer of route.transfer ?? []) {
          const percent = transfer.bonus_percentage ?? 0;
          if (percent < params.minBonusPercent) continue;

          const key = `${transfer.bank}|${result.code}`;
          const existing = found.get(key);
          if (existing && existing.bonus_percentage >= percent) continue;

          const payment = route.payment;
          const awardMiles = payment?.miles ?? transfer.actual_points;
          found.set(key, {
            bank: transfer.bank,
            bank_code: transfer.code ?? '',
            program: result.program,
            program_code: result.code,
            bonus_percentage: percent,
            award_miles: awardMiles,
            effective_transfer_points: Math.ceil(awardMiles / (1 + percent / 100)),
            points_reported: { actual: transfer.actual_points, nominal: transfer.points },
            bonus_end_date: bonusEndDateLabel(transfer.bonus_end_date),
            slogan: transfer.bonus_slogn ?? '',
            url: transfer.url ?? '',
            sample: payment
              ? {
                  departure: result.departure,
                  arrival: result.arrival,
                  date: result.date,
                  miles: payment.miles,
                  cabin: payment.cabin,
                }
              : null,
          });
        }
      }
    }

    const bonuses = Array.from(found.values())
      .sort((a, b) => b.bonus_percentage - a.bonus_percentage || a.bank.localeCompare(b.bank))
      .slice(0, params.limit);

    const notes: string[] = [];
    if (bonuses.length === 0) {
      notes.push(
        'No live transfer bonuses showed up on this route. Bonuses are bank-wide, so try a busier route or a different date to surface them.'
      );
    }
    if (results.unfiltered_total === 0) {
      notes.push('PointsYeah returned no award results for this route, so no bonuses could be read.');
    }

    return {
      bonuses,
      searched: {
        origin: params.origin,
        destination: params.destination,
        depart_date: params.departDate,
        return_date: params.returnDate,
        cabins: params.cabins,
      },
      total_results: results.total,
      unfiltered_total: results.unfiltered_total,
      notes,
    };
  }

  /**
   * Price a whole window of departure dates in a single PointsYeah search
   * (its flexible-date mode) and report the cheapest award per date.
   */
  async findCheapestAwardDates(
    params: FindCheapestAwardDatesParams
  ): Promise<CheapestAwardDatesResult> {
    const searchParams = FlightSearchParamsSchema.parse({
      departure: params.departure,
      arrival: params.arrival,
      departDate: params.departDate,
      departDateTo: params.departDateTo,
      returnDate: params.returnDate,
      returnDateTo: params.returnDateTo,
      tripType: params.returnDate ? '2' : '1',
      adults: params.adults,
      children: params.children,
      cabins: params.cabins,
      multiday: true,
      transferBonusOnly: false,
      buyPointsPromotionOnly: false,
      excludeRedeye: false,
      maxStops: params.maxStops,
      minSeats: params.minSeats,
      maxMiles: params.maxMiles,
      sortBy: 'miles',
    });

    const results = await this.searchFlights(searchParams);

    const byDate = new Map<string, AwardDateOption>();
    const byProgram = new Map<string, AwardDateOption>();

    for (const result of results.results) {
      for (const route of result.routes ?? []) {
        const option = toAwardDateOption(result, route);
        if (!option) continue;

        const existingDate = byDate.get(option.date);
        if (!existingDate || option.miles < existingDate.miles) byDate.set(option.date, option);

        const existingProgram = byProgram.get(option.program_code);
        if (!existingProgram || option.miles < existingProgram.miles) {
          byProgram.set(option.program_code, option);
        }
      }
    }

    const allDates = Array.from(byDate.values());
    const ordered =
      params.sortBy === 'date'
        ? [...allDates].sort((a, b) => a.date.localeCompare(b.date))
        : [...allDates].sort((a, b) => a.miles - b.miles || a.date.localeCompare(b.date));

    const notes: string[] = [];
    if (allDates.length <= 1) {
      notes.push(
        'PointsYeah only priced a single date in this window — the flexible-date search found no other days with award space.'
      );
    }
    if (allDates.length > 0) {
      notes.push('Prices come from one flexible-date PointsYeah search; confirm before transferring points.');
    }

    return {
      window: { from: params.departDate, to: params.departDateTo },
      dates: ordered.slice(0, params.limit),
      by_program: Array.from(byProgram.values())
        .sort((a, b) => a.miles - b.miles)
        .map((option) => ({
          program: option.program,
          program_code: option.program_code,
          cheapest: option,
        })),
      cheapest: allDates.reduce<AwardDateOption | null>(
        (cheapest, option) => (!cheapest || option.miles < cheapest.miles ? option : cheapest),
        null
      ),
      searched_dates: Array.from(new Set(results.results.map((result) => result.date))).sort(),
      total_results: results.total,
      unfiltered_total: results.unfiltered_total,
      notes,
    };
  }
}

// =============================================================================
// SERVER FACTORY
// =============================================================================

export type ClientFactory = () => IPointsYeahClient;

export interface CreateMCPServerOptions {
  version: string;
}

export function createMCPServer(options: CreateMCPServerOptions) {
  const server = new Server(
    {
      name: 'pointsyeah-mcp-server',
      version: options.version,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  const registerHandlers = async (server: Server, clientFactory: ClientFactory) => {
    registerResources(server, options.version);
    const registerTools = createRegisterTools(clientFactory);
    registerTools(server);
  };

  return { server, registerHandlers };
}

/**
 * Default client factory that creates a PointsYeahClient with Playwright support.
 * Playwright is loaded dynamically to avoid import-time errors in environments
 * where it may not be installed.
 */
export function defaultClientFactory(): IPointsYeahClient {
  const playwrightDeps: PlaywrightSearchDeps = {
    launchBrowser: async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      return {
        addCookies: (cookies) => context.addCookies(cookies),
        newPage: async () => {
          const page = await context.newPage();
          return {
            goto: (url: string, options?: { waitUntil?: string; timeout?: number }) =>
              page.goto(url, options as Parameters<typeof page.goto>[1]).then(() => {}),
            waitForResponse: (
              predicate: (response: { url: () => string; json: () => Promise<unknown> }) => boolean,
              options?: { timeout?: number }
            ) =>
              page
                .waitForResponse((res) => predicate(res), options)
                .then((res) => ({
                  url: () => res.url(),
                  json: () => res.json(),
                })),
            close: () => page.close(),
          };
        },
        close: async () => {
          await context.close();
          await browser.close();
        },
      };
    },
  };

  return new PointsYeahClient(playwrightDeps);
}
