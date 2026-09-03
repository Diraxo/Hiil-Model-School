# Tilmaan Modern Academy — School Management System

Phase 1: a complete, runnable **React + Vite** frontend for the Tilmaan
Modern Academy School Management System, built from the approved prototype.
It runs entirely on local mock data — no backend required yet.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). To build for
production:

```bash
npm run build
npm run preview   # serve the production build locally to double-check it
```

## Demo accounts

The app seeds a realistic demo school on first load and persists changes to
your browser's `localStorage` (per-browser, not shared across devices).

| Role                        | Email                       | Password   |
|-----------------------------|-----------------------------|------------|
| Owner (Super Admin)         | `owner@tilmaan-demo.com`    | `Demo123!` |
| Educational Director        | `admin@tilmaan-demo.com`    | `Demo123!` |
| Finance & Operations Director | `finance@tilmaan-demo.com` | `Demo123!` |
| Teacher                     | `teacher@tilmaan-demo.com`  | `Demo123!` |
| Parent                      | `parent@tilmaan-demo.com`   | `Demo123!` |

"Educational Director" is the same underlying role as the original single
Admin account — just relabeled now that an Owner sits above it. The Owner
can also **view the app as any other user** (Accounts & Access → "View as")
without needing their password, and return to their own account at any time.

There are more teacher/parent accounts in the seed data too (10 teachers,
23 users total) — check Owner/Director → Teachers / Parents once logged in.
Staff (including non-login roles like cleaners, guards, and drivers) and
their payroll history are seeded too — see Owner/Finance → Staff / Payroll.

To wipe local data and start over, use **Settings → Reset demo data** inside
the app (or clear the site's local storage in your browser's dev tools).

## What's here

```
src/
  utils/        constants.js, helpers.js       – pure constants + formatting helpers
  data/         seed.js                        – mock data generator + localStorage persistence
  context/      ToastContext, DataContext,      – toast notifications, the app "database" +
                AuthContext                        CRUD API, and the logged-in user
  components/   ui.jsx, ReportCard.jsx          – shared UI kit + the printable report card template
  layouts/      AppShell.jsx                    – sidebar nav + page routing + impersonation banner
  pages/        auth/, owner/, admin/, finance/, – all the screens, grouped by role (admin/ also
                teacher/, parent/                  covers the Educational Director, who shares its pages)
  services/     studentService.js, etc.         – thin adapters over DataContext (see below)
  App.jsx, main.jsx                             – app root / entry point
```

This mirrors the original prototype's structure and behavior exactly —
same layout, roles, dashboards, workflows, calculations, and demo data. The
prototype was split from one 5,400-line file into these modules; nothing
about how it looks or works was changed in the process.

### Why `src/services/`?

Every page currently talks to the mock "database" through `useData()` from
`DataContext`, which is the Phase 1 stand-in for a real backend
(`MockStudentService`-style, in spirit). The `src/services/` folder wraps
that same context into named, per-domain functions —
`studentService.create(...)`, `paymentService.record(...)`, etc. — so that
in Phase 2 you can replace what's *inside* one service file with a real
Supabase query and nothing else in the app has to change. `useServices()`
is a convenience hook that bundles all of them together if you want to
start using it in new code.

## Phase 1 → Phase 4 roadmap

- **Phase 1 (this delivery):** React + Vite frontend, local mock data,
  Supabase/Firebase-ready but not required to run.
- **Phase 2:** Connect Supabase — Auth, Postgres, Row Level Security,
  real users/data, Realtime, Edge Functions. Replace the bodies of the
  files in `src/services/` with real Supabase calls.
- **Phase 3:** File/image storage — every user-uploaded image and file
  (profile & student photos, student documents, announcement and
  payment-reminder attachments, expense receipts, exam evidence) lives in
  a **private Supabase Storage bucket**; Postgres stores only the object
  path and the app reads short-lived signed URLs. No third-party object
  store is used or required.
- **Phase 4:** Connect Firebase Cloud Messaging for real push
  notifications, layered on top of the in-app notification system that
  already works today.

## Environment variables

`.env.example` lists the Supabase (required) and Firebase (optional, push
notifications) variables — copy it to `.env` and fill in the Supabase URL
and publishable key.

## A note on the persistence layer

The original prototype called `window.storage.get/set` — an API that only
exists inside Claude.ai's Artifacts preview and would not work in a real
deployed site. That's been replaced with real browser `localStorage`
(`src/data/seed.js`, `loadDB`/`saveDB`) behind the exact same function
signatures, so nothing else in the app needed to change, and the existing
cross-tab "live update" polling still works the same way.

## Before moving to Phase 2

Run through all five roles once, on both desktop and a phone, to confirm
Phase 1 feels solid:

- **Owner:** Login → dashboard → students → teachers → staff → payroll → expenses → accounts & access ("View as" a Director/Teacher, then return) → audit log
- **Educational Director** (`admin@tilmaan-demo.com`): Login → dashboard → students → teachers → classes → results → report cards → reports
- **Finance & Operations Director:** Login → dashboard → fees → payroll → expenses
- **Teacher:** Login → dashboard → class → homework → attendance → results → messages
- **Parent:** Login → dashboard → children → homework → attendance → results → report cards → behavior → payments → messages

Also confirm the lifecycle paths work end to end: changing a student's
status (e.g. to Transferred) hides them from "active" counts and shows
"No longer enrolled" on the parent's dashboard without deleting any history;
disabling a Director/Finance/Teacher account blocks their next login with a
clear message; and a report card can't be generated until every subject for
that class has a Final mark, then flows Generate → Publish → Lock.

Only once that feels stable should Supabase + RLS + Auth + Realtime work
begin.
