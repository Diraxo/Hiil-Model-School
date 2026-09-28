# Academic year as the central scope

The academic year is the one scope every year-sensitive screen and rule hangs off. This document is the
map: the data model, the lifecycle, how each domain is scoped, and — for the school owner — the exact steps
to apply this to production. **Nothing here has been applied to the production database.**

## 1. Data model

| Thing | Belongs to a year through | Notes |
|---|---|---|
| Student | *(nothing — permanent)* | A student is never deleted because they don't return. |
| Enrollment | `enrollments.academic_year_id` (unique per student + year) | One row per student per year: that year's grade / section / class / status. |
| "Not returning" | `student_year_decisions (student, year)` | A decision about a *year*. Deletes nothing. |
| Fees | `fee_schedules.academic_year_id` → `fee_installments` → `student_fee_obligations` → `payment_allocations` | A payment reaches a year only through its obligation, so it cannot appear in another year. |
| Results | `results.academic_year_id` | Unchanged; now also read-only in a closed year. |
| Attendance | its **date** (a row lies in exactly one year's `[year_start, year_end]`) | Deliberately *not* a second `academic_year_id` column: a duplicated id could drift or be tampered with. |
| Payroll | its **month** (`payroll_payments.month`, `salary_advances.payroll_month`) | Must be one of a year's billing months. |
| Teacher assignments | live table = current year; `academic_year_teacher_assignments` = snapshot taken when a year closes | Display-only history. |

`academic_years` gained `closed_at` / `closed_by`. `is_current` (unique partial index — at most one) and `closed_at` are the whole lifecycle.

## 2. Lifecycle

* **UPCOMING** — set up, never activated (`closed_at` null, not current). Editable; students can be registered.
* **CURRENT** — the operational year. Exactly one.
* **PREVIOUS / CLOSED** — was current, now replaced. `closed_at` set. Read-only, kept forever, never hidden.

Phases of the current year (derived from its dates and the *result finalization grace days*): active → **ending soon**
(≤ 30 days) → **ended** → **closed** (after `year_end + grace days`). The Owner / Educational Director get a banner with
*Review Year* and *Create Next Academic Year*.

The current year changes **only** through `set_current_academic_year()` (Academic Years → *Make Current*, or the wizard's last step):

* atomic — the old year is closed and the new one activated in one transaction, with an audit row;
* activating an upcoming year needs every student registered or marked *not returning* (or an explicit "record the rest as not returning");
* switching to a **closed** year is an exceptional reopening: a reason is required and it is audited;
* the student roster (grade / class / status) is synced to the activated year's enrollments — a pure function of the enrollments, so switching back and forth is lossless;
* a plain `UPDATE academic_years SET is_current…` by a signed-in user is refused by a trigger.

## 3. The workspace (what the screens show)

`DataContext` decides it once (`db.yearScope`, `useAcademicYear()`):

* `currentAcademicYear` (operational) and `selectedAcademicYear` (what the header selector shows);
* Owner / Educational Director / Finance can pick any year; **everyone else is pinned to the current year**;
* the selection is a per-browser convenience, never a permission;
* while another year is being viewed, the day-to-day write actions (enrolment, attendance, results, homework, fees/payments, payroll, assignments) are **refused** with a clear message — they would otherwise land in the current year;
* pages remount when the year changes, so no screen keeps a stale year.

The database is the real enforcement (next section); the client guard only makes the refusal friendly.

## 4. Database enforcement (migration `20260929000000_academic_year_central_scope.sql`)

* **Read-only years** — triggers refuse writes to `enrollments`, `results`, `result_components`, `fee_schedules`, `fee_installments`, `student_fee_obligations`, `payment_allocations`, `fee_obligation_adjustments` of a closed year, and the calendar of a closed year can't be edited. `academic_year_id` can never be changed on a year-scoped row.
* **Historical adjustments** — money into a closed year: `record_historical_payment_batch` / `record_historical_payroll_payment` — **Owner only, reason required, audited**. The UI offers the payment one when the Owner is viewing a closed year.
* **Payroll periods** — a payroll payment / advance must be for a month of some academic year and for a month the person was employed in (their start month through their end month; joining on the 29th still includes that month).
* **Billing months** — `academic_year_billing_months(start, end)`: one period per **Ethiopian month of which the year covers at least half** (15 of 30 days). Meskerem 1 → Sene 30 is exactly **10** months; a 1-Sept start doesn't drag in Nehasse; a stray Hamle 1 end doesn't add Hamle. A billing period is keyed by the Gregorian month holding its 16th day (`2026-09-01` = Meskerem 2019).
* **Fees only for enrolled students** — obligations are created only for students enrolled in the schedule's year; a mid-year joiner is billed from their joining month (earlier months show **Not applicable**, never unpaid).
* **Audit** — `academic_year_audit` (append-only): created, calendar changed (old/new dates), activated, reopened, historical adjustments.
* **Security** — new tables have RLS (audit / decisions: Owner, Educational Director, Finance read; nobody writes directly); internal functions are not executable by `anon`/`authenticated`; the RPCs re-check the caller's role.

## 5. Owner steps for production (in this order)

1. **Read-only diagnostic.** Run `supabase/manual/diagnose_academic_year_dates.sql` in the Supabase SQL editor and look at it. It changes nothing.
   It tells you which row is 2018–2019 (2025–26) and which is 2019–2020 (2026–27) and what hangs off each.
2. **Fix the bad row (only if the diagnostic says so).** If the row with `year_start = 2025-09-11`, `year_end = 2027-07-08`, `sem1_start = 2026-09-14` is really the 2019 year and the *verdict helper* at the bottom of the diagnostic shows **0** everywhere, run `supabase/manual/repair_academic_year_start.sql.template`
   (`<<ACADEMIC_YEAR_ID>>`, `2026-09-11`, `2027-07-07`). It moves only `year_start` / `year_end` (and `sem2_end` if it ends later). It refuses — and changes nothing — if any fee, attendance or payroll from before the new start exists on that row (then the row carries two school years and must be **split by a person**; nothing is ever moved automatically, and nothing is deleted).
3. **Apply the migration** `20260929000000_academic_year_central_scope.sql`. It is additive and idempotent. Its two data steps are insert/flag-only: `closed_at` on already-ended non-current years, and an enrollment for any active student who lacked one in the current year.
4. Deploy the app. (The app also runs *before* step 3: the current-year switch falls back to the old two-step update and the new lists read as empty — but registering students for a new year needs the migration.)
5. Create next year with **Academic Year → Create Next Academic Year**.

**Rollback:** `supabase/rollbacks/20260929000000_rollback.sql` removes everything the migration added and restores the previous fee RPC bodies. It deletes no student / enrollment / result / fee / payment / attendance / payroll data. It drops the three tables the migration added (audit, decisions, teacher-assignment snapshots) — export them first if you want to keep them.

## 6. Behaviour changes to know about

* **Payroll only for a year's own months.** Meskerem–Sene. A salary for Hamle / Nehasse / Pagumen (outside every year) is refused.
* **Fees only for enrolled students.** A student without an enrollment for a year is not billed for it.
* **Closed-year results can't be edited even with the auto-lock override** — reopen the year (audited) instead.
* Dashboards and reports now show **the selected year's** figures, not all-time.

## 7. Known limits (deliberate)

* **Timetable and classes are not year-scoped** (they are current-state tables). Teacher assignments are snapshotted at close for display; reopening an old year does **not** restore them.
* Payroll for a closed year has the Owner-only RPC but no screen yet (payments do).
* Voiding a receipt in a closed year is not blocked (it is an owner/finance action with its own audit log).

## 8. Where things live

`src/utils/academicYearScope.js` (lifecycle, workspace, re-enrollment worklist) · `src/utils/billingPeriods.js` +
`ethiopianCalendar.js#ethiopianMonthsCoveredBy` (periods) · `src/utils/feeLedger.js` (fee rows + Not applicable) ·
`src/utils/payrollLedger.js` · `src/hooks/useAcademicYear.js` · `src/components/academicYear.jsx` (selector, banners, settings, wizard) ·
`src/services/academicYearService.js` · `supabase/migrations/20260929000000_*` · tests: `academicYear*.test.*`, `feeLedger`, `payrollLedger`, `billingPeriods`.
