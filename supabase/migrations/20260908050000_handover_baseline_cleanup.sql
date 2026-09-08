-- HANDOVER BASELINE CLEANUP
--
-- Final tidy of the live database before handover. Removes test-only financial residue left by
-- the Blocker 6 / Blocker 7 fee-model work and the payroll-advance feature test. Touches NO real
-- person: the 28 students, the 3 accounts (Owner / Finance / Educational Director), their grades,
-- enrolments and classes are all left exactly as they are. The deliberately-kept VOIDED test
-- receipts #0001-#0006 and the 9 fee obligations that anchor them are preserved.
--
-- Owner-confirmed decisions (2026-09-08):
--   1. The two Sept-2026 salary advances to the Finance Director (10,000 + 2,000 Birr, refs
--      ADV-2026-09-0001/0002) are test data from the payroll feature check -> delete. They are the
--      sole source of the "-12,000 Net Position".
--   2. Remove the ~451 orphan fee obligations that were materialised against five now-archived fee
--      schedules during repeated Fee-Settings experiments (already invisible in every UI and
--      balance because archived fee types are filtered out - this just clears the clutter from the
--      database itself). The 9 obligations referenced by the VOIDED receipts are kept.
--   3. Fully delete the three archived DUPLICATE school-fee types ("9-10 Fee", "Grade-11",
--      "Grade-12") and their schedules/installments. The archived "9-10 School Fee" and "Bus fee"
--      types are KEPT (they give the VOIDED receipts their line labels).
--   4. Trim the three ACTIVE school-fee schedules from 11 billed months (Sep 2026 - Jul 2027) to
--      the intended 10 (September - June). No payment exists against any July installment, so this
--      is the "drop month" path of set_fee_schedule_billed_months done inline.
--
-- Every statement is id-scoped or guarded, so on a database without this residue (a fresh
-- environment) the whole migration is a harmless no-op. Fully transactional.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Test salary advances + their matching notification / activity-feed entries
-- ---------------------------------------------------------------------------------------------
delete from public.notifications
where id in ('bcd41480-affc-446f-bc40-f129abbd248e',
             '1d359286-81dc-4435-9550-2a323661d84d');

delete from public.activities
where id in ('9e86506e-a189-4b69-ae59-9cd2bf7af643',
             'd8a0125a-0054-4cf8-9115-3eb85438f6b0');

delete from public.salary_advances
where id in ('7def6688-278b-489a-bdab-73edb9983d30',
             '62be4eb7-04f4-494a-81c0-f86ba76c05b1');

-- ---------------------------------------------------------------------------------------------
-- 2. Orphan obligations on the five archived fee schedules (no allocation, no adjustment).
--    Keeps the 9 that anchor VOIDED receipts #0001-#0006.
-- ---------------------------------------------------------------------------------------------
delete from public.student_fee_obligations o
using public.fee_installments fi
where o.fee_installment_id = fi.id
  and fi.fee_schedule_id in (
        '00bb6e4f-511b-4ea7-8b76-c768d60a4fee',  -- 9-10 School Fee 2000 (kept, archived)
        'be795c66-e2e7-4696-bcef-1b6a84664807',  -- Bus fee 1000       (kept, archived)
        '2b88840d-83ba-4ebc-9b33-e3e6036b997f',  -- 9-10 Fee 3000      (dupe, removed below)
        'e85e3715-03f2-4b34-85e8-0f115289471b',  -- Grade-11 4000      (dupe, removed below)
        '11700656-2097-469b-aaf9-df2604ee66af')  -- Grade-12 5000      (dupe, removed below)
  and not exists (select 1 from public.payment_allocations pa where pa.obligation_id = o.id)
  and not exists (select 1 from public.fee_obligation_adjustments a where a.obligation_id = o.id);

-- ---------------------------------------------------------------------------------------------
-- 3. Trim the three ACTIVE school-fee schedules to September - June (drop July 2027).
-- ---------------------------------------------------------------------------------------------
delete from public.student_fee_obligations o
using public.fee_installments fi
where o.fee_installment_id = fi.id
  and fi.fee_schedule_id in (
        'bae4fdac-12ba-4a3f-ba7a-1f55975fcceb',  -- Grade 9 $ 10 3000
        'f4c797c1-4ccb-4c7c-8363-dfe8e3eff9cd',  -- Grade 11 4000
        'a476932f-4598-4332-8098-77ae36779cb0')  -- Grade 12 5000
  and fi.period_month = date '2027-07-01'
  and not exists (select 1 from public.payment_allocations pa where pa.obligation_id = o.id)
  and not exists (select 1 from public.fee_obligation_adjustments a where a.obligation_id = o.id);

delete from public.fee_installments
where fee_schedule_id in (
        'bae4fdac-12ba-4a3f-ba7a-1f55975fcceb',
        'f4c797c1-4ccb-4c7c-8363-dfe8e3eff9cd',
        'a476932f-4598-4332-8098-77ae36779cb0')
  and period_month = date '2027-07-01';

update public.fee_schedules
set billed_months = array[
      date '2026-09-01', date '2026-10-01', date '2026-11-01', date '2026-12-01',
      date '2027-01-01', date '2027-02-01', date '2027-03-01', date '2027-04-01',
      date '2027-05-01', date '2027-06-01'],
    units_per_year = 10,
    updated_at = now()
where id in (
        'bae4fdac-12ba-4a3f-ba7a-1f55975fcceb',
        'f4c797c1-4ccb-4c7c-8363-dfe8e3eff9cd',
        'a476932f-4598-4332-8098-77ae36779cb0');

-- ---------------------------------------------------------------------------------------------
-- 4. On the two KEPT archived schedules, drop installments that now have no obligation at all
--    (the 3 Sept/Oct/Nov "9-10 School Fee" + 1 Sept "Bus fee" installments that anchor the
--    VOIDED receipts are protected by the NOT EXISTS).
-- ---------------------------------------------------------------------------------------------
delete from public.fee_installments fi
where fi.fee_schedule_id in (
        '00bb6e4f-511b-4ea7-8b76-c768d60a4fee',
        'be795c66-e2e7-4696-bcef-1b6a84664807')
  and not exists (select 1 from public.student_fee_obligations o where o.fee_installment_id = fi.id);

-- ---------------------------------------------------------------------------------------------
-- 5. Fully remove the three archived DUPLICATE school-fee types (their obligations are gone
--    after step 2). Installments -> schedules -> types, in FK-safe order.
-- ---------------------------------------------------------------------------------------------
delete from public.fee_installments
where fee_schedule_id in (
        '2b88840d-83ba-4ebc-9b33-e3e6036b997f',
        'e85e3715-03f2-4b34-85e8-0f115289471b',
        '11700656-2097-469b-aaf9-df2604ee66af');

delete from public.fee_schedules
where id in (
        '2b88840d-83ba-4ebc-9b33-e3e6036b997f',
        'e85e3715-03f2-4b34-85e8-0f115289471b',
        '11700656-2097-469b-aaf9-df2604ee66af');

delete from public.fee_types
where id in (
        'd4451313-d067-449b-b452-964039fc23b4',  -- 9-10 Fee
        '48a1b722-51c1-4c50-9e83-838f1ca2b843',  -- Grade-11
        '24d2bb28-c39a-4d5f-a1f1-e2d3d2717eba');  -- Grade-12

-- ---------------------------------------------------------------------------------------------
-- 6. Guard: nothing here should ever touch a POSTED payment or a real person.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_posted        integer;
  v_students      integer;
  v_advances      integer;
begin
  select count(*) into v_posted   from public.payments where status <> 'VOIDED';
  select count(*) into v_students from public.students;
  select count(*) into v_advances from public.salary_advances;

  if v_posted <> 0 then
    raise exception 'ABORT: % non-voided payment(s) exist - unexpected, rolling back', v_posted;
  end if;
  -- Only assert the live head-count on the production database (skip on a fresh/empty env).
  if v_students <> 0 and v_students <> 28 then
    raise exception 'ABORT: expected 28 students, found % - rolling back', v_students;
  end if;
  if v_advances <> 0 then
    raise exception 'ABORT: expected 0 salary advances after cleanup, found % - rolling back', v_advances;
  end if;
end $$;

commit;
