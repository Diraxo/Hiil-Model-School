-- BLOCKER 6 §11 / §41: the Owner / Finance Director must be able to CHANGE which months a fee is
-- billed for after it has already been rolled out — not only at rollout time.
--
-- set_fee_schedule_billed_months(schedule, months[]) — SECURITY DEFINER, Owner/Finance only:
--   * ADD months  -> generate the installment (honours billed_months) + materialise obligations
--                    for every currently-applicable active student (anchor = academic-year start,
--                    ON CONFLICT DO NOTHING so re-runs are safe).
--   * DROP months  -> only allowed when NOTHING is at stake for that month: no non-voided payment
--                     allocation and no adjustment against ANY student's obligation for it. Then
--                     the obligations and the installment are deleted. A month with real money
--                     recorded against it can never be silently removed — the RPC raises and rolls
--                     back the whole change.
--
-- Idempotent, transactional, additive. No existing signature changes.

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

comment on function public.set_fee_schedule_billed_months is
  'BLOCKER 6: Owner/Finance change which months a rolled-out fee is billed for. Adds months
   (generate + materialize) and drops months only when no non-voided payment / adjustment exists
   for them. Transactional and idempotent.';

revoke all on function public.set_fee_schedule_billed_months(uuid, date[]) from public;
grant execute on function public.set_fee_schedule_billed_months(uuid, date[]) to authenticated;
