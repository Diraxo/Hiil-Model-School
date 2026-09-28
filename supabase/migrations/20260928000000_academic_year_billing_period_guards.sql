-- Academic year -> billing period guards.
--
-- The academic year (academic_years.year_start / year_end) is the single source of truth for a
-- school year's billing periods: fee_schedules, fee_installments, student_fee_obligations and
-- payment_allocations all hang off its id. A year row whose START date was left in the previous
-- school year (e.g. year_start 2025-09-11 with year_end 2027-07-08 and Semester 1 on 2026-09-14) made
-- generate_monthly_fee_installments / the fee month picker produce ~23 months.
--
-- 1. academic_years_validate_span (trigger): one row = one school year. Fires only on INSERT or when a
--    date column is written, so an existing inconsistent row can still be flagged is_current=false /
--    switched away from, and is rejected the moment someone re-saves its dates without fixing them.
-- 2. generate_monthly_fee_installments: refuses to generate from a year longer than ~13 months.
-- 3. set_fee_schedule_billed_months: leaves installments outside the year's dates alone (they are
--    historical records), instead of trying to drop them and being blocked by their payments.
--
-- Additive and idempotent (create or replace / drop trigger if exists). No table or column changes,
-- no data is modified.

create or replace function public.academic_years_validate_span()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.year_end - new.year_start > 400 then
    raise exception 'An academic year can span at most 13 months, but this one runs % days (% to %). Its start date is probably left over from the previous school year.',
      new.year_end - new.year_start, new.year_start, new.year_end;
  end if;
  if new.sem1_start - new.year_start > 92 then
    raise exception 'Semester 1 starts % days after the academic year does (% to %). The academic year should begin at the start of Semester 1.',
      new.sem1_start - new.year_start, new.year_start, new.sem1_start;
  end if;
  return new;
end;
$$;

drop trigger if exists academic_years_validate_span on public.academic_years;
create trigger academic_years_validate_span
  before insert or update of year_start, year_end, sem1_start on public.academic_years
  for each row
  execute function public.academic_years_validate_span();

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

revoke all on function public.generate_monthly_fee_installments(uuid) from public;
grant execute on function public.generate_monthly_fee_installments(uuid) to authenticated;
revoke all on function public.set_fee_schedule_billed_months(uuid, date[]) from public;
grant execute on function public.set_fee_schedule_billed_months(uuid, date[]) to authenticated;
