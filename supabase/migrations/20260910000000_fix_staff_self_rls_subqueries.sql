-- Fix: a Teacher could not submit their own leave request (403, "new row violates row-level
-- security policy for table leave_requests").
--
-- Root cause: leave_requests_insert's self-service STAFF branch (20260825190000_rls_policies.sql)
-- tests membership with a raw inline subquery:
--
--     exists (select 1 from public.staff s where s.id = subject_id and s.user_id = auth.uid())
--
-- That subquery runs in the *caller's* RLS context, and the base `staff` table has no
-- teacher-self SELECT policy (Owner/Finance only — the whole reason my_staff_record() and the
-- staff_directory view exist as SECURITY DEFINER workarounds). So for a Teacher the subquery
-- always returns zero rows, the WITH CHECK fails, and the insert is rejected — even though the
-- teacher is submitting for their own staff row.
--
-- The migration adds one SECURITY DEFINER helper — owns_staff_row(uuid) — mirroring the
-- pattern already used by teacher_academic_action_ok() / can_decide_leave(), and rewrites the
-- two policies that make this exact raw-subquery mistake:
--   * leave_requests_insert  (the reproduced bug)
--   * staff_attendance_select self-view branch (identical root cause: a Teacher currently can't
--     read their own staff_attendance rows either)
--
-- No policy is loosened: owns_staff_row() is strictly `id = p_staff_id AND user_id = auth.uid()`,
-- exactly what the broken subqueries intended.

create or replace function public.owns_staff_row(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.id = p_staff_id and s.user_id = auth.uid()
  );
$$;

revoke all on function public.owns_staff_row(uuid) from public;
grant execute on function public.owns_staff_row(uuid) to authenticated;

comment on function public.owns_staff_row is
  'SECURITY DEFINER: true when p_staff_id is the caller''s own staff row. Lets RLS policies check
   "this is my staff record" without the caller needing SELECT on the (Owner/Finance-only) staff
   table. Mirrors teacher_academic_action_ok()/can_decide_leave().';

-- leave_requests_insert: same shape as the original, self-STAFF branch now via owns_staff_row().
drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests
  for insert
  with check (
    requested_by = auth.uid()
    and (
      (kind = 'STUDENT' and (public.is_parent_of(subject_id) or public.is_owner_or_admin()))
      or (kind = 'STAFF' and (
        public.owns_staff_row(subject_id)
        or public.is_owner()
        or (public.is_admin() and exists (select 1 from public.staff s where s.id = subject_id and s.position = 'Teacher'))
        or (public.is_finance() and exists (select 1 from public.staff s where s.id = subject_id and public.staff_group_for_position(s.position) = 'Other Staff'))
      ))
    )
  );

-- staff_attendance_select: identical root cause in the self-view branch.
drop policy if exists staff_attendance_select on public.staff_attendance;
create policy staff_attendance_select on public.staff_attendance
  for select
  using (
    public.can_edit_staff_attendance_for(staff_id)
    or public.owns_staff_row(staff_attendance.staff_id)
  );

-- --------------------------------------------------------------------------------------------
-- parent_students_select: let the Finance & Operations Director read the links.
--
-- Finance owns billing for every family: the Fees page groups obligations by family, shows a
-- per-family "Remind" action, and notify_payment_reminder takes a Finance-picked parent-id list.
-- With the links invisible to Finance the Fees list labels every family "no parent account
-- linked" (wrong for any student who has one) and the Remind button resolves to an empty
-- recipient set. Finance already sees every student, every obligation and every family grouping,
-- so the parent-account link is a natural part of that same billing view. (Teachers are
-- intentionally NOT added — their student-profile copy was already softened in the app.)
drop policy if exists parent_students_select on public.parent_students;
create policy parent_students_select on public.parent_students
  for select
  using (
    parent_id = auth.uid()
    or public.is_owner_or_admin()
    or public.is_finance()
  );
