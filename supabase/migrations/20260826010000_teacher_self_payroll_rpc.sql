-- Self-service payroll RPCs for a staff member's OWN record only.
--
-- The base RLS design (20260825190000_rls_policies.sql) deliberately gives `staff`/
-- `payroll_payments`/`salary_advances` no self-service SELECT policy at all -- Owner/Finance only,
-- "no self-service view for the staff member's own payroll history" (see that migration's comment
-- above the payroll_payments/salary_advances policies). That was written before the app's existing
-- Teacher-facing "My Salary" page (src/pages/teacher/TeacherPages.jsx MySalaryPage) was converted
-- from mock data -- that page (and the "Salary Paid" notification's Payslip link) already lets a
-- Teacher see their OWN salary/payment history/advance balance, and is a real, previously
-- browser-verified feature (see project notes), not new scope this migration is inventing.
--
-- These three functions restore exactly that, and nothing more: each is scoped with
-- `where user_id = auth.uid()` / a join back to a caller-owned staff row, so they can never return
-- another employee's data. They deliberately return the FULL row (including salary) for the
-- caller's own record -- an employee seeing their own contracted salary is normal; the thing the
-- base RLS design defends against is a Director/Finance/another-Teacher seeing someone ELSE's
-- salary, which is completely untouched here -- the base table policies are unchanged, and these
-- functions are useless for looking up anyone but the caller.

create or replace function public.my_staff_record()
returns public.staff
language sql
stable
security definer
set search_path = public
as $$
  select * from public.staff where user_id = auth.uid();
$$;

create or replace function public.my_payroll_payments()
returns setof public.payroll_payments
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.payroll_payments p
  join public.staff s on s.id = p.staff_id
  where s.user_id = auth.uid();
$$;

create or replace function public.my_salary_advances()
returns setof public.salary_advances
language sql
stable
security definer
set search_path = public
as $$
  select a.* from public.salary_advances a
  join public.staff s on s.id = a.staff_id
  where s.user_id = auth.uid();
$$;

revoke all on function public.my_staff_record() from public;
revoke all on function public.my_payroll_payments() from public;
revoke all on function public.my_salary_advances() from public;

grant execute on function public.my_staff_record() to authenticated;
grant execute on function public.my_payroll_payments() to authenticated;
grant execute on function public.my_salary_advances() to authenticated;
