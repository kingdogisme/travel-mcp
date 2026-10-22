import { describe, expect, it } from 'vitest';
import { toSeatsAeroOption } from '../shared/src/seats-aero.js';

describe('cached reward inventory', () => {
  const base = { flight_ref: 'test', mileage_program: 'american', miles_price: 30000 };
  it('does not present an upstream sentinel as bookable seats', () => {
    expect(toSeatsAeroOption({ ...base, remaining_seats: 9999 })?.seats).toBeNull();
  });
  it('preserves reported counts in the normal range', () => {
    expect(toSeatsAeroOption({ ...base, remaining_seats: 2 })?.seats).toBe(2);
  });
});
