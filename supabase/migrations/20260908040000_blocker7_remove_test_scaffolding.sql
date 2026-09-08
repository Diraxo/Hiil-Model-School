-- BLOCKER 7 — remove the isolated test scaffolding created while verifying grade-specific fee
-- eligibility against the live database.
--
-- During verification, five "ZZ Test*" students (one per grade + a bus case) were created to
-- exercise the new Record Payment behaviour without touching any of the 28 real students. Three
-- were removed directly afterwards; two (ZZ TestG9, ZZ TestG11) could not be — they carry VOIDED
-- test receipts and the payment-immutability design (no DELETE policy on payments /
-- payment_allocations / student_fee_obligations) blocks removing a student with any payment
-- history from the client. This migration does that cleanup with owner privileges.
--
-- Everything deleted here is test-only data generated today:
--   * payments 0008 / 0009 / 0011  — all VOIDED, created by the grade-eligibility test run.
--   * one rogue student_fee_obligations row deliberately inserted to prove record_payment_batch
--     rejects a cross-grade payment, then found un-deletable from the client (RLS has no DELETE
--     policy for that table).
--   * the ZZ TestG9 / ZZ TestG11 students (their remaining obligations + enrolments cascade).
--
-- The pre-existing VOIDED test receipts 0001–0006 (from earlier blockers, kept deliberately by
-- the school) are NOT touched. All guards are idempotent — on a database without this scaffolding
-- (e.g. a fresh environment) every statement is a harmless no-op.

do $$
declare
  v_zz uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_zz
  from public.students
  where first_name = 'ZZ' and last_name in ('TestG9', 'TestG11', 'TestG10', 'TestG12', 'TestG9Bus');

  if array_length(v_zz, 1) is null then
    return; -- nothing to clean up
  end if;

  -- 1. Drop the VOIDED test receipts that allocate to a ZZ obligation (frees the ON DELETE RESTRICT
  --    on payment_allocations.obligation_id). Only ever VOIDED test rows match this.
  delete from public.payments p
  where p.status = 'VOIDED'
    and exists (
      select 1
      from public.payment_allocations pa
      join public.student_fee_obligations o on o.id = pa.obligation_id
      where pa.payment_id = p.id
        and o.student_id = any (v_zz)
    );

  -- 2. Remove the ZZ students. student_fee_obligations.student_id and enrollments.student_id are
  --    both ON DELETE CASCADE, so their obligations (including the rogue cross-grade one) and
  --    enrolments go with them.
  delete from public.students where id = any (v_zz);
end $$;
