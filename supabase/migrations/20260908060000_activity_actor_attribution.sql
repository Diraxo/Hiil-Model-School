-- GLOBAL RECENT ACTIVITY — ACTOR ATTRIBUTION
--
-- The `activities` feed (migration 20260825181253_comms.sql, hardened in
-- 20260903010000_phase6_comms_realtime.sql) records WHAT happened and WHEN, but has no columns
-- for WHO did it. Multiple Owner accounts share one school, so "a student was added" / "a payment
-- was recorded" must name the authenticated actor and their role for another authorized user to
-- see who performed it.
--
-- This migration is additive and safe on the live DB:
--   1. Three nullable snapshot columns on `activities`: actor_id (FK, set null on profile delete)
--      plus actor_name / actor_role captured AT WRITE TIME so a later profile rename never
--      rewrites history.
--   2. log_activity() (same 3-arg signature — no client change, no grant change) now resolves the
--      actor from auth.uid() SERVER-SIDE and stamps the snapshot. The client cannot supply an
--      actor, so it cannot make an action look like someone else performed it.
--
-- Existing historical rows keep NULL actor columns — the UI shows "Actor information unavailable"
-- for them rather than guessing. No RLS change: activities_select (STAFF / FINANCE visibility)
-- is unchanged, and the actor columns ride along with the row a caller was already entitled to
-- read. `activities` is already in the supabase_realtime publication (whole-row), so live inserts
-- carry the new columns with no publication change.

-- =====================================================================
-- 1. Snapshot columns
-- =====================================================================

alter table public.activities add column if not exists actor_id   uuid references public.profiles (id) on delete set null;
alter table public.activities add column if not exists actor_name text;
alter table public.activities add column if not exists actor_role user_role;

comment on column public.activities.actor_name is
  'Full name of the authenticated user who performed the action, snapshotted by log_activity at
   write time so a later profiles rename does not alter historical audit lines. NULL for rows
   written before migration 20260908060000.';
comment on column public.activities.actor_role is
  'Role of the authenticated actor at the moment of the action (OWNER/ADMIN/FINANCE/TEACHER),
   snapshotted for the same reason as actor_name.';

-- Optional: lets an audit view filter the feed by person without a profiles join.
create index if not exists activities_actor_id_idx on public.activities (actor_id);

-- =====================================================================
-- 2. log_activity — stamp the authenticated actor server-side
-- =====================================================================

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
  v_row  public.activities;
  v_name text;
  v_role user_role;
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

  -- Authoritative actor: the authenticated caller, never anything the client passed.
  select full_name, role into v_name, v_role
  from public.profiles
  where id = auth.uid();

  insert into public.activities (text, navigation, visibility, actor_id, actor_name, actor_role)
  values (p_text, p_navigation, coalesce(p_visibility, 'STAFF'), auth.uid(), v_name, v_role)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.log_activity(text, jsonb, text) from public;
grant execute on function public.log_activity(text, jsonb, text) to authenticated;
