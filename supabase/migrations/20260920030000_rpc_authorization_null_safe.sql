-- SECURITY REMEDIATION 1 of 2: role authorization must never treat "no active profile" as authorized.
--
-- ROOT CAUSE
--   public.current_role() (20260825190000) returns NULL for any caller without an ACTIVE profiles row
--   (no profile, SUSPENDED, DISABLED, or anonymous). Every role helper was written as
--   `current_role() = 'X'`, so for those callers is_owner()/is_admin()/is_finance()/is_teacher()/
--   is_parent() (and is_owner_or_admin()/is_owner_or_finance()) return NULL, not false. RLS policies
--   treat NULL as deny, but about 34 SECURITY DEFINER RPCs guard with `if not public.is_x() then raise`,
--   and `not NULL` is NULL: the guard silently does not fire. Verified on a replay of all production
--   migrations (function bodies are byte-identical to production): an anonymous caller, a caller with
--   no profile and a SUSPENDED/DISABLED Owner/Finance account all got past record_payment_batch,
--   void_payment, record_payroll_payment, record_salary_advance, add_obligation_adjustment,
--   create/update/delete_expense, the fee RPCs and every notify_* guard. Production also grants
--   EXECUTE on these RPCs to anon (confirmed against the live catalog: Supabase default privileges
--   grant anon explicitly, and older migrations only ran `revoke ... from public`), and
--   record_payment_batch's second check (`p_recorded_by is distinct from auth.uid()`) passes when both
--   are NULL, so an ANONYMOUS API call could record a payment.
--
-- FIX (smallest change that closes every caller at once)
--   1. The five leaf helpers become TOTAL: `coalesce(current_role() = 'X', false)`. For any caller
--      with an ACTIVE profile they already returned true/false and are unchanged, so no permission is
--      broadened or narrowed for a legitimate user. Only role-less callers change (NULL -> false).
--      is_owner_or_admin()/is_owner_or_finance() are `a or b` of total inputs and so are total too.
--      current_role() itself is deliberately NOT changed (`current_role() is not null` policies and the
--      results_select policies depend on it; the only two policies that negate a helper are AND-ed
--      with can_view_result(), which is false for role-less callers, so nothing flips to allow).
--   2. Two triggers (enforce_profile_privilege_guard, enforce_staff_financial_field_guard) relied on
--      that same NULL behaviour, by accident, to let the service-role Edge Function / SQL editor /
--      migrations through (they have no auth.uid()). With total helpers that would start rejecting
--      them, so the trusted-backend exemption is made explicit via public.is_trusted_backend().
--      (Not a live hole: a SUSPENDED user cannot reach their own profiles row through the API, because
--      the SELECT policy needs current_role() IS NOT NULL and an UPDATE must be able to read the row.
--      The trigger checks are made total for consistency and defence in depth.)
--   3. Functions guarded only by identity (auth.uid()) but with no active-account check now require
--      an active profile: get_or_create_conversation, notify_message, notify_leave_submitted,
--      notify_announcement (author branch), touch_presence, my_staff_record, my_payroll_payments,
--      my_salary_advances. my_profile() is untouched on purpose (clients use it to explain a
--      suspended state).
--   4. Grants: anon can execute exactly one public function (check_student_ids, used by the
--      pre-signup form); PUBLIC no longer holds EXECUTE on any of them, and authenticated /
--      service_role are granted explicitly. The two internal helpers (_insert_expense_items has NO
--      guard at all, _leave_admin_recipients) are callable by nobody but the SECURITY DEFINER
--      functions that use them (those run as the function owner, so they are unaffected).
--      Effect for anonymous table requests: they are still denied, but as `permission denied for
--      function ...` (the RLS helpers are no longer executable by anon) instead of an empty result.
--
-- ROLLBACK: see docs/SECURITY_REMEDIATION_REPORT.md (restores the previous function bodies and
--   grants; it re-opens the vulnerability and is for emergencies only).
-- Nothing here touches data. All statements are CREATE OR REPLACE / REVOKE and are idempotent.

-- ---------------------------------------------------------------------
-- 1. Total role helpers
-- ---------------------------------------------------------------------
create or replace function public.is_owner() returns boolean language sql stable
  security definer set search_path = public as $$ select coalesce(public.current_role() = 'OWNER', false) $$;
create or replace function public.is_admin() returns boolean language sql stable
  security definer set search_path = public as $$ select coalesce(public.current_role() = 'ADMIN', false) $$;
create or replace function public.is_finance() returns boolean language sql stable
  security definer set search_path = public as $$ select coalesce(public.current_role() = 'FINANCE', false) $$;
create or replace function public.is_teacher() returns boolean language sql stable
  security definer set search_path = public as $$ select coalesce(public.current_role() = 'TEACHER', false) $$;
create or replace function public.is_parent() returns boolean language sql stable
  security definer set search_path = public as $$ select coalesce(public.current_role() = 'PARENT', false) $$;

-- ---------------------------------------------------------------------
-- 2. Explicit trusted-backend context (replaces an accidental NULL pass-through in two triggers)
--    True only when there is NO end-user identity AND the request is not an anon/authenticated API
--    call: the service-role key (Edge Function), the SQL editor, migrations and GoTrue's own
--    database session. Anonymous API requests carry role=anon and are never trusted.
-- ---------------------------------------------------------------------
create or replace function public.is_trusted_backend() returns boolean language sql stable
  set search_path = public as $$
  select auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated')
$$;
create or replace function public.enforce_profile_privilege_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Trusted backend (service-role Edge Function, SQL editor, migrations): no end-user identity to
  -- authorize. This is the behaviour these callers always had, now stated instead of accidental.
  if public.is_trusted_backend() then
    return new;
  end if;
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception 'Only the Owner may change a user''s role';
  end if;
  if new.status is distinct from old.status then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own account status';
    end if;
    if not (
      public.is_owner()
      or (public.is_admin() and exists (
        select 1 from public.staff s where s.user_id = new.id and s.position = 'Teacher'
      ))
      or (public.is_finance() and exists (
        select 1 from public.staff s where s.user_id = new.id
          and public.staff_group_for_position(s.position) = 'Other Staff'
      ))
    ) then
      raise exception 'Not authorized to change this account''s status';
    end if;
  end if;
  if new.must_change_password is distinct from old.must_change_password and new.id <> auth.uid() and not public.is_owner() then
    raise exception 'Not authorized to change must_change_password for another user';
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_staff_financial_field_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.is_trusted_backend() then
    return new;
  end if;
  if (new.salary is distinct from old.salary or new.payment_schedule is distinct from old.payment_schedule)
     and not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may change salary or payment schedule';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Identity-only functions now also require an ACTIVE profile
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(user_a uuid, user_b uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  lo uuid := least(user_a, user_b);
  hi uuid := greatest(user_a, user_b);
  conv_id uuid;
begin
  if auth.uid() is null or public.current_role() is null or auth.uid() not in (user_a, user_b) then
    raise exception 'You may only create a conversation you participate in';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.notify_message(p_message_id uuid, p_title text, p_message text, p_navigation jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_msg public.messages;
  v_conv public.conversations;
  v_recipient uuid;
begin
  if public.current_role() is null then
    raise exception 'Not authorized';
  end if;
  select * into v_msg from public.messages where id = p_message_id;
  if not found then
    raise exception 'Message % not found', p_message_id;
  end if;
  if v_msg.sender_id is distinct from auth.uid() then
    raise exception 'Only the message sender may send its notification';
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if auth.uid() not in (v_conv.participant_1_id, v_conv.participant_2_id) then
    raise exception 'Not a participant in this conversation';
  end if;
  -- Idempotent: one notification per message id.
  if exists (
    select 1 from public.notifications
    where type = 'MESSAGE' and (navigation ->> 'messageId') = p_message_id::text
  ) then
    return 0;
  end if;

  v_recipient := case when v_conv.participant_1_id = auth.uid()
                      then v_conv.participant_2_id else v_conv.participant_1_id end;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_recipient, p_title, p_message, 'MESSAGE',
          coalesce(p_navigation, '{}'::jsonb)
            || jsonb_build_object('page', 'messages', 'userId', v_msg.sender_id,
                                  'messageId', p_message_id));
  return 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_leave_submitted(p_leave_request_id uuid, p_title text, p_message text, p_navigation jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lr public.leave_requests;
  v_count integer := 0;
begin
  if public.current_role() is null then
    raise exception 'Not authorized';
  end if;
  select * into v_lr from public.leave_requests where id = p_leave_request_id;
  if not found then
    raise exception 'Leave request % not found', p_leave_request_id;
  end if;
  -- leave_requests_insert requires requested_by = auth.uid(); only the submitter notifies.
  if v_lr.requested_by is distinct from auth.uid() then
    raise exception 'Only the request submitter may send the submission notification';
  end if;
  if v_lr.submitted_notified then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select rec.recipient_id, p_title, p_message, 'LEAVE', p_navigation
  from public._leave_admin_recipients(p_leave_request_id) as rec;
  get diagnostics v_count = row_count;

  update public.leave_requests set submitted_notified = true where id = p_leave_request_id;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_announcement(p_announcement_id uuid, p_title text, p_message text, p_navigation jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ann public.announcements;
  v_count integer := 0;
begin
  select * into v_ann from public.announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement % not found', p_announcement_id;
  end if;
  -- announcements_insert policy = is_owner_or_admin() OR is_finance(), with author_id stamped
  -- server-side; only the author (or an Owner/Educational Director) may dispatch it.
  if not (public.is_owner_or_admin() or (v_ann.author_id = auth.uid() and public.current_role() is not null)) then
    raise exception 'Not authorized to dispatch this announcement';
  end if;
  -- Not yet due, or already dispatched -> no-op (idempotent; safe for a polling caller).
  if v_ann.publish_notified or (v_ann.publish_at is not null and v_ann.publish_at > now()) then
    return 0;
  end if;

  with recipients as (
    select p.id as user_id
    from public.profiles p
    where p.status = 'ACTIVE'
      and (
        case v_ann.audience ->> 'type'
          when 'ALL' then true
          when 'ALL_PARENTS' then p.role = 'PARENT'
          when 'ALL_TEACHERS' then p.role = 'TEACHER'
          when 'USER' then p.id::text = (v_ann.audience ->> 'userId')
          when 'DIRECTORS' then exists (
            select 1 from public.staff s
            where s.user_id = p.id
              and public.staff_group_for_position(s.position) = 'Directors'
          )
          when 'GRADE' then p.role = 'PARENT' and exists (
            select 1 from public.parent_students ps
            join public.students st on st.id = ps.student_id
            where ps.parent_id = p.id and st.status = 'ACTIVE'
              and st.grade = (v_ann.audience ->> 'grade')
          )
          when 'SECTION' then p.role = 'PARENT' and exists (
            select 1 from public.parent_students ps
            join public.students st on st.id = ps.student_id
            where ps.parent_id = p.id and st.status = 'ACTIVE'
              and st.grade = (v_ann.audience ->> 'grade')
              and st.section = (v_ann.audience ->> 'section')
          )
          else false
        end
      )
  )
  insert into public.notifications (user_id, title, message, type, navigation, announcement_id)
  select user_id, p_title, p_message, 'ANNOUNCEMENT', p_navigation, p_announcement_id
  from recipients;
  get diagnostics v_count = row_count;

  update public.announcements set publish_notified = true where id = p_announcement_id;
  return v_count;
end;
$function$;

create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.user_presence (user_id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null and public.current_role() is not null
  on conflict (user_id) do update set last_seen_at = now();
$function$;

create or replace function public.my_staff_record()
returns staff
language sql
stable
security definer
set search_path to 'public'
as $function$
  select * from public.staff where user_id = auth.uid() and public.current_role() is not null;
$function$;

create or replace function public.my_payroll_payments()
returns setof payroll_payments
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.* from public.payroll_payments p
  join public.staff s on s.id = p.staff_id
  where s.user_id = auth.uid() and public.current_role() is not null;
$function$;

create or replace function public.my_salary_advances()
returns setof salary_advances
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.* from public.salary_advances a
  join public.staff s on s.id = a.staff_id
  where s.user_id = auth.uid() and public.current_role() is not null;
$function$;

-- ---------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------
-- anon may call exactly one function: the pre-signup Student ID check. Several older functions never
-- had `revoke ... from public`, and every role (anon included) inherits PUBLIC, so revoking from anon
-- alone is not enough: revoke from PUBLIC and anon, and grant explicitly to the roles that legitimately
-- call functions. The RLS helper functions stay executable by authenticated (policies evaluate them as
-- the caller); an anonymous table request is denied by RLS either way.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and p.proname <> 'check_student_ids'
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end
$$;

-- Internal helpers: only the SECURITY DEFINER callers (which run as the function owner) need them.
-- (_insert_expense_items has no guard of its own; it must never be reachable through the Data API.)
revoke all on function public._insert_expense_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._leave_admin_recipients(uuid) from public, anon, authenticated;
revoke all on function public.is_trusted_backend() from public, anon, authenticated;
