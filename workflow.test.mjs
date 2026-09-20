import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('./.github/workflows/resy-check.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const steps = workflow.split(/^      - name: /m).slice(1);
function step(name) {
  const found = steps.find((block) => block.startsWith(name + '\n'));
  assert.ok(found, 'Missing workflow step: ' + name);
  return found;
}
function script(name) {
  const match = step(name).match(/^        run: \|\n([\s\S]*)/m);
  assert.ok(match, 'Missing shell script: ' + name);
  return match[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
}
function eligible(name, state, inputs = {}) {
  const condition = step(name).match(/^        if: (.*)$/m)[1]
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  // Evaluate the actual status condition against simulated previous step outcomes.
  return Function('steps', 'inputs', 'cancelled', 'success', 'failure', 'return (' + condition + ')')(
    state, inputs, () => false, () => false, () => true,
  );
}
const slotsFound = {
  window: { outputs: { should_run: 'true' } },
  resy: { outcome: 'success', outputs: { available: 'true' } },
};
test('availability email and phone remain eligible after an unrelated step fails', () => {
  assert.equal(eligible('Send email (slots available)', slotsFound), true);
  assert.equal(eligible('Call phone (slots available)', slotsFound), true);
  assert.equal(eligible('Send email (checker error)', slotsFound), false);
  assert.equal(eligible('Send email (checked, no matching slots)', slotsFound), false);
});
test('error and empty-result emails are mutually exclusive', () => {
  const noSlots = { ...slotsFound, resy: { outcome: 'success', outputs: { available: 'false' } } };
  const failed = { ...slotsFound, resy: { outcome: 'failure', outputs: { available: 'false' } } };
  assert.equal(eligible('Send email (checked, no matching slots)', noSlots), true);
  assert.equal(eligible('Send email (checker error)', noSlots), false);
  assert.equal(eligible('Send email (checked, no matching slots)', failed), false);
  assert.equal(eligible('Send email (checker error)', failed), true);
  assert.equal(eligible('Call phone (slots available)', failed), false);
});
test('checkout, runtime setup and tests finish before the release wait', () => {
  const names = steps.map((block) => block.split('\n')[0]);
  const wait = names.indexOf('Wait until 9 AM Eastern');
  for (const name of ['Checkout', 'Setup Node', 'Run self-tests']) {
    assert.ok(names.indexOf(name) < wait, name + ' must precede the release wait');
  }
  assert.equal(names[wait + 1], 'Record check start time');
  assert.equal(names[wait + 2], 'Check Resy availability');
  assert.ok(names.indexOf('Send email (slots available)') < names.indexOf('Call phone (slots available)'));
});

test('validation-only runs never send email or phone alerts', () => {
  for (const name of ['Send email (slots available)', 'Send email (checked, no matching slots)', 'Send email (checker error)', 'Call phone (slots available)']) {
    for (const outcome of ['success', 'failure']) {
      for (const available of ['true', 'false']) {
        const state = { ...slotsFound, resy: { outcome, outputs: { available } } };
        assert.equal(eligible(name, state, { validate_only: true }), false, name);
      }
    }
  }
});

test('normal booking requires slots and is disabled during validation', () => {
  assert.equal(eligible('Book one matching reservation', slotsFound),true);
  assert.equal(eligible('Book one matching reservation', slotsFound, {validate_only:true}),false);
  for (const outcome of ['failure','skipped']) {
    assert.equal(eligible('Book one matching reservation', {...slotsFound,resy:{outcome,outputs:{available:'true'}}}),false);
  }
  assert.equal(eligible('Book one matching reservation', {...slotsFound,resy:{outcome:'success',outputs:{available:'false'}}}),false);
});

test('live test requires both explicit inputs and excludes inspection mode', () => {
  assert.equal(eligible('Test booking and immediate cancellation', {}, {}),undefined);
  assert.equal(Boolean(eligible('Test booking and immediate cancellation', {}, {validate_only:true})),false);
  assert.equal(Boolean(eligible('Test booking and immediate cancellation', {}, {booking_test:true})),false);
  assert.equal(eligible('Test booking and immediate cancellation', {}, {booking_test:true,validate_only:true}),true);
  assert.equal(eligible('Test booking and immediate cancellation', {}, {booking_test:true,validate_only:true,inspect_booking:true}),false);
});

function runPhone(mode, missingSecrets = false) {
  const dir = mkdtempSync(join(tmpdir(), 'resy-phone-test-'));
  try {
    writeFileSync(join(dir, 'result.json'), JSON.stringify({
      slots: [{ date: '2026-10-10', time: '8:00 PM & <terrace>' }],
    }));
    // Mock only curl; execute the real workflow shell and jq without sending alerts.
    const stub = [
      'export PATH="/usr/bin:$PATH"',
      'if [ -n "$TEST_JQ_PATH" ]; then jq() { "$TEST_JQ_PATH" --binary "$@"; }; fi',
      'curl() {',
      '  printf "%s\\n" "$@" > curl-args.txt',
      '  case "$TEST_CURL_MODE" in',
      '    network) return 6 ;;',
      '    http) printf \'%s\\n%s\' \'{"message":"test failure"}\' 400 ;;',
      '    *) printf \'%s\\n%s\' \'{"sid":"test-call","status":"queued"}\' 201 ;;',
      '  esac',
      '}',
    ].join('\n');
    const result = spawnSync(process.env.BASH_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/bash.exe' : 'bash'),
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stub + '\n' + script('Call phone (slots available)')], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env, TEST_CURL_MODE: mode,
          TWILIO_ACCOUNT_SID: missingSecrets ? '' : 'test-account',
          TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM_PHONE: 'test-from', ALERT_PHONE: 'test-to',
        },
      });
    assert.ifError(result.error);
    let args = '';
    try { args = readFileSync(join(dir, 'curl-args.txt'), 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { ...result, args };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('phone script generates escaped TwiML and queues a call', () => {
  const result = runPhone('success');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sid=test-call status=queued/);
  assert.match(result.args, /Twiml=<Response><Say voice="alice" language="en-US">/);
  assert.match(result.args, /8:00 PM &amp; &lt;terrace&gt;/);
  assert.match(result.args, /--connect-timeout\r?\n5/);
  assert.match(result.args, /--max-time\r?\n15/);
});
test('phone transport failures are bounded and leave email eligible', () => {
  const result = runPhone('network');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /failed to connect/);
  assert.equal(eligible('Send email (slots available)', slotsFound), true);
});
test('phone API rejection is reported without suppressing availability email', () => {
  const result = runPhone('http');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /failed with HTTP 400/);
  assert.equal(eligible('Send email (slots available)', slotsFound), true);
});
test('phone script skips missing credentials without making a call', () => {
  const result = runPhone('success', true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.args, '');
  assert.match(result.stdout, /not set; skipping phone call alert/);
});
