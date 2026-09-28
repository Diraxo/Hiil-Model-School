-- timetable_entries: read access is scoped to the rows each role actually needs (was: every signed-in account).
--
-- BACKGROUND
--   timetable_entries_select was `current_role() is not null`, i.e. ANY active account - Finance, and every parent, including
--   parents of other families - could read the whole school timetable (class, day, period, subject, teacher) straight from the
--   API. The apps filtered client-side; the database did not enforce it.
--
-- WHAT EACH ROLE NEEDS (audited against every web and mobile timetable read)
--   Owner, Educational Director  every row (they build and edit the timetable; conflict checks, coverage, journal rollups).
--   Teacher                      (a) their own periods (teacher_id = me)               web TeacherTimetablePage / dashboard
--                                (b) a period they are SUBSTITUTING for (any substitutions row naming them)  web substitutingPeriods
--                                (c) the full timetable of a class they are ASSIGNED to (teacher_assignments) or HEAD (classes.head_teacher_id)
--                                    - the mobile Timetable class picker, which is limited to exactly those classes.
--   Parent                       rows of the class(es) their linked children are in (parent_students -> students.class_id).
--   Finance                      NOTHING. No web or mobile Finance screen reads the timetable; Finance keeps timetable_config only.
--
-- HOW
--   One SECURITY DEFINER helper decides visibility per row, and the SELECT policy calls it. A helper (not an inline subquery) is
--   required: substitutions_select_parent and period_logs_* already read timetable_entries inside their own policies, so an inline
--   policy that read substitutions would recurse. Insert / update / delete policies are untouched (Owner / Educational Director).
--
-- WHAT IS NOT CHANGED
--   substitutions and period_logs were already scoped (Owner/ED, the two teachers on the row, a parent of the class) and stay so.
--   timetable_config (periods count, start time, durations) is a school-wide bell schedule with no student, teacher or family data
--   in it, and stays readable by every signed-in role. No columns, indexes, data or other policies change.
--
-- The existing policies that read timetable_entries internally keep working: everything they need (a teacher's own / substituted
-- rows, a parent's child-class rows, Owner/ED everything) is inside what this policy grants.
-- Rollback: supabase/rollbacks/20260920055000_rollback.sql

create or replace function public.can_read_timetable_entry(p_entry uuid, p_class uuid, p_teacher uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner_or_admin() then true
    when public.is_teacher() then
      p_teacher = auth.uid()
      or exists (select 1 from public.substitutions sub where sub.timetable_entry_id = p_entry and sub.substitute_teacher_id = auth.uid())
      or exists (select 1 from public.teacher_assignments ta where ta.class_id = p_class and ta.teacher_id = auth.uid())
      or exists (select 1 from public.classes c where c.id = p_class and c.head_teacher_id = auth.uid())
    when public.is_parent() then exists (
      select 1 from public.students s
      where s.class_id = p_class and public.is_parent_of(s.id)
    )
    else false
  end;
$$;

comment on function public.can_read_timetable_entry is
  'Row-level visibility of a timetable_entries row: Owner/Educational Director all; Teacher own / substituted / assigned-or-head class; Parent the class of a linked child; nobody else (Finance included). Total: a caller with no ACTIVE profile gets false.';

-- Same grant pattern as the other RLS helpers (20260920030000): not callable by anon or PUBLIC.
revoke all on function public.can_read_timetable_entry(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_read_timetable_entry(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists timetable_entries_select on public.timetable_entries;
create policy timetable_entries_select on public.timetable_entries
  for select using (public.can_read_timetable_entry(id, class_id, teacher_id));
