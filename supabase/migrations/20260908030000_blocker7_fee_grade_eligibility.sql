-- BLOCKER 7 — grade-specific school-fee eligibility.
--
-- PROBLEM: fee_schedules has no grade-eligibility data. Obligation materialization
-- (materialize_obligations_for_schedule / _for_student) creates a row for EVERY active student for a
-- TUITION schedule, and the read side offers every rolled-out fee type to every student. A Grade 9
-- student is therefore billed the 9-10 fee + the Grade-11 fee + the Grade-12 fee at once. The three
-- "school fees" are three separate fee_types (fee_schedules_unique is per fee_type+year), each fully
-- rolled out for the current academic year.
--
-- FIX: fee_schedules.applicable_grades text[]  -- NULL = every grade (legacy default, and the norm
--   for TRANSPORT / bus, whose eligibility is uses_bus only). Non-NULL = only students whose
--   enrolment grade for THIS schedule's academic year is in the list.
--   * materialize_obligations_for_schedule / _for_student honour it.
--   * record_payment_batch re-validates it server-side (a client cannot post a Grade-9 student
--     against a Grade-11 installment).
--   * set_fee_schedule_applicable_grades(schedule, grades[]) lets Owner/Finance change the grade set
--     after rollout (adds newly-eligible obligations, drops now-ineligible ones that carry no money).
--
-- Additive, idempotent, transactional. Mirrors the billed_months pattern
-- (20260908000000 / 20260908010000). Grades are the canonical GRADES strings ("Grade 9", ...),
-- matched to students.grade / enrollments.grade by exact equality.

-- ---------------------------------------------------------------------------------------
-- 1. applicable_grades column + normalise trigger
-- ---------------------------------------------------------------------------------------
alter table public.fee_schedules
  add column if not exists applicable_grades text[];

comment on column public.fee_schedules.applicable_grades is
  'BLOCKER 7: the grades this school (TUITION) fee is billed to within its academic year. NULL = every
   grade (legacy behaviour, and the norm for TRANSPORT/bus fees whose eligibility is uses_bus only).
   Non-NULL => only students whose enrolment grade for this schedule''s academic year is in the list.
   Elements are the canonical grade strings ("Grade 9", ...). Enforced by
   materialize_obligations_for_schedule/_for_student and re-validated in record_payment_batch.';

create or replace function public.fee_schedules_normalise_applicable_grades()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.applicable_grades is not null then
    select case when count(*) = 0 then null else array_agg(distinct g order by g) end
      into new.applicable_grades
    from (
      select trim(g) as g
      from unnest(new.applicable_grades) g
      where g is not null and length(trim(g)) > 0
    ) s;
  end if;
  return new;
end;
$$;

drop trigger if exists fee_schedules_normalise_applicable_grades on public.fee_schedules;
create trigger fee_schedules_normalise_applicable_grades
  before insert or update of applicable_grades on public.fee_schedules
  for each row
  execute function public.fee_schedules_normalise_applicable_grades();

-- ---------------------------------------------------------------------------------------
-- 2. helper: a student's grade for one academic year (enrolment first, denormalised fallback)
-- ---------------------------------------------------------------------------------------
create or replace function public.student_grade_for_year(p_student_id uuid, p_academic_year_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select e.grade from public.enrollments e
      where e.student_id = p_student_id and e.academic_year_id = p_academic_year_id
      limit 1),
    (select s.grade from public.students s where s.id = p_student_id)
  );
$$;

-- ---------------------------------------------------------------------------------------
-- 3. materialize_obligations_for_schedule — same signature, now grade-aware
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

-- ---------------------------------------------------------------------------------------
-- 5. record_payment_batch — same signature; adds the server-side grade-eligibility guard.
--    (Body carried over verbatim from 20260825190000_rls_policies.sql plus the grade check.)
-- ---------------------------------------------------------------------------------------
create or replace function public.record_payment_batch(
  p_lines jsonb,
  p_method_name text,
  p_date date,
  p_note text,
  p_recorded_by uuid
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_obligation_id uuid;
  v_requested numeric;
  v_net_owed numeric;
  v_applied numeric;
  v_total numeric := 0;
  v_method_id uuid;
  v_payment public.payments;
  v_student_id uuid;
  v_sched public.fee_schedules;
  v_grade text;
  v_student_name text;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record payments';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'recorded_by must match the authenticated caller';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'record_payment_batch requires at least one line';
  end if;

  select id into v_method_id from public.payment_methods where name = p_method_name;
  if v_method_id is null then
    insert into public.payment_methods (name) values (p_method_name)
      returning id into v_method_id;
  end if;

  insert into public.payments (receipt_no, payment_method_id, amount_total, date, note, recorded_by)
    values (
      lpad(nextval('public.receipt_no_seq')::text, 4, '0'),
      v_method_id, 0, p_date, p_note, p_recorded_by
    )
    returning * into v_payment;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_requested := (v_line ->> 'amount')::numeric;
    if v_requested is null or v_requested <= 0 then
      continue;
    end if;

    v_student_id := (v_line ->> 'student_id')::uuid;

    select o.id into v_obligation_id
      from public.student_fee_obligations o
      where o.student_id = v_student_id
        and o.fee_installment_id = (v_line ->> 'installment_id')::uuid
      for update;

    if v_obligation_id is null then
      continue;
    end if;

    -- BLOCKER 7: the installment's schedule must actually apply to this student's grade for that
    -- schedule's academic year. A schedule with a NULL applicable_grades applies to every grade.
    select fs.* into v_sched
      from public.fee_installments fi
      join public.fee_schedules fs on fs.id = fi.fee_schedule_id
      where fi.id = (v_line ->> 'installment_id')::uuid;

    if v_sched.id is not null and v_sched.applicable_grades is not null then
      v_grade := public.student_grade_for_year(v_student_id, v_sched.academic_year_id);
      if v_grade is null or not (v_grade = any (v_sched.applicable_grades)) then
        select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into v_student_name
          from public.students where id = v_student_id;
        raise exception 'This fee does not apply to %''s grade (%). It is billed only to: %',
          coalesce(nullif(v_student_name, ''), 'this student'),
          coalesce(v_grade, 'unknown'),
          array_to_string(v_sched.applicable_grades, ', ');
      end if;
    end if;

    v_net_owed := public.net_owed_for_obligation(v_obligation_id);
    v_applied := least(v_requested, v_net_owed);
    if v_applied <= 0 then
      continue;
    end if;

    insert into public.payment_allocations (payment_id, obligation_id, amount)
      values (v_payment.id, v_obligation_id, v_applied);

    v_total := v_total + v_applied;
  end loop;

  if v_total <= 0 then
    raise exception 'No payable lines: every line was skipped (no matching obligation, non-positive amount, or nothing owed)';
  end if;

  update public.payments set amount_total = v_total where id = v_payment.id
    returning * into v_payment;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. set_fee_schedule_applicable_grades — change the grade set of a rolled-out school fee.
--    Mirrors set_fee_schedule_billed_months: transactional, idempotent, Owner/Finance only.
-- ---------------------------------------------------------------------------------------
create or replace function public.set_fee_schedule_applicable_grades(
  p_fee_schedule_id uuid,
  p_grades          text[]
)
returns public.fee_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule   public.fee_schedules;
  v_year       public.academic_years;
  v_target     text[];
  v_blocked    integer;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may change a fee''s applicable grades';
  end if;

  select * into v_schedule from public.fee_schedules where id = p_fee_schedule_id for update;
  if v_schedule.id is null then
    raise exception 'Fee schedule % not found', p_fee_schedule_id;
  end if;

  select * into v_year from public.academic_years where id = v_schedule.academic_year_id;
  if v_year.id is null then
    raise exception 'The academic year for this fee schedule no longer exists';
  end if;

  select case when count(*) = 0 then null else array_agg(distinct g order by g) end
    into v_target
  from (
    select trim(g) as g from unnest(coalesce(p_grades, '{}'::text[])) g
    where g is not null and length(trim(g)) > 0
  ) s;

  if v_target is null then
    raise exception 'Select at least one grade for this fee';
  end if;

  -- Drop obligations for students no longer eligible under the new grade set, but only when no
  -- non-voided payment allocation and no adjustment is tied to them. A month with real money
  -- recorded against it blocks the whole change (the caller must void those first).
  select count(*) into v_blocked
  from public.student_fee_obligations o
  join public.fee_installments fi on fi.id = o.fee_installment_id
  where fi.fee_schedule_id = p_fee_schedule_id
    and public.student_grade_for_year(o.student_id, v_schedule.academic_year_id) <> all (v_target)
    and (
      exists (
        select 1 from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id
        where pa.obligation_id = o.id and p.status <> 'VOIDED'
      )
      or exists (select 1 from public.fee_obligation_adjustments a where a.obligation_id = o.id)
    );

  if v_blocked > 0 then
    raise exception 'Cannot narrow the grades: % obligation(s) for now-excluded students already have a payment or adjustment. Void those first.', v_blocked;
  end if;

  delete from public.student_fee_obligations o
  using public.fee_installments fi
  where o.fee_installment_id = fi.id
    and fi.fee_schedule_id = p_fee_schedule_id
    and public.student_grade_for_year(o.student_id, v_schedule.academic_year_id) <> all (v_target);

  update public.fee_schedules set applicable_grades = v_target where id = p_fee_schedule_id;

  -- Add obligations for students newly eligible under the widened grade set.
  perform public.materialize_obligations_for_schedule(
    p_fee_schedule_id,
    date_trunc('month', coalesce(v_year.year_start, current_date))::date,
    'YEAR_ROLLOUT'
  );

  select * into v_schedule from public.fee_schedules where id = p_fee_schedule_id;
  return v_schedule;
end;
$$;

comment on function public.set_fee_schedule_applicable_grades is
  'BLOCKER 7: Owner/Finance change which grades a rolled-out school fee is billed to. Widening adds
   obligations for newly-eligible students; narrowing deletes obligations for now-excluded students
   only when no non-voided payment / adjustment exists for them (otherwise raises and rolls back).';

revoke all on function public.student_grade_for_year(uuid, uuid) from public;
grant execute on function public.student_grade_for_year(uuid, uuid) to authenticated;
revoke all on function public.set_fee_schedule_applicable_grades(uuid, text[]) from public;
grant execute on function public.set_fee_schedule_applicable_grades(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. One-time data fix for the live database (idempotent).
--    Backfill applicable_grades by schedule id (an intentional one-time mapping — NOT runtime
--    name parsing), then delete obligations that were materialised for the wrong grade and carry
--    no payment allocation and no adjustment.
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_g9_10 text[] := array['Grade 9', 'Grade 10'];
begin
  -- 9-10 Fee (active, 3000) and the archived 9-10 School Fee (2000): grades 9 & 10.
  update public.fee_schedules set applicable_grades = v_g9_10
    where id in ('2b88840d-83ba-4ebc-9b33-e3e6036b997f', '00bb6e4f-511b-4ea7-8b76-c768d60a4fee')
      and applicable_grades is null;

  -- Grade-11 fee (4000): grade 11 only.
  update public.fee_schedules set applicable_grades = array['Grade 11']
    where id = 'e85e3715-03f2-4b34-85e8-0f115289471b' and applicable_grades is null;

  -- Grade-12 fee (5000): grade 12 only.
  update public.fee_schedules set applicable_grades = array['Grade 12']
    where id = '11700656-2097-469b-aaf9-df2604ee66af' and applicable_grades is null;

  -- Bus fee schedule (be795c66) intentionally left NULL — bus eligibility is uses_bus only.
end $$;

delete from public.student_fee_obligations o
using public.fee_installments fi, public.fee_schedules fs
where o.fee_installment_id = fi.id
  and fi.fee_schedule_id = fs.id
  and fs.applicable_grades is not null
  and coalesce(
    (select e.grade from public.enrollments e
      where e.student_id = o.student_id and e.academic_year_id = fs.academic_year_id limit 1),
    (select s.grade from public.students s where s.id = o.student_id)
  ) <> all (fs.applicable_grades)
  and not exists (select 1 from public.payment_allocations pa where pa.obligation_id = o.id)
  and not exists (select 1 from public.fee_obligation_adjustments a where a.obligation_id = o.id);
