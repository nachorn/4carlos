# 4 Charles Resy checker – step-by-step setup

Do these in order. You’ll need: a GitHub account, a Resy account (logged in once), and Gmail.

---

## Step 1: Push this project to GitHub

1. **Create a new repo on GitHub**
   - Go to [github.com/new](https://github.com/new).
   - Name it whatever you like (e.g. `resy-4-charles`).
   - Choose **Public** (or Private; both work).
   - Do **not** add a README, .gitignore, or license (this folder already has files).
   - Click **Create repository**.

2. **Push this folder from your PC**
   - Open PowerShell or Terminal in this project folder:  
     `c:\Users\nacho\Desktop\Cursor Projects\App 7`
   - Run (replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub repo):

   ```powershell
   git init
   git add .
   git commit -m "Add Resy 4 Charles checker"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

   If you don’t have Git installed: [git-scm.com](https://git-scm.com/download/win).

---

## Step 2: Get your Resy API key and auth token

1. **Log in to Resy**
   - Go to [resy.com](https://resy.com) and sign in.
   - If you’re sent to the **security center** (captcha / “verify you’re human”), complete it once.

2. **Open Developer Tools**
   - Press **F12** (or right‑click the page → Inspect).
   - Open the **Network** tab.
   - Leave it open.

3. **Trigger a Resy API request**
   - In the same browser, open:  
     [4 Charles on Resy – pick a date](https://resy.com/cities/new-york-ny/venues/4-charles-prime-rib?date=2026-03-14&seats=4)
   - Change the date or click “Find a table” if the page lets you.
   - In the **Network** tab, look for requests to **api.resy.com** (filter by “resy” or “find” if needed).

4. **Copy the two values**
   - Click one of the `api.resy.com` requests (e.g. one containing `find` or `venues`).
   - Open **Headers** (Request Headers section).
   - Find **Authorization**: it looks like  
     `ResyAPI api_key="SOME_LONG_STRING"`  
     Copy **only the part inside the quotes** (SOME_LONG_STRING). That’s your **RESY_API_KEY**.
   - Find **x-resy-auth-token**: copy the **entire value**. That’s your **RESY_AUTH_TOKEN**.

   Keep these for Step 4. If you don’t see any api.resy.com requests, try changing the date or refreshing; stay logged in.

---

## Step 3: Create a Gmail App Password (SMTP password)

You need this so GitHub Actions can send you email. Gmail doesn’t allow your normal password for apps; you create a one-off **App Password**.

1. **Turn on 2-Step Verification** (if it’s not already on)
   - Go to [Google Account → Security](https://myaccount.google.com/security).
   - Under “How you sign in to Google,” click **2-Step Verification** and turn it on (you may need to confirm with your phone).

2. **Create an App Password**
   - Go to [App Passwords](https://myaccount.google.com/apppasswords).
     - If you don’t see “App passwords,” make sure 2-Step Verification is on, or search “App passwords” in your Google account.
   - Click **Select app** → choose **Mail**.
   - Click **Select device** → choose **Other (Custom name)** and type e.g. **Resy checker**.
   - Click **Generate**.
   - Google shows a **16-character password** (like `abcd efgh ijkl mnop`). Copy it and remove the spaces → `abcdefghijklmnop`. That’s your **SMTP_PASSWORD**.
   - You won’t see it again, so paste it into your GitHub secret right away.

   Use your normal Gmail address (e.g. `you@gmail.com`) as **SMTP_USER** and **NOTIFY_EMAIL** in the next step.

---

## Step 4: Add secrets to your GitHub repo

1. Open your repo on GitHub (the one you created in Step 1).
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret** and add each of these:

   | Name              | Value |
   |-------------------|--------|
   | `RESY_API_KEY`    | The api_key value from Step 2 (inside the quotes only). |
   | `RESY_AUTH_TOKEN` | The full x-resy-auth-token value from Step 2. |
   | `SMTP_USER`        | Your Gmail address (e.g. `you@gmail.com`). |
   | `SMTP_PASSWORD`    | The 16-character Gmail App Password from Step 3. |
   | `NOTIFY_EMAIL`     | Email where you want the “slots available” alert (can be the same as SMTP_USER). |

4. Save each secret after entering it. You should see 5 secrets listed.

---

## Step 5: Run a test

1. In your repo, open the **Actions** tab.
2. In the left sidebar, click **Resy 4 Charles Check**.
3. Click **Run workflow** (dropdown on the right) → **Run workflow**.
4. When the run appears, click it, then click the **check** job.
5. Open the **Check Resy availability** step and look at the log:
   - If you see JSON with `"available": true/false` and `"slots": [...]`, the script ran.
   - If you see an error about missing credentials, double‑check Step 4.
   - If you see “security/verification page,” complete the Resy security center again (Step 2) and update **RESY_AUTH_TOKEN** (and **RESY_API_KEY** if needed) in Step 4.

You’ll get an email only when the script finds at least one matching slot (4 people, dinner or Sat/Sun lunch).

---

## Step 6: You’re done

The workflow runs **automatically** every day at 9:05 AM Eastern. No need to keep your PC on. When 4 Charles has availability, you’ll get an email with a link to book.

- **To test again later:** Actions → Resy 4 Charles Check → Run workflow.
- **If emails stop:** Resy’s token may have expired. Repeat Step 2 and update **RESY_AUTH_TOKEN** (and **RESY_API_KEY** if it changed) in Settings → Secrets.
