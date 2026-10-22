import { describe, expect, it } from 'vitest';
import { normalizeAwardSeatCount, sanitizeAwardSeatFields, UNKNOWN_SEAT_NOTE } from '../shared/src/award-seats.js';

describe('PointsYeah 9999 seat sentinel', () => {
  it('does not convert unknown inventory into thousands of bookable seats', () => {
    for (const value of [9999, 10000, '9999', undefined, -1, 2.5]) {
      expect(normalizeAwardSeatCount(value)).toBeNull();
    }
    expect(UNKNOWN_SEAT_NOTE).toContain('9999');
  });

  it('preserves ordinary reported seat counts', () => {
    for (const value of [0, 1, 2, 9]) expect(normalizeAwardSeatCount(value)).toBe(value);
  });

  it('normalizes the observed AA Explorer JSON while preserving AS inventory', () => {
    const raw = {
      total: 2,
      results: [
        { program: 'AA', miles: 30000, seats: 9999, departure: { code: 'SAN' }, arrival: { code: 'CDG' } },
        { program: 'AS', miles: 35000, seats: 9, departure: { code: 'SAN' }, arrival: { code: 'MXP' } },
      ],
    };
    const normalized = sanitizeAwardSeatFields(raw);
    expect(normalized.unverified).toBe(1);
    expect(normalized.value.results[0].seats).toBeNull();
    expect(normalized.value.results[1].seats).toBe(9);
    expect(normalized.value.results[0].miles).toBe(30000);
    expect(raw.results[0].seats).toBe(9999);
  });

  it('sanitizes nested live-search payment.seats and partner remaining_seats', () => {
    const raw = {
      results: [{ routes: [{ payment: { miles: 90000, seats: 9999 } }] }],
      partner: { remaining_seats: 9999, available_seats: 2 },
      requestedSeats: 2,
    };
    const normalized = sanitizeAwardSeatFields(raw);
    expect(normalized.unverified).toBe(2);
    expect(normalized.value.results[0].routes[0].payment.seats).toBeNull();
    expect(normalized.value.partner.remaining_seats).toBeNull();
    expect(normalized.value.partner.available_seats).toBe(2);
    expect(normalized.value.requestedSeats).toBe(2);
  });
});
