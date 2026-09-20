import { pathToFileURL } from 'node:url';
import { dateStringInTimeZone } from './check-resy.mjs';

// Only a completed scheduled run that actually checked Resy counts. Manual
// credential tests and wrong-season skipped runs must never suppress the release.
export async function checkedToday({get,runId,today=dateStringInTimeZone(new Date())}) {
  const data=await get('/actions/workflows/resy-check.yml/runs?event=schedule&per_page=100');
  if(!Array.isArray(data.workflow_runs)) throw new Error('Unknown GitHub run list');
  for(const run of data.workflow_runs) {
    if(String(run.id)===String(runId) || run.status!=='completed' || run.conclusion!=='success'
       || dateStringInTimeZone(new Date(run.created_at))!==today) continue;
    const jobs=await get('/actions/runs/'+run.id+'/jobs?per_page=100');
    if(!Array.isArray(jobs.jobs)) throw new Error('Unknown GitHub jobs list');
    if(jobs.jobs.some(job=>job.steps?.some(step=>step.name==='Check Resy availability' && step.conclusion==='success'
      && dateStringInTimeZone(new Date(step.started_at))===today))) return true;
  }
  return false;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const get=async path=>{
      const response=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+path,{
        headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error('GitHub history HTTP '+response.status);
      return response.json();
    };
    console.log(await checkedToday({get,runId:process.env.GITHUB_RUN_ID}) ? 'true' : 'false');
  } catch {
    // History lookup failure must not suppress a release check. The durable
    // booking journal still prevents duplicate reservation submissions.
    console.error('::warning::Could not verify earlier scheduled run; continuing with duplicate-booking protection.');
    console.log('false');
  }
}
