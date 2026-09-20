# Running the Resy checker and booker

The scheduled job prepares Node and runs its tests before waiting for 9 AM in
New York. It checks three dates (20, 21 and 22 days ahead), up to 30 times with
four seconds between attempts. GitHub can delay scheduled jobs, so exact release
timing is not guaranteed.

The primary schedule starts at 6:11 AM Eastern, with an 8:17 AM backup. Both wait
until 9 AM. The UTC schedules are filtered for daylight/standard time. The shared
concurrency group serializes runs, and a later start skips the check if a successful
scheduled run already actually checked Resy that New York calendar day. Skipped
wrong-season runs and manual credential tests do not count. A GitHub history lookup
failure allows the check to proceed, with the existing durable booking lock still
preventing duplicate reservations.

On September 20, 2026, no scheduled run appeared in GitHub's history, despite the
workflow being enabled. The later successful checks were manually dispatched.
GitHub did not provide a cause for the absent trigger. The cron definitions were
updated and the backup added, but a future scheduled run is needed to verify
delivery. GitHub can delay or drop schedule events; this backup uses the same
scheduler and is not an independent guarantee.

## Daily outcome report

Email subjects and the Actions run summary distinguish confirmed bookings,
observed tables that were not booked, unknown booking outcomes, fee-policy blocks,
existing reservations, tables outside preferences, and checks with no observed
tables. A table that disappears before the booker rechecks is reported separately
from a Resy HTTP 404 booking rejection. Lost or ambiguous responses remain unknown,
with instructions to check the account before another attempt.

Every valid checker result is preserved in `observations.jsonl`, so an earlier
observation is not lost when a later attempt fails or returns no tables. Reports
include observation times, check count and a late-start warning when the check
begins more than ten seconds after 9 AM Eastern. This cannot establish whether a
table existed before checking began or between requests. The checker watches the
configured three release dates; it is not an all-day or all-date availability log.

Each active run uploads its daily outcome, observations, attempt log and booking
result as an Actions artifact retained for 30 days. These files exclude Resy auth,
booking and cancellation tokens and account/payment details. Validation-only runs
build the same report without sending email or attempting bookings.

Matching slots on one date are still reported if another date fails. Date-specific
errors remain in the diagnostics. Email runs before the optional phone call, and
failure of one notification does not prevent the other from being attempted.

## Automatic booking

When a normal run finds matching slots, it attempts one 4 Charles reservation for
four people using the same date and time preferences. It fetches fresh checkout
terms before booking and verifies the resulting reservation in the Resy account.
The maximum approved total is $20, solely for reservation charges. Deposits,
add-ons, other charges, cancellation fees and unrecognized policy text block
booking and are reported in the email. The paid 4 Charles checkout has not yet
been exercised live; an unfamiliar policy or payment shape will require review.

`booked` means account verification succeeded. `booking_blocked_by_policy` means
the fee or cancellation terms were not approved. `booking_needs_attention` means
the outcome may be uncertain: inspect your Resy account before booking manually.
The email reports availability separately from booking confirmation.

Only one automatic reservation is allowed. Existing upcoming reservations at the
restaurant block new bookings. A durable intent on the `resy-booking-state` branch
is written **before** the booking POST. This prevents repeat bookings after a lost
response, runner crash, workflow rerun, or completed restaurant visit. Concurrent
workflow runs are serialized, and creation of the intent is atomic. Booking POSTs
are never retried automatically. After a successful reservation or an uncertain
attempt, the `booking-state/4-charles.json` file must be cleared deliberately on
that branch to rearm booking, after checking the account and confirming that a
new reservation is wanted. Do not clear it merely to retry a failed workflow.

The workflow token has repository contents write permission only to maintain this
journal. No Resy authentication, booking, cancellation or payment tokens are stored
there or printed in logs. Request authentication is confined to headers.

## Completed live test

On September 20, 2026, the code booked La Contenta Oeste for two people on Saturday,
September 26 at 7 PM, verified it in the account, immediately cancelled it, and
verified its removal. The checkout total was $0 and its cancellation policy
explicitly stated that cancellation carries no charge. FUMO Kips Bay uses
OpenTable, so it could not exercise the Resy code path.

Evidence: https://github.com/nachorn/4carlos/actions/runs/35488600598

The manual `booking_test` input requires `validate_only: true` and uses that exact
test reservation with a zero-fee limit. A separate permanent test journal prevents
accidental repetition. `inspect_booking` checks four-person availability at
4 Charles from today through 21 days ahead, and reads checkout policy metadata
for a real returned slot on each available date. It never books or cancels.
Ordinary validation-only runs never book, cancel, email or call.

Network requests time out after ten seconds. Unknown availability responses are
reported as errors rather than as successful empty checks. Unparseable slot times
may still produce an availability alert but are never booked automatically.

## Verify credentials without sending alerts

1. Open **Actions → Resy 4 Charles Check → Run workflow**.
2. Select the desired branch and enable **Check Resy once without sending email
   or phone alerts** (`validate_only`).
3. Inspect **Check Resy availability**. A healthy result has `looked: true` and
   each entry in `counts` has `ok: true`. `checked_no_slots` is a healthy check.

If Resy returns 401, 403 or 419, sign in to Resy in your browser, open Developer
Tools → Network, and select an `api.resy.com` availability request. Update these
repository **Actions secrets** from its **Request Headers**:

- `RESY_API_KEY`: the value inside quotes after `api_key=` in `Authorization`.
- `RESY_AUTH_TOKEN`: the entire `x-resy-auth-token` value.

Paste credentials directly into GitHub Secrets; never commit them or put them in
issues or logs. Browser authentication does not guarantee Resy will accept the
same session from a GitHub runner; use the validation-only run to verify it.

## Restore an inactive schedule

GitHub disables scheduled workflows in public repositories after 60 days without
repository activity. In **Actions → Resy 4 Charles Check**, choose **Enable
workflow**, then run validation-only mode. Re-enabling is not a permanent exemption
from GitHub's inactivity rule.

Email requires `SMTP_USER`, `SMTP_PASSWORD` and `NOTIFY_EMAIL`. Phone calls are
optional and require all four of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_PHONE` and `ALERT_PHONE`.

## Tests

Run `node --test` with Node 24, Bash and jq installed. Tests mock HTTP requests,
including the phone request, and never send alerts. On Windows, Git Bash is used;
set `TEST_JQ_PATH` to the jq executable if it is not on PATH.
