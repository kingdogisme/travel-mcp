import { writeFileSync } from 'node:fs';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const q = 'Flights from SFO to NRT on 2026-11-15 business class';
const res = await fetch(`https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=USD`, { headers: H });
const html = await res.text();
writeFileSync('/tmp/gf-q-biz.html', html);
console.log('status', res.status, 'len', html.length);
const tfu = [...new Set([...html.matchAll(/tfu=([A-Za-z0-9_-]{4,})/g)].map(m=>m[1]))];
console.log('tfu:', tfu.slice(0,10));
const tfs = [...new Set([...html.matchAll(/tfs=([A-Za-z0-9_-]{6,})/g)].map(m=>m[1]))];
console.log('tfs:', tfs.slice(0,10).map(v=>v.slice(0,24)));
const dec = (s) => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/') + '==='.slice(0,(4-s.length%4)%4), 'base64');
for (const v of [...tfu, ...tfs].slice(0,6)) console.log('decoded', v.slice(0,16), dec(v).toString('hex'));
// also: search for a "cabin" encoded selection in the page's UI state
const i = html.indexOf('EgQIABABIgA');
console.log('EgQIABABIgA count', (html.match(/EgQIABABIgA/g)||[]).length);
