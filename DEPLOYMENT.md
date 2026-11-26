# Deploying QuizMUJ

QuizMUJ is **one Node.js service**. It serves the API, the real-time Socket.io channel and the website from a single port, and stores its data in **MongoDB**. A complete deployment is that service plus a database and an email account for one-time codes.

## What production needs

| Need | Why | Recommended |
|---|---|---|
| An **always-on** server with **WebSocket** support, running **exactly one instance** | The live exam monitor, deadline grace handling and rate limits live in memory. Free tiers that sleep drop live exams. | Render *Starter*, Railway, Fly.io, or a small VPS |
| MongoDB | All data | [MongoDB Atlas](https://www.mongodb.com/atlas) M0 (free), region **Mumbai (aws ap-south-1)** |
| SMTP email | Sign-up, sign-in and password-reset codes | A Gmail App Password for a pilot (about 500 emails/day). A transactional provider for whole-university use. |
| HTTPS | Security | Automatic on Render, Railway and Fly.io. Caddy on a VPS. |

> Serverless function platforms (Vercel or Netlify functions) are **not** suitable: they can't hold WebSocket connections or background timers.

---

## Free showcase deployment (₹0, about 20 minutes)

Use this to put QuizMUJ online for a portfolio, demo or viva. It uses **Render's free plan**, a free **MongoDB Atlas** cluster, and optionally **Brevo's** free email plan. With `SHOWCASE_MODE`, visitors click **Try the student demo** or **Try the faculty demo**: no sign-up and no MUJ email needed.

**What you get**
- **Full public app:** students take proctored exams while the faculty console monitors them live.
- **Always-fresh demo data:** it's rebuilt every time the free server wakes up, and every 6 hours.
- **Protected demo accounts:** visitors can't change their passwords, rename them or ban users. Your own admin account stays private and has full rights.

**Free-tier limits to know**
- **Slow first visit after idling:** the server sleeps after 15 minutes without visitors, and the first visit afterwards takes about a minute.
- **Data doesn't stay:** with `SHOWCASE_MODE` on, all quizzes and attempts are wiped at each refresh. Keep this database for the demo only.
- **Email needs Brevo:** free Render instances block SMTP ports (465/587). Use Brevo's free plan (300 emails/day), or skip email entirely, since demo visitors don't need it.

### Steps

1. **Prepare the repo**
   - Rotate the leaked Gmail App Password: revoke the old one.
   - Stop tracking secrets and packages, commit, and push to GitHub:
     ```bash
     git rm -r --cached backend/.env backend/node_modules
     git commit -m "Stop tracking secrets and node_modules"
     ```
2. **Database: [MongoDB Atlas](https://www.mongodb.com/atlas)** (free M0, see [section 2](#2-create-the-database-mongodb-atlas-free) for details)
   - Create an **M0** cluster on AWS in **Mumbai**.
   - Add a database user, and allow access from `0.0.0.0/0`.
   - Copy the connection string and add the database name: `…mongodb.net/quizmuj_demo?retryWrites=true&w=majority`.
3. **Email: [Brevo](https://www.brevo.com)** (optional; needed only for real student sign-ups)
   - Sign up, then **Senders, domains & IPs → Senders → Add a sender** using your own email, and click the link Brevo sends you.
   - **SMTP & API → API keys → Generate a new API key.**
4. **Deploy on [Render](https://render.com)**
   - Sign in with GitHub, then **New → Blueprint** and pick your repository. Render reads `render.yaml`, which is already set to the free plan with showcase mode on.
   - Fill in:
     - `MONGO_URI`
     - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (your private admin, 8+ characters with letters and numbers)
     - `BREVO_API_KEY`
     - `FROM_EMAIL` (the sender you verified)

     If you skipped Brevo, enter `none` for both email fields: the demo works and only real sign-ups will report that email couldn't be sent.
   - Click **Apply**. The first build takes about 5 minutes.
5. **Open your app:** `https://quizmuj-xxxx.onrender.com`. Press **Try the student demo**, or sign in as yourself on the **Faculty / Admin** tab.
6. **Share it:** put the URL and "click *Try the student demo*" in your README, resume or LinkedIn post. Mention that the first load may take up to a minute.

> **Demo it live:** open the faculty demo in one browser and the student demo in another (or on your phone). Start the *Data Structures Midterm* as the student and watch it in **Live monitor**. Switch tabs on the student side to trigger a proctoring alert, or broadcast an announcement and watch it pop up.

---

# Production deployment (real exams)

Everything below is for running real exams: an always-on paid instance, persistent data, and no showcase mode.

## 1. Before you deploy (do this first)

1. **Rotate the leaked secrets.** `backend/.env` was committed, so its Gmail App Password and `JWT_SECRET` are in your git history.
   - Revoke that App Password in your Google Account.
   - Never reuse the old JWT secret.
2. **Stop tracking secrets and installed packages:**
   ```bash
   git rm -r --cached backend/.env backend/node_modules
   git commit -m "Stop tracking secrets and node_modules"
   ```
3. Push the repository to GitHub. A private repository is recommended.

## 2. Create the database (MongoDB Atlas, free)

1. **Create → Cluster → M0**, provider **AWS**, region **Mumbai (ap-south-1)**.
2. **Database Access → Add user** with password authentication and the role *Read and write to any database*.
3. **Network Access → Add IP address → `0.0.0.0/0`.** Hosting platforms use changing IPs; the database user and password protect access. On a VPS, add only its IP.
4. **Connect → Drivers**, then copy the URI and add the database name `quizmuj`:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/quizmuj?retryWrites=true&w=majority
   ```
   URL-encode special characters in the password (for example `@` → `%40`).

> M0 has no automatic backups. Schedule `mongodump --uri "$MONGO_URI" --archive=quizmuj-$(date +%F).gz --gzip`, or move to a paid tier before real exams.

## 3. Set up email

- **Gmail (pilot):**
  1. Turn on 2-Step Verification.
  2. Go to **Google Account → Security → App passwords** and create one.
  3. Use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_EMAIL=you@gmail.com`, `SMTP_PASSWORD=<16-character app password>` and `FROM_EMAIL=you@gmail.com`.
- **Whole university:** use a provider with your own sending domain and SPF/DKIM records so codes don't land in spam. Examples: Brevo (`smtp-relay.brevo.com:587`), SendGrid, Amazon SES. Only the `SMTP_*` values change.
- **Check delivery locally before deploying:** `cd backend && npm run test:email -- you@muj.manipal.edu`.

---

## 4A. Deploy on Render (recommended, about 15 minutes)

The repository includes a **`render.yaml` Blueprint**. It ships configured for the free showcase, so for real exams first edit it:
- set `plan: starter` (always on);
- set `SHOWCASE_MODE` to `"false"`;
- add `SMTP_*` variables if you'd rather use Gmail SMTP than Brevo. Paid instances can send SMTP.

1. **Render → New → Blueprint**, then connect your GitHub repository.
2. Fill in the values Render asks for:
   - `MONGO_URI`
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (8+ characters with letters and numbers)
   - `SMTP_EMAIL`, `SMTP_PASSWORD` and `FROM_EMAIL`

   `JWT_SECRET` is generated for you.
3. **Apply.** The first build takes a few minutes.
4. Open `https://<your-service>.onrender.com/api/health`. It should show `"database":"connected"`.
5. *(Optional)* **Settings → Custom Domains**: add `quiz.yourdomain` and create the CNAME record at your DNS provider. HTTPS is automatic.

Every push to the default branch redeploys automatically. The service runs one instance in **Singapore**, the region closest to India. Use the Starter plan for real exams; the free plan sleeps after 15 minutes idle.

## 4B. Railway or Fly.io (same Dockerfile)

**Railway**
1. **New Project → Deploy from GitHub repo.** It builds the root `Dockerfile`.
2. **Variables:** add everything from the table below, including `NODE_ENV=production`, `PORT=3000`, `TRUST_PROXY=1` and a generated `JWT_SECRET`.
3. **Settings → Networking → Generate Domain.** Keep **1 replica**.

**Fly.io**
```bash
fly launch --no-deploy        # detects the Dockerfile; internal port 3000; region "bom" (Mumbai)
fly secrets set NODE_ENV=production TRUST_PROXY=1 JWT_SECRET=$(openssl rand -hex 48) \
  MONGO_URI='mongodb+srv://…/quizmuj' ADMIN_EMAIL=… ADMIN_PASSWORD=… \
  SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_EMAIL=… SMTP_PASSWORD=… FROM_EMAIL=…
fly deploy
fly scale count 1             # exactly one machine
```
In `fly.toml`, set `auto_stop_machines = "off"` and `min_machines_running = 1` so exams are never interrupted.

## 4C. Your own server (VPS) with Docker Compose

This suits a university Linux server or a VPS (DigitalOcean, AWS Lightsail, …) in Mumbai or Bangalore.

```bash
# Ubuntu 22.04+; install Docker with:  curl -fsSL https://get.docker.com | sh
git clone <your-repo-url> quizmuj && cd quizmuj
cp backend/.env.example backend/.env
nano backend/.env        # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD and the SMTP_* values
docker compose up -d --build
```

This starts MongoDB, the API and nginx, and the site answers on port **8080**. Add HTTPS with **Caddy** on the host, which obtains certificates automatically:

```bash
sudo apt install -y caddy
printf 'quiz.example.edu {\n  reverse_proxy 127.0.0.1:8080\n}\n' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Then finish the setup:
1. Point the domain's DNS **A record** at the server.
2. Allow only ports **80** and **443** in the firewall.
3. In `docker-compose.yml`, change `"8080:80"` to `"127.0.0.1:8080:80"` so the site is reachable only through Caddy.
4. Back up the bundled MongoDB daily (cron):
   ```bash
   docker compose exec -T mongo mongodump --archive --gzip > quizmuj-$(date +%F).gz
   ```
5. To use Atlas instead of the bundled MongoDB, remove the `mongo` service and replace the `MONGO_URI` line under `web → environment`.

---

## Environment variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Turns on the production safeguards |
| `JWT_SECRET` | yes | `openssl rand -hex 48` | Changing it signs everyone out |
| `MONGO_URI` | yes | `mongodb+srv://…/quizmuj` | |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first boot | `faculty@muj.manipal.edu` | Creates the first admin only when none exists. In production a weak or missing password is refused. Change it later under **Console → Settings**. |
| `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME` | one email option | `xkeysib-…` | Email over Brevo's HTTPS API. Works on hosts that block SMTP (Render free). `FROM_EMAIL` must be a sender verified in Brevo. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_EMAIL`, `SMTP_PASSWORD` | the other option | `smtp.gmail.com`, `587` | Used when `BREVO_API_KEY` isn't set. In production, if email can't be sent, sign-up shows a clear "could not send the email" message. |
| `SHOWCASE_MODE` | no | `true` | Public demo: one-click demo logins and protected demo accounts. **Wipes and rebuilds all quiz data on every boot and every 6 h**, so give it its own database. |
| `TRUST_PROXY` | behind a proxy | `1` | Number of proxy hops (`1` on Render, Railway and Fly.io; Compose uses `uniquelocal`). Needed for per-student rate limiting. |
| `PORT` | platform | `3000` | |
| `APP_TIMEZONE` | no | `Asia/Kolkata` | Day boundaries for streaks and the activity chart |
| `STUDENT_EMAIL_DOMAIN` | no | `muj.manipal.edu` | Only this domain can register as a student |
| `JWT_EXPIRE` | no | `7d` | |
| `CORS_ORIGIN` | no | `https://quiz.example.edu` | Only needed if the website is hosted on a different origin than the API |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_EMAIL`, `RATE_LIMIT_NETWORK` | no | `20`, `6`, `3000` | Per account and per network, per 15 minutes. The defaults let a whole campus share one public IP. |

## After deploying: 5-minute smoke test

1. `/api/health` returns `"database":"connected"`.
2. Sign in on the **Faculty / Admin** tab. The quick-start wizard and then the console open.
3. Create a short quiz that starts now and targets your own cohort.
4. In a private window, register with a real `@muj.manipal.edu` address. The code should arrive by email. Complete the profile and the quiz appears.
5. Start the quiz on a phone and watch **Console → Live monitor**. Switch apps on the phone: a proctoring alert appears. Submit, then open the quiz's results.

## Operating notes

- **Run one instance.** Scaling out needs Redis (the Socket.io Redis adapter plus shared rate limits), which isn't included. One instance is fine for a department-scale rollout. Load-test before a university-wide exam.
- **Restarts are safe but not invisible.** Attempts, answers and deadlines are stored in MongoDB, and answers are also saved in each student's browser. During a redeploy students see "Reconnecting…" for a few seconds and carry on. Still, avoid deploying during exams.
- **The server's clock decides deadlines.** Hosting platforms keep it in sync; on a VPS make sure NTP is on (it is by default on Ubuntu).
- **Keep dependencies current.** Run `npm audit --omit=dev` in `backend/` from time to time. The Docker build installs exactly what `package-lock.json` pins.
- **Never seed demo data in production.** `npm run seed:demo` refuses to run when `NODE_ENV=production`.
