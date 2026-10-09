import { getApiKey } from '../state.js';
import { logDebug, logWarning } from '../logging.js';

/**
 * PointsYeah's public developer API (ai-api.pointsyeah.com).
 *
 * Unlike the website's live search — which needs a real browser because the
 * request payload is encrypted client-side — this API is plain JSON over HTTPS
 * authenticated with an `X-API-Key` header. It exposes an award-flight explorer
 * (including "anywhere" searches and destination recommendations) and a hotel
 * award search. The key is created under the account profile and requires a
 * premium membership (1000 calls/day), so calls stay few and serialized.
 */
export const API_BASE = process.env.POINTSYEAH_API_BASE ?? 'https://ai-api.pointsyeah.com';

/** Gap between API calls — the docs ask for restraint and the quota is daily. */
const MIN_REQUEST_INTERVAL_MS = 300;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1500;

let lastRequestTime = 0;
let requestChain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function acquireSlot(): Promise<void> {
  const previous = requestChain;
  let release: () => void = () => {};
  requestChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const elapsed = Date.now() - lastRequestTime;
  const wait = MIN_REQUEST_INTERVAL_MS + Math.floor(Math.random() * 200) - elapsed;
  if (wait > 0) await sleep(wait);
  lastRequestTime = Date.now();
  release();
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'PointsYeah API key required. Create one under your PointsYeah account profile (API Key page, premium tier), ' +
        'then set POINTSYEAH_API_KEY or call the set_api_key tool.'
    );
    this.name = 'MissingApiKeyError';
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const key = getApiKey();
  if (!key) throw new MissingApiKeyError();

  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await acquireSlot();

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'X-API-Key': key,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) break;
      logWarning('api', `Network error calling ${path} (${lastError}), retrying`);
      await sleep(BASE_BACKOFF_MS * attempt);
      continue;
    }

    if (response.status === 403) {
      throw new Error(
        'PointsYeah rejected the API key (403 Forbidden). The developer API needs a premium-tier key created at pointsyeah.com/account/api-key.'
      );
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      if (attempt === MAX_ATTEMPTS) break;
      const retryAfter = Number(response.headers.get('retry-after')) * 1000;
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logWarning('api', `${path} returned ${response.status}, backing off ${Math.round(delay)}ms`);
      await sleep(delay);
      continue;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PointsYeah API ${path} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    const payload = (await response.json()) as { code?: number; success?: boolean; message?: string; data?: unknown };
    logDebug('api', `${path} -> code=${payload.code ?? 'n/a'} success=${payload.success ?? 'n/a'}`);
    if (payload.success === false) {
      throw new Error(`PointsYeah API ${path} returned an error: ${payload.message ?? 'unknown error'}`);
    }
    // Some endpoints wrap the payload in `data`, others return it directly.
    return (payload.data !== undefined ? payload.data : payload) as T;
  }

  throw new Error(`PointsYeah API ${path} failed after ${MAX_ATTEMPTS} attempts (${lastError}).`);
}

// =============================================================================
// REQUEST SHAPES
// =============================================================================

/** A place filter used by the flight explorer. All lists are OR-ed together. */
export interface PlaceFilter {
  airports?: string[];
  countries?: string[];
  continents?: string[];
  regions?: string[];
  states?: string[];
}

export interface ExplorerSearchBody {
  departure: PlaceFilter;
  arrival: PlaceFilter;
  start_date: string;
  end_date: string;
  cabins: string[];
  seats?: number;
  weekend_only?: boolean;
  collection?: boolean;
  sort?: string;
  pagination?: { page: number; page_size: number };
  group_by?: string;
  [key: string]: unknown;
}

export interface HotelLocation {
  label: string;
  value?: string;
  longitude?: number;
  latitude?: number;
  distance?: number;
  dest_type?: string;
  country_code?: string;
}

export interface HotelSearchBody {
  location: HotelLocation;
  start_date: string;
  end_date: string;
  max_points?: number;
  max_prices?: number;
  amenities?: string[];
  programs?: string[];
  brands?: string[];
  free_night_certificate?: string[];
  fhr_label?: string[];
  weekend_only?: boolean;
  holiday_only?: boolean;
  suit_only?: boolean;
  sort?: string;
  tag?: string[];
  pagination?: { page: number; page_size: number };
  [key: string]: unknown;
}

// =============================================================================
// CLIENT
// =============================================================================

export interface AwardExplorerResult {
  total: number;
  results: unknown[];
  [key: string]: unknown;
}

export interface HotelSearchResult {
  total: number;
  results: unknown[];
  [key: string]: unknown;
}

export class PointsYeahApiClient {
  /** Award flight explorer search (multi-airport / region / date range). */
  explorerSearch(body: ExplorerSearchBody): Promise<AwardExplorerResult> {
    return apiPost<AwardExplorerResult>('/explorer/search', body);
  }

  /** Curated routes from a departure city; supports arrival.anywhere. */
  explorerRecommend(body: Record<string, unknown>): Promise<AwardExplorerResult> {
    return apiPost<AwardExplorerResult>('/explorer/recommend', body);
  }

  /** Min/max ranges for points, tax and duration in a search context. */
  explorerFilterRange(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return apiPost<Record<string, unknown>>('/explorer/get_filter_range', body);
  }

  /** Hotel award availability with points, cash and transfer partners. */
  hotelSearch(body: HotelSearchBody): Promise<HotelSearchResult> {
    return apiPost<HotelSearchResult>('/hotel/explorer/search', body);
  }

  /** Curated hotels for a location. */
  hotelRecommend(body: Record<string, unknown>): Promise<HotelSearchResult> {
    return apiPost<HotelSearchResult>('/hotel/explorer/recommend', body);
  }

  /** Daily availability for one property over a month. */
  hotelCalendar(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return apiPost<Record<string, unknown>>('/hotel/explorer/calendar/v2', body);
  }

  /** Property details (images, phone, description). */
  hotelDetail(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return apiPost<Record<string, unknown>>('/hotel/detail', body);
  }
}
