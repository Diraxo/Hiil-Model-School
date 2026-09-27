-- Rollback for 20260927000000_push_devices_actor_delivery.sql.
-- Removes the push tables/RPCs/trigger/column and restores the ORIGINAL notification update guard
-- (20260825190000_rls_policies.sql). Notification history rows themselves are untouched.
drop table if exists public.push_deliveries;

drop function if exists public.set_device_push_enabled(text, boolean);
drop function if exists public.unregister_device_token(text);
drop function if exists public.register_device_token(text, text, text, text);
drop table if exists public.device_tokens;

drop trigger if exists notifications_set_actor on public.notifications;
drop function if exists public.set_notification_actor();

-- The guard must stop referencing actor_user_id BEFORE the column is dropped.
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
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the read flag may be updated on a notification';
  end if;
  return new;
end;
$$;

alter table public.notifications drop column if exists actor_user_id;
