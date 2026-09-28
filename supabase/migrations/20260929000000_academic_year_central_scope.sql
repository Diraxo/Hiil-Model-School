-- Academic year as the central scope of the school system.
--
-- Most of the year scoping already exists in the schema: fee_schedules / results / enrollments carry
-- academic_year_id, fee_installments -> student_fee_obligations -> payment_allocations hang off a
-- schedule (so every payment belongs to exactly one year through its obligation), attendance is
-- date-scoped (rows carry a date inside exactly one year) and payroll is month-scoped. This migration
-- closes the gaps and makes the lifecycle explicit and safe:
--
--  1. LIFECYCLE   academic_years.closed_at / closed_by. current / previous(closed) / upcoming is
--                 (is_current, closed_at); the "one current year" rule is the existing partial unique
--                 index. The current year can only change through set_current_academic_year() — one
--                 atomic, audited action — never two loose UPDATEs.
--  2. BILLING     public.academic_year_billing_months(start, end): the Ethiopian months a year covers
--                 at least half of (Meskerem 1 -> Sene 30 = 10). generate_monthly_fee_installments and
--                 set_fee_schedule_billed_months use it, so a year bills exactly its own months.
--  3. ENROLLMENT  a student is permanent, an enrollment belongs to one year. register_student_for_year()
--                 / mark_student_not_returning() (+ student_year_decisions) drive re-enrollment;
--                 set_current_academic_year() syncs the student roster to the year being activated.
--                 Nothing here ever deletes a student or rewrites a historical enrollment.
--  4. READ-ONLY   a closed year's enrollments, results, fee schedules/installments/obligations,
--                 payment allocations and adjustments cannot be written (triggers), and academic_year_id
--                 can never be changed on those rows. The one exception is an explicit, owner-only,
--                 reasoned, audited "historical adjustment" (record_historical_payment_batch /
--                 record_historical_payroll_payment).
--  5. PAYROLL     a payroll payment / advance must be for a month that belongs to an academic year and
--                 for a month the staff member was employed in (start month .. end month).
--  6. AUDIT       academic_year_audit (append-only): created, calendar changed, activated, reopened,
--                 historical adjustments.
--
-- Additive and idempotent (create or replace / drop ... if exists / on conflict do nothing). No table
-- is dropped and no historical row is deleted or moved; the two data steps (closed_at backfill and a
-- missing-current-year-enrollment backfill) are insert/flag-only and are described where they run.

-- =====================================================================
-- 1. Lifecycle columns + helpers
-- =====================================================================

alter table public.academic_years
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles (id) on delete set null;

comment on column public.academic_years.closed_at is
  'Set when the year stops being the current one (previous / closed = read-only history). NULL for the current year and for years that were never activated (upcoming).';

-- Backfill: a year that already ended and is not current is history. (Years that were never activated
-- and haven''t ended stay "upcoming" and editable.)
update public.academic_years
   set closed_at = (year_end + 1)::timestamptz
 where closed_at is null and not is_current and year_end < current_date;

create or replace function public.academic_year_is_writable(p_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.academic_years y
    where y.id = p_year_id and (y.is_current or y.closed_at is null)
  );
$$;

comment on function public.academic_year_is_writable is
  'True for the current year and for an upcoming (never-closed) year being set up; false for a previous/closed year (read-only history).';

create or replace function public.assert_academic_year_writable(p_year_id uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  if not public.academic_year_is_writable(p_year_id) then
    select coalesce(gc_label, year_start::text) into v_label from public.academic_years where id = p_year_id;
    raise exception 'The academic year % is closed (read-only): % cannot be changed. An owner can reopen it from Academic Years.', coalesce(v_label, ''), p_what;
  end if;
end;
$$;

-- =====================================================================
-- 2. Ethiopian billing months
-- =====================================================================

-- Gregorian date of Meskerem 1 in Gregorian year p (11 Sept, or 12 Sept when p + 1 is a leap year).
create or replace function public.ethiopian_new_year(p_gregorian_year integer)
returns date
language sql
immutable
as $$
  select make_date(
    p_gregorian_year, 9,
    case when ((p_gregorian_year + 1) % 4 = 0 and (p_gregorian_year + 1) % 100 <> 0) or (p_gregorian_year + 1) % 400 = 0
         then 12 else 11 end
  );
$$;

-- The billing months ("YYYY-MM-01") of a school year: one per ETHIOPIAN month of which [p_start, p_end]
-- covers at least half (15 of its 30 days). A month is keyed by the Gregorian civil month holding its
-- 16th day (the same rule the app uses to label a civil month with its Ethiopian name), so Meskerem 1
-- (11 Sep) -> Sene 30 (7 Jul) is Sep .. Jun = 10 rows, a Sep 1 start does not drag in Nehasse (5 days of
-- the previous E.C. year) and a Hamle 1 end does not add Hamle. Pagumen is never a period.
-- Mirrors ethiopianMonthsCoveredBy() in src/utils/ethiopianCalendar.js (a test compares them).
create or replace function public.academic_year_billing_months(p_start date, p_end date)
returns setof date
language plpgsql
immutable
as $$
declare
  v_month date;
  v_last  date;
  v_mid   date;
  v_ny    date;
  v_bs    date;
begin
  if p_start is null or p_end is null or p_end < p_start then
    return;
  end if;
  v_month := (make_date(extract(year from p_start)::integer, extract(month from p_start)::integer, 1) - interval '1 month')::date;
  v_last  := (make_date(extract(year from p_end)::integer, extract(month from p_end)::integer, 1) + interval '1 month')::date;
  while v_month <= v_last loop
    v_mid := v_month + 15;
    v_ny  := public.ethiopian_new_year(extract(year from v_mid)::integer);
    if v_mid < v_ny then
      v_ny := public.ethiopian_new_year(extract(year from v_mid)::integer - 1);
    end if;
    v_bs := v_ny + 30 * ((v_mid - v_ny) / 30);   -- first day of the Ethiopian month holding v_mid
    if least(v_bs + 29, p_end) - greatest(v_bs, p_start) + 1 >= 15 then
      return next v_month;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return;
end;
$$;

create or replace function public.generate_monthly_fee_installments(p_fee_schedule_id uuid)
returns setof public.fee_installments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule   public.fee_schedules;
  v_year       public.academic_years;
  v_month      date;
  v_idx        integer;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may generate fee installments';
  end if;

  select * into v_schedule from public.fee_schedules where id = p_fee_schedule_id for update;
  if v_schedule.id is null then
    raise exception 'Fee schedule % not found', p_fee_schedule_id;
  end if;

  select * into v_year from public.academic_years where id = v_schedule.academic_year_id;
  if v_year.id is null then
    raise exception 'The academic year for this fee schedule no longer exists';
  end if;
  if v_year.year_start is null or v_year.year_end is null or v_year.year_end < v_year.year_start then
    raise exception 'The academic year has no valid start/end dates -- set them on the Academic Years page first';
  end if;

  -- The academic year owns the billing periods, so its dates must describe ONE school year. A year
  -- whose start date was left in the previous year (e.g. 2025-09-11 .. 2027-07-08) would silently
  -- generate ~23 months. Refuse instead; the dates are fixed in Academic Calendar & Attendance.
  if v_year.year_end - v_year.year_start > 400 then
    raise exception 'The academic year runs % days (% to %) -- more than one school year. Correct its start/end dates in Academic Calendar before generating fee installments',
      v_year.year_end - v_year.year_start, v_year.year_start, v_year.year_end;
  end if;

  v_idx := 0;
  -- One installment per Ethiopian billing month of the year (spans two Gregorian years automatically).
  -- When billed_months is set, a month outside it is skipped entirely (no installment, therefore no
  -- obligation) -- the sequence_index still advances so re-runs stay stable and labels/order match
  -- the calendar.
  for v_month in select m from public.academic_year_billing_months(v_year.year_start, v_year.year_end) m order by m
  loop
    if v_schedule.billed_months is null or v_month = any (v_schedule.billed_months) then
      insert into public.fee_installments
        (fee_schedule_id, sequence_index, label, due_date, amount, period_month)
      values
        (p_fee_schedule_id,
         v_idx,
         trim(to_char(v_month, 'FMMonth YYYY')),
         v_month,
         v_schedule.unit_amount,
         v_month)
      on conflict (fee_schedule_id, period_month) where period_month is not null
        do nothing;
    end if;
    v_idx := v_idx + 1;
  end loop;

  return query
    select * from public.fee_installments
    where fee_schedule_id = p_fee_schedule_id
    order by coalesce(period_month, due_date), sequence_index;
end;
$$;

create or replace function public.set_fee_schedule_billed_months(
  p_fee_schedule_id uuid,
  p_months          date[]
)
returns public.fee_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule   public.fee_schedules;
  v_year       public.academic_years;
  v_target     date[];
  v_drop_month date;
  v_inst       record;
  v_blocked    integer;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may change a fee''s billed months';
  end if;

  select * into v_schedule from public.fee_schedules where id = p_fee_schedule_id for update;
  if v_schedule.id is null then
    raise exception 'Fee schedule % not found', p_fee_schedule_id;
  end if;

  select * into v_year from public.academic_years where id = v_schedule.academic_year_id;
  if v_year.id is null or v_year.year_start is null or v_year.year_end is null then
    raise exception 'The academic year for this fee schedule has no valid dates';
  end if;

  -- Normalise the target: month-start, distinct, sorted, and inside the academic year only (a month
  -- is inside when it is one of the year's Ethiopian billing months).
  select coalesce(array_agg(m order by m), '{}')
    into v_target
  from (
    select distinct date_trunc('month', m)::date as m
    from unnest(coalesce(p_months, '{}'::date[])) m
    where date_trunc('month', m)::date in (select b from public.academic_year_billing_months(v_year.year_start, v_year.year_end) b)
  ) s;

  if array_length(v_target, 1) is null then
    raise exception 'Select at least one month for this fee';
  end if;

  -- ---- DROP: months that currently have an installment but are not in the target ----
  for v_drop_month in
    select fi.period_month
    from public.fee_installments fi
    where fi.fee_schedule_id = p_fee_schedule_id
      and fi.period_month is not null
      and not (fi.period_month = any (v_target))
      -- Installments OUTSIDE the academic year's current billing months (the dates were changed after
      -- billing began) are historical: this RPC only manages the months the year covers, so it never
      -- drops them and their payments/adjustments can never block an unrelated change.
      and fi.period_month in (select b from public.academic_year_billing_months(v_year.year_start, v_year.year_end) b)
  loop
    select fi.* into v_inst
    from public.fee_installments fi
    where fi.fee_schedule_id = p_fee_schedule_id and fi.period_month = v_drop_month
    for update;

    -- any real financial fact tied to this month?
    select count(*) into v_blocked
    from public.student_fee_obligations o
    where o.fee_installment_id = v_inst.id
      and (
        exists (
          select 1 from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id
          where pa.obligation_id = o.id and p.status <> 'VOIDED'
        )
        or exists (select 1 from public.fee_obligation_adjustments a where a.obligation_id = o.id)
      );

    if v_blocked > 0 then
      raise exception 'Cannot remove % : a payment or adjustment has already been recorded against it. Void those first.',
        trim(to_char(v_drop_month, 'FMMonth YYYY'));
    end if;

    delete from public.student_fee_obligations where fee_installment_id = v_inst.id;
    delete from public.fee_installments where id = v_inst.id;
  end loop;

  -- ---- Persist the new month set BEFORE (re)generating so generate_* honours it ----
  update public.fee_schedules
    set billed_months = v_target,
        units_per_year = array_length(v_target, 1)
    where id = p_fee_schedule_id;

  -- ---- ADD: generate any now-missing installments + materialise their obligations ----
  perform public.generate_monthly_fee_installments(p_fee_schedule_id);

  -- materialise across the whole (possibly shrunk / grown) schedule; ON CONFLICT DO NOTHING.
  perform public.materialize_obligations_for_schedule(p_fee_schedule_id, date_trunc('month', v_year.year_start)::date, 'YEAR_ROLLOUT');

  select * into v_schedule from public.fee_schedules where id = p_fee_schedule_id;
  return v_schedule;
end;
$$;

revoke all on function public.generate_monthly_fee_installments(uuid) from public;
grant execute on function public.generate_monthly_fee_installments(uuid) to authenticated;
revoke all on function public.set_fee_schedule_billed_months(uuid, date[]) from public;
grant execute on function public.set_fee_schedule_billed_months(uuid, date[]) to authenticated;

-- =====================================================================
-- 3. Audit log + enrollment decisions
-- =====================================================================

create table if not exists public.academic_year_audit (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid references public.academic_years (id) on delete cascade,
  action           text not null,
  actor_id         uuid references public.profiles (id) on delete set null,
  actor_name       text,
  reason           text,
  details          jsonb,
  at               timestamptz not null default now()
);

comment on table public.academic_year_audit is
  'Append-only history of academic-year lifecycle actions (created, calendar changed, activated, reopened, historical adjustments). Written by triggers / SECURITY DEFINER RPCs only.';

create index if not exists academic_year_audit_year_idx on public.academic_year_audit (academic_year_id, at desc);

alter table public.academic_year_audit enable row level security;
revoke all on public.academic_year_audit from anon;
revoke insert, update, delete on public.academic_year_audit from authenticated;
drop policy if exists academic_year_audit_select on public.academic_year_audit;
create policy academic_year_audit_select on public.academic_year_audit
  for select using (public.is_owner_or_admin() or public.is_finance());

create or replace function public.write_academic_year_audit(p_year_id uuid, p_action text, p_reason text, p_details jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.academic_year_audit (academic_year_id, action, actor_id, actor_name, reason, details)
  values (p_year_id, p_action, auth.uid(),
          (select full_name from public.profiles where id = auth.uid()), p_reason, p_details);
$$;
-- Internal: only the triggers / SECURITY DEFINER RPCs below may write the audit. (Supabase's default
-- privileges grant EXECUTE on new functions to anon/authenticated, so revoke those explicitly.)
revoke all on function public.write_academic_year_audit(uuid, text, text, jsonb) from public, anon, authenticated;

-- A student's decision for a year they have no enrollment in. NOT_RETURNING never deletes or edits the
-- student or any earlier enrollment: it only records that they are not enrolled in THIS year.
create table if not exists public.student_year_decisions (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  decision         text not null default 'NOT_RETURNING',
  reason           text,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz not null default now(),
  constraint student_year_decisions_unique unique (student_id, academic_year_id),
  constraint student_year_decisions_known check (decision in ('NOT_RETURNING'))
);

comment on table public.student_year_decisions is
  'Re-enrollment decisions ("Not returning") per student per academic year. Written only by mark_student_not_returning / register_student_for_year.';

create index if not exists student_year_decisions_year_idx on public.student_year_decisions (academic_year_id);

alter table public.student_year_decisions enable row level security;
revoke all on public.student_year_decisions from anon;
revoke insert, update, delete on public.student_year_decisions from authenticated;
drop policy if exists student_year_decisions_select on public.student_year_decisions;
create policy student_year_decisions_select on public.student_year_decisions
  for select using (public.is_owner_or_admin() or public.is_finance());

-- Teacher assignments (which teacher teaches which subject in which class) are the CURRENT state; the year
-- that is being closed keeps a snapshot of them so its history stays visible after the assignments change for
-- the next year. Written only by set_current_academic_year().
create table if not exists public.academic_year_teacher_assignments (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  teacher_id       uuid references public.profiles (id) on delete set null,
  teacher_name     text,
  subject_id       uuid references public.subjects (id) on delete set null,
  class_id         uuid references public.classes (id) on delete set null,
  snapshot_at      timestamptz not null default now()
);
create unique index if not exists academic_year_teacher_assignments_slot
  on public.academic_year_teacher_assignments (academic_year_id, class_id, subject_id)
  where class_id is not null and subject_id is not null;

comment on table public.academic_year_teacher_assignments is
  'Snapshot of teacher_assignments taken when an academic year is closed, so a previous year keeps showing who taught what.';

alter table public.academic_year_teacher_assignments enable row level security;
revoke all on public.academic_year_teacher_assignments from anon;
revoke insert, update, delete on public.academic_year_teacher_assignments from authenticated;
drop policy if exists academic_year_teacher_assignments_select on public.academic_year_teacher_assignments;
create policy academic_year_teacher_assignments_select on public.academic_year_teacher_assignments
  for select using (public.current_role() is not null);

-- Audit the lifecycle facts that change without going through an RPC.
create or replace function public.academic_years_audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_academic_year_audit(new.id, 'CREATED', null,
      jsonb_build_object('year_start', new.year_start, 'year_end', new.year_end));
  elsif new.year_start is distinct from old.year_start or new.year_end is distinct from old.year_end
     or new.sem1_start is distinct from old.sem1_start or new.sem1_end is distinct from old.sem1_end
     or new.sem2_start is distinct from old.sem2_start or new.sem2_end is distinct from old.sem2_end
     or new.break_days is distinct from old.break_days
     or new.result_finalization_grace_days is distinct from old.result_finalization_grace_days then
    perform public.write_academic_year_audit(new.id, 'CALENDAR_UPDATED', null,
      jsonb_build_object(
        'old', jsonb_build_object('year_start', old.year_start, 'year_end', old.year_end, 'sem1_start', old.sem1_start,
                                  'sem1_end', old.sem1_end, 'sem2_start', old.sem2_start, 'sem2_end', old.sem2_end,
                                  'break_days', old.break_days, 'grace_days', old.result_finalization_grace_days),
        'new', jsonb_build_object('year_start', new.year_start, 'year_end', new.year_end, 'sem1_start', new.sem1_start,
                                  'sem1_end', new.sem1_end, 'sem2_start', new.sem2_start, 'sem2_end', new.sem2_end,
                                  'break_days', new.break_days, 'grace_days', new.result_finalization_grace_days)));
  end if;
  return new;
end;
$$;

drop trigger if exists academic_years_audit_changes on public.academic_years;
create trigger academic_years_audit_changes
  after insert or update on public.academic_years
  for each row
  execute function public.academic_years_audit_changes();

-- The current year / closure can change only through set_current_academic_year() (it sets a
-- transaction-local flag). A signed-in user updating is_current / closed_at directly is refused, and so is
-- editing the calendar of a CLOSED year (it is read-only history: reopen it first); a backend / SQL-editor
-- session (no auth.uid()) is unaffected, so owner-run repair scripts still work.
create or replace function public.academic_years_lifecycle_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null
     and (new.is_current is distinct from old.is_current or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by)
     and coalesce(current_setting('app.year_switch', true), '') <> 'on' then
    raise exception 'The current academic year can only be changed with set_current_academic_year() (Academic Years > Make Current).';
  end if;
  if auth.uid() is not null and old.closed_at is not null and not old.is_current
     and coalesce(current_setting('app.year_switch', true), '') <> 'on'
     and (new.year_start is distinct from old.year_start or new.year_end is distinct from old.year_end
          or new.sem1_start is distinct from old.sem1_start or new.sem1_end is distinct from old.sem1_end
          or new.sem2_start is distinct from old.sem2_start or new.sem2_end is distinct from old.sem2_end
          or new.break_days is distinct from old.break_days
          or new.result_finalization_grace_days is distinct from old.result_finalization_grace_days) then
    raise exception 'This academic year is closed (read-only): its calendar cannot be changed. An owner can reopen it from Academic Years.';
  end if;
  return new;
end;
$$;

drop trigger if exists academic_years_lifecycle_guard on public.academic_years;
create trigger academic_years_lifecycle_guard
  before update on public.academic_years
  for each row
  execute function public.academic_years_lifecycle_guard();

-- =====================================================================
-- 4. Missing current-year enrollments (insert-only backfill)
-- =====================================================================
-- Fee materialization now bills only students ENROLLED in the schedule's year (section 6). Every code
-- path in the app already writes the current year's enrollment row whenever a student is created or
-- edited; this covers any active student who somehow lacks one, so nobody silently drops out of billing.
insert into public.enrollments (student_id, academic_year_id, grade, section, class_id, status, suspension, enrollment_date)
select s.id, y.id, s.grade, s.section, s.class_id, s.status, s.suspension, coalesce(s.admission_date, y.year_start)
from public.students s
cross join public.academic_years y
where y.is_current
  and s.status in ('ACTIVE', 'ABSENT', 'SUSPENDED')
  and not exists (select 1 from public.enrollments e where e.student_id = s.id and e.academic_year_id = y.id)
on conflict (student_id, academic_year_id) do nothing;

-- =====================================================================
-- 5. Roster sync, registration, not-returning, and the atomic year switch
-- =====================================================================

-- Makes the students table's "current" columns (grade / section / class / status) mirror one year's
-- enrollments: enrolled students take that enrollment's values; an active student with NO enrollment in
-- the year is archived (they are not on that year's roll). It is a pure function of the enrollments, so
-- switching years back and forth is lossless. Internal: called only by set_current_academic_year.
create or replace function public.sync_students_to_academic_year(p_year_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_synced   integer;
  v_archived integer;
begin
  with want as (
    select e.student_id, e.grade, e.section, e.status, e.suspension,
           coalesce(e.class_id, (select c.id from public.classes c where c.grade = e.grade and c.section = e.section limit 1)) as class_id
    from public.enrollments e
    where e.academic_year_id = p_year_id
  ), upd as (
    update public.students s
       set grade = w.grade, section = w.section, status = w.status, suspension = w.suspension,
           class_id = w.class_id      -- NULL when that grade/section has no class: never keep last year's class
      from want w
     where w.student_id = s.id
       and (s.grade, s.section, s.status, s.suspension, s.class_id)
           is distinct from (w.grade, w.section, w.status, w.suspension, w.class_id)
    returning s.id
  )
  select count(*) into v_synced from upd;

  with arch as (
    update public.students s
       set status = 'ARCHIVED'
     where s.status in ('ACTIVE', 'ABSENT', 'SUSPENDED')
       and not exists (select 1 from public.enrollments e where e.student_id = s.id and e.academic_year_id = p_year_id)
    returning s.id
  )
  select count(*) into v_archived from arch;

  return jsonb_build_object('synced', v_synced, 'archived', v_archived);
end;
$$;
revoke all on function public.sync_students_to_academic_year(uuid) from public, anon, authenticated;

create or replace function public.register_student_for_year(
  p_student_id uuid,
  p_year_id    uuid,
  p_grade      text,
  p_section    text default ''
)
returns public.enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year    public.academic_years;
  v_student public.students;
  v_class   uuid;
  v_row     public.enrollments;
  v_section text := coalesce(p_section, '');
begin
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may register students for an academic year';
  end if;
  if coalesce(btrim(p_grade), '') = '' then
    raise exception 'Choose a grade to register the student in';
  end if;

  select * into v_year from public.academic_years where id = p_year_id;
  if v_year.id is null then raise exception 'Academic year % not found', p_year_id; end if;
  perform public.assert_academic_year_writable(p_year_id, 'Student registration');

  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then raise exception 'Student % not found', p_student_id; end if;

  select c.id into v_class from public.classes c where c.grade = p_grade and c.section = v_section limit 1;

  -- They are coming back: any earlier "not returning" decision for this year no longer stands.
  delete from public.student_year_decisions where student_id = p_student_id and academic_year_id = p_year_id;

  insert into public.enrollments (student_id, academic_year_id, grade, section, class_id, status, suspension, enrollment_date)
  values (p_student_id, p_year_id, p_grade, v_section, v_class, 'ACTIVE', null, greatest(current_date, v_year.year_start))
  on conflict (student_id, academic_year_id) do update
    set grade = excluded.grade, section = excluded.section, class_id = excluded.class_id, status = 'ACTIVE', suspension = null
  returning * into v_row;

  -- Registering into the operational year also moves the student onto that year's roll right away; an
  -- upcoming year is only recorded (the roster follows when that year is activated).
  if v_year.is_current then
    update public.students
       set grade = p_grade, section = v_section, class_id = v_class, status = 'ACTIVE', suspension = null
     where id = p_student_id;
  end if;

  -- Fees: bill from the month they join (a mid-year joiner is not billed the months before).
  perform public.materialize_obligations_for_student(
    p_student_id, p_year_id, date_trunc('month', greatest(current_date, v_year.year_start))::date, 'ENROLLMENT');

  return v_row;
end;
$$;

create or replace function public.mark_student_not_returning(
  p_student_id uuid,
  p_year_id    uuid,
  p_reason     text default null
)
returns public.student_year_decisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year public.academic_years;
  v_row  public.student_year_decisions;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may record that a student is not returning';
  end if;
  select * into v_year from public.academic_years where id = p_year_id;
  if v_year.id is null then raise exception 'Academic year % not found', p_year_id; end if;
  perform public.assert_academic_year_writable(p_year_id, 'A re-enrollment decision');
  if v_year.is_current then
    raise exception 'This year is already running. Use the student''s status (withdrawn / transferred / archived) instead of "not returning".';
  end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'Student % not found', p_student_id;
  end if;
  if exists (select 1 from public.enrollments where student_id = p_student_id and academic_year_id = p_year_id) then
    raise exception 'This student is already registered for the year. Their enrollment is kept; change their status instead.';
  end if;

  insert into public.student_year_decisions (student_id, academic_year_id, decision, reason, decided_by)
  values (p_student_id, p_year_id, 'NOT_RETURNING', nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (student_id, academic_year_id) do update
    set decision = 'NOT_RETURNING', reason = excluded.reason, decided_by = auth.uid(), decided_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- THE way to change the operational year. One atomic, audited action:
--   * exactly one year ends up current (the partial unique index would refuse two);
--   * the outgoing year is closed (read-only history) — nothing of it is deleted or hidden;
--   * activating an UPCOMING year first requires every student who is on the roll to be registered
--     or marked not-returning (unless p_allow_undecided: then they are recorded as not returning);
--   * switching to a CLOSED year is an exceptional reopening: it needs a reason and is audited;
--   * the student roster (grade / class / status) follows the activated year's enrollments.
create or replace function public.set_current_academic_year(
  p_year_id         uuid,
  p_reason          text default null,
  p_allow_undecided boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target    public.academic_years;
  v_old       public.academic_years;
  v_reopen    boolean;
  v_undecided integer := 0;
  v_sync      jsonb;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may change the current academic year';
  end if;

  select * into v_target from public.academic_years where id = p_year_id for update;
  if v_target.id is null then raise exception 'Academic year % not found', p_year_id; end if;
  if v_target.is_current then
    return jsonb_build_object('changed', false);
  end if;
  if v_target.year_end - v_target.year_start > 400 then
    raise exception 'This academic year''s dates cover more than one school year (% to %). Correct them before making it current.', v_target.year_start, v_target.year_end;
  end if;

  select * into v_old from public.academic_years where is_current for update;
  v_reopen := v_target.closed_at is not null;

  if v_reopen and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Reopening a closed academic year needs a reason.';
  end if;

  if not v_reopen and v_old.id is not null then
    -- Every student on the outgoing roll needs a decision for the incoming year.
    select count(*) into v_undecided
    from public.students s
    where s.status in ('ACTIVE', 'ABSENT', 'SUSPENDED')
      and not exists (select 1 from public.enrollments e where e.student_id = s.id and e.academic_year_id = p_year_id)
      and not exists (select 1 from public.student_year_decisions d where d.student_id = s.id and d.academic_year_id = p_year_id);
    if v_undecided > 0 and not coalesce(p_allow_undecided, false) then
      raise exception '% student(s) have no decision for this year yet. Register them or mark them "not returning" first.', v_undecided;
    end if;
    if v_undecided > 0 then
      insert into public.student_year_decisions (student_id, academic_year_id, decision, reason, decided_by)
      select s.id, p_year_id, 'NOT_RETURNING', 'No decision recorded when the year was activated', auth.uid()
      from public.students s
      where s.status in ('ACTIVE', 'ABSENT', 'SUSPENDED')
        and not exists (select 1 from public.enrollments e where e.student_id = s.id and e.academic_year_id = p_year_id)
        and not exists (select 1 from public.student_year_decisions d where d.student_id = s.id and d.academic_year_id = p_year_id)
      on conflict (student_id, academic_year_id) do nothing;
    end if;
  end if;

  perform set_config('app.year_switch', 'on', true);
  if v_old.id is not null then
    -- The outgoing year keeps who taught what (refreshed if it is closed a second time).
    insert into public.academic_year_teacher_assignments (academic_year_id, teacher_id, teacher_name, subject_id, class_id)
    select v_old.id, ta.teacher_id, p.full_name, ta.subject_id, ta.class_id
    from public.teacher_assignments ta
    left join public.profiles p on p.id = ta.teacher_id
    on conflict (academic_year_id, class_id, subject_id) where class_id is not null and subject_id is not null
      do update set teacher_id = excluded.teacher_id, teacher_name = excluded.teacher_name, snapshot_at = now();
    update public.academic_years
       set is_current = false, closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, auth.uid())
     where id = v_old.id;
  end if;
  update public.academic_years
     set is_current = true, closed_at = null, closed_by = null
   where id = p_year_id;
  perform set_config('app.year_switch', 'off', true);

  v_sync := public.sync_students_to_academic_year(p_year_id);

  perform public.write_academic_year_audit(
    p_year_id, case when v_reopen then 'REOPENED' else 'ACTIVATED' end, nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('previous_year_id', v_old.id, 'undecided_recorded', v_undecided) || v_sync);

  return jsonb_build_object('changed', true, 'reopened', v_reopen, 'undecided_recorded', v_undecided) || v_sync;
end;
$$;

revoke all on function public.register_student_for_year(uuid, uuid, text, text) from public, anon;
grant execute on function public.register_student_for_year(uuid, uuid, text, text) to authenticated;
revoke all on function public.mark_student_not_returning(uuid, uuid, text) from public, anon;
grant execute on function public.mark_student_not_returning(uuid, uuid, text) to authenticated;
revoke all on function public.set_current_academic_year(uuid, text, boolean) from public, anon;
grant execute on function public.set_current_academic_year(uuid, text, boolean) to authenticated;

-- =====================================================================
-- 6. Fee obligations only for students enrolled in the schedule's year
-- =====================================================================
-- (Bodies carried over from 20260908030000_blocker7_fee_grade_eligibility.sql plus the enrollment
-- requirement: a student with no enrollment for the year -- e.g. "not returning" -- is never billed.)

create or replace function public.materialize_obligations_for_schedule(
  p_fee_schedule_id uuid,
  p_anchor_date     date default null,
  p_reason          public.fee_obligation_reason default 'YEAR_ROLLOUT'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule    public.fee_schedules;
  v_category    text;
  v_created     integer := 0;
begin
  if not (public.is_owner() or public.is_admin() or public.is_finance()) then
    raise exception 'Only the Owner, Educational Director or Finance & Operations Director may materialize fee obligations';
  end if;

  select * into v_schedule from public.fee_schedules where id = p_fee_schedule_id;
  if v_schedule.id is null then
    raise exception 'Fee schedule % not found', p_fee_schedule_id;
  end if;

  select category into v_category from public.fee_types where id = v_schedule.fee_type_id;

  with target_students as (
    select s.id
    from public.students s
    join public.enrollments en on en.student_id = s.id and en.academic_year_id = v_schedule.academic_year_id
    where en.status not in ('TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'ARCHIVED')
      and s.status not in ('TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'ARCHIVED')
      and (v_category <> 'TRANSPORT' or s.uses_bus)
      and (
        v_schedule.applicable_grades is null
        or public.student_grade_for_year(s.id, v_schedule.academic_year_id) = any (v_schedule.applicable_grades)
      )
  ),
  target_installments as (
    select fi.id, fi.amount
    from public.fee_installments fi
    where fi.fee_schedule_id = p_fee_schedule_id
      and (p_anchor_date is null or fi.due_date >= p_anchor_date)
  ),
  ins as (
    insert into public.student_fee_obligations
      (student_id, fee_installment_id, amount_due, created_reason)
    select ts.id, ti.id, ti.amount, p_reason
    from target_students ts
    cross join target_installments ti
    on conflict (student_id, fee_installment_id) do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  return v_created;
end;
$$;

create or replace function public.materialize_obligations_for_student(
  p_student_id        uuid,
  p_academic_year_id  uuid,
  p_anchor_date       date default null,
  p_reason            public.fee_obligation_reason default 'ENROLLMENT'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uses_bus  boolean;
  v_status    public.student_status;
  v_grade     text;
  v_created   integer := 0;
begin
  if not (public.is_owner() or public.is_admin() or public.is_finance()) then
    raise exception 'Only the Owner, Educational Director or Finance & Operations Director may materialize fee obligations';
  end if;

  select uses_bus, status into v_uses_bus, v_status
  from public.students where id = p_student_id;
  if not found then
    raise exception 'Student % not found', p_student_id;
  end if;

  -- Not on this year's roll (no enrollment, or one that has ended) -> nothing to bill.
  if not exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.academic_year_id = p_academic_year_id
      and e.status not in ('TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'ARCHIVED')
  ) then
    return 0;
  end if;

  v_grade := public.student_grade_for_year(p_student_id, p_academic_year_id);

  with target_installments as (
    select fi.id, fi.amount
    from public.fee_installments fi
    join public.fee_schedules fs on fs.id = fi.fee_schedule_id
    join public.fee_types ft on ft.id = fs.fee_type_id
    where fs.academic_year_id = p_academic_year_id
      and ft.archived_at is null
      and (ft.category <> 'TRANSPORT' or coalesce(v_uses_bus, false))
      and (fs.applicable_grades is null or v_grade = any (fs.applicable_grades))
      and (p_anchor_date is null or fi.due_date >= p_anchor_date)
  ),
  ins as (
    insert into public.student_fee_obligations
      (student_id, fee_installment_id, amount_due, created_reason)
    select p_student_id, ti.id, ti.amount, p_reason
    from target_installments ti
    on conflict (student_id, fee_installment_id) do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  return v_created;
end;
$$;

-- =====================================================================
-- 7. Read-only years: write guards (and immutable academic_year_id)
-- =====================================================================

create or replace function public.guard_year_scoped_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_what text := case tg_table_name
    when 'enrollments' then 'Enrollments'
    when 'results' then 'Results'
    when 'fee_schedules' then 'Fee schedules'
    else tg_table_name end;
begin
  if tg_op = 'UPDATE' and new.academic_year_id is distinct from old.academic_year_id then
    raise exception 'The academic year of a % record cannot be changed.', lower(v_what);
  end if;
  perform public.assert_academic_year_writable(new.academic_year_id, v_what);
  return new;
end;
$$;

drop trigger if exists enrollments_year_guard on public.enrollments;
create trigger enrollments_year_guard before insert or update on public.enrollments
  for each row execute function public.guard_year_scoped_row();
drop trigger if exists results_year_guard on public.results;
create trigger results_year_guard before insert or update on public.results
  for each row execute function public.guard_year_scoped_row();
drop trigger if exists fee_schedules_year_guard on public.fee_schedules;
create trigger fee_schedules_year_guard before insert or update on public.fee_schedules
  for each row execute function public.guard_year_scoped_row();

-- A component score belongs to a result, so it is as read-only as the result's year.
create or replace function public.guard_result_component_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
begin
  select academic_year_id into v_year from public.results where id = new.result_id;
  if v_year is not null then
    perform public.assert_academic_year_writable(v_year, 'Results');
  end if;
  return new;
end;
$$;
drop trigger if exists result_components_year_guard on public.result_components;
create trigger result_components_year_guard before insert or update on public.result_components
  for each row execute function public.guard_result_component_year();

-- Installments and obligations belong to a schedule's year; allocations and adjustments to an
-- obligation's. Money can be recorded into a closed year only by the reasoned, audited owner
-- adjustments below (they set app.historical_adjustment for the duration of one transaction).
create or replace function public.guard_fee_ledger_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
  v_what text;
begin
  if tg_table_name = 'fee_installments' then
    select academic_year_id into v_year from public.fee_schedules where id = (to_jsonb(new) ->> 'fee_schedule_id')::uuid;
    v_what := 'Fee installments';
  elsif tg_table_name = 'student_fee_obligations' then
    select fs.academic_year_id into v_year
      from public.fee_installments fi join public.fee_schedules fs on fs.id = fi.fee_schedule_id
     where fi.id = (to_jsonb(new) ->> 'fee_installment_id')::uuid;
    v_what := 'Fee obligations';
  else
    select fs.academic_year_id into v_year
      from public.student_fee_obligations o
      join public.fee_installments fi on fi.id = o.fee_installment_id
      join public.fee_schedules fs on fs.id = fi.fee_schedule_id
     where o.id = (to_jsonb(new) ->> 'obligation_id')::uuid;
    v_what := case tg_table_name when 'payment_allocations' then 'Payments' else 'Fee adjustments' end;
  end if;
  if v_year is not null
     and not public.academic_year_is_writable(v_year)
     and coalesce(current_setting('app.historical_adjustment', true), '') <> 'on' then
    perform public.assert_academic_year_writable(v_year, v_what);
  end if;
  return new;
end;
$$;

drop trigger if exists fee_installments_year_guard on public.fee_installments;
create trigger fee_installments_year_guard before insert on public.fee_installments
  for each row execute function public.guard_fee_ledger_year();
drop trigger if exists student_fee_obligations_year_guard on public.student_fee_obligations;
create trigger student_fee_obligations_year_guard before insert on public.student_fee_obligations
  for each row execute function public.guard_fee_ledger_year();
drop trigger if exists payment_allocations_year_guard on public.payment_allocations;
create trigger payment_allocations_year_guard before insert on public.payment_allocations
  for each row execute function public.guard_fee_ledger_year();
drop trigger if exists fee_obligation_adjustments_year_guard on public.fee_obligation_adjustments;
create trigger fee_obligation_adjustments_year_guard before insert on public.fee_obligation_adjustments
  for each row execute function public.guard_fee_ledger_year();

-- =====================================================================
-- 8. Payroll periods: inside an academic year, inside the person's employment
-- =====================================================================

create or replace function public.guard_payroll_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month  text := coalesce(to_jsonb(new) ->> 'month', to_jsonb(new) ->> 'payroll_month');
  v_anchor date;
  v_year   public.academic_years;
  v_staff  public.staff;
begin
  v_anchor := (v_month || '-01')::date;

  select y.* into v_year
    from public.academic_years y
   where v_anchor in (select b from public.academic_year_billing_months(y.year_start, y.year_end) b)
   order by y.is_current desc, y.year_start desc
   limit 1;
  if v_year.id is null then
    raise exception 'Payroll month % is not part of any academic year. Payroll periods come from an academic year''s own months.', v_month;
  end if;

  select * into v_staff from public.staff where id = new.staff_id;
  if v_staff.id is not null then
    if v_anchor < date_trunc('month', v_staff.employment_date)::date then
      raise exception '% joined on %, so payroll for % is not applicable (payroll starts from their first month).', v_staff.name, v_staff.employment_date, v_month;
    end if;
    if v_staff.employment_end_date is not null and v_anchor > date_trunc('month', v_staff.employment_end_date)::date then
      raise exception '%''s employment ended on %, so payroll for % is not applicable.', v_staff.name, v_staff.employment_end_date, v_month;
    end if;
  end if;

  if not public.academic_year_is_writable(v_year.id)
     and coalesce(current_setting('app.historical_adjustment', true), '') <> 'on' then
    perform public.assert_academic_year_writable(v_year.id, 'Payroll');
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_payments_period_guard on public.payroll_payments;
create trigger payroll_payments_period_guard before insert on public.payroll_payments
  for each row execute function public.guard_payroll_period();
drop trigger if exists salary_advances_period_guard on public.salary_advances;
create trigger salary_advances_period_guard before insert on public.salary_advances
  for each row execute function public.guard_payroll_period();

-- =====================================================================
-- 9. Historical adjustments (owner only, reasoned, audited)
-- =====================================================================

create or replace function public.record_historical_payment_batch(
  p_lines       jsonb,
  p_method_name text,
  p_date        date,
  p_note        text,
  p_recorded_by uuid,
  p_reason      text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  if not public.is_owner() then
    raise exception 'Only the Owner may record a payment into a closed academic year';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to record a payment into a closed academic year.';
  end if;
  perform set_config('app.historical_adjustment', 'on', true);
  v_payment := public.record_payment_batch(p_lines, p_method_name, p_date, p_note, p_recorded_by);
  perform set_config('app.historical_adjustment', 'off', true);
  perform public.write_academic_year_audit(null, 'HISTORICAL_PAYMENT', btrim(p_reason),
    jsonb_build_object('payment_id', v_payment.id, 'receipt_no', v_payment.receipt_no, 'amount', v_payment.amount_total));
  return v_payment;
end;
$$;

create or replace function public.record_historical_payroll_payment(
  p_staff_id        uuid,
  p_amount          numeric,
  p_method          text,
  p_month           text,
  p_date            date,
  p_note            text,
  p_allowances      numeric,
  p_deductions      numeric,
  p_recorded_by     uuid,
  p_reason          text
)
returns public.payroll_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payments;
begin
  if not public.is_owner() then
    raise exception 'Only the Owner may record payroll into a closed academic year';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to record payroll into a closed academic year.';
  end if;
  perform set_config('app.historical_adjustment', 'on', true);
  v_row := public.record_payroll_payment(p_staff_id, p_amount, p_method, p_month, p_date, p_note, p_allowances, p_deductions, 0, p_recorded_by);
  perform set_config('app.historical_adjustment', 'off', true);
  perform public.write_academic_year_audit(null, 'HISTORICAL_PAYROLL', btrim(p_reason),
    jsonb_build_object('payroll_payment_id', v_row.id, 'staff_id', p_staff_id, 'month', p_month, 'amount', p_amount));
  return v_row;
end;
$$;

revoke all on function public.record_historical_payment_batch(jsonb, text, date, text, uuid, text) from public, anon;
grant execute on function public.record_historical_payment_batch(jsonb, text, date, text, uuid, text) to authenticated;
revoke all on function public.record_historical_payroll_payment(uuid, numeric, text, text, date, text, numeric, numeric, uuid, text) from public, anon;
grant execute on function public.record_historical_payroll_payment(uuid, numeric, text, text, date, text, numeric, numeric, uuid, text) to authenticated;
