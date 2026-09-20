import { pathToFileURL } from 'node:url';
import { ResyClient } from './resy-client.mjs';
import { BookingJournal } from './booking-journal.mjs';
import { getDatesToCheck, parseSlotMinutes, slotMatchesPref, isPreferredSlot } from './check-resy.mjs';

const FREE_POLICY = "While you won't be charged if you need to cancel, we ask that you do so at least 24 hours in advance.";

export function checkFees(slot, detail, maxTotal) {
  const payment = detail?.payment;
  const amounts = payment?.amounts;
  const cancellation = detail?.cancellation;
  if (!slot.payment || !amounts || !cancellation || !Object.hasOwn(cancellation, 'fee')) return 'unknown_fee_policy';
  if (slot.payment.is_add_on_required !== false) return 'required_add_on';
  if (cancellation.fee !== null && cancellation.fee !== 0) return 'cancellation_fee';
  for (const key of ['cancellation_fee','deposit_fee']) {
    if (!Object.hasOwn(slot.payment,key) || (slot.payment[key] !== null && slot.payment[key] !== 0)) return key;
  }
  if (typeof amounts.total !== 'number' || !Number.isFinite(amounts.total) || amounts.total < 0 || amounts.total > maxTotal) return 'total_exceeds_limit';
  if (amounts.total > 0 && detail.venue?.currency?.toUpperCase() !== 'USD') return 'unknown_currency';
  // Only the explicitly authorized reservation charge is allowed. Unknown or
  // separate service charges, prepaid meals, deposits and add-ons stop booking.
  for (const key of ['add_ons','resy_fee','service_fee','tax','surcharge','price_per_unit']) {
    if (amounts[key] !== 0) return 'unapproved_charge';
  }
  if (amounts.service_charge?.amount !== 0 || !Array.isArray(amounts.items) || amounts.items.length) return 'unapproved_charge';
  if (amounts.reservation_charge !== amounts.total || amounts.subtotal !== amounts.total) return 'unknown_charge_breakdown';
  if (amounts.total === 0 && (payment.config?.type !== 'free' || slot.payment.is_paid !== false)) return 'unknown_payment_type';
  // Fee fields alone do not establish the absence of no-show charges. Unknown
  // policy text requires a human review, even when the amount field is zero.
  const policy = cancellation.display?.policy;
  if (!Array.isArray(policy) || policy.length !== 1 || policy[0] !== FREE_POLICY) return 'policy_requires_review';
  return null;
}

function venueId(reservation) {
  return Number(reservation?.venue?.id?.resy ?? reservation?.venue?.id);
}

export async function runBooking({client, journal, test = false, dates = getDatesToCheck()}) {
  const target = test ? {venueId:1927,partySize:2,dates:['2026-09-26'],maxTotal:0} : {venueId:834,partySize:4,dates,maxTotal:20};
  const previous = await journal.read();
  if (previous) return {status:'booking_locked',previousStatus:previous.status};
  const before = await client.upcoming();
  if (before.some(r => venueId(r) === target.venueId)) return {status:'existing_reservation'};
  const beforeIds = new Set(before.map(r => String(r.reservation_id)));
  const candidates = [];
  for (const date of target.dates) {
    for (const slot of await client.find(target.venueId,date,target.partySize)) {
      const minutes = parseSlotMinutes(slot);
      if (minutes == null || !String(slot.date?.start).startsWith(`${date} `)) continue;
      if (test ? minutes !== 19 * 60 || slot.config?.type !== 'Dining room' : !slotMatchesPref(slot,date)) continue;
      candidates.push({slot,date,preferred:isPreferredSlot(slot,date)});
    }
  }
  candidates.sort((a,b) => Number(b.preferred)-Number(a.preferred) || a.slot.date.start.localeCompare(b.slot.date.start));
  const skipped = new Set();
  for (const {slot,date} of candidates.slice(0,20)) {
    const detail = await client.details(slot,date,target.partySize);
    const reason = checkFees(slot,detail,target.maxTotal);
    if (reason) { skipped.add(reason); continue; }
    if (typeof detail.book_token?.value !== 'string' || !detail.book_token.value) throw new Error('Missing fresh book token');
    let paymentId;
    if (detail.payment.amounts.total > 0) {
      paymentId = detail.user?.payment_methods?.find(p => p.is_default)?.id;
      if (!paymentId) { skipped.add('missing_default_payment'); continue; }
    }
    // Recheck immediately before claiming the durable lock and sending one POST.
    if ((await client.upcoming()).some(r => venueId(r) === target.venueId)) return {status:'existing_reservation'};
    await journal.claim({venueId:target.venueId,date,time:slot.date.start,partySize:target.partySize,test});
    let booked;
    let confirmed = false;
    let cancellationVerified = false;
    try {
      try {
        booked = await client.book(detail.book_token.value,paymentId);
      } catch {
        // A timeout can hide a successful booking. Reconcile; never resubmit.
      }
      const after = await client.upcoming();
      const created = after.filter(r => !beforeIds.has(String(r.reservation_id)) && venueId(r) === target.venueId && r.day === date && Number(r.num_seats) === target.partySize && String(r.time_slot).startsWith(slot.date.start.slice(11,16)));
      if (created.length === 1 && (!booked?.reservation_id || String(created[0].reservation_id) === String(booked.reservation_id))) {
        booked = {...booked,...created[0],resy_token:created[0].resy_token || booked?.resy_token};
        confirmed = true;
      }
      if (!confirmed) throw new Error('Booking outcome uncertain; inspect Resy account. Automatic retries are locked.');
    } finally {
      if (test && booked?.resy_token) {
        try { await client.cancel(booked.resy_token); } catch { /* Verify even if cancellation response is lost. */ }
        const remaining = await client.upcoming();
        cancellationVerified = !remaining.some(r => String(r.reservation_id) === String(booked.reservation_id));
        if (!cancellationVerified) throw new Error('Test reservation may remain active; cancel it in Resy now. Automatic retries are locked.');
      }
    }
    const status = test ? (cancellationVerified ? 'test_booked_and_cancelled' : 'test_cleanup_required') : 'booked';
    await journal.finish(status);
    return {status,date,time:slot.date.start,partySize:target.partySize,total:detail.payment.amounts.total,confirmed,cancellationVerified};
  }
  return {status:candidates.length ? 'booking_blocked_by_policy' : 'no_bookable_slots',reasons:[...skipped]};
}

async function main() {
  try {
    const test = process.env.RESY_BOOKING_TEST === 'true';
    const result = await runBooking({
      client:new ResyClient({apiKey:process.env.RESY_API_KEY,authToken:process.env.RESY_AUTH_TOKEN}),
      journal:new BookingJournal({token:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,key:test ? 'test-2026-09-26' : '4-charles'}),
      test,
    });
    console.log(JSON.stringify(result));
    if (test && result.status !== 'test_booked_and_cancelled') process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({status:'booking_needs_attention',error:error.message}));
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
