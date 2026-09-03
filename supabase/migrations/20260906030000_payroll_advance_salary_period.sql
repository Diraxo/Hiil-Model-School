-- Payroll: a salary advance is money paid against a specific salary period.
--
-- Revised model (supersedes the Blocker 5A "advance_applied recovery" mechanism):
--
--   * A salary advance is real cash paid to the employee, tied to ONE salary month
--     (salary_advances.payroll_month). It reduces that month's remaining obligation
--     directly -- exactly like a direct payroll payment does.
--
--   * A month's paid total  =  SUM(payroll_payments.amount  WHERE month        = M)
--                           +  SUM(salary_advances.amount    WHERE payroll_month = M)
--     remaining  =  greatest(0, salary + allowances - deductions - paid total)   -- never negative
--     status     =  remaining = 0 ? PAID : paid total > 0 ? PARTIAL : UNPAID
--
--   * payroll_payments.advance_applied is retired as a crediting mechanism. New payments
--     always write 0; the column is kept only so historical rows still render. It is no
--     longer added to any month's paid total, so an advance and an "advance applied" can
--     never double-count the same money.
--
-- This is NOT the old creditPool bug (Blocker 5A): that netted an unconsumed advance
-- balance against whichever month happened to be oldest-unpaid. Here an advance only ever
-- touches the ONE month it was explicitly recorded against.
--
-- public.staff_advance_balance(uuid) is left in place but is no longer called by either RPC
-- (there is no floating "advance balance" any more -- every advance is applied to its period).
--
-- Both RPCs keep their existing authorization checks (is_owner_or_finance + recorded_by =
-- auth.uid()) and stay the only write path onto these tables. record_salary_advance gains a
-- p_payroll_month argument (its signature changes, so it is dropped and recreated); it
-- defaults to the month of p_date when null/blank, matching prior behaviour.

-- ---------------------------------------------------------------------
-- record_payroll_payment: cap now subtracts advances recorded for the
-- month, so cash + advances for one period can never exceed its net pay.
-- ---------------------------------------------------------------------

create or replace function public.record_payroll_payment(
  p_staff_id uuid,
  p_amount numeric,
  p_method text,
  p_month text,
  p_date date,
  p_note text,
  p_allowances numeric,
  p_deductions numeric,
  p_advance_applied numeric,   -- retired: ignored, always stored as 0
  p_recorded_by uuid
)
returns public.payroll_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric;
  v_cash_this_month numeric;
  v_advance_this_month numeric;
  v_cash_cap numeric;
  v_row public.payroll_payments;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a payroll payment';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'recorded_by must match the authenticated caller';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payroll payment amount must be positive';
  end if;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'Invalid payroll month %', p_month;
  end if;

  select salary into v_salary from public.staff where id = p_staff_id for update;
  if v_salary is null then
    raise exception 'Staff % not found', p_staff_id;
  end if;

  select coalesce(sum(amount), 0) into v_cash_this_month
    from public.payroll_payments
    where staff_id = p_staff_id and month = p_month;

  select coalesce(sum(amount), 0) into v_advance_this_month
    from public.salary_advances
    where staff_id = p_staff_id and payroll_month = p_month;

  v_cash_cap := greatest(
    0,
    v_salary + coalesce(p_allowances, 0) - coalesce(p_deductions, 0)
      - v_cash_this_month - v_advance_this_month
  );

  if p_amount > v_cash_cap + 0.001 then
    raise exception 'Payment % exceeds this month''s remaining net pay %', p_amount, v_cash_cap;
  end if;

  insert into public.payroll_payments
    (staff_id, amount, method, month, date, note, recorded_by, reference, allowances, deductions, advance_applied)
    values (
      p_staff_id, p_amount, p_method, p_month, p_date, p_note, p_recorded_by,
      'SAL-' || split_part(p_month, '-', 1) || '-' || split_part(p_month, '-', 2)
        || '-' || lpad(nextval('public.payroll_payment_ref_seq')::text, 4, '0'),
      coalesce(p_allowances, 0), coalesce(p_deductions, 0), 0
    )
    returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- record_salary_advance: signature change (adds p_payroll_month). Cap is
-- the target month's own unmet obligation: salary - cash already paid
-- that month - advances already recorded for that month. Never negative.
-- ---------------------------------------------------------------------

drop function if exists public.record_salary_advance(uuid, numeric, date, text, uuid);

create or replace function public.record_salary_advance(
  p_staff_id uuid,
  p_amount numeric,
  p_date date,
  p_note text,
  p_payroll_month text,
  p_recorded_by uuid
)
returns public.salary_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric;
  v_month text := coalesce(nullif(p_payroll_month, ''), to_char(p_date, 'YYYY-MM'));
  v_cash_this_month numeric;
  v_advance_this_month numeric;
  v_month_remaining numeric;
  v_row public.salary_advances;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a salary advance';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'recorded_by must match the authenticated caller';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Salary advance amount must be positive';
  end if;
  if v_month !~ '^\d{4}-\d{2}$' then
    raise exception 'Invalid payroll month %', v_month;
  end if;

  select salary into v_salary from public.staff where id = p_staff_id for update;
  if v_salary is null then
    raise exception 'Staff % not found', p_staff_id;
  end if;

  select coalesce(sum(amount), 0) into v_cash_this_month
    from public.payroll_payments
    where staff_id = p_staff_id and month = v_month;

  select coalesce(sum(amount), 0) into v_advance_this_month
    from public.salary_advances
    where staff_id = p_staff_id and payroll_month = v_month;

  v_month_remaining := greatest(0, v_salary - v_cash_this_month - v_advance_this_month);

  if p_amount > v_month_remaining + 0.001 then
    raise exception 'Advance % exceeds the % still unpaid for the % salary period',
      p_amount, v_month_remaining, v_month;
  end if;

  insert into public.salary_advances (staff_id, amount, date, payroll_month, note, recorded_by, reference)
    values (
      p_staff_id, p_amount, p_date, v_month, p_note, p_recorded_by,
      'ADV-' || split_part(v_month, '-', 1) || '-' || split_part(v_month, '-', 2)
        || '-' || lpad(nextval('public.salary_advance_ref_seq')::text, 4, '0')
    )
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_salary_advance(uuid, numeric, date, text, text, uuid) from public;
grant execute on function public.record_salary_advance(uuid, numeric, date, text, text, uuid) to authenticated;
