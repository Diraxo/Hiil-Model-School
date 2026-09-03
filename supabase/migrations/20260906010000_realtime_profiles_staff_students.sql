-- Real-time profile / staff / student photo (and name / status) synchronisation.
--
-- Before this, the single authenticated Realtime channel DataContext.jsx opens per signed-in user
-- (`comms:<uid>`) only subscribed to the five communication tables (migration 20260903010000):
-- notifications / messages / conversations / announcements / activities. Nothing told an
-- already-open session that a *directory* row changed, so when one user uploaded a new profile
-- photo (writing `profiles.photo_url` + the mirrored `staff.photo_url`, or `students.photo_url`)
-- every other open session kept rendering the old avatar until a full browser refresh re-ran the
-- initial fetch.
--
-- Fix: add the three directory tables to the `supabase_realtime` publication so the SAME scoped
-- client subscription delivers their row changes. The client handler ignores the payload columns
-- and simply re-runs the existing RLS-scoped directory queries (teacherService.list /
-- staffService.list / studentService.list / directory_contacts), so:
--   * RLS still governs every delivered row -- Realtime replays the same policies as a normal
--     SELECT (profiles: every authenticated user, row-level; staff: Owner / Finance only;
--     students: Owner / Educational Director / Finance, the teacher of the class, the parent of
--     the child). A role that cannot SELECT a row never receives its change event.
--   * column privacy is untouched -- `authenticated` still lacks SELECT on profiles.email /
--     profiles.phone (migration 20260904010000), Realtime strips columns the subscriber cannot
--     read, and the handler reads nothing but the row id anyway.
-- No new RLS, no new grants, no replica-identity change (the client only needs the primary key,
-- which the default replica identity already publishes for UPDATE/DELETE).
--
-- Idempotent: guarded DO blocks for publication membership, mirroring migration 20260903010000.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff'
  ) then
    alter publication supabase_realtime add table public.staff;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students'
  ) then
    alter publication supabase_realtime add table public.students;
  end if;
end $$;
