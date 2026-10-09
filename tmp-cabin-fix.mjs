import { searchFlights, buildQueryString } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const base = { origin: 'SFO', destination: 'NRT', departure_date: '2026-11-15', trip_type: 'one_way', adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, max_stops: 'any', sort_by: 'price', max_results: 5, offset: 0, currency: 'USD', exclude_basic_economy: true };
console.log('query string:', buildQueryString({ ...base, seat_class: 'business', return_date: undefined }));
for (const seat_class of ['economy', 'business', 'first', 'premium_economy']) {
  const r = await searchFlights({ ...base, seat_class });
  console.log(`${seat_class}: total=${r.total_results} cheapest=${r.flights[0]?.price} cabin_honored=${r.query.cabin_honored} notes=${JSON.stringify(r.notes)}`);
}
