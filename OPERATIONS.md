# Running the Resy checker

The scheduled job prepares Node and runs its tests before waiting for 9 AM in
New York. It checks three dates (20, 21 and 22 days ahead), up to 30 times with
four seconds between attempts. GitHub can delay scheduled jobs, so exact release
timing is not guaranteed.

Matching slots on one date are still reported if another date fails. Date-specific
errors remain in the diagnostics. Email runs before the optional phone call, and
failure of one notification does not prevent the other from being attempted.

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
