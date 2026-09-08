-- BLOCKER 6 — configurable billed months per fee schedule.
--
-- Spec §11/§12: when the Owner / Finance Director rolls out a school fee (or bus fee) for an
-- academic year they may choose WHICH calendar months of that year the fee applies to, and the
-- system must not silently bill months that were not selected.
--
-- Design:
--   * fee_schedules.billed_months  date[]  -- NULL  => every month of the academic year
--                                             (year_start..year_end), the pre-existing behaviour,
--                                             so every schedule already on the database keeps
--                                             billing exactly as before.
--                                          -- non-NULL => only these month-anchor dates are billed.
--   * generate_monthly_fee_installments() honours it: a month not in a non-NULL billed_months is
--     never turned into a fee_installments row, so no obligation is ever materialised for it.
--
-- Non-destructive & idempotent:
--   * additive nullable column, guarded `if not exists`.
--   * the RPC is `create or replace` with an unchanged signature — callers need no change.
--   * removing a month from billed_months later never deletes an installment a student has
--     already been billed for (student_fee_obligations.fee_installment_id is ON DELETE RESTRICT
--     and this migration adds no delete path); it only stops FUTURE generation of that month.

-- ---------------------------------------------------------------------------------------
-- 1. billed_months column
-- ---------------------------------------------------------------------------------------
alter table public.fee_schedules
  add column if not exists billed_months date[];

comment on column public.fee_schedules.billed_months is
  'BLOCKER 6: the calendar months (1st-of-month anchor dates) this fee is billed for within its
   academic year. NULL = every month of the year (legacy behaviour). generate_monthly_fee_installments
   only creates installments for these months when non-NULL. Every element is expected to be a
   month-start date; a non-anchor date simply never matches a generated month and bills nothing.';

-- Normalise on write so a non-anchor date can never slip in (a CHECK can't hold a subquery, and
-- generate_monthly_fee_installments compares billed_months elements to month-start anchors by
-- exact equality). This trigger truncates each element to its month start.
create or replace function public.fee_schedules_normalise_billed_months()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.billed_months is not null then
    select array_agg(distinct date_trunc('month', m)::date order by date_trunc('month', m)::date)
      into new.billed_months
    from unnest(new.billed_months) m;
  end if;
  return new;
end;
$$;

drop trigger if exists fee_schedules_normalise_billed_months on public.fee_schedules;
create trigger fee_schedules_normalise_billed_months
  before insert or update of billed_months on public.fee_schedules
  for each row
  execute function public.fee_schedules_normalise_billed_months();

-- ---------------------------------------------------------------------------------------
-- 2. generate_monthly_fee_installments — same signature, now month-selection aware.
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

comment on function public.generate_monthly_fee_installments is
  'Owner/Finance only. Generates one fee_installments row per billed calendar month of the
   schedule''s academic year. Honours fee_schedules.billed_months (NULL = every month). Idempotent
   via fee_installments_schedule_period_month_key -- safe to re-run.';

revoke all on function public.generate_monthly_fee_installments(uuid) from public;
grant execute on function public.generate_monthly_fee_installments(uuid) to authenticated;
