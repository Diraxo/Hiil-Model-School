-- Finance announcement audiences are enforced by the DATABASE, not only by the pickers.
--
-- BACKGROUND
--   The web composer (AdminPages.jsx CreateAnnouncementModal) offers Finance & Operations only "All parents",
--   "All teachers", "One grade" and "One section". "All users", "Directors" and direct-user targeting are
--   Owner / Educational-Director-only. That rule lived ONLY in the UI: the announcements_insert policy is
--   `is_owner_or_admin() OR is_finance()` for any audience, and announcements_update lets the author rewrite
--   the row, so a Finance account calling the API directly (or a client with a picker bug) could insert
--   {"type":"ALL"} / {"type":"DIRECTORS"} / {"type":"USER",...} - or insert a legal audience and then UPDATE
--   it to a forbidden one - and notify_announcement would then dispatch it to everyone.
--
-- CHANGE
--   A BEFORE INSERT OR UPDATE OF audience trigger rejects any audience for a Finance caller whose "type" is not
--   one of ALL_PARENTS / ALL_TEACHERS / GRADE / SECTION. Owner and Educational Director are not touched (same
--   permissions as before). Teacher / Parent / anonymous callers are still refused by the announcements_insert
--   policy. The trusted backend (service role / SQL editor, no auth.uid()) is not a Finance caller and is unaffected.
--   The trigger fires only when the audience column is written, so a Finance author can still pin/unpin or edit
--   the text of their own older rows.
--
-- No data is read or changed. Rollback: supabase/rollbacks/20260920050000_rollback.sql

create or replace function public.enforce_announcement_audience()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(public.is_finance(), false)
     and coalesce(new.audience ->> 'type', '') not in ('ALL_PARENTS', 'ALL_TEACHERS', 'GRADE', 'SECTION') then
    raise exception 'Only the Owner or Educational Director may announce to everyone, to Directors, or to a single user. Finance & Operations may announce to all parents, all teachers, a grade or a section.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_announcement_audience() from public, anon, authenticated;

drop trigger if exists announcements_enforce_audience on public.announcements;
create trigger announcements_enforce_audience
  before insert or update of audience on public.announcements
  for each row
  execute function public.enforce_announcement_audience();
