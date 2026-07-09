# XpenseTrack / Cashalo — Handover & Self-Hosting Guide

This guide is for the company's IT/DevOps team to run the application entirely on
their own infrastructure (database, backend, and frontend).

The app has three parts:

1. **Database** — PostgreSQL
2. **Backend** — Node.js / Express API (folder: `backend/`)
3. **Frontend** — React (Vite) single-page app (folder: `frontend/`)

---

## 1. Prerequisites

- Node.js 18+ and npm
- A PostgreSQL database (managed service or self-hosted)
- Two hosting targets (can be the same provider):
  - one that runs a **Node process** for the backend (Railway, Render, Fly.io, a VM, etc.)
  - one that serves a **static site** for the frontend (Vercel, Netlify, Nginx, S3+CDN, etc.)
- A domain name (optional but recommended)

---

## 2. Database

1. Create an empty PostgreSQL database and get its connection string
   (`postgresql://user:password@host:5432/dbname`).
2. That's all you create manually — the backend builds all tables automatically
   on first boot (`prisma db push` runs from `start.sh`).

> Migrating existing data? Use `pg_dump` from the old DB and `pg_restore`/`psql`
> into the new one BEFORE starting the new backend.

---

## 3. Backend (API)

**Location:** `backend/`

1. Copy `backend/.env.example` to `backend/.env` and fill in the values.
   Minimum required: `DATABASE_URL`, `JWT_SECRET`, `PORT`.
2. Install and start:
   ```bash
   cd backend
   npm install
   npm start          # runs start.sh -> syncs DB schema -> starts the API
   ```
3. **Create the first admin (one time):**
   ```bash
   npm run db:seed
   ```
   This creates an ADMIN using `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`.
   The account is forced to change its password on first login. All other users are
   then created in-app under **Settings → Users**.

**Notes**
- The API listens on `PORT` (default `3001`) at `/api/...`.
- CORS allows any origin by default, so the frontend can live on a separate domain.
- On a platform like Railway/Render, set the env vars in the dashboard (not a file),
  point the service at the `backend/` folder, and use `npm start` as the start command.

---

## 4. Frontend (web app)

**Location:** `frontend/`

1. Set `VITE_API_URL` to the backend's public URL **including `/api`**
   (copy `frontend/.env.example` to `frontend/.env`, or set it in the host's build settings).
2. Build:
   ```bash
   cd frontend
   npm install
   npm run build      # outputs static files to frontend/dist
   ```
3. Serve the `frontend/dist` folder as a static site.
   - **Vercel/Netlify:** set project root to `frontend/`, build command `npm run build`,
     output directory `dist`, and add the `VITE_API_URL` environment variable.
   - **Nginx/Apache/S3:** upload `dist/` and configure SPA fallback (serve `index.html`
     for unknown routes).

> `VITE_API_URL` is baked in at **build time** — if you change it, rebuild/redeploy.

---

## 5. Domain & DNS (optional)

- Point e.g. `expenses.yourcompany.com` → frontend host, `api.yourcompany.com` → backend host.
- Set `FRONTEND_URL` (backend env) to the frontend URL so email links are correct.

---

## 6. First login

1. Open the frontend URL.
2. Log in with the seeded admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).
3. Change the password when prompted.
4. Go to **Settings** to set company name, logo, currency, categories, ATC codes
   (for BIR Form 2307), approval flows, and to create the rest of the users.

---

## 7. Deploy / update flow (going forward)

- **Backend:** deploy new code → it re-syncs the schema on boot automatically.
- **Frontend:** rebuild and redeploy the static site. Because it's a PWA, users may
  need a hard refresh (Ctrl/Cmd+Shift+R); if a change won't appear, use the browser's
  "Clear site data" once.

---

## 8. Optional features (safe to skip)

- **Email notifications:** set a MailerSend **or** Resend key in the backend env.
  Without it, the app runs but sends no emails (password resets are shown/handled in-app).
- **Receipt OCR autofill:** set `OCRSPACE_API_KEY` and/or `ANTHROPIC_API_KEY`.
  Without them, receipts can still be attached manually.

---

## 9. Security checklist (please read)

- Set a strong, unique `JWT_SECRET`. Never commit `.env` files to source control.
- **Rotate the `ANTHROPIC_API_KEY`** if the previous key was ever shared/screenshotted.
- Use HTTPS on both frontend and backend.
- Restrict database network access to the backend only.
- This codebase has had a **static access-control review, not a full penetration test.**
  Before relying on it for real money, commission an independent security review and
  run a limited pilot first.

---

## 10. Important disclaimers

- **Not tax advice.** BIR Form 2307 ATC codes, rates, and computed figures must be
  verified by your accountant before issuing certificates. The default withholding
  base assumes VAT-inclusive amounts (amount ÷ 1.12) — adjust for non-VAT invoices.
- Test all money-related flows (approvals, exports, 2307, payments) in a staging
  environment before go-live.

---

## Quick reference — environment variables

**Backend (required):** `DATABASE_URL`, `JWT_SECRET`, `PORT`
**Backend (recommended):** `FRONTEND_URL`, `NODE_ENV`, seed vars
**Backend (optional):** email + OCR provider keys
**Frontend (required):** `VITE_API_URL` (must end in `/api`)

See `backend/.env.example` and `frontend/.env.example` for the full annotated list.
