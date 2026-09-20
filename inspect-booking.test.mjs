import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFourCharles } from './inspect-booking.mjs';

test('inspection checks the 21-day horizon for four guests without mutations',async()=>{
  const dates=[];
  const result=await inspectFourCharles({find:async(venue,date,party)=>{
    assert.equal(venue,834);assert.equal(party,4);dates.push(date);return [];
  }},{today:'2026-09-20',report:()=>{}});
  assert.equal(dates.length,22);
  assert.equal(dates[0],'2026-09-20');assert.equal(dates.at(-1),'2026-10-11');
  assert.equal(result.checkoutsInspected,0);assert.equal(result.errors,0);
});

test('inspection uses a real slot and logs only fee and availability fields',async()=>{
  const output=[];
  const slot={date:{start:'2026-09-20 19:00:00'},config:{token:'secret-slot',type:'Table'},payment:{is_paid:true}};
  const result=await inspectFourCharles({find:async(v,date)=>date==='2026-09-20'?[slot]:[],details:async(s,date,party)=>{
    assert.equal(s,slot);assert.equal(date,'2026-09-20');assert.equal(party,4);
    return {book_token:{value:'secret-book'},user:{email:'private@example.com'},payment:{amounts:{total:20}},venue:{currency:'USD'}};
  }},{today:'2026-09-20',report:line=>output.push(line)});
  assert.equal(result.checkoutsInspected,1);
  assert.doesNotMatch(output.join('\n'),/secret-|private@example/);
  assert.match(output.join('\n'),/unknown_fee_policy/);
});
