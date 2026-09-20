import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFees, runBooking } from './book-resy.mjs';
import { ResyClient } from './resy-client.mjs';
import { BookingJournal } from './booking-journal.mjs';

function fixture() {
  const slot = {config:{token:'slot-secret',type:'Dining room'},date:{start:'2026-09-26 19:00:00'},payment:{is_paid:false,is_add_on_required:false,cancellation_fee:null,deposit_fee:null}};
  const detail = {book_token:{value:'book-secret'},payment:{config:{type:'free'},amounts:{items:[],reservation_charge:0,subtotal:0,add_ons:0,resy_fee:0,service_fee:0,service_charge:{amount:0},tax:0,total:0,surcharge:0,price_per_unit:0}},cancellation:{fee:null,display:{policy:["While you won't be charged if you need to cancel, we ask that you do so at least 24 hours in advance."]}}};
  const reservation = {reservation_id:1,resy_token:'cancel-secret',venue:{id:1927},day:'2026-09-26',num_seats:2,time_slot:'19:00:00'};
  let active = [];
  const calls = [];
  const client = {
    upcoming:async () => [...active], find:async()=>[slot], details:async()=>detail,
    book:async()=>{calls.push('book');active=[reservation];return reservation;},
    cancel:async()=>{calls.push('cancel');active=[];return {};},
  };
  const journal = {read:async()=>null,claim:async()=>{calls.push('claim');},finish:async status=>calls.push(status)};
  return {slot,detail,reservation,client,journal,calls,setActive:value=>{active=value;}};
}

test('fee guard accepts the observed free checkout and rejects unknown or paid policies',()=>{
  const {slot,detail} = fixture();
  assert.equal(checkFees(slot,detail,0),null);
  for (const mutate of [
    d=>{delete d.payment.amounts.total;}, d=>{d.payment.amounts.total=1;},
    d=>{d.cancellation.fee=30;}, d=>{delete d.cancellation.fee;},
    d=>{d.cancellation.display.policy=['No-show fee: $25'];},
    d=>{d.payment.amounts.tax=1;}, d=>{d.payment.amounts.items=[{amount:10}];},
    d=>{d.payment.amounts.service_charge.amount=1;}, d=>{d.payment.config.type='deposit';},
  ]) {
    const changed=structuredClone(detail); mutate(changed);
    assert.notEqual(checkFees(slot,changed,0),null);
  }
  assert.equal(checkFees({...slot,payment:{...slot.payment,deposit_fee:20}},detail,0),'deposit_fee');
});

test('4 Charles permits only the approved total reservation charge, up to $20',()=>{
  const {slot,detail}=fixture();
  slot.payment.is_paid=true; detail.payment.config.type='reservation';
  detail.venue={currency:'USD'};
  Object.assign(detail.payment.amounts,{total:20,subtotal:20,reservation_charge:20});
  assert.equal(checkFees(slot,detail,20),null);
  assert.equal(checkFees(slot,detail,0),'total_exceeds_limit');
  detail.payment.amounts.total=21;
  assert.equal(checkFees(slot,detail,20),'total_exceeds_limit');
});

test('live-test path claims first, books once, verifies, cancels and verifies cleanup',async()=>{
  const f=fixture();
  const result=await runBooking({...f,test:true});
  assert.equal(result.status,'test_booked_and_cancelled');
  assert.equal(result.confirmed,true); assert.equal(result.cancellationVerified,true);
  assert.deepEqual(f.calls,['claim','book','cancel','test_booked_and_cancelled']);
});

test('an existing journal prevents any Resy request',async()=>{
  const result=await runBooking({client:{},journal:{read:async()=>({status:'pending'})},test:true});
  assert.equal(result.status,'booking_locked');
});

test('existing reservations are preserved and never cancelled by the test',async()=>{
  const f=fixture();f.setActive([f.reservation]);
  assert.equal((await runBooking({...f,test:true})).status,'existing_reservation');
  assert.deepEqual(f.calls,[]);
});

test('a failed durable claim prevents submitting a booking',async()=>{
  const f=fixture();f.journal.claim=async()=>{throw new Error('Conflict');};
  await assert.rejects(runBooking({...f,test:true}),/Conflict/);
  assert.deepEqual(f.calls,[]);
});

test('a lost booking response is reconciled and cancelled without retrying',async()=>{
  const f=fixture();f.client.book=async()=>{f.calls.push('book');f.setActive([f.reservation]);throw new Error('Timeout');};
  assert.equal((await runBooking({...f,test:true})).status,'test_booked_and_cancelled');
  assert.equal(f.calls.filter(c=>c==='book').length,1);
});

test('ambiguous booking without account evidence stops and retains its lock',async()=>{
  const f=fixture();f.client.book=async()=>{f.calls.push('book');throw new Error('Timeout');};
  await assert.rejects(runBooking({...f,test:true}),/outcome uncertain/);
  assert.deepEqual(f.calls,['claim','book']);
});

test('cancellation failure never reports test success',async()=>{
  const f=fixture();f.client.cancel=async()=>{throw new Error('HTTP 500');};
  await assert.rejects(runBooking({...f,test:true}),/may remain active/);
  assert.deepEqual(f.calls,['claim','book']);
});

test('lost cancellation response is reconciled using the account',async()=>{
  const f=fixture();f.client.cancel=async()=>{f.setActive([]);throw new Error('Timeout');};
  assert.equal((await runBooking({...f,test:true})).status,'test_booked_and_cancelled');
});

test('unapproved fees and malformed slot times never reach booking',async()=>{
  const f=fixture();f.detail.cancellation.fee=30;
  assert.equal((await runBooking({...f,test:true})).status,'booking_blocked_by_policy');
  f.slot.date.start='2026-09-26 unknown';
  assert.equal((await runBooking({...f,test:true})).status,'no_bookable_slots');
  assert.deepEqual(f.calls,[]);
});

test('production reservations are kept and subsequent runs remain locked',async()=>{
  const f=fixture();f.reservation.venue.id=834;f.reservation.num_seats=4;
  assert.equal((await runBooking({...f,dates:['2026-09-26']})).status,'booked');
  assert.deepEqual(f.calls,['claim','book','booked']);
});

test('API client keeps authentication in headers, does not retry or expose error bodies',async()=>{
  let calls=0;
  const client=new ResyClient({apiKey:'key-secret',authToken:'auth-secret',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.includes('auth-secret'),false);
    assert.equal(options.headers['x-resy-auth-token'],'auth-secret');
    assert.equal(options.body.get('book_token'),'book-secret');
    return new Response('private response body',{status:500});
  }});
  await assert.rejects(client.book('book-secret'),error=>error.message==='Resy /3/book returned HTTP 500');
  assert.equal(calls,1);
});

test('journal claim uses create-only semantics; finish uses returned SHA',async()=>{
  const puts=[];
  const journal=new BookingJournal({token:'github-secret',repository:'owner/repo',key:'test',fetchImpl:async(url,options)=>{
    if (options.method==='PUT') { puts.push(JSON.parse(options.body));return Response.json({content:{sha:'version-1'}}); }
    return Response.json({object:{sha:'main-sha'}});
  }});
  await journal.claim({date:'2026-09-26'});await journal.finish('test_booked_and_cancelled');
  assert.equal(Object.hasOwn(puts[0],'sha'),false);
  assert.equal(puts[1].sha,'version-1');
  assert.equal(puts[0].branch,'resy-booking-state');
});

test('malformed account data prevents treating the account as duplicate-free',async()=>{
  const client=new ResyClient({apiKey:'key',authToken:'token',fetchImpl:async()=>Response.json({reservations:[{reservation_id:1}]})});
  await assert.rejects(client.upcoming(),/duplicate check cannot be trusted/);
});

test('an account check failure after booking still cancels the test reservation',async()=>{
  const f=fixture();let reads=0;
  f.client.upcoming=async()=>{reads++; if(reads===3) throw new Error('Account unavailable'); return [];};
  await assert.rejects(runBooking({...f,test:true}),/Account unavailable/);
  assert.deepEqual(f.calls,['claim','book','cancel']);
});
