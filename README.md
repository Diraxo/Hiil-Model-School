# Hiil Model School — School Management System

A **React + Vite** single-page app for running Hiil Model School: admissions,
classes and curriculum, timetables, attendance and leave, homework, exam
results and report cards, fees and payments, payroll and expenses, behaviour
records, announcements, 1:1 messaging, and a staff activity feed.

The app is backed entirely by **Supabase** — Postgres with Row Level Security,
Supabase Auth, Realtime, Storage, and Edge Functions. There is no mock data
layer and nothing is persisted in the browser; every screen reads and writes
live data through the authenticated Supabase client.

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the two Supabase values (see below)
npm run dev               # Vite dev server, usually http://localhost:5173
```

### Scripts

| Command           | What it does                                              |
|-------------------|----------------------------------------------------------|
| `npm run dev`     | Start the Vite dev server with HMR                        |
| `npm run build`   | Production build to `dist/`                               |
| `npm run preview` | Serve the built `dist/` locally to sanity-check it        |

There is no separate lint / typecheck / test script in this project.

Node 20+ is recommended (developed on Node 24).

## Environment variables

`.env` (git-ignored) needs exactly two values, both safe to ship to the browser:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

- `VITE_SUPABASE_ANON_KEY` must be a **publishable / anon** key
  (`sb_publishable_…`). Never put a `service_role` / secret key in `.env`, in
  client code, or in this repo — RLS is what protects the data, and the
  publishable key is meant to be public.
- `src/lib/supabaseClient.js` throws on startup if either variable is missing.
- Firebase Cloud Messaging variables in `.env.example` are optional and only
  needed if/when web push is wired up.

The same two variables must be configured in the hosting provider (e.g. Vercel
project → Settings → Environment Variables, Production scope).

## Architecture

```
Browser (React SPA)
  │   authenticated Supabase JS client (publishable key + user session)
  ▼
Supabase
  ├─ Auth              real accounts for every role; sessions + password reset
  ├─ Postgres + RLS    every table has RLS; role/ownership checks live in policies
  ├─ RPCs              SECURITY DEFINER functions for notifications, activity,
  │                    money movement, leave decisions, obligation materialisation
  ├─ Realtime          per-user channel for notifications / messages / activity,
  │                    plus Presence + Broadcast for "online" and "typing"
  ├─ Storage           private buckets for every user-uploaded image / file
  └─ Edge Function     manage-staff-account (creates/disables/resets auth accounts)
```

### Data layer (`src/`)

- **`src/lib/supabaseClient.js`** — the single shared Supabase client.
- **`src/services/*`** — one module per domain (students, fees, payments,
  timetable, results, messaging, …). Each talks only to Supabase (tables, RPCs,
  Storage) and maps rows into the camelCase shape the UI expects.
- **`src/context/DataContext.jsx`** — owns read-side state and a `refetch`
  function per domain, exposes an `api.*` method for every mutation, and folds
  every domain onto one read-only `db` object that pages consume through
  `useData()`. It also opens the per-user Realtime channel and re-hydrates
  everything on login / account switch / logout.
- **`src/context/AuthContext.jsx`** — the logged-in user, the post-login
  ACTIVE/SUSPENDED/DISABLED check (`my_profile()` RPC), and the Owner-only
  "View as" (client-side impersonation; the Supabase session stays the Owner's).
- **`src/data/skeleton.js`** — empty starting shape for `db` before the first
  fetch resolves. No records, no credentials, no demo data.

### Roles and access boundaries

Five roles (`src/utils/constants.js`). RLS policies in
`supabase/migrations/20260825190000_rls_policies.sql` (and later hardening
migrations) are the real enforcement; the `src/utils/*Permissions.js` helpers
only decide which buttons/forms render.

| Role | Label in UI | Can see / do |
|------|-------------|--------------|
| `OWNER` | Owner | Everything: students, staff, teachers, classes, curriculum, timetable, attendance, leave, results, report cards, fees, payments, payroll, expenses, announcements, messaging, activity log, and Accounts & Access (create/disable/reset any account, "View as" any user). |
| `ADMIN` | Educational Director | Academic operations: students, teachers, classes, curriculum, timetable, attendance, leave decisions for teachers/other staff, results, report cards, behaviour records, exam announcements, announcements, messaging. **No** payment, payroll or salary visibility. |
| `FINANCE` | Finance & Operations Director | Finance only: fees, payments (record / void), expenses, payroll for every staff group, contact details for "Other Staff" they administer. **No** academic marks, attendance editing, or behaviour records. |
| `TEACHER` | Teacher | Their own classes only: take attendance for a class they head, publish/edit homework and enter draft results for subjects they are assigned to teach, view their own timetable, request leave, message parents/staff, view their own payslips. Academic actions are also gated by the calendar and by their own attendance that day. |
| `PARENT` | Parent | Their own children only: dashboard, homework, attendance, published results and report cards, behaviour records, fee balances and payment history, messaging. Sees "no longer enrolled" instead of history when a child's status changes. |

Contact details (`profiles.email` / `profiles.phone`) are column-revoked from
ordinary authenticated users and only returned through the
`directory_contacts()` RPC to the accounts each role legitimately administers.

### Modules

| Area | Tables / RPCs (high level) |
|------|----------------------------|
| Auth & accounts | `profiles`, `my_profile()`, `manage-staff-account` Edge Function |
| Academic structure | `academic_years`, `classes`, `subjects`, `class_subjects`, `teacher_assignments`, `enrollments` |
| Timetable | `timetable_entries`, `timetable_config`, `substitutions`, `school_closures` |
| Attendance & leave | `attendance`, `period_logs`, `staff_attendance`, `leave_requests` (+ `decide_leave_request()`), `owner_leave_log` |
| Homework | `homework` (+ `notify_homework`) |
| Results & report cards | `results`, `result_components`, `result_audit_log`, `result_evidence`, `exam_announcements`, `report_cards` |
| Behaviour | `behavior_records` |
| Fees & payments | `fee_types` → `fee_schedules` → `fee_installments` → `student_fee_obligations` → `fee_obligation_adjustments`; `payments`, `payment_allocations`, `payment_methods`, `payment_audit_log`; money moves only through `record_payment_batch()` / `void_payment()` / obligation-materialisation RPCs |
| Payroll & expenses | `payroll_payments`, `salary_advances`, `expenses` (+ transactional RPCs) |
| Communications | `notifications` (write only via `notify_*` RPCs), `announcements`, `conversations`, `messages`, `activities` (write only via `log_activity`) |

### Storage (private buckets only)

Every user-uploaded image or file lives in a **private** Supabase Storage
bucket. Postgres stores only the object path; the app mints short-lived signed
URLs on read. No public buckets, no base64 in the database, no third-party
object store.

| Bucket | Contents |
|--------|----------|
| `profile-photos` | staff / director / teacher / parent avatars |
| `student-photos` | student photos |
| `student-documents` | student document uploads |
| `result-evidence` | photos/scans of marked exam papers |
| `expense-receipts` | expense purchase receipts |
| `announcement-attachments` | files attached to announcements |
| `payment-reminder-attachments` | files attached to payment reminders |

Object-level RLS on each bucket mirrors the owning table's row policies.
Student payment receipts are rendered on the fly from `payments` data and
printed, never stored as files.

### Realtime — notifications, messaging, presence

- **Notifications / messages / announcements / activity / directory** — `DataContext`
  opens one RLS-scoped Realtime channel per signed-in user
  (`comms:<uid>`), debounces a refetch of the affected domain, and tears the
  channel down + rebuilds it on account switch (torn down on logout). The
  channel also watches `profiles` / `staff` / `students` so a profile- or
  student-photo (or name / status) change made in one session shows up in every
  other open session without a refresh; `AuthContext` reloads the signed-in
  user's own `currentUser` via `profileSyncStore` when their own row changes.
- **Presence ("online now")** — `src/utils/presence.js` uses Supabase Realtime
  **Presence** on a single app-wide channel, keyed by the real logged-in user.
- **"Last seen"** — `public.user_presence.last_seen_at`, stamped by the
  `touch_presence()` RPC on connect and on a ~25s heartbeat, so status survives a
  disconnect. Kept off the `profiles` row so the heartbeat doesn't churn the
  directory Realtime subscription above.
- **Typing indicator** — Realtime **Broadcast** on a per-conversation channel.

None of this touches `localStorage`.

## Supabase project & migrations

- SQL migrations live in `supabase/migrations/` (32 files as of this writing).
- The linked project is referenced in `supabase/config.toml` /
  `supabase/.temp/`.
- Apply new migrations to the remote database with the Supabase CLI
  (`supabase db push`, or `supabase migration up --linked`). Do **not** run
  `supabase db reset` against the production project.
- The `manage-staff-account` Edge Function is in `supabase/functions/`; it runs
  with the service-role key **server-side only** and re-checks the caller's
  session against `is_owner_or_admin()` before doing anything.
- `supabase/seed_owner.sql` is a template for bootstrapping the first Owner
  account. Real owner-bootstrap seeds (`seed_owner_*.sql`) contain a live email
  and default password and are git-ignored.

## Project layout

```
src/
  lib/          supabaseClient.js, storageMedia.js
  services/     one Supabase-backed module per domain (+ index.js barrel, useServices hook)
  context/      DataContext (the db + api + realtime), AuthContext, ToastContext
  hooks/        shared hooks (e.g. useMutationGuard)
  components/   shared UI kit, Receipt, ReportCard, announcement/notification widgets
  layouts/      AppShell — sidebar nav, routing, "View as" banner
  pages/        auth/, owner/, admin/, finance/, teacher/, parent/
  utils/        constants, helpers, permission checks, academic-calendar logic, presence
  data/         skeleton.js (empty initial db shape)
  App.jsx, main.jsx

supabase/
  migrations/   ordered SQL migrations (schema, RLS, RPCs, Storage)
  functions/    manage-staff-account edge function
  config.toml   linked-project + local config
```

## Deployment

The app is a static SPA — `npm run build` produces `dist/`, deployable to any
static host. Routing is state-based (no history-API deep links), so no rewrite
rules are required. The host must provide `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` at build time.
