import { describe, expect, it } from 'vitest';
import {
  normalizeAwardSeatFields,
  normalizeSeatCount,
  UNVERIFIED_SEAT_SENTINEL,
} from '../shared/src/seat-availability.js';

describe('award inventory normalization', () => {
  it('recognizes 9999 as unknown but preserves realistic counts', () => {
    expect(UNVERIFIED_SEAT_SENTINEL).toBe(9999);
    for (const raw of [9999, 10000, null, undefined, NaN, -1, 3.5, '9999']) {
      expect(normalizeSeatCount(raw)).toBeNull();
    }
    expect(normalizeSeatCount(0)).toBe(0);
    expect(normalizeSeatCount(1)).toBe(1);
    expect(normalizeSeatCount(2)).toBe(2);
    expect(normalizeSeatCount(9)).toBe(9);
  });

  it('sanitizes nested Explorer and recommendation results without losing award data', () => {
    const original = {
      total: 2,
      results: [
        { program: 'AA', miles: 30000, tax: 11.2, seats: 9999 },
        { program: 'AS', miles: 35000, tax: 373.2, seats: 9 },
      ],
      recommendation: { legs: [{ seats: 9999, flight: 'AA123' }] },
    };

    const safe = normalizeAwardSeatFields(original);
    expect(safe.results[0].seats).toBeNull();
    expect((safe.results[0] as Record<string, unknown>).seat_count_status).toBe('unverified');
    expect(safe.results[1].seats).toBe(9);
    expect(safe.recommendation.legs[0].seats).toBeNull();
    expect(safe.results.map((r) => r.miles)).toEqual([30000, 35000]);
    expect(original.results[0].seats).toBe(9999);
  });

  it('preserves unrelated amounts and ordinary seat counts', () => {
    expect(normalizeAwardSeatFields({ seats: 2, tags: [], metadata: { max_miles: 9999 } })).toEqual({
      seats: 2, tags: [], metadata: { max_miles: 9999 },
    });
  });
});
