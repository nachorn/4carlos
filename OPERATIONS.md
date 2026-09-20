# Running the Resy checker and booker

The scheduled job prepares Node and runs its tests before waiting for 9 AM in
New York. It checks three dates (20, 21 and 22 days ahead), up to 30 times with
four seconds between attempts. GitHub can delay scheduled jobs, so exact release
timing is not guaranteed.

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
accidental repetition. `inspect_booking` only reads checkout policy metadata.
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
