-- REMOVE TEST SALARY PAYMENT RESIDUE (pre-handover cleanup)
--
-- On 2026-09-09 a single test payroll payment was recorded while exercising the
-- Payroll screen (10,000 Birr / Bank Transfer / September 2026 for staff
-- "ABDIRHAMAN MOHAMED ASKER", reference SAL-2026-09-0001). It was not a real
-- disbursement. This migration removes that payment and the two derived records
-- the record_payroll_payment flow produced alongside it:
--
--   * the Recent Activity feed line ("10,000 Birr salary payment recorded ...")
--   * the "Salary Paid" notification delivered to that staff member
--
-- Nothing else is touched: staff records, the owner account, students and all
-- student fee data are left exactly as they are. Scoped by primary key /
-- unique reference so no other row can be affected; each statement is a no-op on
-- a database where the row is already gone (e.g. a fresh `db reset`).

delete from public.payroll_payments
where reference = 'SAL-2026-09-0001';

delete from public.activities
where id = '056ac32f-3757-4ada-9be1-ff789ee6ed48';

delete from public.notifications
where id = '28c9f831-09be-4149-b7bd-53c4d6ad6f43';

-- The payroll reference sequence was advanced to 1 by the test payment. With the
-- table now empty, restart it so the school's first real payslip is numbered
-- SAL-YYYY-MM-0001. (salary_advance_ref_seq was never used and is left alone.)
alter sequence public.payroll_payment_ref_seq restart with 1;
