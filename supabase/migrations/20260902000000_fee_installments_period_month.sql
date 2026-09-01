-- Phase 4 (Fees / Payments / Expenses), part 1 of 3: monthly-installment schema.
--
-- The student fee cycle is MONTHLY, never quarterly. fee_installments already has
-- sequence_index / label / due_date / amount; this adds `period_month` -- a real DATE
-- (always the 1st of the month) identifying which calendar month an installment bills for
-- -- so the payment UI can offer "September 2026 / October 2026 / ..." from stored data
-- instead of a string label or browser-clock math.
--
-- Non-destructive & idempotent:
--   * fee_installments has 0 rows on this database (verified before writing), so there is
--     no historical "Quarter N" data to reinterpret. The column is added nullable.
--   * every statement guards itself (add column if not exists / create index if not exists
--     / drop policy if exists).

-- ---------------------------------------------------------------------------------------
-- 1. period_month column
-- ---------------------------------------------------------------------------------------
alter table public.fee_installments
  add column if not exists period_month date;

comment on column public.fee_installments.period_month is
  'The 1st of the calendar month this installment bills for (monthly fee cycle). NULL only for
   legacy / non-monthly rows. generate_monthly_fee_installments() always sets it.';

-- Keep it a real month anchor, never a mid-month date.
alter table public.fee_installments
  drop constraint if exists fee_installments_period_month_is_month_start;
alter table public.fee_installments
  add constraint fee_installments_period_month_is_month_start
  check (period_month is null or period_month = date_trunc('month', period_month)::date);

-- ---------------------------------------------------------------------------------------
-- 2. One installment per (schedule, month) -- the DB-side guard that makes
--    generate_monthly_fee_installments() safe to run repeatedly / on a double-click.
-- ---------------------------------------------------------------------------------------
create unique index if not exists fee_installments_schedule_period_month_key
  on public.fee_installments (fee_schedule_id, period_month)
  where period_month is not null;

-- ---------------------------------------------------------------------------------------
-- 3. Widen fee_types.category to include 'OTHER'.
--    The original check (20260825181404) allowed only TUITION / TRANSPORT, but the Fee
--    Settings UI has always offered a third "Other" option (non-transport, billed to every
--    student — behaves like TUITION in every fee helper except the tuition-only installment
--    view). Picking it used to work only because the catalog was mock; now it must persist.
-- ---------------------------------------------------------------------------------------
alter table public.fee_types drop constraint if exists fee_types_category_known;
alter table public.fee_types
  add constraint fee_types_category_known
  check (category in ('TUITION', 'TRANSPORT', 'OTHER'));

-- ---------------------------------------------------------------------------------------
-- 4. DELETE policy for fee_installments.
--    The RLS migration (20260825190000) gave fee_installments SELECT/INSERT/UPDATE to
--    Owner/Finance but no DELETE -- so a schedule generated with the wrong academic-year
--    dates could never have its installments cleared and regenerated. student_fee_obligations
--    .fee_installment_id is ON DELETE RESTRICT, so the database still blocks deleting any
--    installment a student has actually been billed for; this only lets Finance/Owner remove
--    not-yet-obligated rows.
-- ---------------------------------------------------------------------------------------
drop policy if exists fee_installments_delete on public.fee_installments;
create policy fee_installments_delete on public.fee_installments
  for delete using (public.is_owner_or_finance());

grant delete on public.fee_installments to authenticated;
