# 4 Charles Resy checker setup

Follow these steps once. After that, GitHub Actions runs the checker for you.

## 1. Add The GitHub Secrets

Open this repo on GitHub, then go to Settings -> Secrets and variables -> Actions -> New repository secret.

Create these five secrets:

| Name | Value |
| --- | --- |
| `RESY_API_KEY` | The api_key value from a Resy API request header. |
| `RESY_AUTH_TOKEN` | The full `x-resy-auth-token` header value. |
| `SMTP_USER` | Your Gmail address. |
| `SMTP_PASSWORD` | A Gmail App Password. |
| `NOTIFY_EMAIL` | Where alerts should go. |

## 2. Get The Resy Values

1. Sign in at [resy.com](https://resy.com).
2. Complete Resy's security check if it appears.
3. Press F12 and open the Network tab.
4. Open [4 Charles on Resy](https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib?seats=4).
5. Click a request to `api.resy.com`.
6. In Request Headers, copy:
   - `Authorization`: only the string inside `api_key="..."`.
   - `x-resy-auth-token`: the entire value.

For `RESY_API_KEY`, do not paste `ResyAPI api_key=` and do not include the quote marks. For `RESY_AUTH_TOKEN`, paste the full token exactly as shown.

## 3. Create The Gmail App Password

1. Turn on 2-Step Verification for your Google account if needed.
2. Open [Google App Passwords](https://myaccount.google.com/apppasswords).
3. Create an app password for Mail.
4. Copy the 16-character password and remove spaces before saving it as `SMTP_PASSWORD`.

Use your Gmail address as `SMTP_USER`.

## 4. Test The Workflow

1. Open the Actions tab in GitHub.
2. Select "Resy 4 Charles Check".
3. Click "Run workflow".
4. Open the run log.

Expected behavior:

- If slots are found, you get a slots-available email.
- If no slots are found, you get a checked/no-slots email with diagnostics.
- If credentials are missing, expired, or blocked by Resy, you get a checker-error email.

## 5. Daily Schedule

The workflow is scheduled for 8:57 AM Eastern, then waits inside the job until 9:00 AM Eastern before checking Resy. It has two UTC cron entries so it still works when New York switches between daylight saving time and standard time. A guard step prevents duplicate scheduled runs, and each email shows the actual Eastern start time. If GitHub starts the scheduled job late, it still checks immediately and marks `Late schedule start: true` in the email.

After 9:00 AM, it checks 30 times, 4 seconds apart. This gives it a better chance to catch slots that appear a few seconds late without hammering Resy all morning.

Every email includes the workflow run link, actual Eastern start time, self-test outcome, Resy check outcome, every polling attempt, the per-date API counts, any Resy errors, and the final checker JSON.

The checked/no-slots email tells you whether Resy responded. If it says `Looked successfully: true` and each date says `API ok`, the checker was able to inspect availability.

If some later attempts show `HTTP 500` but earlier attempts say `Looked successfully: true`, the workflow uses the last successful Resy response as the final result.

If error emails mention `HTTP 419: Unauthorized`, `auth_failed`, Resy credentials, or security verification, repeat the Resy credential steps and update both `RESY_API_KEY` and `RESY_AUTH_TOKEN`. A 419 means the checker reached Resy, but Resy rejected the stored token/key before showing availability.
