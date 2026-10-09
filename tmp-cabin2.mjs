import { extractDs1, buildTfsParam, parseFlightOffers } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const tfs = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass: 'business', adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
const url = `https://www.google.com/travel/flights?tfs=${tfs}&hl=en&tfu=EgQIABABIgA&curr=USD`;
const res = await fetch(url, { headers: H });
const html = await res.text();
console.log('status', res.status, 'len', html.length);
const tfu = new Set([...html.matchAll(/tfu=([A-Za-z0-9_-]{4,})/g)].map(m => m[1]));
console.log('tfu values:', [...tfu].slice(0, 20));
const tfsAll = new Set([...html.matchAll(/tfs=([A-Za-z0-9_-]{6,})/g)].map(m => m[1]));
console.log('tfs values:', [...tfsAll].slice(0, 12).map(v => v.slice(0, 20)));
// look for cabin selection labels near "Cabin" / "Business"
for (const kw of ['Business', 'Cabin', 'First class', 'Premium economy']) {
  const i = html.indexOf(kw);
  console.log(kw, 'at', i, i > 0 ? JSON.stringify(html.slice(i - 80, i + 80)) : '');
}
const ds1 = extractDs1(html);
const offers = parseFlightOffers(ds1, 'USD');
console.log('offers', offers.length, 'prices', offers.slice(0, 5).map(o => `${o.price}/${o.fare_brand}`));
