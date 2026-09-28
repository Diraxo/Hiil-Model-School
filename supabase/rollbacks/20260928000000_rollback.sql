-- ROLLBACK for 20260928000000_academic_year_billing_period_guards.sql (NOT a migration; it lives in
-- supabase/rollbacks/ so `supabase db push` never runs it). Removes the academic-year span trigger and
-- restores the previous bodies of generate_monthly_fee_installments / set_fee_schedule_billed_months.
-- No data is touched.

drop trigger if exists academic_years_validate_span on public.academic_years;
drop function if exists public.academic_years_validate_span();

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
