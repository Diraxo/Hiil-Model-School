-- Phase 6: communications domain (notifications / announcements / messages / conversations /
-- activity feed) frontend conversion from the mock runtime to real Supabase.
--
-- Everything structural already exists:
--   * tables + RLS  -- migration 20260825181253_comms.sql + 20260825190000_rls_policies.sql
--   * 20 notify_* fan-out RPCs + log_activity + get_or_create_conversation
--       -- migration 20260827000000_notification_and_activity_rpcs.sql (deployed & verified, Phase A)
--
-- This migration adds only what the frontend conversion needs on top:
--   1. Defence-in-depth: REVOKE the blanket INSERT privilege PostgREST/Supabase grants by
--      default on `notifications` and `activities`. Migration 8 documented that these tables
--      have NO INSERT *policy* (so RLS already denies a direct client insert), but the
--      table-level GRANT to `anon` / `authenticated` was never actually revoked. The notify_*
--      / log_activity SECURITY DEFINER RPCs remain the only write path.
--   2. announcement_read_stats(uuid[]) -- an author/admin oversight read. The AnnouncementsPage
--      "N/M read" figure needs a cross-user count of ANNOUNCEMENT notification rows, which
--      ordinary RLS (notifications_select = user_id = auth.uid()) cannot provide. SECURITY
--      DEFINER, gated to the announcement author or an Owner/Educational Director.
--   3. Realtime: add the five communication tables to the `supabase_realtime` publication so a
--      scoped client subscription (notifications for auth.uid(), messages/conversations for the
--      caller's conversations) delivers live inserts. RLS still governs every delivered row --
--      Realtime replays the same policies as a normal SELECT.
--   4. A couple of supporting indexes for the new query patterns.
--
-- Idempotent: create-or-replace throughout; guarded DO blocks for the publication membership.

-- =====================================================================
-- 1. REVOKE the default INSERT grant (RLS already denies; this is belt-and-braces)
-- =====================================================================

revoke insert on public.notifications from anon, authenticated;
revoke insert on public.activities   from anon, authenticated;
revoke insert on public.conversations from anon, authenticated;
-- messages INSERT stays (messages_insert policy enforces sender_id = auth.uid() + membership).
-- announcements INSERT stays (announcements_insert policy enforces role; author stamped by trigger).

-- The global activity feed is a STAFF operational log -- migration 8's activities_select allowed
-- any role with a profile (PARENT included) to read it, which was harmless while only staff
-- dashboards rendered it but becomes a real leak now the frontend fetches it directly.
--
-- Add a `visibility` column so the handful of lines that quote personal salary figures
-- (payroll payments / advances) are readable only by the Owner and Finance & Operations
-- Director -- a Teacher can otherwise reconstruct colleagues' pay from the feed text. Everything
-- else stays 'STAFF' (all four staff roles), matching the mock's behaviour and every
-- activity-feed consumer (all staff-only screens).
alter table public.activities add column if not exists visibility text not null default 'STAFF';
alter table public.activities drop constraint if exists activities_visibility_chk;
alter table public.activities add constraint activities_visibility_chk
  check (visibility in ('STAFF', 'FINANCE'));

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select using (
    case visibility
      when 'FINANCE' then public.is_owner_or_finance()
      else public.current_role()::text in ('OWNER', 'ADMIN', 'FINANCE', 'TEACHER')
    end
  );

-- log_activity gains an optional visibility arg (default 'STAFF'). Drop the old 2-arg overload
-- (nothing but this app's activityService calls it) so there's exactly one signature.
drop function if exists public.log_activity(text, jsonb);
create or replace function public.log_activity(
  p_text text,
  p_navigation jsonb default null,
  p_visibility text default 'STAFF'
)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.activities;
begin
  if not (public.is_owner() or public.is_admin() or public.is_finance() or public.is_teacher()) then
    raise exception 'Only staff may write to the activity feed';
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'Activity text is required';
  end if;
  if coalesce(p_visibility, 'STAFF') not in ('STAFF', 'FINANCE') then
    raise exception 'Invalid activity visibility';
  end if;

  insert into public.activities (text, navigation, visibility)
  values (p_text, p_navigation, coalesce(p_visibility, 'STAFF'))
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.log_activity(text, jsonb, text) from public;
grant execute on function public.log_activity(text, jsonb, text) to authenticated;

-- =====================================================================
-- 2. announcement_read_stats -- cross-user read counts for the author/admin oversight view
-- =====================================================================

create or replace function public.announcement_read_stats(p_announcement_ids uuid[])
returns table (announcement_id uuid, total integer, read_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_owner_or_admin() or public.is_finance() or public.is_teacher()) then
    raise exception 'Not authorized to read announcement statistics';
  end if;

  return query
  select a.id as announcement_id,
         count(n.id)::integer as total,
         count(n.id) filter (where n.read)::integer as read_count
  from public.announcements a
  left join public.notifications n
    on n.announcement_id = a.id and n.type = 'ANNOUNCEMENT'
  where a.id = any (p_announcement_ids)
    -- only the author (or an Owner/Educational Director) gets real numbers for a given row;
    -- everyone else gets it folded to zero rather than an error, so a mixed id list is fine.
    and (public.is_owner_or_admin() or a.author_id = auth.uid())
  group by a.id;
end;
$$;

revoke all on function public.announcement_read_stats(uuid[]) from public;
grant execute on function public.announcement_read_stats(uuid[]) to authenticated;

-- =====================================================================
-- 3. Realtime publication membership
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activities'
  ) then
    alter publication supabase_realtime add table public.activities;
  end if;
end $$;

-- =====================================================================
-- 4. Supporting indexes
-- =====================================================================

-- notify_message idempotency guard does `where type = 'MESSAGE' and navigation ->> 'messageId' = ...`
create index if not exists notifications_message_nav_idx
  on public.notifications ((navigation ->> 'messageId')) where type = 'MESSAGE';

-- announcement_read_stats joins notifications by announcement_id
create index if not exists notifications_announcement_id_idx
  on public.notifications (announcement_id) where announcement_id is not null;
