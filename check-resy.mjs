#!/usr/bin/env node
/**
 * Check 4 Charles Prime Rib (Resy) for availability.
 * Wants: 4 people. Dinner any day 6:30–11 PM; lunch Sat/Sun only 12–4 PM.
 * Reservations release 21 days ahead at 9 AM ET.
 *
 * Usage: RESY_API_KEY=xxx RESY_AUTH_TOKEN=xxx node check-resy.mjs
 * Outputs JSON to stdout: { available: boolean, slots: [...], error?: string }
 */

const VENUE_ID = 834; // 4 Charles Prime Rib
const PARTY_SIZE = 4;
const BASE = 'https://api.resy.com';

// Dates to check: today + 20, 21, 22 days (covers release window)
function getDatesToCheck() {
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset of [20, 21, 22]) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  return day === 0 || day === 6; // Sun, Sat
}

function getSlotHour(slot) {
  const start = slot?.date?.start || slot?.start_time || slot?.time;
  if (!start) return -1;
  const time = typeof start === 'string' ? start : start.toString();
  return parseInt(time.slice(11, 13), 10) || -1;
}

// Lunch (Sat/Sun only): 12–4 PM. Dinner (any day): 6:30–11 PM
function slotMatchesPref(slot, dateStr) {
  const hour = getSlotHour(slot);
  if (hour < 0) return true;
  const weekend = isWeekend(dateStr);
  const lunch = hour >= 12 && hour <= 16;   // 12 PM–4 PM
  const dinner = hour >= 18 && hour <= 23;  // 6:30 PM–11 PM (hour only)
  if (weekend && lunch) return true;
  if (dinner) return true;
  return false;
}

// Best lunch 1:30 PM (hour 13), best dinner 8–8:30 PM (hour 20)
function isPreferredSlot(slot, dateStr) {
  const hour = getSlotHour(slot);
  if (hour < 0) return false;
  const weekend = isWeekend(dateStr);
  if (weekend && hour >= 12 && hour <= 16 && hour === 13) return true;  // 1 PM slot ~ 1:30
  if (hour >= 18 && hour <= 23 && hour === 20) return true;            // 8 PM slot ~ 8–8:30
  return false;
}

async function findAvailability(apiKey, authToken, dateStr) {
  const url = new URL(`${BASE}/4/find`);
  url.searchParams.set('lat', '0');
  url.searchParams.set('long', '0');
  url.searchParams.set('day', dateStr);
  url.searchParams.set('party_size', String(PARTY_SIZE));
  url.searchParams.set('venue_id', String(VENUE_ID));
  url.searchParams.set('resy_token', authToken);

  // Browser-like headers so Resy is less likely to block the request (security-center is web-only; API may still check)
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `ResyAPI api_key="${apiKey}"`,
      'x-resy-auth-token': authToken,
      'Origin': 'https://resy.com',
      'Referer': 'https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });

  if (!res.ok) {
    return { error: `HTTP ${res.status}`, slots: [] };
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Resy may return HTML (e.g. security-center) instead of JSON
    const text = await res.text();
    if (text.includes('security-center') || text.includes('captcha') || text.includes('verify')) {
      return { error: 'Resy returned security/verification page; token may be expired or IP blocked', slots: [] };
    }
    return { error: `Unexpected response type: ${contentType.slice(0, 50)}`, slots: [] };
  }

  const data = await res.json();
  // Response may be { results: { venues: [ { slots: { ... } ] } } or similar
  const slots = data?.results?.venues?.[0]?.slots
    || data?.venues?.[0]?.slots
    || data?.scheduled?.length
    || data?.slots
    || (Array.isArray(data) ? data : []);

  const list = Array.isArray(slots) ? slots : (slots ? Object.values(slots).flat() : []);
  const matching = list.filter((s) => slotMatchesPref(s, dateStr));
  return { slots: matching, rawCount: list.length };
}

async function main() {
  const apiKey = process.env.RESY_API_KEY;
  const authToken = process.env.RESY_AUTH_TOKEN;

  if (!apiKey || !authToken) {
    console.log(JSON.stringify({
      available: false,
      slots: [],
      error: 'Missing RESY_API_KEY or RESY_AUTH_TOKEN',
    }));
    process.exit(0);
  }

  const dates = getDatesToCheck();
  const allSlots = [];

  for (const dateStr of dates) {
    try {
      const { slots, error } = await findAvailability(apiKey, authToken, dateStr);
      if (error) {
        console.error(`Error for ${dateStr}:`, error);
        continue;
      }
      for (const s of slots) {
        const start = s?.date?.start || s?.start_time || s?.time || '';
        allSlots.push({
          date: dateStr,
          time: start,
          preferred: isPreferredSlot(s, dateStr),
        });
      }
    } catch (e) {
      console.error(`Request failed for ${dateStr}:`, e.message);
    }
  }

  // Best times first: preferred (lunch ~1:30, dinner ~8–8:30), then by date/time
  allSlots.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const d = (a.date + a.time).localeCompare(b.date + b.time);
    return d;
  });

  const available = allSlots.length > 0;
  console.log(JSON.stringify({
    available,
    slots: allSlots.slice(0, 20).map(({ date, time, preferred }) => ({ date, time, preferred })),
    checked: dates,
  }));
  process.exit(0);
}

main();
