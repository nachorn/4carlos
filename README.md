# 4 Charles Prime Rib – Resy checker

Runs **in the cloud on GitHub Actions** so you don’t need your PC on. Checks Resy daily when new dates drop (9 AM ET). **Sends you an email only when there’s availability** for 4 people (dinner any day, or Sat/Sun lunch).

## What you need

1. **A GitHub account** and this repo pushed to GitHub (public or private).
2. **Resy auth** (so the checker can call Resy’s API as you):
   - Log in at [resy.com](https://resy.com).
   - If you get sent to [Resy’s security center](https://resy.com/security-center) (captcha / “verify you’re human”), complete it **once** in your browser. The checker never opens the website—only the API—so you just need to pass this step to get a valid token.
   - Open DevTools (F12) → **Network**.
   - Go to [4 Charles on Resy](https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib?date=2026-03-14&seats=4) and pick a date (after any security check).
   - In Network, find a request to `api.resy.com` (e.g. `find` or `venues`). Click it → **Headers**.
   - Copy:
     - **Authorization** header → use only the part after `ResyAPI api_key=` (the quoted string). That’s `RESY_API_KEY`.
     - **x-resy-auth-token** header → that’s `RESY_AUTH_TOKEN`.
   - Resy may log you out; the token can expire. If emails stop or you see “security/verification page” in logs, pass the security center again and update the secret.
3. **Email (Gmail)** so Actions can send you mail:
   - Use a Gmail address and an [App Password](https://support.google.com/accounts/answer/185833) (not your normal password) for `SMTP_PASSWORD`.

## Repo setup

1. Push this project to a GitHub repo.
2. In the repo: **Settings → Secrets and variables → Actions**.
3. Add these **Actions secrets**:

   | Secret name         | What to put |
   |---------------------|-------------|
   | `RESY_API_KEY`      | From Authorization header (the api_key value only). |
   | `RESY_AUTH_TOKEN`   | From `x-resy-auth-token` header. |
   | `SMTP_USER`         | Your Gmail address (e.g. `you@gmail.com`). |
   | `SMTP_PASSWORD`     | Gmail App Password (16-character). |
   | `NOTIFY_EMAIL`      | Where to send the “slots available” email (can be same as `SMTP_USER`). |

4. Save. The workflow will run on schedule automatically.

## Schedule

- Runs **twice daily** at 9:00 AM Eastern (13:00 and 14:00 UTC) so it works in both EDT and EST.
- **3 tries**, 10 seconds apart (first try right at 9:00, then +10s, then +20s).
- You get an email **only when** the script finds at least one matching slot (4 people, dinner any day or Sat/Sun lunch).

## Test run

- In the repo: **Actions → Resy 4 Charles Check → Run workflow**.
- Check the run log to see the script output; if slots are found, you should get an email.

## Files

- `check-resy.mjs` – Node script that calls Resy’s API and prints JSON (available + slots).
- `.github/workflows/resy-check.yml` – Scheduled workflow; runs the script and sends email on success.
- `4-charles-resy-helper.html` – Local helper with direct Resy links (optional).

## Notes

- Resy’s token can expire; if you stop getting emails, re-copy `RESY_AUTH_TOKEN` (and `RESY_API_KEY` if needed) and update the secret.
- The script checks the dates that typically release at 9 AM ET (20–22 days out). If Resy changes their release rule, you may need to adjust `getDatesToCheck()` in `check-resy.mjs`.
