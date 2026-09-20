import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function dailyOutcome(attempts, booking, {late = false, validation = false} = {}) {
  const observed = new Map();
  let sawMatching = false, sawAny = false, failed = attempts.length === 0;
  for (const attempt of attempts) {
    sawMatching ||= attempt.available === true;
    sawAny ||= (attempt.counts || []).some(c => c.rawCount > 0);
    failed ||= !attempt.looked || (attempt.errors || []).length > 0;
    for (const slot of attempt.slots || []) observed.set(slot.date + ' ' + slot.time, {date:slot.date,time:slot.time});
  }
  let outcome, reason;
  const status = booking?.status;
  if (status === 'booked' && booking.confirmed === true) {
    outcome = 'Reservation booked';reason = 'Confirmed in your Resy account.';
  } else if (sawMatching || observed.size) {
    if (validation) {outcome='Table observed — validation only';reason='Booking was intentionally disabled.';}
    else if (status === 'booking_needs_attention' || status === 'booked' || !status) {outcome='Table observed — booking outcome unknown';reason=booking?.error || 'No confirmed booking result; check your Resy account before trying again.';}
    else {
      outcome='Table observed — not booked';
      reason = {
        no_bookable_slots:'The table was no longer available or eligible when the booker checked again.',
        booking_blocked_by_policy:'Booking stopped by fee or cancellation safeguards: ' + (booking.reasons || []).join(', '),
        booking_locked:'A previous booking attempt is locked (' + (booking.previousStatus || 'unknown') + '); check your Resy account.',
        existing_reservation:'You already have an upcoming reservation at this restaurant.',
        booking_not_secured:booking?.reason || 'Resy rejected the slot and no matching new reservation was found.',
      }[status] || 'No new booking confirmed: ' + status;
    }
  } else if (failed) {outcome='Availability uncertain';reason='One or more checks failed; this is not proof that no tables existed.';}
  else if (sawAny) {outcome='Tables observed outside your preferences';reason='No matching four-person table was observed.';}
  else {outcome='No tables observed';reason='No table was returned during the checks we actually made.';}
  return {outcome,reason,attemptCount:attempts.length,sawMatching:sawMatching || observed.size > 0,sawAny:sawAny || sawMatching,
    observedSlots:[...observed.values()],bookingStatus:status || 'not_attempted',
    firstObservation:attempts[0]?.observedAt || null,lastObservation:attempts.at(-1)?.observedAt || null,
    coverage:late ? 'Started after 9 AM Eastern; availability before the first check is unknown.' : 'Covers only the recorded checks; tables between checks may not be observed.',
    hadCheckErrors:failed};
}

function optionalJson(path) {try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let attempts=[];
  try {attempts=readFileSync('observations.jsonl','utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));} catch { const result=optionalJson('result.json');if(result) attempts=[result]; }
  const result=dailyOutcome(attempts,optionalJson('booking-result.json'),{late:process.env.LATE_START==='true',validation:process.env.VALIDATE_ONLY==='true'});
  writeFileSync('daily-outcome.json',JSON.stringify(result,null,2));
  const lines=[result.outcome,result.reason,'Checks made: '+result.attemptCount,
    'First/last observation (UTC): '+(result.firstObservation || 'unknown')+' / '+(result.lastObservation || 'unknown'),
    result.coverage,...result.observedSlots.map(s=>'- '+s.date+' '+s.time)];
  writeFileSync('daily-outcome.txt',lines.join('\n')+'\n');
  if(process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,'outcome='+result.outcome+'\n');
  if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n\n')+'\n');
}
