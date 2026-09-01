-- Phase 4 (Fees / Payments / Expenses), part 2 of 3: transactional server-side rollout.
--
-- Two SECURITY DEFINER RPCs, both Owner/Finance-only and both idempotent, that replace the
-- client-side installment/obligation generation the mock DataContext did:
--
--   generate_monthly_fee_installments(schedule)   -- schedule -> one fee_installments row per
--                                                    calendar month of that schedule's academic
--                                                    year (from year_start..year_end).
--   materialize_obligations_for_schedule(schedule) -- schedule -> one student_fee_obligations row
--                                                    per (applicable active student, installment).
--
-- Idempotency: generate_* relies on the unique index fee_installments_schedule_period_month_key
-- (part 1); materialize_* on the pre-existing UNIQUE(student_id, fee_installment_id). Both use
-- INSERT ... ON CONFLICT DO NOTHING, so a retry / double-click / re-run never duplicates a row
-- or doubles a balance.

-- ---------------------------------------------------------------------------------------
-- generate_monthly_fee_installments
-- ---------------------------------------------------------------------------------------
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

  v_month     := date_trunc('month', v_year.year_start)::date;
  v_end_month := date_trunc('month', v_year.year_end)::date;
  v_idx       := 0;

  -- Spans two calendar years automatically: the loop walks month anchors, it never assumes
  -- Sept..June or a single year.
  while v_month <= v_end_month loop
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

    v_month := (v_month + interval '1 month')::date;
    v_idx   := v_idx + 1;
  end loop;

  return query
    select * from public.fee_installments
    where fee_schedule_id = p_fee_schedule_id
    order by coalesce(period_month, due_date), sequence_index;
end;
$$;

comment on function public.generate_monthly_fee_installments is
  'Owner/Finance only. Generates one fee_installments row per calendar month of the schedule''s
   academic year (year_start..year_end inclusive). Idempotent via
   fee_installments_schedule_period_month_key -- safe to re-run.';

-- ---------------------------------------------------------------------------------------
-- materialize_obligations_for_schedule
-- ---------------------------------------------------------------------------------------
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
  -- Obligation materialization is DERIVED data (amounts come from the frozen
  -- fee_installments.amount, never client input) — so Owner / Educational Director / Finance may
  -- all trigger it. The Educational Director path matters: they can create students
  -- (students_insert = is_owner_or_admin) and a new student must get their fee obligations
  -- immediately, mirroring the old client-side _materializeObligationsForStudent.
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
  'Owner/Finance only. Creates student_fee_obligations for every applicable active student x
   installment of the schedule (TRANSPORT schedules only bill students with uses_bus). Optional
   p_anchor_date restricts to installments due on/after that date (Decision A -- mid-year joiners).
   Idempotent via UNIQUE(student_id, fee_installment_id). Returns the number of rows created.';

-- ---------------------------------------------------------------------------------------
-- materialize_obligations_for_student -- the per-student counterpart, used at enrollment
-- (anchor = admission date) and bus opt-in (anchor = today). Walks every schedule already
-- rolled out for the given academic year.
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
  v_created   integer := 0;
begin
  -- Owner / Educational Director / Finance (see materialize_obligations_for_schedule note).
  if not (public.is_owner() or public.is_admin() or public.is_finance()) then
    raise exception 'Only the Owner, Educational Director or Finance & Operations Director may materialize fee obligations';
  end if;

  select uses_bus, status into v_uses_bus, v_status
  from public.students where id = p_student_id;
  if not found then
    raise exception 'Student % not found', p_student_id;
  end if;

  with target_installments as (
    select fi.id, fi.amount
    from public.fee_installments fi
    join public.fee_schedules fs on fs.id = fi.fee_schedule_id
    join public.fee_types ft on ft.id = fs.fee_type_id
    where fs.academic_year_id = p_academic_year_id
      and ft.archived_at is null
      and (ft.category <> 'TRANSPORT' or coalesce(v_uses_bus, false))
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
  'Owner/Finance only. Per-student obligation materialization across every fee schedule rolled
   out for the academic year. Used at enrollment and bus opt-in. Idempotent. Returns rows created.';

-- ---------------------------------------------------------------------------------------
-- Grants -- EXECUTE defaults to PUBLIC unless revoked (same hardening the RLS migration
-- applied to record_payment_batch / void_payment / add_obligation_adjustment).
-- ---------------------------------------------------------------------------------------
revoke all on function public.generate_monthly_fee_installments(uuid) from public;
revoke all on function public.materialize_obligations_for_schedule(uuid, date, public.fee_obligation_reason) from public;
revoke all on function public.materialize_obligations_for_student(uuid, uuid, date, public.fee_obligation_reason) from public;
grant execute on function public.generate_monthly_fee_installments(uuid) to authenticated;
grant execute on function public.materialize_obligations_for_schedule(uuid, date, public.fee_obligation_reason) to authenticated;
grant execute on function public.materialize_obligations_for_student(uuid, uuid, date, public.fee_obligation_reason) to authenticated;
