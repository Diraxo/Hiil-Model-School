-- Phase 2, checkpoint 1 (Timetable): additive RLS so a Parent can read substitute coverage for a
-- period in their own child's class.
--
-- Why: the app's data.getPeriodCoverage() (ParentTimetablePage / ParentDashboard /
-- ParentAttendancePage) reads the substitutions table to show parents "Substitute: <name>" for
-- today's classes. The original substitutions_select policy
-- (20260825190000_rls_policies.sql) only covers Owner/Educational Director and the two teachers
-- named on the row, so parents saw nothing once the timetable domain moved to real Supabase data.
-- notify_substitute_assigned already sends parents the "Class schedule changed" notification, so
-- this only restores parity with what parents could already see in the app.
--
-- Purely additive: the existing substitutions_select policy is left exactly as-is. Postgres ORs
-- permissive policies for the same command, so this only ever grants, never restricts. Mirrors the
-- parent branch of homework_select (students.class_id + public.is_parent_of).

create policy substitutions_select_parent on public.substitutions
  for select
  using (
    public.is_parent()
    and exists (
      select 1
      from public.timetable_entries te
      join public.students s on s.class_id = te.class_id
      where te.id = substitutions.timetable_entry_id
        and public.is_parent_of(s.id)
    )
  );
