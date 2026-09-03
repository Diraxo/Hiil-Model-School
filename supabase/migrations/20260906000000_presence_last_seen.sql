-- Real presence for Messaging.
--
-- Before this, "online / last seen" and the "… is typing" indicator on the Messages page were
-- backed entirely by the browser: src/utils/presence.js wrote the current user's heartbeat into
-- window.localStorage and broadcast typing over a same-origin BroadcastChannel. Both are
-- per-browser -- two people on different devices never saw each other's status, so in a real
-- deployment the green dot and "Last seen …" line simply never appeared and the typing bubble
-- never fired. presence.js now uses Supabase Realtime Presence (online-now) + Realtime Broadcast
-- (typing); this migration adds the one piece Realtime cannot provide on its own -- a durable
-- "last seen" timestamp that survives the user disconnecting.
--
--   * profiles.last_seen_at -- stamped by touch_presence() on connect and on a ~25s heartbeat.
--   * touch_presence() -- SECURITY DEFINER so it can update the caller's own row without a broad
--     UPDATE policy on profiles (writes are otherwise funnelled through profiles_privilege_guard).
--     Scoped hard to `where id = auth.uid()`, so it can only ever touch the caller's own row.
--   * SELECT on the single column last_seen_at is granted to authenticated (additive to the
--     column list in 20260904010000_profiles_contact_privacy.sql). This is a deliberate,
--     low-sensitivity disclosure: any authenticated user can already read every profile's name,
--     photo and role, and a "last seen 5 minutes ago" line is normal messaging UX. email / phone
--     remain revoked. If presence ever needs to be hidden from parents, gate it behind an RPC the
--     same way directory_contacts() gates contact details -- the client only reads this column
--     through usePresenceMap().
--
-- Idempotent: add-column-if-not-exists, declarative grant, create-or-replace on the function.

alter table public.profiles add column if not exists last_seen_at timestamptz;

grant select (last_seen_at) on public.profiles to authenticated;

create or replace function public.touch_presence()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;
