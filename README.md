# 4 Charles Prime Rib - Resy checker

Runs in GitHub Actions so your PC does not need to stay on. It starts just before the 9:00 AM Eastern release window, waits until 9:00 inside the job, then polls Resy for about two minutes.

You get an email when slots are found, when the check completes with no matching slots, or when the checker hits a real error. The no-slots email includes diagnostics so you can tell whether Resy actually responded.

## What It Checks

- Venue: 4 Charles Prime Rib
- Party size: 4
- Dates: today in New York + 20, 21, and 22 days
- Matching slots: dinner any day from 6:30 PM to 11:00 PM, plus lunch on Saturday/Sunday from 12:00 PM to 4:00 PM
- Preferred slots are listed first: around 1 PM weekend lunch or 8 PM dinner

## Required GitHub Secrets

Add these in GitHub under Settings -> Secrets and variables -> Actions.

| Secret name | Value |
| --- | --- |
| `RESY_API_KEY` | The api_key value from the Resy `Authorization` request header. |
| `RESY_AUTH_TOKEN` | The full `x-resy-auth-token` request header value. |
| `SMTP_USER` | Your Gmail address. |
| `SMTP_PASSWORD` | A Gmail App Password, not your normal Gmail password. |
| `NOTIFY_EMAIL` | The email address that should receive alerts. |

## Getting Resy Credentials

1. Log in at [resy.com](https://resy.com).
2. If Resy sends you to its security center, complete that once in your browser.
3. Open DevTools with F12, then open the Network tab.
4. Visit [4 Charles on Resy](https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib?seats=4).
5. Find a request to `api.resy.com`, open its request headers, and copy:
   - `Authorization`: copy only the value inside `api_key="..."`.
   - `x-resy-auth-token`: copy the full value.

Resy tokens can expire. If the workflow starts sending checker-error emails, refresh `RESY_AUTH_TOKEN` the same way.

## Schedule

GitHub cron runs in UTC, so the workflow has two scheduled entries:

- `12:57 UTC`, which is 8:57 AM Eastern during daylight saving time.
- `13:57 UTC`, which is 8:57 AM Eastern during standard time.

A guard step skips the wrong-season duplicate. The real run waits until 9:00 AM Eastern, then performs 30 checks, 4 seconds apart. Each email includes the actual Eastern start time so you can see whether GitHub Actions queued the job late.

This is more reliable than scheduling exactly at 9:00 because GitHub Actions jobs can queue late at the top of the hour.

Manual runs from the Actions tab always run immediately.

## Email Diagnostics

The status email includes:

- `Looked successfully: true/false`
- the dates checked
- whether each date returned an API response
- raw slot counts and preference-matched counts
- any Resy credential/security errors

## Local Test

Run the no-network self-tests:

```powershell
node --test check-resy.test.mjs
```

Run the checker locally with real credentials:

```powershell
$env:RESY_API_KEY="your_api_key"
$env:RESY_AUTH_TOKEN="your_auth_token"
node check-resy.mjs
```

## Files

- `check-resy.mjs`: Node script that calls Resy's API and prints JSON.
- `check-resy.test.mjs`: Self-tests for date, slot parsing, and preference rules.
- `.github/workflows/resy-check.yml`: Scheduled GitHub Actions checker and email alerts.
- `4-charles-resy-helper.html`: Optional local helper with direct Resy links.
