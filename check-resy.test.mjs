import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  extractSlots,
  getDatesToCheck,
  isPreferredSlot,
  parseSlotMinutes,
  slotMatchesPref,
  cleanApiKey,
  cleanAuthToken,
} from './check-resy.mjs';

test('getDatesToCheck uses the New York calendar day', () => {
  const lateUtcStillPreviousDayInNewYork = new Date('2026-05-13T02:00:00Z');
  assert.deepEqual(getDatesToCheck(lateUtcStillPreviousDayInNewYork), [
    '2026-06-01',
    '2026-06-02',
    '2026-06-03',
  ]);
});

test('extractSlots handles nested Resy response shapes', () => {
  const dinner = { date: { start: '2026-06-01 20:00:00' } };
  const lunch = { start_time: '2026-06-06T13:30:00-04:00' };

  const slots = extractSlots({
    results: { venues: [{ slots: [dinner] }] },
    scheduled: [lunch],
  });

  assert.deepEqual(slots, [dinner, lunch]);
});

test('slot time parsing handles common formats', () => {
  assert.equal(parseSlotMinutes({ date: { start: '2026-06-01 20:15:00' } }), 1215);
  assert.equal(parseSlotMinutes({ start_time: '2026-06-01T18:30:00-04:00' }), 1110);
  assert.equal(parseSlotMinutes({ time: '8:45 PM' }), 1245);
});

test('slotMatchesPref applies lunch and dinner rules', () => {
  assert.equal(slotMatchesPref({ time: '6:00 PM' }, '2026-06-01'), false);
  assert.equal(slotMatchesPref({ time: '6:30 PM' }, '2026-06-01'), true);
  assert.equal(slotMatchesPref({ time: '1:30 PM' }, '2026-06-06'), true);
  assert.equal(slotMatchesPref({ time: '1:30 PM' }, '2026-06-05'), false);
});

test('isPreferredSlot highlights target windows', () => {
  assert.equal(isPreferredSlot({ time: '8:15 PM' }, '2026-06-01'), true);
  assert.equal(isPreferredSlot({ time: '1:30 PM' }, '2026-06-06'), true);
  assert.equal(isPreferredSlot({ time: '7:00 PM' }, '2026-06-01'), false);
});

test('credential cleaners tolerate copied header values', () => {
  assert.equal(cleanApiKey('ResyAPI api_key="abc123"'), 'abc123');
  assert.equal(cleanApiKey('"abc123"'), 'abc123');
  assert.equal(cleanAuthToken("'token456'"), 'token456');
});

function runChecker(responses, credentials = true) {
  // Run the real CLI with a mocked transport; no network or real secrets.
  const preload = `
    const responses = ${JSON.stringify(responses)};
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => {
      if (ms !== 10000) throw new Error('Unexpected request timeout');
      return timeout(20);
    };
    globalThis.fetch = async (url, options) => {
      if (options.method !== 'GET' || new URL(url).pathname !== '/4/find') {
        throw new Error('Checker must only read availability');
      }
      const response = responses.shift();
      if (!response) throw new Error('Unexpected extra request');
      if (response.hang) {
        return new Promise((resolve, reject) => {
          const hold = setTimeout(() => reject(new Error('Request was not aborted')), 1000);
          options.signal.addEventListener('abort', () => {
            clearTimeout(hold);
            reject(options.signal.reason);
          }, { once: true });
        });
      }
      if (response.error) throw new Error(response.error);
      return new Response(JSON.stringify(response.body || {}), {
        status: response.status || 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  `;
  const child = spawnSync(process.execPath, [
    '--import', `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`,
    fileURLToPath(new URL('./check-resy.mjs', import.meta.url)),
  ], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, RESY_API_KEY: credentials ? 'test-key' : '', RESY_AUTH_TOKEN: credentials ? 'test-token' : '' },
  });
  assert.ifError(child.error);
  return { code: child.status, output: JSON.parse(child.stdout) };
}

const emptyResponse = { body: { results: { venues: [{ slots: [] }] } } };
const dinnerResponse = { body: { results: { venues: [{ slots: [{ time: '8:00 PM' }] }] } } };

test('CLI preserves matching slots when another date rejects authentication', () => {
  const { code, output } = runChecker([dinnerResponse, { status: 403 }, emptyResponse]);
  assert.equal(code, 0);
  assert.equal(output.available, true);
  assert.equal(output.authFailed, false);
  assert.equal(output.status, 'slots_found');
  assert.equal(output.slots.length, 1);
  assert.equal(output.errors.length, 1);
});

test('CLI reports partial checks without treating one auth error as total failure', () => {
  const { code, output } = runChecker([emptyResponse, { status: 419 }, emptyResponse]);
  assert.equal(code, 0);
  assert.equal(output.looked, true);
  assert.equal(output.authFailed, false);
  assert.equal(output.status, 'partial_check');
  assert.equal(output.errors.length, 1);
});

test('CLI still fails when every date rejects authentication', () => {
  const { code, output } = runChecker([{ status: 401 }, { status: 403 }, { status: 419 }]);
  assert.equal(code, 3);
  assert.equal(output.looked, false);
  assert.equal(output.authFailed, true);
  assert.equal(output.status, 'auth_failed');
});

test('CLI reports total transport failures as errors, not no availability', () => {
  const { code, output } = runChecker(Array(3).fill({ error: 'Connection failed' }));
  assert.equal(code, 2);
  assert.equal(output.looked, false);
  assert.equal(output.status, 'check_failed');
});

test('CLI reports a successful empty check', () => {
  const { code, output } = runChecker(Array(3).fill(emptyResponse));
  assert.equal(code, 0);
  assert.equal(output.available, false);
  assert.equal(output.status, 'checked_no_slots');
});

test('CLI rejects missing credentials before making requests', () => {
  const { code, output } = runChecker([], false);
  assert.equal(code, 3);
  assert.equal(output.status, 'missing_credentials');
});

test('CLI aborts stalled requests and reports timeouts for each date', () => {
  const { code, output } = runChecker(Array(3).fill({ hang: true }));
  assert.equal(code, 2);
  assert.equal(output.looked, false);
  assert.ok(output.counts.every((count) => count.errorType === 'timeout'));
  assert.ok(output.errors.every((message) => message.includes('timed out after 10 seconds')));
});

test('empty availability does not turn venue metadata into a slot', () => {
  const data = { results: { venues: [{ venue: { config: { type: 'metadata' } }, slots: [] }] } };
  assert.deepEqual(extractSlots(data), []);
  const { code, output } = runChecker(Array(3).fill({ body: data }));
  assert.equal(code, 0);
  assert.equal(output.available, false);
  assert.equal(output.status, 'checked_no_slots');
});

test('unknown and malformed response shapes fail instead of claiming no slots', () => {
  for (const body of [{}, { token: 'not-a-slot' }, { slots: 'invalid' }, { results: { venues: {} } }]) {
    assert.throws(() => extractSlots(body), /Unexpected Resy/);
    const { code, output } = runChecker(Array(3).fill({ body }));
    assert.equal(code, 2);
    assert.equal(output.looked, false);
    assert.equal(output.status, 'check_failed');
  }
});

test('slot time parsing handles noon, midnight and dated AM/PM times', () => {
  for (const [time, minutes] of [['12 AM', 0], ['12 PM', 720], ['2026-06-01 8:30 PM', 1230], ['8:30 p.m.', 1230]]) {
    assert.equal(parseSlotMinutes({ time }), minutes);
  }
  for (const time of ['25:00', '20:99', '20:00:99', '13 PM', '0 AM', '8:70 PM', '20:30 garbage']) {
    assert.equal(parseSlotMinutes({ time }), null);
  }
});

test('preference windows include their exact boundaries only', () => {
  const weekday = '2026-06-01';
  const weekend = '2026-06-06';
  for (const [time, expected] of [['18:29', false], ['18:30', true], ['23:00', true], ['23:01', false]]) {
    assert.equal(slotMatchesPref({ time }, weekday), expected);
  }
  for (const [time, expected] of [['11:59', false], ['12:00', true], ['16:00', true], ['16:01', false]]) {
    assert.equal(slotMatchesPref({ time }, weekend), expected);
  }
});
