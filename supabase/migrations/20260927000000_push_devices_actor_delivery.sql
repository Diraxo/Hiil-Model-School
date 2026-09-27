-- Push notifications (FCM) for the web PWA + mobile app. Additive only; no existing policy, RPC
-- signature or business rule changes. Supabase's `notifications` table stays the source of truth;
-- FCM is only a delivery layer driven by an INSERT webhook -> `push-fanout` Edge Function.
--
--  1. device_tokens       one row per (user, install). platform: android | ios | web. Written ONLY through
--                         register_device_token / unregister_device_token / set_device_push_enabled
--                         (ownership = auth.uid(), never a client-supplied id). No client table access.
--  2. notifications.actor_user_id
--                         WHO caused the notification, stamped server-side from auth.uid() by a BEFORE INSERT
--                         trigger. Every notify_* RPC is SECURITY DEFINER but runs inside the caller's
--                         session, so auth.uid() is the real actor and no RPC needed to change. The
--                         recipient can never rewrite it (update guard extended).
--  3. push_deliveries     per (notification, device) delivery ledger, service-role only: makes webhook
--                         redelivery idempotent (never a duplicate push) and records failures.
--
-- This supersedes the unapplied draft hiil-mobile/backend/migrations/20260920060000_mobile_device_tokens.sql
-- (same RPC signatures; it additionally allows platform 'web'). Apply ONE of them, not both.

-- ---------------------------------------------------------------------------------------------
-- 1. device_tokens
-- ---------------------------------------------------------------------------------------------
create table public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_id    text not null check (char_length(device_id) between 8 and 64),  -- random per install, generated client-side
  token        text not null check (char_length(token) between 32 and 4096),   -- FCM registration token
  platform     text not null check (platform in ('android', 'ios', 'web')),
  app_version  text check (app_version is null or char_length(app_version) <= 64),
  enabled      boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, device_id)
);

-- A physical registration token belongs to exactly one row, so it can never be delivered to two users.
create unique index device_tokens_token_uidx on public.device_tokens (token);
create index device_tokens_user_idx on public.device_tokens (user_id);

comment on table public.device_tokens is
  'FCM registration tokens (web PWA + mobile). Written ONLY through the register/unregister RPCs; read only by the push-fanout Edge Function (service role). Tokens are never exposed to other users.';

alter table public.device_tokens enable row level security;
-- Deliberately NO policies for anon/authenticated. Supabase default privileges grant table access to
-- them, so revoke explicitly as well: direct table access is denied twice over.
revoke all on public.device_tokens from anon, authenticated;

create or replace function public.register_device_token(
  p_token       text,
  p_platform    text,
  p_device_id   text,
  p_app_version text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Explicit NULL-safe active check (an `if not is_x()` shortcut would not fire for NULL).
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ACTIVE') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if p_token is null or p_device_id is null or p_platform is null then
    raise exception 'token, platform and device id are required' using errcode = '22023';
  end if;

  -- One phone, one user at a time: when someone else signs in on this device (or the token moves),
  -- drop the previous owner's row so their alerts stop arriving here.
  delete from public.device_tokens where token = p_token and not (user_id = v_uid and device_id = p_device_id);
  delete from public.device_tokens where device_id = p_device_id and user_id <> v_uid;

  insert into public.device_tokens (user_id, device_id, token, platform, app_version)
  values (v_uid, p_device_id, p_token, p_platform, p_app_version)
  on conflict (user_id, device_id) do update
    set token = excluded.token,
        platform = excluded.platform,
        app_version = excluded.app_version,
        enabled = true,
        last_seen_at = now(),
        updated_at = now();
end;
$$;

create or replace function public.unregister_device_token(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.device_tokens where user_id = v_uid and device_id = p_device_id;
end;
$$;

-- Pause / resume pushes for THIS install without forgetting it (the caller's own row only).
create or replace function public.set_device_push_enabled(p_device_id text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'enabled flag is required' using errcode = '22023';
  end if;
  update public.device_tokens
     set enabled = p_enabled, updated_at = now()
   where user_id = v_uid and device_id = p_device_id;
end;
$$;

revoke all on function public.register_device_token(text, text, text, text) from public, anon;
revoke all on function public.unregister_device_token(text) from public, anon;
revoke all on function public.set_device_push_enabled(text, boolean) from public, anon;
grant execute on function public.register_device_token(text, text, text, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;
grant execute on function public.set_device_push_enabled(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. notifications.actor_user_id (server-stamped)
-- ---------------------------------------------------------------------------------------------
alter table public.notifications
  add column actor_user_id uuid references public.profiles (id) on delete set null;

comment on column public.notifications.actor_user_id is
  'The signed-in user whose action caused this notification, stamped by trigger from auth.uid(); NULL for system events or self-notifications. Never client-supplied.';

create or replace function public.set_notification_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Always overwrite: whatever an INSERT statement claims, the actor is the authenticated caller.
  new.actor_user_id := auth.uid();
  if new.actor_user_id = new.user_id then
    new.actor_user_id := null; -- a person notifying themselves has no separate actor to show
  end if;
  return new;
end;
$$;

create trigger notifications_set_actor
  before insert on public.notifications
  for each row
  execute function public.set_notification_actor();

-- Same guard as before (only `read` is recipient-editable), plus actor_user_id. The FK's
-- `on delete set null` fires this trigger when an actor's profile is deleted, so a change TO null
-- is allowed; any other change (spoofing a different actor) is rejected.
create or replace function public.enforce_notification_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.type is distinct from old.type
     or new.image is distinct from old.image
     or new.announcement_id is distinct from old.announcement_id
     or new.payment_id is distinct from old.payment_id
     or new.navigation is distinct from old.navigation
     or new.created_at is distinct from old.created_at
     or (new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null) then
    raise exception 'Only the read flag may be updated on a notification';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. push_deliveries (service role only)
-- ---------------------------------------------------------------------------------------------
create table public.push_deliveries (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  device_row_id   uuid not null references public.device_tokens (id) on delete cascade,
  status          text not null check (status in ('sent', 'failed')),
  attempts        integer not null default 1,
  error_code      text,
  updated_at      timestamptz not null default now(),
  primary key (notification_id, device_row_id)
);

comment on table public.push_deliveries is
  'Per (notification, device) FCM delivery ledger written by push-fanout. status=sent rows are skipped on webhook redelivery, so a retry never produces a duplicate push; failed rows are re-attempted.';

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
