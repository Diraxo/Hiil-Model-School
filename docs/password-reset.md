# Password reset / recovery flow

## How it works in the app

1. **Login page → “Forgot password?”** opens `ForgotPasswordScreen`
   (`src/pages/auth/AuthPages.jsx`).
2. The user enters their email; the app calls
   `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
   (`AuthContext.requestPasswordReset`). `redirectTo` is
   `import.meta.env.VITE_SITE_URL || window.location.origin`. The response is
   deliberately always “success” (Supabase never reveals whether an address is
   registered).
3. Supabase Auth sends the recovery email. The link points at
   `https://<project-ref>.supabase.co/auth/v1/verify?token=…&type=recovery&redirect_to=<site>`.
4. Clicking it verifies the token server-side and 302-redirects to
   `<site>/#access_token=…&type=recovery&refresh_token=…` (or, for an
   expired/used/malformed link, `<site>/#error=access_denied&error_code=otp_expired…`).
5. On app boot **`src/lib/supabaseClient.js` snapshots the URL synchronously**
   (`recoveryUrlState`) *before* `createClient()` runs, because supabase-js
   consumes and strips that hash during init and its one-shot `PASSWORD_RECOVERY`
   event fires before React can attach a listener.
6. `AuthContext` seeds `passwordRecovery` / `recoveryLinkInvalid` from that
   snapshot (the `PASSWORD_RECOVERY` event is kept as a secondary trigger) and
   holds `recoveryModeRef` so the recovery-scoped session is **never** treated as
   a normal login.
7. `App.jsx` `Root` renders `PasswordRecoveryScreen` (valid link) or
   `InvalidRecoveryLinkScreen` (bad link) *before* the `currentUser` / dashboard
   branch.
8. The user sets **New password** + **Confirm new password** and submits.
   `AuthContext.completePasswordRecovery` calls
   `supabase.auth.updateUser({ password })` — Supabase Auth is the sole authority
   for the password and its strength rules.
9. On success the confirmation card shows, then **Back to sign in** calls
   `finalizePasswordRecovery`: `supabase.auth.signOut()` + scrub the URL. The user
   lands on the normal login screen and signs in with the new password. The old
   password no longer authenticates (Supabase replaced the stored credential).

### Root cause of the original bug

The app relied **only** on the `PASSWORD_RECOVERY` event, which supabase-js emits
once during `detectSessionInUrl` processing at client-init time — before the
React `onAuthStateChange` listener is attached, and not replayed to late
listeners. When the event was missed (a race, made worse by StrictMode’s
double-mounted effect) the recovery-scoped session looked like an ordinary login
and `Root` fell through to the dashboard. Fix: detect the recovery landing from
the URL synchronously at module load and treat that as authoritative.

## Security properties

- Passwords are handled **only** by Supabase Auth (`updateUser`). No password
  field, table, hashing, or reset table in application code or Postgres.
- No service-role key anywhere in the frontend (`.env` is publishable/anon only).
- No recovery token or password is logged, or written to `localStorage`
  (supabase-js keeps its own session in storage; the app never touches tokens).
- A valid recovery session is **required** — `completePasswordRecovery` re-checks
  `getSession()` and surfaces “link expired” otherwise.
- Invalid / expired / used / malformed links get
  `InvalidRecoveryLinkScreen` (“This password reset link is invalid or has
  expired. Please request a new one.”), never a working reset form.
- Duplicate submits are guarded by the project-standard `useMutationGuard`
  (`key: "password-recovery-update"`).
- After reset the recovery session is ended (`signOut`) and the URL is scrubbed;
  a page refresh returns to normal login (recovery state does not persist).

## Deployment configuration (Supabase Dashboard — not in this repo)

`supabase/config.toml` only configures the **local** `supabase start` stack. The
hosted project is configured in the Dashboard:

### Authentication → URL Configuration

| Setting | Value |
| --- | --- |
| Site URL | `https://hiil-model-school.vercel.app` |
| Redirect URLs | `https://hiil-model-school.vercel.app`, `https://hiil-model-school.vercel.app/**`, plus any local dev origin (`http://localhost:5173`) |

Vercel → Project → Settings → Environment Variables (Production):
`VITE_SITE_URL=https://hiil-model-school.vercel.app`.

### Email branding — “Hiil Model School”

Current state: the project uses Supabase’s **default** Auth email sender
(`noreply@mail.app.supabase.io`, display name “Supabase Auth”) and the default
recovery template. Branding the email requires Dashboard/SMTP changes that
**cannot** be done from frontend code or this repo:

1. **Sender name + address** — Authentication → Emails → **SMTP Settings**:
   enable custom SMTP (e.g. Resend / SendGrid / Postmark), set
   *Sender name* = `Hiil Model School`, *Sender email* = a school-domain address.
   The API key is an SMTP secret — it lives in the Dashboard only, never in the
   repo. Until custom SMTP is configured the visible sender stays “Supabase Auth”.
2. **Template** — Authentication → Emails → **Templates → Reset Password**.
   Replace the body with school-branded HTML. Keep the CTA link as the supported
   variable `{{ .ConfirmationURL }}` (do **not** hardcode the project URL, token,
   or email). Suggested copy:
   - Subject: `Reset your Hiil Model School password`
   - Heading: `Hiil Model School`
   - Body: “We received a request to reset the password for your Hiil Model
     School account. Click the button below to choose a new password. If you
     didn’t request this, you can ignore this email.”
   - Button: `Reset your password` → `{{ .ConfirmationURL }}`
3. **Logo** — the app’s logo currently lives as a base64 data URI in
   `src/utils/constants.js` (`LOGO_DATA_URI`) and as `public/favicon.png`. Email
   clients need an absolute `https://` image URL. Use the production-hosted
   favicon (`https://hiil-model-school.vercel.app/favicon.png`) or upload the
   school logo to a public Storage bucket / CDN and reference that URL in the
   template `<img>`. Do not invent a URL and do not reference a `src/assets/…`
   path — it isn’t reachable from the email.

Changing the recovery template does not affect the signup-confirmation or
email-change templates — edit only **Reset Password**.

## Manual test plan

Browser verification: **NOT PERFORMED** by the implementer — run these against
production (`https://hiil-model-school.vercel.app`) after deploy.

| # | Step | Expected |
| --- | --- | --- |
| 1 | Login page → Forgot password → enter a real test account email → send | “Check your email” confirmation; recovery email arrives |
| 2 | Click **Reset your password** in the email | App opens the dedicated **Reset your password** screen (New password + Confirm). **Not** the dashboard/profile. |
| 3 | Enter matching new password (≥ 6 chars) → **Set new password** | “Password updated successfully” card |
| 4 | **Back to sign in** → try logging in with the **old** password | Login fails (“Incorrect email or password.”) |
| 5 | Log in with the **new** password | Login succeeds; same role/permissions, no new profile |
| 6 | Open an old/expired/reused recovery link | **InvalidRecoveryLinkScreen** — “This password reset link is invalid or has expired.” No reset form, no fake success |
| 7 | On the reset screen, click **Set new password** repeatedly | Exactly one update request (`useMutationGuard`) |
| 8 | Watch the address bar through the whole flow | Stays on `https://hiil-model-school.vercel.app`; tokens/hash are scrubbed after completion; a refresh returns to normal login |
| 9 | Mismatched passwords / empty fields / < 6 chars | Inline error, no network call; Supabase still rejects a weak password if it slips through |
