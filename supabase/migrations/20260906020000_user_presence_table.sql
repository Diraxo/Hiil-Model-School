-- Move the messaging "last seen" heartbeat OFF the profiles table.
--
-- 20260906000000 put `profiles.last_seen_at` on the profiles row and had touch_presence() write it
-- on connect + on a ~25s heartbeat (src/utils/presence.js). That was fine on its own, but the
-- profile-photo real-time sync (migration 20260906010000) adds `public.profiles` to the
-- `supabase_realtime` publication so every open session is notified when a directory row changes.
-- With the heartbeat still on profiles, that notification would also fire every 25 seconds for
-- every user -- an N-by-N storm of change events whose only content is a moved timestamp.
--
-- Fix: a dedicated one-row-per-user `user_presence` table. touch_presence() upserts there instead;
-- `profiles` UPDATEs now happen only on real profile edits (name / photo / phone / status), which
-- is exactly the signal the photo-sync subscription wants. `user_presence` is NOT added to the
-- realtime publication -- usePresenceMap() polls it on an interval (unchanged behaviour), and
-- "online now" is still Realtime Presence, untouched.
--
-- Idempotent: create-if-not-exists, guarded back-fill, create-or-replace on the function,
-- drop-column-if-exists.

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;

-- Same low-sensitivity disclosure the previous migration documented: any authenticated user may
-- read "last seen" (normal messaging UX). No INSERT/UPDATE/DELETE policy -- writes go only through
-- the SECURITY DEFINER touch_presence() RPC, scoped hard to the caller's own row.
drop policy if exists user_presence_select on public.user_presence;
create policy user_presence_select on public.user_presence
  for select using (public.current_role() is not null);

grant select on public.user_presence to authenticated;

-- Carry across whatever the profiles column already holds (no-op if 20260906000000 was never
-- applied, or if it was already superseded).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'last_seen_at'
  ) then
    insert into public.user_presence (user_id, last_seen_at)
    select id, last_seen_at from public.profiles where last_seen_at is not null
    on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
  end if;
end $$;

create or replace function public.touch_presence()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.user_presence (user_id, last_seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now();
$$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

alter table public.profiles drop column if exists last_seen_at;
