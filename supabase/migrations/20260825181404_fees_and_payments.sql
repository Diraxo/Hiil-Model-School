-- Migration 6 of N: fee catalog -> schedule -> installment -> obligation
-- -> payment/allocation (the Blocker 2 / Blocker 4 locked financial
-- architecture), plus the transactional RPCs that enforce it.
--
-- IMPORTANT -- a discrepancy against the master migration prompt:
-- Section 24 of the prompt says fee overpayment should be REJECTED.
-- But the actual, already-shipped, browser-verified app behavior (the
-- mock DataContext's recordPaymentBatch, "Decision B") instead CAPS an
-- overpaying line at the obligation's remaining balance rather than
-- rejecting the whole batch. Per the instruction to preserve locked
-- behavior and flag contradictions instead of silently resolving them,
-- record_payment_batch below preserves the CAP behavior. Flag this to
-- the user for an explicit decision before relying on either reading.
-- (Payroll overpayment -- a separate, unrelated rule -- IS rejected, per
-- Blocker 5, and record_payroll_payment in the next migration does
-- reject it -- these are two different money flows with two different
-- locked policies, not an inconsistency.)
--
-- Concurrency: every RPC here locks the rows it reads with `for update`
-- before computing caps, so two simultaneous payments against the same
-- obligation can never jointly overshoot it (see master prompt section
-- 57).

create type fee_obligation_reason as enum ('YEAR_ROLLOUT', 'ENROLLMENT', 'BUS_OPT_IN');

create type fee_adjustment_type as enum ('WAIVER', 'DISCOUNT', 'SCHOLARSHIP', 'CANCELLATION', 'CORRECTION');

create type payment_status as enum ('POSTED', 'VOIDED');

-- ---------------------------------------------------------------------
-- fee_types: reusable catalog, no per-year pricing
-- ---------------------------------------------------------------------

create table public.fee_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  default_unit_amount numeric(12, 2),
  default_unit_months numeric(6, 2),
  default_units_per_year integer,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_types_category_known check (category in ('TUITION', 'TRANSPORT'))
);

comment on table public.fee_types is
  'category is constrained to the two values the app has ever used (TUITION, TRANSPORT). Widen this check if a genuinely new fee category is introduced.';

alter table public.fee_types enable row level security;

create trigger fee_types_set_updated_at
  before update on public.fee_types
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- fee_schedules: one row per (fee_type, academic_year) -- the year's
-- actual pricing. A historical year's schedule is never rewritten by a
-- later year's pricing change.
-- ---------------------------------------------------------------------

create table public.fee_schedules (
  id uuid primary key default gen_random_uuid(),
  fee_type_id uuid not null references public.fee_types (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  unit_amount numeric(12, 2) not null,
  unit_months numeric(6, 2) not null,
  units_per_year integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint fee_schedules_unique unique (fee_type_id, academic_year_id)
);

alter table public.fee_schedules enable row level security;

create trigger fee_schedules_set_updated_at
  before update on public.fee_schedules
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- fee_installments: concrete due-date rows, generated once at rollout.
-- amount is frozen -- corrections go through fee_obligation_adjustments,
-- never a direct edit once any obligation references the installment.
-- ---------------------------------------------------------------------

create table public.fee_installments (
  id uuid primary key default gen_random_uuid(),
  fee_schedule_id uuid not null references public.fee_schedules (id) on delete cascade,
  sequence_index integer not null,
  label text not null,
  due_date date not null,
  amount numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_installments_unique unique (fee_schedule_id, sequence_index)
);

alter table public.fee_installments enable row level security;

create trigger fee_installments_set_updated_at
  before update on public.fee_installments
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- student_fee_obligations: what a specific student actually owes for one
-- installment. amount_due is frozen at materialization time.
-- ---------------------------------------------------------------------

create table public.student_fee_obligations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  fee_installment_id uuid not null references public.fee_installments (id) on delete restrict,
  amount_due numeric(12, 2) not null,
  created_reason fee_obligation_reason not null,
  created_at timestamptz not null default now(),
  constraint student_fee_obligations_unique unique (student_id, fee_installment_id)
);

alter table public.student_fee_obligations enable row level security;

create index student_fee_obligations_student_idx on public.student_fee_obligations (student_id);

-- ---------------------------------------------------------------------
-- fee_obligation_adjustments: append-only corrections
-- ---------------------------------------------------------------------

create table public.fee_obligation_adjustments (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.student_fee_obligations (id) on delete cascade,
  type fee_adjustment_type not null,
  amount numeric(12, 2) not null,
  reason text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fee_obligation_adjustments_reason_required check (length(trim(reason)) > 0)
);

alter table public.fee_obligation_adjustments enable row level security;

create index fee_obligation_adjustments_obligation_idx on public.fee_obligation_adjustments (obligation_id);

-- ---------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  constraint payment_methods_name_unique unique (name)
);

alter table public.payment_methods enable row level security;

-- ---------------------------------------------------------------------
-- payments: one row = one receipt = one whole transaction. Immutable --
-- never edited, only whole-receipt voided (Blocker 4).
-- ---------------------------------------------------------------------

create sequence public.receipt_no_seq start 1;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  payment_method_id uuid not null references public.payment_methods (id) on delete restrict,
  amount_total numeric(12, 2) not null,
  date date not null,
  note text,
  recorded_by uuid references public.profiles (id) on delete set null,
  status payment_status not null default 'POSTED',
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint payments_void_fields_consistent check (
    (status = 'POSTED' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'VOIDED' and voided_at is not null and void_reason is not null)
  )
);

alter table public.payments enable row level security;

create index payments_date_idx on public.payments (date);
create index payments_status_idx on public.payments (status);

alter table public.notifications
  add constraint notifications_payment_id_fkey
  foreign key (payment_id) references public.payments (id) on delete set null;

-- ---------------------------------------------------------------------
-- payment_allocations: how one payment funds one or more obligations.
-- Void is whole-receipt only -- allocations carry no independent void
-- flag; they're excluded from balance math by joining through
-- payments.status <> 'VOIDED'.
-- ---------------------------------------------------------------------

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  obligation_id uuid not null references public.student_fee_obligations (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.payment_allocations enable row level security;

create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_obligation_idx on public.payment_allocations (obligation_id);

-- ---------------------------------------------------------------------
-- payment_audit_log: append-only, records VOID actions
-- ---------------------------------------------------------------------

create table public.payment_audit_log (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  student_ids uuid[] not null default '{}',
  action text not null default 'VOIDED',
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role user_role,
  actor_name text,
  amount numeric(12, 2),
  receipt_no text,
  reason text,
  at timestamptz not null default now()
);

alter table public.payment_audit_log enable row level security;

-- ---------------------------------------------------------------------
-- Derived balance helper: net amount still owed on one obligation,
-- counting only adjustments and allocations from non-voided payments.
-- ---------------------------------------------------------------------

create or replace function public.net_owed_for_obligation(p_obligation_id uuid)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    o.amount_due
      - coalesce((select sum(a.amount) from public.fee_obligation_adjustments a
                  where a.obligation_id = o.id), 0)
      - coalesce((select sum(pa.amount)
                  from public.payment_allocations pa
                  join public.payments p on p.id = pa.payment_id
                  where pa.obligation_id = o.id and p.status <> 'VOIDED'), 0)
  )
  from public.student_fee_obligations o
  where o.id = p_obligation_id;
$$;

-- ---------------------------------------------------------------------
-- record_payment_batch: the real payment-recording engine. One call ->
-- one payments row + N payment_allocations rows, atomically.
--
-- p_lines: jsonb array of {student_id, installment_id, amount, note?}.
-- A line with no matching obligation, or a non-positive requested
-- amount, is silently skipped (matches existing app behavior). Each
-- line's applied amount is capped at that obligation's live
-- net_owed_for_obligation (Decision B -- see header comment).
-- ---------------------------------------------------------------------

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
begin
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

    select o.id into v_obligation_id
      from public.student_fee_obligations o
      where o.student_id = (v_line ->> 'student_id')::uuid
        and o.fee_installment_id = (v_line ->> 'installment_id')::uuid
      for update;

    if v_obligation_id is null then
      continue;
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

comment on function public.record_payment_batch is
  'SECURITY DEFINER so a Finance/Owner caller (checked by the RLS policy that GRANTs execute, added in the RLS migration) can write across payments/payment_allocations/payment_methods atomically. Every obligation touched is row-locked (for update) before its cap is computed, so concurrent payments can never jointly overshoot it.';

-- ---------------------------------------------------------------------
-- void_payment: whole-receipt void (Blocker 4). Never touches
-- allocations -- they're excluded from balance math purely by the
-- payments.status join filter above.
-- ---------------------------------------------------------------------

create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_actor_role user_role,
  p_actor_name text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_student_ids uuid[];
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A void reason is required';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment is null then
    raise exception 'Payment % not found', p_payment_id;
  end if;
  if v_payment.status = 'VOIDED' then
    raise exception 'Payment % is already voided', p_payment_id;
  end if;

  select array_agg(distinct o.student_id) into v_student_ids
    from public.payment_allocations pa
    join public.student_fee_obligations o on o.id = pa.obligation_id
    where pa.payment_id = p_payment_id;

  update public.payments
    set status = 'VOIDED', voided_at = now(), voided_by = p_actor_id, void_reason = p_reason
    where id = p_payment_id
    returning * into v_payment;

  insert into public.payment_audit_log
    (payment_id, student_ids, action, actor_id, actor_role, actor_name, amount, receipt_no, reason)
    values
    (p_payment_id, coalesce(v_student_ids, '{}'), 'VOIDED', p_actor_id, p_actor_role, p_actor_name,
     v_payment.amount_total, v_payment.receipt_no, p_reason);

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------
-- add_obligation_adjustment: blocks waiving more than is still owed
-- unless the adjustment type is CORRECTION.
-- ---------------------------------------------------------------------

create or replace function public.add_obligation_adjustment(
  p_obligation_id uuid,
  p_type fee_adjustment_type,
  p_amount numeric,
  p_reason text,
  p_created_by uuid
)
returns public.fee_obligation_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net_owed numeric;
  v_row public.fee_obligation_adjustments;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'An adjustment reason is required';
  end if;

  perform 1 from public.student_fee_obligations where id = p_obligation_id for update;
  if not found then
    raise exception 'Obligation % not found', p_obligation_id;
  end if;

  if p_type <> 'CORRECTION' then
    v_net_owed := public.net_owed_for_obligation(p_obligation_id);
    if p_amount > v_net_owed + 0.001 then
      raise exception 'Adjustment amount % exceeds the % still owed on this obligation', p_amount, v_net_owed;
    end if;
  end if;

  insert into public.fee_obligation_adjustments (obligation_id, type, amount, reason, created_by)
    values (p_obligation_id, p_type, p_amount, p_reason, p_created_by)
    returning * into v_row;

  return v_row;
end;
$$;
