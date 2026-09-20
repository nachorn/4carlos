// Read-only 4 Charles checkout diagnostics. Never book, cancel, or print tokens.
import { pathToFileURL } from 'node:url';
import { ResyClient } from './resy-client.mjs';
import { addDays, dateStringInTimeZone, slotMatchesPref } from './check-resy.mjs';
import { checkFees } from './book-resy.mjs';

export async function inspectFourCharles(client, {today = dateStringInTimeZone(new Date()), report = console.log} = {}) {
  const summary = {venueId:834,partySize:4,datesChecked:0,rawSlots:0,matchingSlots:0,checkoutsInspected:0,errors:0};
  for (let offset = 0; offset <= 21; offset++) {
    const date = addDays(today,offset);
    try {
      const slots = await client.find(834,date,4);
      const matching = slots.filter(slot => slotMatchesPref(slot,date));
      summary.datesChecked++;
      summary.rawSlots += slots.length;
      summary.matchingSlots += matching.length;
      report(JSON.stringify({date,rawSlots:slots.length,matchingSlots:matching.length}));
      // Inspect a real returned slot; never fabricate a configuration or book token.
      const slot = matching[0] || slots[0];
      if (!slot) continue;
      const detail = await client.details(slot,date,4);
      summary.checkoutsInspected++;
      report(JSON.stringify({date,time:slot.date?.start,type:slot.config?.type,
        matchesPreferences:slotMatchesPref(slot,date),slotPayment:slot.payment,
        payment:detail.payment,cancellation:detail.cancellation,
        currency:detail.venue?.currency,bookingBlock:checkFees(slot,detail,20),
      }));
    } catch (error) {
      summary.errors++;
      report(JSON.stringify({date,error:error.message}));
    }
  }
  report(JSON.stringify({summary}));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await inspectFourCharles(new ResyClient({apiKey:process.env.RESY_API_KEY,authToken:process.env.RESY_AUTH_TOKEN}));
    if (summary.errors) process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({error:error.message}));
    process.exitCode = 2;
  }
}
