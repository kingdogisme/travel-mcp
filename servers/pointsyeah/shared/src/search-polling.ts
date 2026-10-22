import type { AwardSearchCompletion, FlightResult, FlightRoute, FlightSearchResponse } from './types.js';

export interface PollOutcome {
  completion: AwardSearchCompletion;
  results: FlightResult[];
  polls: number;
  upstream_status: string | null;
  /** Safe, fixed-category failure reason; never exposes upstream authentication data. */
  failure_kind: 'upstream_failed' | 'upstream_rejected' | null;
}

export interface PollOptions {
  /** Absolute clock deadline, normally measured from the BEGINNING of the request. */
  deadlineMs: number;
  poll: () => Promise<FlightSearchResponse>;
  intervalMs?: number;
  /** Reserve enough for one entire HTTP poll before the function's deadline. */
  requestGuardMs?: number;
  maxPolls?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (pollNumber: number, status: string | null, groupCount: number) => void;
}

/**
 * A group can be repeated in successive PointsYeah polls. Keep all distinct
 * itineraries for that group rather than replacing earlier routes or
 * duplicating the same route on every incremental poll.
 */
function routeIdentity(route: FlightRoute): string {
  return JSON.stringify([
    route.payment?.miles ?? null,
    route.payment?.tax ?? null,
    route.payment?.currency ?? null,
    route.payment?.cabin ?? null,
    (route.segments ?? []).map((segment) => [
      segment.flight_number, segment.da, segment.aa,
      segment.dt, segment.at, segment.cabin,
    ]),
  ]);
}

export function mergeAwardBatches(
  groups: Map<string, FlightResult>,
  batch: FlightResult[]
): void {
  for (const value of batch) {
    const key = JSON.stringify([
      value.code, value.program, value.date, value.departure, value.arrival,
    ]);
    const previous = groups.get(key);
    if (!previous) {
      groups.set(key, { ...value, routes: value.routes?.slice() ?? null });
      continue;
    }
    const routes = new Map<string, FlightRoute>();
    for (const route of previous.routes ?? []) routes.set(routeIdentity(route), route);
    for (const route of value.routes ?? []) {
      // More recent polls may update the reported inventory; use the latest
      // value, including an unknown count, rather than keeping stale seats.
      routes.set(routeIdentity(route), route);
    }
    groups.set(key, {
      ...previous,
      ...value,
      routes: routes.size > 0 ? [...routes.values()] : null,
    });
  }
}

/**
 * Poll inside a hard time budget. A timeout or failed poll never masquerades
 * as a completed search; all previously discovered routes remain usable as
 * explicitly incomplete leads, not as evidence of absent award seats.
 */
export async function pollAwardSearch(options: PollOptions): Promise<PollOutcome> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.intervalMs ?? 3000;
  const guard = options.requestGuardMs ?? 35_000;
  const maxPolls = options.maxPolls ?? 120;
  if (interval < 0 || guard < 0 || maxPolls < 1) {
    throw new Error('Invalid PointsYeah polling configuration');
  }

  const groups = new Map<string, FlightResult>();
  let polls = 0;
  let upstreamStatus: string | null = null;
  let failureKind: PollOutcome['failure_kind'] = null;

  while (polls < maxPolls) {
    // Do not START a poll that could run past our hard deadline. Unlike a
    // fixed 120 * 3s loop, this respects browser startup and auth time.
    if (now() + interval + guard >= options.deadlineMs) break;
    await sleep(interval);
    if (now() + guard >= options.deadlineMs) break;
    polls++;

    let reply: FlightSearchResponse;
    try {
      reply = await options.poll();
    } catch {
      failureKind = 'upstream_failed';
      break;
    }
    if (!reply.success) {
      failureKind = 'upstream_rejected';
      break;
    }
    const data = reply.data;
    upstreamStatus = data?.status ?? null;
    if (data && Array.isArray(data.result)) {
      mergeAwardBatches(groups, data.result);
    }
    options.onProgress?.(polls, upstreamStatus, groups.size);
    if (data?.status === 'done') {
      return {
        completion: 'completed', results: [...groups.values()],
        polls, upstream_status: upstreamStatus, failure_kind: null,
      };
    }
    if (data?.status === 'failed' || data?.status === 'error') {
      failureKind = 'upstream_rejected';
      break;
    }
  }

  return {
    completion: failureKind ? 'partial_error' : 'partial_timeout',
    results: [...groups.values()],
    polls,
    upstream_status: upstreamStatus,
    failure_kind: failureKind,
  };
}
