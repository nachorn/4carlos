import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyOutcome, emailReport } from './daily-outcome.mjs';
import { checkedToday } from './schedule-guard.mjs';

const empty={looked:true,available:false,slots:[],counts:[{rawCount:0}]};
const found={...empty,available:true,slots:[{date:'2026-10-11',time:'19:00'}],counts:[{rawCount:1}]};

test('earlier observed tables survive later empty checks and explain the lost opportunity',()=>{
  const result=dailyOutcome([found,empty],{status:'no_bookable_slots'});
  assert.equal(result.outcome,'Table observed — not booked');
  assert.equal(result.observedSlots.length,1);
  assert.match(result.reason,/no longer available/);
});
test('reports policy blocks, duplicate prevention, and definitive rejection separately',()=>{
  assert.match(dailyOutcome([found],{status:'booking_blocked_by_policy',reasons:['cancellation_fee']}).reason,/cancellation_fee/);
  assert.match(dailyOutcome([found],{status:'booking_locked',previousStatus:'pending'}).reason,/pending/);
  assert.match(dailyOutcome([found],{status:'existing_reservation'}).reason,/already/);
  assert.equal(dailyOutcome([found],{status:'booking_not_secured',reason:'Slot gone'}).reason,'Slot gone');
});
test('ambiguous booking is unknown rather than falsely described as missed',()=>{
  assert.equal(dailyOutcome([found],{status:'booking_needs_attention'}).outcome,'Table observed — booking outcome unknown');
  assert.equal(dailyOutcome([found],null).outcome,'Table observed — booking outcome unknown');
});
test('requires account confirmation for a booked report',()=>{
  assert.equal(dailyOutcome([found],{status:'booked',confirmed:true}).outcome,'Reservation booked');
  assert.notEqual(dailyOutcome([found],{status:'booked'}).outcome,'Reservation booked');
});
test('reports observation limits and failed checks without claiming no availability',()=>{
  assert.equal(dailyOutcome([empty],null).outcome,'No tables observed');
  assert.match(dailyOutcome([empty],null,{late:true}).coverage,/before the first check is unknown/);
  assert.equal(dailyOutcome([{...empty,looked:false}],null).outcome,'Availability uncertain');
  assert.equal(dailyOutcome([],null).outcome,'Availability uncertain');
  assert.equal(dailyOutcome([{...empty,counts:[{rawCount:2}]}],null).outcome,'Tables observed outside your preferences');
  assert.equal(dailyOutcome([found],null,{validation:true}).outcome,'Table observed — validation only');
});
test('reports the number of failed attempts and HTTP codes without losing healthy observations',()=>{
  const result=dailyOutcome([
    {looked:true,counts:[{rawCount:0}],errors:[]},
    {looked:false,counts:[],errors:['2026-10-13: HTTP 500']},
    {looked:true,counts:[{rawCount:0}],errors:['2026-10-14: HTTP 500']},
  ],null);
  assert.equal(result.outcome,'Availability uncertain');
  assert.equal(result.errorAttempts,2);
  assert.deepEqual(result.errorKinds,['HTTP 500']);
});
test('email stays brief while preserving the outcome and a link to detailed evidence',()=>{
  const runUrl='https://github.com/nachorn/4carlos/actions/runs/123';
  const booked=emailReport(dailyOutcome([found],{status:'booked',confirmed:true}),{runUrl});
  assert.match(booked,/Reservation booked/);
  assert.match(booked,/2026-10-11 at 19:00/);
  assert.match(booked,/Detailed report: .*runs\/123/);
  assert.doesNotMatch(booked,/HTTP|First\/last observation|Final result JSON|Attempt log/);

  const missed=emailReport(dailyOutcome([found],{status:'no_bookable_slots'}));
  assert.match(missed,/Table observed — not booked/);
  assert.match(missed,/no longer available/);

  const uncertain=emailReport(dailyOutcome([{...empty,looked:false,errors:['HTTP 500']}],null,{late:true}));
  assert.match(uncertain,/Availability uncertain/);
  assert.match(uncertain,/first check started after 9 AM/i);
  assert.doesNotMatch(uncertain,/No tables observed/);
});
test('backup skips a completed real scheduled check but not skipped jobs or previous dates',async()=>{
  const today='2026-09-20';
  const run={id:1,status:'completed',conclusion:'success',created_at:'2026-09-20T10:11:00Z'};
  let conclusion='skipped';
  const get=async path=>path.includes('/jobs')?{jobs:[{steps:[{name:'Check Resy availability',conclusion,started_at:'2026-09-20T13:00:00Z'}]}]}:{workflow_runs:[run]};
  assert.equal(await checkedToday({get,runId:2,today}),false);
  conclusion='success';
  assert.equal(await checkedToday({get,runId:2,today}),true);
  assert.equal(await checkedToday({get,runId:1,today}),false);
  assert.equal(await checkedToday({get,runId:2,today:'2026-09-21'}),false);
});
