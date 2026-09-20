// Read-only checkout diagnostics. Never print credentials, book tokens or user data.
import { cleanApiKey, cleanAuthToken } from './check-resy.mjs';
const headers = {
  Authorization: `ResyAPI api_key="${cleanApiKey(process.env.RESY_API_KEY)}"`,
  'x-resy-auth-token': cleanAuthToken(process.env.RESY_AUTH_TOKEN),
  'x-resy-universal-auth-token': cleanAuthToken(process.env.RESY_AUTH_TOKEN),
  'X-Resy-API-Version': '1',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://resy.com', Referer: 'https://resy.com/',
  'Content-Type': 'application/json',
};
async function request(path, body) {
  const response = await fetch(`https://api.resy.com${path}`, {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const text = await response.text();
    // Report only the response format, never an arbitrary response body.
    throw new Error(`Resy HTTP ${response.status}; content-type=${response.headers.get('content-type')}; JSON=${text.trim().startsWith('{')}`);
  }
  return response.json();
}
const date = '2026-09-26';
const account = await request('/3/user/reservations?type=upcoming&limit=100&offset=0');
console.log(JSON.stringify({accountKeys:Object.keys(account),reservationsArray:Array.isArray(account.reservations),reservationFieldNames:account.reservations?.[0] ? Object.keys(account.reservations[0]) : []}));
const data = await request('/4/find?lat=0&long=0&day=2026-09-26&party_size=2&venue_id=1927');
const venues = data?.results?.venues;
if (!Array.isArray(venues)) throw new Error('Unknown availability shape');
for (const venue of venues) {
  const slots = venue.slots.filter(s => s.date?.start?.includes('19:00:00'));
  console.log(JSON.stringify({ venue: venue.venue?.name, venueId:venue.venue?.id, count: venue.slots.length, candidates: slots.map(s => ({ date:s.date, payment:s.payment, type:s.config?.type })) }));
  if (!slots.length) continue;
  const detail = await request('/3/details', {config_id:slots[0].config.token, day:date, party_size:'2'});
  console.log(JSON.stringify({detailKeys:Object.keys(detail)}));
  for (const key of ['payment','cancellation','cancel','terms','policies','display_values']) {
    if (detail[key] !== undefined) console.log(JSON.stringify({ [key]: detail[key] }));
  }
}
