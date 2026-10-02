# unblurr.site

Keep your video quality. unblurr.site prepares videos so they keep their
original quality when uploaded — with accounts, email verification, daily
quotas, premium memberships and a full admin console. The processing module
ships obfuscated; user videos are never uploaded.

Built with Next.js 16 (App Router) + TypeScript + Tailwind CSS + shadcn/ui.

---

## Features

### For users
- **Account system** — sign up with a **Gmail or iCloud** email address only
- **Email verification** — verification link delivered by email (24h expiry)
- **Video enhancer** — drag & drop `.mp4` / `.mov`, enhance, download.
  Your file never leaves your device
- **Daily quota** — free accounts can enhance **2 videos per day**
  (resets 00:00 UTC)
- **Premium** — unlimited processing, granted by the admin

### For the admin
- **Admin console at `/admin`** (dedicated admin sign-in)
- **Dashboard** — totals (users, verified, premium/free, videos today &
  all-time, emails delivered, data processed) + 14-day charts for
  processing volume and signups
- **User management** — search, paginate, grant/revoke **premium**,
  **reset a user's daily usage**, **delete users**
- **Activity** — full processing history + email delivery log
- **System** — live status of database / email / quota / admin settings

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript |
| UI | Tailwind CSS 4, shadcn/ui, Recharts |
| Database | **MongoDB Atlas** (official driver, connection string) |
| Auth | Custom JWT sessions (jose) in httpOnly cookies, bcrypt passwords |
| Email | **Resend API** (verification emails) |
| Processing | Proprietary processing module (shipped obfuscated) |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | **Yes (production)** | MongoDB Atlas connection string, e.g. `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/unblurr?retryWrites=true&w=majority` |
| `RESEND_API_KEY` | **Yes (production)** | API key from [resend.com](https://resend.com) |
| `EMAIL_FROM` | recommended | Verified sender, e.g. `unblurr.site <noreply@unblurr.site>` |
| `JWT_SECRET` | **Yes (production)** | Long random string used to sign session cookies |
| `NEXT_PUBLIC_SITE_URL` | recommended | Your production URL, used in verification links |
| `ADMIN_EMAIL` | optional | Defaults to `bruhmeric@gmail.com` |
| `ADMIN_PASSWORD` | optional | Defaults to `Akila@7463` — change it |
| `FREE_DAILY_LIMIT` | optional | Free videos per day (default `2`) |
| `MONGODB_DB` | optional | DB name if not included in the URI (default `unblurr`) |

The admin account (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) is **seeded
automatically** on first run. Admins bypass email verification and have
unlimited processing.

> **Dev/demo mode:** when `MONGODB_URI` or `RESEND_API_KEY` are not set,
> the app falls back to a local file store and shows verification links
> on-screen instead of sending email. Perfect for local testing — never
> rely on it in production.

## Run locally

```bash
npm install          # or bun install / pnpm install
cp .env.example .env.local   # fill in what you have
npm run dev          # http://localhost:3000
```

## Upload to GitHub

```bash
git init
git add .
git commit -m "unblurr.site — initial release"
git branch -M main
git remote add origin https://github.com/<your-username>/unblurr-site.git
git push -u origin main
```

> `.env.local`, `node_modules/` and build output are already excluded by
> `.gitignore` — real secrets never leave your machine. Only the
> `.env.example` template is tracked.


## Deploy to Vercel

1. Push this folder to a Git repository (GitHub / GitLab / Bitbucket)
2. In Vercel: **Add New → Project → Import** your repo
   (Next.js is auto-detected, zero build config needed)
3. Add the environment variables from the table above under
   **Settings → Environment Variables** (Production + Preview)
   — at minimum: `MONGODB_URI`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `JWT_SECRET`, `NEXT_PUBLIC_SITE_URL`
4. Deploy. Your routes:
   - `/` — video enhancer (login required)
   - `/login`, `/signup`, `/verify`
   - `/admin` — admin sign-in
   - `/admin/dashboard` — admin console

### MongoDB Atlas quick setup

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. **Database Access** → add a database user
3. **Network Access** → allow access from anywhere
   (`0.0.0.0/0`) — required for Vercel serverless functions
4. **Connect → Drivers** → copy the connection string, replace
   `<password>` and append the database name: `...mongodb.net/unblurr?...`
5. Put it in `MONGODB_URI`

### Resend quick setup

1. Sign up at [resend.com](https://resend.com) and verify your domain
2. Create an API key → `RESEND_API_KEY`
3. Set `EMAIL_FROM` to a sender on your verified domain
   (for quick testing you can use `onboarding@resend.dev`)

## Project structure

```
├── public/engine/            # processing engine (obfuscated — do not edit)
├── src/app/
│   ├── page.tsx              # main tool page (auth-gated)
│   ├── login/ signup/ verify/
│   ├── admin/                # admin login
│   └── admin/dashboard/      # admin console
├── src/app/api/
│   ├── auth/                 # signup, login, logout, me, verify, resend
│   ├── quota/                # quota status + consume
│   └── admin/                # stats, users, logs
├── src/components/admin/     # dashboard tabs
├── src/lib/
│   ├── mongo.ts              # MongoDB Atlas adapter
│   ├── filedb.ts             # local demo fallback adapter
│   ├── auth.ts               # JWT sessions + guards
│   ├── email.ts              # Resend delivery
│   └── config.ts             # env + policy
└── src/proxy.ts              # route protection (redirects)
```

## Contact

Questions, premium requests or account issues? Email
**unblurr@proton.me**.

## Security notes

- Passwords are hashed with bcrypt; sessions are signed JWTs in
  httpOnly cookies (30 days)
- Email verification is required before sign-in; links expire in 24 hours
- Only `@gmail.com` and `@icloud.com` addresses may register
- Quotas are enforced server-side per UTC day
- Change `ADMIN_PASSWORD` and set a strong `JWT_SECRET` before going live
