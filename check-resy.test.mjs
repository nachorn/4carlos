import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractSlots,
  getDatesToCheck,
  isPreferredSlot,
  parseSlotMinutes,
  slotMatchesPref,
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
