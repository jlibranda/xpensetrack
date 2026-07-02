# Cashalo / XpenseTrack — Go-Live Checklist

A practical checklist to validate before rolling the app out to your company.
Items marked **[validated]** were checked in the codebase. Items marked **[you verify]**
depend on your Railway/Vercel settings, which can only be confirmed on your side.

---

## A. Validated in the code (already in good shape)

- [x] **Password security** — passwords are hashed with bcrypt (strength 12). No plaintext stored. **[validated]**
- [x] **No insecure auth fallback** — JWT uses `JWT_SECRET` with no weak default; tokens expire in 7 days. **[validated]**
- [x] **Schema auto-applies on deploy** — `start.sh` runs `prisma db push` at boot, so additive schema changes sync automatically. **[validated]**
- [x] **Account lockout** — failed-login lockout is in place (configurable attempts/lockout minutes). **[validated]**
- [x] **No secrets committed** — no `.env` or hardcoded API keys found in source. **[validated]**
- [x] **Audit trail on critical actions** — now logs: mark-processed, bulk-processed, **payout reversal (Undo)**, transaction deletes, role changes, credentials sent, user deletes, and **"Login as" (impersonation)**. (Undo + impersonation logging were added during this review.) **[validated]**
- [x] **Forced password change** for new credentials; **already-used temp password** shows a clear message. **[validated]**
- [x] **Receipt object-storage support** exists (S3/R2) to keep receipts out of the DB disk. **[validated — but must be configured, see B]**

---

## B. You must verify (Railway / Vercel settings)

### Deployment
- [ ] Latest code **pushed**, Railway **auto-deployed**, and the **Vercel deploy-hook URL opened** (frontend does NOT auto-deploy).
- [ ] Railway deploy logs show **"Syncing database schema"** succeeded (no errors).
- [ ] Hard-refresh (Ctrl/Cmd+Shift+R) and confirm the new build loaded.

### Environment variables (Railway)
- [ ] `JWT_SECRET` is set to a **long, random** value (not a guessable string).
- [ ] `DATABASE_URL` points to the correct production Postgres.
- [ ] `RESEND_API_KEY` set, and `RESEND_FROM` / `EMAIL_FROM` set to your verified sender (e.g. no-reply@cashalo-app.com).
- [ ] `FRONTEND_URL` set to the production frontend URL (used in email links).
- [ ] **Object storage** set so receipts don't fill the DB disk: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (Cloudflare R2 or S3).
- [ ] `ANTHROPIC_API_KEY` set **and ROTATED** (the previous key was exposed in a screenshot — generate a new one and delete the old).
- [ ] Remove any leftover `BOOTSTRAP_ADMIN_EMAIL` once admin accounts are confirmed (it re-promotes that email to ADMIN on every restart).

### Data safety (critical for financial data)
- [ ] **Database backups / point-in-time recovery enabled** on Railway Postgres.
- [ ] Take a **manual backup before each deploy** — `prisma db push --accept-data-loss` runs at boot; additive changes are safe, but a backup protects against accidental destructive edits.
- [ ] Confirm the Postgres **volume is large enough** and not near full (the earlier disk-full incident was caused by receipts stored in the DB).

---

## C. Functional test (run before rollout — a small UAT)

Use 3–4 real test accounts across roles (Employee, Manager, Finance, Admin):

- [ ] **Submit** an expense with a receipt (OCR/scan works, or manual entry works).
- [ ] **Multi-level approval** — test a sequential flow with an **AND** level (all must approve) and an **OR** level (any one approves). Confirm the next approver is notified only when it's their turn.
- [ ] **Email at each step actually arrives**: approval request, approved/returned/rejected, processed, reprocessing (after Undo), credentials, password updated, follow-up reminder.
- [ ] **Transactions → Mark processed** (bulk via checkboxes) with Pay type / Pay period / Pay out date; confirm columns + email.
- [ ] **Undo (payout reversal)** — confirm only Admin or the designated reversal user(s) can do it; others see no Undo button and the API blocks them.
- [ ] **Send credentials** → employee logs in with temp password → forced to change → **"Password updated"** email arrives → old temp password is rejected with the clear message.
- [ ] **Login as (impersonate)** an employee → lands on their dashboard directly (NOT the change-password page).
- [ ] **Reports** — quick ranges highlight when selected; **Export Excel** respects all filters (Year, Status, From/To, Pay out date).
- [ ] **Email notifications toggle** OFF silences workflow emails (but password reset/credentials still send).
- [ ] **Timezone** — set in Settings; confirm email timestamps match your local time.
- [ ] **Exchange rate** — Settings → Refresh; confirm it pulls the BSP rate (or set Manual).
- [ ] **Mobile** — submit, view expense details (bottom sheet), approve, and view approval details all work on a phone.

---

## D. Security & controls hardening (recommended)

- [ ] **Restrict CORS** to your frontend domain (currently reflects any origin). Lower priority since the app uses Bearer tokens, not cookies — but tighten before wide rollout.
- [ ] **Review role permissions** — who can: send credentials, undo payouts, manage security, delete transactions, impersonate. Apply least privilege.
- [ ] **Separation of duties** — ideally the person who *approves* is not the same who *processes/pays*; the *Undo* right is limited to a small, named group.
- [ ] **Review the Audit Log** after the UAT to confirm sensitive actions are recorded.
- [ ] Confirm strong, unique passwords for all Admin accounts; consider periodic rotation.

---

## E. Operational readiness

- [ ] Decide a **pilot group** (e.g. one department) for 1–2 weeks before company-wide rollout.
- [ ] Prepare a **short user guide** for employees (how to submit) and approvers (how to approve).
- [ ] Identify an **admin owner** who manages users, settings, and watches Railway logs.
- [ ] Know how to **restore from backup** if something goes wrong.

---

## Notes / honest caveats

- This tool was built iteratively and has not been independently security-audited or load-tested. For real money/payroll, have your finance/compliance team review the internal controls (approval thresholds, separation of duties, audit trail) before relying on it solely.
- Email delivery depends on Resend being configured and your sending domain verified.
- The BSP exchange-rate fetch runs on the server; if a given day's parse fails it falls back to a market feed — verify the rate looks right, or use Manual mode.

**Recommendation:** Once Section B is green and Section C passes in a small pilot, you're in good shape to expand to the whole company.
