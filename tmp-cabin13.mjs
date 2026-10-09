import { extractDs1, parseFlightOffers } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const q = 'Premium economy flights from SFO to NRT on 2026-11-15';
const res = await fetch(`https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=USD`, { headers: H });
const html = await res.text();
const offers = parseFlightOffers(extractDs1(html), 'USD');
console.log('offers', offers.length, 'cheapest', offers[0]?.price, offers[0]?.fare_brand);
console.log('page mentions premium economy:', (html.match(/Premium economy/gi)||[]).length);
