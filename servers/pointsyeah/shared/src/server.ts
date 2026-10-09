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
} from './types.js';
import { refreshCognitoTokens } from './pointsyeah-client/lib/auth.js';
import { createSearchTask } from './pointsyeah-client/lib/search.js';
import type { PlaywrightSearchDeps } from './pointsyeah-client/lib/search.js';
import { fetchSearchResults } from './pointsyeah-client/lib/fetch-results.js';
import { getSearchHistory } from './pointsyeah-client/lib/user-api.js';
import { logDebug, logWarning } from './logging.js';

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

export function applyResultFilters(
  results: FlightResult[],
  params: FlightSearchParams
): FlightResult[] {
  let scoped = results;
  const programs = (params.airlineProgram ?? []).filter(
    (value) => !PROGRAM_PSEUDO_VALUES.includes(value)
  );
  if (programs.length > 0) {
    scoped = scoped.filter((result) => matchesAirlineProgram(result, programs));
  }

  const hasRouteFilters =
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

export interface IPointsYeahClient {
  searchFlights(params: FlightSearchParams): Promise<FlightSearchResults>;
  getSearchHistory(): Promise<unknown>;
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
    const results = applyResultFilters(unfiltered, params);

    return {
      total: results.length,
      unfiltered_total: unfiltered.length,
      results,
    };
  }

  async getSearchHistory(): Promise<unknown> {
    return this.withAuth((idToken) => getSearchHistory(idToken));
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
