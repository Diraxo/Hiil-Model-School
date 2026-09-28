-- ROLLBACK for 20260929000000_academic_year_central_scope.sql (NOT a migration; it lives in
-- supabase/rollbacks/ so `supabase db push` never runs it).
--
-- Removes the academic-year lifecycle (closed_at / closed_by), the atomic set_current_academic_year and the
-- register / not-returning RPCs, the read-only write guards, the payroll-period guard, the historical
-- adjustment RPCs and the Ethiopian billing-month function, and restores the previous bodies of
-- generate_monthly_fee_installments, set_fee_schedule_billed_months and materialize_obligations_for_*.
--
-- DATA: drops the two tables this migration added (academic_year_audit, student_year_decisions) — export
-- them first if you want to keep the audit / "not returning" history. Nothing in students, enrollments,
-- results, fees, payments, attendance or payroll is deleted or changed. The insert-only enrollment backfill
-- the migration ran is kept (those rows are correct). Any student the roster sync archived stays archived
-- until an admin restores them.

-- triggers
drop trigger if exists academic_years_audit_changes on public.academic_years;
drop trigger if exists academic_years_lifecycle_guard on public.academic_years;
drop trigger if exists enrollments_year_guard on public.enrollments;
drop trigger if exists results_year_guard on public.results;
drop trigger if exists fee_schedules_year_guard on public.fee_schedules;
drop trigger if exists result_components_year_guard on public.result_components;
drop trigger if exists fee_installments_year_guard on public.fee_installments;
drop trigger if exists student_fee_obligations_year_guard on public.student_fee_obligations;
drop trigger if exists payment_allocations_year_guard on public.payment_allocations;
drop trigger if exists fee_obligation_adjustments_year_guard on public.fee_obligation_adjustments;
drop trigger if exists payroll_payments_period_guard on public.payroll_payments;
drop trigger if exists salary_advances_period_guard on public.salary_advances;

-- RPCs and helpers
drop function if exists public.record_historical_payroll_payment(uuid, numeric, text, text, date, text, numeric, numeric, uuid, text);
drop function if exists public.record_historical_payment_batch(jsonb, text, date, text, uuid, text);
drop function if exists public.set_current_academic_year(uuid, text, boolean);
drop function if exists public.mark_student_not_returning(uuid, uuid, text);
drop function if exists public.register_student_for_year(uuid, uuid, text, text);
drop function if exists public.sync_students_to_academic_year(uuid);
drop function if exists public.guard_payroll_period();
drop function if exists public.guard_fee_ledger_year();
drop function if exists public.guard_result_component_year();
drop function if exists public.guard_year_scoped_row();
drop function if exists public.academic_years_lifecycle_guard();
drop function if exists public.academic_years_audit_changes();
drop function if exists public.write_academic_year_audit(uuid, text, text, jsonb);

-- tables added by the migration
drop table if exists public.academic_year_teacher_assignments;
drop table if exists public.student_year_decisions;
drop table if exists public.academic_year_audit;

-- previous fee RPC bodies (they no longer use the Ethiopian billing months)
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
  v_end_month  date;
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

  v_month     := date_trunc('month', v_year.year_start)::date;
  v_end_month := date_trunc('month', v_year.year_end)::date;
  v_idx       := 0;

  -- Spans two calendar years automatically. When billed_months is set, a month outside it is
  -- skipped entirely (no installment, therefore no obligation) -- the sequence_index still
  -- advances so re-runs stay stable and labels/order match the calendar.
  while v_month <= v_end_month loop
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

    v_month := (v_month + interval '1 month')::date;
    v_idx   := v_idx + 1;
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

  -- Normalise the target: month-start, distinct, sorted, and inside the academic year only.
  select coalesce(array_agg(m order by m), '{}')
    into v_target
  from (
    select distinct date_trunc('month', m)::date as m
    from unnest(coalesce(p_months, '{}'::date[])) m
    where date_trunc('month', m)::date
          between date_trunc('month', v_year.year_start)::date
              and date_trunc('month', v_year.year_end)::date
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
      -- Installments OUTSIDE the academic year's current dates (the dates were changed after billing
      -- began) are historical: this RPC only manages the months the year covers, so it never drops
      -- them and their payments/adjustments can never block an unrelated change to the in-year months.
      and fi.period_month between date_trunc('month', v_year.year_start)::date
                              and date_trunc('month', v_year.year_end)::date
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
    where s.status not in ('TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'ARCHIVED')
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

comment on function public.materialize_obligations_for_schedule is
  'Owner/Finance/Ed-Director. Creates student_fee_obligations for every applicable active student x
   installment of the schedule. TRANSPORT schedules only bill students with uses_bus; a schedule with
   a non-NULL applicable_grades only bills students whose enrolment grade for that year is listed.
   Optional p_anchor_date restricts to installments due on/after that date. Idempotent. Returns rows created.';

-- ---------------------------------------------------------------------------------------
-- 4. materialize_obligations_for_student — same signature, now grade-aware
-- ---------------------------------------------------------------------------------------
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

comment on function public.materialize_obligations_for_student is
  'Owner/Finance/Ed-Director. Per-student obligation materialization across every fee schedule rolled
   out for the academic year, skipping TRANSPORT for a non-bus student and any schedule whose
   applicable_grades does not include the student''s grade for that year. Idempotent. Returns rows created.';

revoke all on function public.generate_monthly_fee_installments(uuid) from public;
grant execute on function public.generate_monthly_fee_installments(uuid) to authenticated;
revoke all on function public.set_fee_schedule_billed_months(uuid, date[]) from public;
grant execute on function public.set_fee_schedule_billed_months(uuid, date[]) to authenticated;

-- billing-month helpers, lifecycle helpers and the lifecycle columns
drop function if exists public.academic_year_billing_months(date, date);
drop function if exists public.ethiopian_new_year(integer);
drop function if exists public.assert_academic_year_writable(uuid, text);
drop function if exists public.academic_year_is_writable(uuid);
alter table public.academic_years drop column if exists closed_by;
alter table public.academic_years drop column if exists closed_at;
