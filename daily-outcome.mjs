import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function dailyOutcome(attempts, booking, {late = false, validation = false} = {}) {
  const observed = new Map();
  let sawMatching = false, sawAny = false, failed = attempts.length === 0;
  let errorAttempts = 0;
  const errorKinds = new Set();
  for (const attempt of attempts) {
    sawMatching ||= attempt.available === true;
    sawAny ||= (attempt.counts || []).some(c => c.rawCount > 0);
    failed ||= !attempt.looked || (attempt.errors || []).length > 0;
    if (!attempt.looked || (attempt.errors || []).length > 0) errorAttempts++;
    for (const error of attempt.errors || []) {
      const code = String(error).match(/HTTP \d{3}/)?.[0];
      if (code) errorKinds.add(code);
    }
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
    hadCheckErrors:failed,errorAttempts,errorKinds:[...errorKinds]};
}

function optionalJson(path) {try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}

export function emailReport(result, {runUrl = ''} = {}) {
  const lines = ['4 Charles Prime Rib · 4 people', '', result.outcome];
  const reason = result.bookingStatus === 'booking_blocked_by_policy'
    ? 'Booking stopped because the fee or cancellation terms did not meet your approved limits.'
    : result.reason;
  lines.push(reason);
  if (result.observedSlots.length) {
    lines.push('', 'Tables seen:');
    for (const slot of result.observedSlots.slice(0, 3)) lines.push('- ' + slot.date + ' at ' + slot.time);
    if (result.observedSlots.length > 3) lines.push(`- ${result.observedSlots.length - 3} more in the detailed report`);
  }
  if (result.outcome === 'No tables observed' || result.outcome === 'Tables observed outside your preferences') {
    lines.push('', `Checked ${result.attemptCount} time${result.attemptCount === 1 ? '' : 's'} today.`);
  }
  if (result.hadCheckErrors && result.outcome !== 'Availability uncertain') {
    lines.push('', 'Some checks had errors; see the detailed report.');
  }
  if (result.coverage.startsWith('Started after 9 AM')) {
    lines.push('', 'The first check started after 9 AM; earlier availability is unknown.');
  }
  lines.push('', 'Resy: https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib?seats=4');
  if (runUrl) lines.push('Detailed report: ' + runUrl + ' (Actions artifact)');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let attempts=[];
  try {attempts=readFileSync('observations.jsonl','utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));} catch { const result=optionalJson('result.json');if(result) attempts=[result]; }
  const result=dailyOutcome(attempts,optionalJson('booking-result.json'),{late:process.env.LATE_START==='true',validation:process.env.VALIDATE_ONLY==='true'});
  writeFileSync('daily-outcome.json',JSON.stringify(result,null,2));
  const lines=[result.outcome,result.reason,'Checks made: '+result.attemptCount,
    'Attempts with errors: '+result.errorAttempts+(result.errorKinds.length ? ' ('+result.errorKinds.join(', ')+')' : ''),
    'First/last observation (UTC): '+(result.firstObservation || 'unknown')+' / '+(result.lastObservation || 'unknown'),
    result.coverage,...result.observedSlots.map(s=>'- '+s.date+' '+s.time)];
  writeFileSync('daily-outcome.txt',lines.join('\n')+'\n');
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  writeFileSync('email-body.txt',emailReport(result,{runUrl}));
  if(process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,'outcome='+result.outcome+'\n');
  if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n\n')+'\n');
}
