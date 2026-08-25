-- Migration 7 of N: payroll payments, salary advances (Blocker 5 /
-- Blocker 5A locked rules), and expenses.
--
-- Both payroll_payments and salary_advances are append-only/immutable by
-- convention (never edited or deleted once created) -- there is no
-- UPDATE/DELETE RPC for either, only the two INSERT-only RPCs below.
-- "Settled"/"remaining"/status for an advance is always derived at read
-- time from the ledger, never stored (see the memory note this schema
-- was built from: Blocker 5A fixed a bug where an advance retroactively
-- "paid off" an old unrelated month -- an advance only reduces what's
-- owed via a real payroll payment's own advance_applied field).

create sequence public.payroll_payment_ref_seq start 1;
create sequence public.salary_advance_ref_seq start 1;
create sequence public.expense_no_seq start 1;

-- ---------------------------------------------------------------------
-- payroll_payments
-- ---------------------------------------------------------------------

create table public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null,
  month text not null,
  date date not null,
  note text,
  recorded_by uuid references public.profiles (id) on delete set null,
  reference text unique,
  allowances numeric(12, 2) not null default 0 check (allowances >= 0),
  deductions numeric(12, 2) not null default 0 check (deductions >= 0),
  advance_applied numeric(12, 2) not null default 0 check (advance_applied >= 0),
  created_at timestamptz not null default now(),
  constraint payroll_payments_month_format check (month ~ '^\d{4}-\d{2}$')
);

alter table public.payroll_payments enable row level security;

create index payroll_payments_staff_month_idx on public.payroll_payments (staff_id, month);

-- ---------------------------------------------------------------------
-- salary_advances
-- ---------------------------------------------------------------------

create table public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  date date not null,
  payroll_month text not null,
  note text,
  recorded_by uuid references public.profiles (id) on delete set null,
  reference text unique,
  created_at timestamptz not null default now(),
  constraint salary_advances_month_format check (payroll_month ~ '^\d{4}-\d{2}$')
);

alter table public.salary_advances enable row level security;

create index salary_advances_staff_idx on public.salary_advances (staff_id);

-- ---------------------------------------------------------------------
-- Derived helper: a staff member's live outstanding advance balance
-- (total advances given minus total advance_applied across all payroll
-- payments -- never stored).
-- ---------------------------------------------------------------------

create or replace function public.staff_advance_balance(p_staff_id uuid)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce((select sum(amount) from public.salary_advances where staff_id = p_staff_id), 0)
      - coalesce((select sum(advance_applied) from public.payroll_payments where staff_id = p_staff_id), 0)
  );
$$;

-- ---------------------------------------------------------------------
-- record_payroll_payment: server-enforced overpayment rejection
-- (Blocker 5 -- partial and exact payments allowed, overpayment/zero/
-- negative rejected). cash_cap = max(0, salary + allowances -
-- deductions - already-paid-this-month-cash - advance_applied-this-call
-- minus already-applied-advance-this-month).
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
  p_advance_applied numeric,
  p_recorded_by uuid
)
returns public.payroll_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric;
  v_already_paid numeric;
  v_advance_balance numeric;
  v_cash_cap numeric;
  v_advance_applied numeric := coalesce(p_advance_applied, 0);
  v_row public.payroll_payments;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payroll payment amount must be positive';
  end if;

  select salary into v_salary from public.staff where id = p_staff_id for update;
  if v_salary is null then
    raise exception 'Staff % not found', p_staff_id;
  end if;

  select coalesce(sum(amount), 0) into v_already_paid
    from public.payroll_payments
    where staff_id = p_staff_id and month = p_month;

  v_advance_balance := public.staff_advance_balance(p_staff_id);
  if v_advance_applied > v_advance_balance + 0.001 then
    raise exception 'advance_applied % exceeds outstanding advance balance %', v_advance_applied, v_advance_balance;
  end if;

  v_cash_cap := greatest(
    0,
    v_salary + coalesce(p_allowances, 0) - coalesce(p_deductions, 0) - v_already_paid - v_advance_applied
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
      coalesce(p_allowances, 0), coalesce(p_deductions, 0), v_advance_applied
    )
    returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- record_salary_advance: cap is against ONLY the most-recently-elapsed
-- month's own unmet cash obligation (salary - already paid that month),
-- never a backlog of older unpaid months (Blocker 5A -- an advance is
-- against upcoming pay, not a loan against arrears).
-- ---------------------------------------------------------------------

create or replace function public.record_salary_advance(
  p_staff_id uuid,
  p_amount numeric,
  p_date date,
  p_note text,
  p_recorded_by uuid
)
returns public.salary_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric;
  v_month text := to_char(p_date, 'YYYY-MM');
  v_already_paid_this_month numeric;
  v_current_month_available numeric;
  v_advance_balance numeric;
  v_max_advance numeric;
  v_row public.salary_advances;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Salary advance amount must be positive';
  end if;

  select salary into v_salary from public.staff where id = p_staff_id for update;
  if v_salary is null then
    raise exception 'Staff % not found', p_staff_id;
  end if;

  select coalesce(sum(amount), 0) into v_already_paid_this_month
    from public.payroll_payments
    where staff_id = p_staff_id and month = v_month;

  v_current_month_available := greatest(0, v_salary - v_already_paid_this_month);
  v_advance_balance := public.staff_advance_balance(p_staff_id);
  v_max_advance := greatest(0, v_current_month_available - v_advance_balance);

  if p_amount > v_max_advance + 0.001 then
    raise exception 'Advance % exceeds the maximum allowed % (current month net pay % minus outstanding advance %)',
      p_amount, v_max_advance, v_current_month_available, v_advance_balance;
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

-- ---------------------------------------------------------------------
-- expenses / expense_items: total_amount is server-derived from items,
-- never trusted from the client (master prompt section 35).
-- ---------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text not null unique,
  date date not null,
  total_amount numeric(12, 2) not null default 0,
  method text not null,
  purchased_by text,
  note text,
  receipt_image_url text,
  receipt_name text,
  receipt_type text,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

create index expenses_date_idx on public.expenses (date);

create or replace function public.assign_expense_no()
returns trigger
language plpgsql
as $$
begin
  if new.expense_no is null then
    new.expense_no := '#' || lpad(nextval('public.expense_no_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger expenses_assign_expense_no
  before insert on public.expenses
  for each row
  execute function public.assign_expense_no();

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  item_name text not null,
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  line_total numeric(14, 2) generated always as (quantity * unit_price) stored
);

alter table public.expense_items enable row level security;

create index expense_items_expense_idx on public.expense_items (expense_id);

create or replace function public.recalc_expense_total()
returns trigger
language plpgsql
as $$
declare
  v_expense_id uuid := coalesce(new.expense_id, old.expense_id);
begin
  update public.expenses
    set total_amount = coalesce((
      select sum(line_total) from public.expense_items where expense_id = v_expense_id
    ), 0)
    where id = v_expense_id;
  return null;
end;
$$;

create trigger expense_items_recalc_total
  after insert or update or delete on public.expense_items
  for each row
  execute function public.recalc_expense_total();
