-- Migration 5 of N: announcements, notifications, conversations,
-- messages, activity feed.
--
-- notifications.payment_id has no FK yet -- the payments table doesn't
-- exist until the finance migration. The constraint is added there via
-- ALTER TABLE once it can reference it.
--
-- The mock app capped notifications' "activities" feed at 60 rows and
-- audit logs at 500 by discarding old entries from an in-memory array.
-- Real tables here keep full history; the app should read the most
-- recent N via `ORDER BY created_at DESC LIMIT N`, never delete rows to
-- enforce a display cap.

create type notification_type as enum (
  'ANNOUNCEMENT', 'PAYMENT', 'HOMEWORK', 'BEHAVIOR', 'MESSAGE',
  'RESULT', 'ATTENDANCE', 'LEAVE', 'EXAM', 'SCHEDULE', 'PAYROLL'
);

-- ---------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text,
  audience jsonb not null,
  priority text,
  author_id uuid references public.profiles (id) on delete set null,
  attachment_url text,
  pinned boolean not null default false,
  publish_at timestamptz,
  expires_at timestamptz,
  publish_notified boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

create index announcements_publish_at_idx on public.announcements (publish_at);

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  message text,
  image text,
  read boolean not null default false,
  type notification_type not null,
  announcement_id uuid references public.announcements (id) on delete set null,
  payment_id uuid,
  navigation jsonb,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create index notifications_user_read_idx on public.notifications (user_id, read);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- conversations / messages: 1:1 only. participant_1_id < participant_2_id
-- (enforced) so the unique pair constraint catches both orderings; use
-- public.get_or_create_conversation() to look up/create by an unordered
-- pair of user ids.
-- ---------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  participant_1_id uuid not null references public.profiles (id) on delete cascade,
  participant_2_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_ordered check (participant_1_id < participant_2_id),
  constraint conversations_pair_unique unique (participant_1_id, participant_2_id)
);

alter table public.conversations enable row level security;

create or replace function public.get_or_create_conversation(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lo uuid := least(user_a, user_b);
  hi uuid := greatest(user_a, user_b);
  conv_id uuid;
begin
  if user_a = user_b then
    raise exception 'A conversation requires two distinct participants';
  end if;

  select id into conv_id
    from public.conversations
    where participant_1_id = lo and participant_2_id = hi;

  if conv_id is null then
    insert into public.conversations (participant_1_id, participant_2_id)
      values (lo, hi)
      returning id into conv_id;
  end if;

  return conv_id;
end;
$$;

comment on function public.get_or_create_conversation is
  'SECURITY DEFINER so it can both read and insert under RLS regardless of caller -- callers are still restricted to conversations they participate in by the RLS policies on conversations/messages themselves (added in the RLS migration).';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- activities: global recent-activity feed
-- ---------------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  navigation jsonb,
  created_at timestamptz not null default now()
);

alter table public.activities enable row level security;

create index activities_created_at_idx on public.activities (created_at desc);
