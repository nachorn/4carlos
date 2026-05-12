#!/usr/bin/env node
/**
 * Check 4 Charles Prime Rib (Resy) for availability.
 * Wants: 4 people. Dinner any day 6:30-11 PM; lunch Sat/Sun only 12-4 PM.
 *
 * Usage: RESY_API_KEY=xxx RESY_AUTH_TOKEN=xxx node check-resy.mjs
 * Outputs JSON to stdout: { available: boolean, slots: [...], error?: string }
 */

import { pathToFileURL } from 'node:url';

const VENUE_ID = 834; // 4 Charles Prime Rib
const PARTY_SIZE = 4;
const BASE = 'https://api.resy.com';
const TIME_ZONE = 'America/New_York';
const DATE_OFFSETS = [20, 21, 22];
const AUTH_STATUS_CODES = new Set([401, 403, 419]);

function datePartsInTimeZone(date, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateStringInTimeZone(date, timeZone = TIME_ZONE) {
  const { year, month, day } = datePartsInTimeZone(date, timeZone);
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Dates to check: today in New York + 20, 21, 22 days.
function getDatesToCheck(referenceDate = new Date()) {
  const todayEt = dateStringInTimeZone(referenceDate);
  return DATE_OFFSETS.map((offset) => addDays(todayEt, offset));
}

function isWeekend(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = d.getUTCDay();
  return weekday === 0 || weekday === 6;
}

function getSlotStart(slot) {
  return (
    slot?.date?.start
    || slot?.date_start
    || slot?.start
    || slot?.start_time
    || slot?.datetime
    || slot?.date_time
    || slot?.time
    || ''
  );
}

function parseSlotMinutes(slot) {
  const value = String(getSlotStart(slot) || '').trim();
  if (!value) return null;

  const dateTimeMatch = value.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (dateTimeMatch) {
    return Number(dateTimeMatch[1]) * 60 + Number(dateTimeMatch[2]);
  }

  const amPmMatch = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] || 0);
    const period = amPmMatch[3].toLowerCase();
    if (period.startsWith('p') && hour !== 12) hour += 12;
    if (period.startsWith('a') && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  const timeOnlyMatch = value.match(/^(\d{1,2}):(\d{2})/);
  if (timeOnlyMatch) {
    return Number(timeOnlyMatch[1]) * 60 + Number(timeOnlyMatch[2]);
  }

  return null;
}

// Lunch (Sat/Sun only): 12-4 PM. Dinner (any day): 6:30-11 PM.
function slotMatchesPref(slot, dateStr) {
  const minutes = parseSlotMinutes(slot);
  if (minutes == null) {
    // If Resy changes the time shape, alert rather than silently miss a slot.
    return true;
  }

  const lunch = minutes >= 12 * 60 && minutes <= 16 * 60;
  const dinner = minutes >= 18 * 60 + 30 && minutes <= 23 * 60;
  return (isWeekend(dateStr) && lunch) || dinner;
}

// Best lunch around 1 PM, best dinner around 8 PM.
function isPreferredSlot(slot, dateStr) {
  const minutes = parseSlotMinutes(slot);
  if (minutes == null) return false;

  const lunch = minutes >= 13 * 60 && minutes < 14 * 60;
  const dinner = minutes >= 20 * 60 && minutes < 21 * 60;
  return (isWeekend(dateStr) && lunch) || dinner;
}

function looksLikeSlot(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && (
      getSlotStart(value)
      || value?.config
      || value?.reservation_id
      || value?.inventory_id
      || value?.token
    )
  );
}

function flattenSlots(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => flattenSlots(entry));
  if (looksLikeSlot(value)) return [value];
  if (typeof value === 'object') return Object.values(value).flatMap((entry) => flattenSlots(entry));
  return [];
}

function extractSlots(data) {
  const venues = data?.results?.venues || data?.venues || [];
  const candidates = [
    Array.isArray(venues) ? venues.flatMap((venue) => venue?.slots || []) : null,
    data?.results?.slots,
    data?.slots,
    data?.scheduled,
    data?.availability,
    data?.inventory,
  ];

  const slots = [];
  const seen = new Set();

  for (const candidate of candidates) {
    for (const slot of flattenSlots(candidate)) {
      if (!seen.has(slot)) {
        seen.add(slot);
        slots.push(slot);
      }
    }
  }

  if (slots.length > 0) return slots;
  return flattenSlots(data);
}

function extractApiError(data) {
  const message = data?.message || data?.error?.message || data?.error || data?.detail;
  if (!message) return null;
  return typeof message === 'string' ? message : JSON.stringify(message);
}

function resyUrl(dateStr) {
  return `https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib?date=${dateStr}&seats=${PARTY_SIZE}`;
}

function slotTimeLabel(slot) {
  const start = String(getSlotStart(slot) || '').trim();
  if (start) return start;
  const configType = slot?.config?.type || slot?.type;
  return configType ? `time unavailable (${configType})` : 'time unavailable';
}

async function errorFromResponse(res) {
  const text = await res.text();
  let detail = text.trim().slice(0, 200);

  try {
    const json = JSON.parse(text);
    detail = extractApiError(json) || detail;
  } catch {
    // Keep the trimmed text fallback.
  }

  if (AUTH_STATUS_CODES.has(res.status)) {
    return {
      message: `HTTP ${res.status}: Resy credentials are invalid, expired, or blocked. Refresh RESY_API_KEY and RESY_AUTH_TOKEN from a logged-in browser session.`,
      type: 'auth',
    };
  }

  return {
    message: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
    type: 'http',
  };
}

async function findAvailability(apiKey, authToken, dateStr) {
  const url = new URL(`${BASE}/4/find`);
  url.searchParams.set('lat', '0');
  url.searchParams.set('long', '0');
  url.searchParams.set('day', dateStr);
  url.searchParams.set('party_size', String(PARTY_SIZE));
  url.searchParams.set('venue_id', String(VENUE_ID));
  url.searchParams.set('resy_token', authToken);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `ResyAPI api_key="${apiKey}"`,
      'x-resy-auth-token': authToken,
      Origin: 'https://resy.com',
      Referer: 'https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  if (!res.ok) {
    const { message, type } = await errorFromResponse(res);
    return { error: message, errorType: type, slots: [], rawCount: 0 };
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('json')) {
    const text = await res.text();
    if (/security-center|captcha|verify/i.test(text)) {
      return {
        error: 'Resy returned a security/verification page; refresh RESY_AUTH_TOKEN after passing the security center',
        errorType: 'auth',
        slots: [],
        rawCount: 0,
      };
    }
    return {
      error: `Unexpected response type: ${contentType || 'unknown'}`,
      errorType: 'response',
      slots: [],
      rawCount: 0,
    };
  }

  const data = await res.json();
  const apiError = extractApiError(data);
  if (apiError) {
    return {
      error: apiError,
      errorType: /auth|unauthori[sz]ed|token|credential/i.test(apiError) ? 'auth' : 'api',
      slots: [],
      rawCount: 0,
    };
  }

  const list = extractSlots(data);
  const matching = list.filter((slot) => slotMatchesPref(slot, dateStr));
  return { slots: matching, rawCount: list.length };
}

async function main() {
  const apiKey = process.env.RESY_API_KEY;
  const authToken = process.env.RESY_AUTH_TOKEN;

  if (!apiKey || !authToken) {
    console.log(JSON.stringify({
      available: false,
      looked: false,
      authFailed: true,
      status: 'missing_credentials',
      slots: [],
      checked: [],
      errors: ['Missing RESY_API_KEY or RESY_AUTH_TOKEN'],
    }));
    process.exit(3);
  }

  const dates = getDatesToCheck();
  const allSlots = [];
  const errors = [];
  const authErrors = [];
  const counts = [];

  for (const dateStr of dates) {
    try {
      const { slots, error, errorType, rawCount } = await findAvailability(apiKey, authToken, dateStr);

      if (error) {
        counts.push({ date: dateStr, ok: false, errorType, rawCount, matchedCount: 0 });
        errors.push(`${dateStr}: ${error}`);
        if (errorType === 'auth') authErrors.push(`${dateStr}: ${error}`);
        continue;
      }

      counts.push({ date: dateStr, ok: true, rawCount, matchedCount: slots.length });

      for (const slot of slots) {
        allSlots.push({
          date: dateStr,
          time: slotTimeLabel(slot),
          preferred: isPreferredSlot(slot, dateStr),
          url: resyUrl(dateStr),
        });
      }
    } catch (error) {
      counts.push({ date: dateStr, ok: false, errorType: 'request', rawCount: 0, matchedCount: 0 });
      errors.push(`${dateStr}: ${error.message}`);
    }
  }

  const authFailed = authErrors.length > 0 && authErrors.length === errors.length;
  allSlots.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
  });

  const output = {
    available: allSlots.length > 0,
    looked: errors.length < dates.length,
    authFailed,
    status: allSlots.length > 0
      ? 'slots_found'
      : authFailed
        ? 'auth_failed'
        : errors.length === 0
          ? 'checked_no_slots'
          : errors.length === dates.length
            ? 'check_failed'
            : 'partial_check',
    slots: allSlots.slice(0, 20),
    checked: dates,
    counts,
  };

  if (errors.length > 0) output.errors = errors;

  console.log(JSON.stringify(output));
  process.exit(authFailed ? 3 : errors.length === dates.length ? 2 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  addDays,
  dateStringInTimeZone,
  extractSlots,
  getDatesToCheck,
  isPreferredSlot,
  isWeekend,
  parseSlotMinutes,
  slotMatchesPref,
};
