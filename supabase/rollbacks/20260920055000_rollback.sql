-- ROLLBACK for 20260920055000_timetable_entries_scoped_read.sql (NOT a migration; it lives in supabase/rollbacks/ so
-- `supabase db push` never runs it).
-- WARNING: this re-opens the hole - every signed-in account (Finance, other families' parents) can again read the whole
-- school timetable through the API. No data is touched.

drop policy if exists timetable_entries_select on public.timetable_entries;
create policy timetable_entries_select on public.timetable_entries
  for select using (public.current_role() is not null);

drop function if exists public.can_read_timetable_entry(uuid, uuid, uuid);
