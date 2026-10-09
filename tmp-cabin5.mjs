import { buildTfsParam } from './servers/google-flights/shared/build/flights-client/flights-client.js';
import { writeFileSync } from 'node:fs';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const tfs = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass: 'business', adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
const res = await fetch(`https://www.google.com/travel/flights?tfs=${tfs}&hl=en&tfu=EgQIABABIgA&curr=USD`, { headers: H });
const html = await res.text();
writeFileSync('/tmp/gf-biz.html', html);
const blobs = new Set([...html.matchAll(/CA[A-Za-z0-9_-]{24,}/g)].map(m => m[0]));
console.log('candidate blobs:', blobs.size);
const dec = (s) => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/') + '==='.slice(0,(4-s.length%4)%4), 'base64');
let n = 0;
for (const b of blobs) {
  const bytes = dec(b);
  if (bytes[0] !== 0x08) continue;
  console.log('---', b.slice(0,16), 'field1=', bytes[1], 'next=', bytes.slice(2,6).toString('hex'), 'len', bytes.length);
  if (++n > 12) break;
}
