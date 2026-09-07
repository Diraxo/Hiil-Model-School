-- Real parent self-registration: a parent creates their own Supabase Auth account and connects
-- their child(ren) using the Student ID the school gave them, without any Owner/Educational
-- Director involvement.
--
-- Why this couldn't just be a plain client insert (see the now-removed comment above
-- RegisterScreen in src/pages/auth/AuthPages.jsx and parent_students_insert in
-- 20260825190000_rls_policies.sql): profiles has NO insert policy at all (account creation is
-- normally an Auth-Admin/service-role operation, see manage-staff-account/index.ts), and
-- parent_students_insert is restricted to is_owner_or_admin(). Both stay exactly as they are --
-- this migration adds two narrowly-scoped SECURITY DEFINER entry points instead of loosening
-- either policy, matching the pattern established by my_profile() (20260825200000) and the
-- notify_*/log_activity RPCs (20260827000000): each function does its own auth.uid()-scoped
-- check and only ever acts on the caller's own rows.
--
-- Product decision (explicit, 2026-09-07): a valid, correctly-typed Student ID is treated as
-- sufficient proof of guardianship, same as the placeholder UI already implied ("Connect your
-- child using the Student ID given by the school") -- the school only ever hands that code
-- directly to a student's own family. No second factor (DOB, one-time code) is required.

-- ---------------------------------------------------------------------
-- 1. handle_new_parent_registration: provisions the `profiles` row for a self-registered parent.
--
-- Scoped to ONLY fire for self-registration signups (raw_user_meta_data ? 'self_registration'),
-- a marker set exclusively by AuthContext.signUp's supabase.auth.signUp({ options: { data } })
-- call. Admin-created staff/parent accounts go through manage-staff-account, which calls
-- auth.admin.createUser({ email, password, email_confirm: true }) with NO user_metadata and
-- inserts `profiles` itself via the service-role client -- this trigger's WHEN clause guarantees
-- it can never fire for, race, or double-insert against that path.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_parent_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, email, phone, status, must_change_password)
  values (
    new.id,
    'PARENT',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'ACTIVE',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_parent_registration is
  'Trigger target only -- provisions profiles for a self-registered parent. Never call directly.';

drop trigger if exists on_auth_user_self_registered on auth.users;
create trigger on_auth_user_self_registered
  after insert on auth.users
  for each row
  when (new.raw_user_meta_data ? 'self_registration')
  execute function public.handle_new_parent_registration();

-- ---------------------------------------------------------------------
-- 2. check_student_ids: live, pre-signup validation for the registration form. Returns only a
-- per-id status (never any student field), so a parent -- or anyone, this is intentionally
-- callable while still anonymous, same as resetPasswordForEmail's non-leaking design elsewhere in
-- this app -- can't learn anything about a student beyond "does this code exist / is it already
-- claimed", which the printed Student ID format (TMA-2026-00031, sequential) doesn't hide anyway.
-- ---------------------------------------------------------------------

create or replace function public.check_student_ids(p_student_ids text[])
returns table (input_id text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select
    x.input_id,
    case
      when s.id is null then 'not_found'
      when exists (select 1 from public.parent_students ps where ps.student_id = s.id) then 'already_linked'
      else 'available'
    end as status
  from unnest(p_student_ids) as x(input_id)
  left join public.students s on lower(trim(s.student_id)) = lower(trim(x.input_id));
$$;

comment on function public.check_student_ids is
  'Anon-callable pre-signup validation for the parent registration form. Returns only a status
   (not_found/already_linked/available) per submitted Student ID -- never any student field.';

-- ---------------------------------------------------------------------
-- 3. self_register_link_children: the atomic "link my newly-created account to these children"
-- step, called by AuthContext.signUp right after supabase.auth.signUp() establishes a session
-- (or, when the project has email confirmation enabled and no session comes back immediately, on
-- the parent's first successful login instead -- see AuthContext.login/signUp).
--
-- All-or-nothing by construction: every submitted id is resolved BEFORE any insert happens: if
-- ANY is invalid or already linked to a parent, the whole call raises and nothing is inserted, so
-- a registration can never leave a partial set of children connected.
-- ---------------------------------------------------------------------

create or replace function public.self_register_link_children(p_student_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_raw text;
  v_seen text[] := '{}';
  v_invalid text[] := '{}';
  v_taken text[] := '{}';
  v_resolved uuid[] := '{}';
  v_student_id uuid;
  v_linked_count int;
begin
  if v_caller is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.is_parent() then
    raise exception 'NOT_A_PARENT';
  end if;
  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'NO_STUDENT_IDS';
  end if;

  foreach v_raw in array p_student_ids loop
    v_raw := trim(v_raw);
    if v_raw = '' or v_raw = any (v_seen) then
      continue; -- blank/duplicate entries in the same submission are ignored, not errors
    end if;
    v_seen := array_append(v_seen, v_raw);

    select id into v_student_id from public.students where lower(student_id) = lower(v_raw);
    if v_student_id is null then
      v_invalid := array_append(v_invalid, v_raw);
    elsif exists (select 1 from public.parent_students where student_id = v_student_id) then
      v_taken := array_append(v_taken, v_raw);
    else
      v_resolved := array_append(v_resolved, v_student_id);
    end if;
  end loop;

  if array_length(v_invalid, 1) is not null then
    raise exception 'INVALID_STUDENT_IDS:%', array_to_string(v_invalid, ',');
  end if;
  if array_length(v_taken, 1) is not null then
    raise exception 'ALREADY_LINKED_STUDENT_IDS:%', array_to_string(v_taken, ',');
  end if;
  if array_length(v_resolved, 1) is null then
    raise exception 'NO_STUDENT_IDS';
  end if;

  insert into public.parent_students (parent_id, student_id)
  select v_caller, sid from unnest(v_resolved) as sid
  on conflict (parent_id, student_id) do nothing;

  get diagnostics v_linked_count = row_count;
  return jsonb_build_object('linked', v_linked_count);
end;
$$;

comment on function public.self_register_link_children is
  'Authenticated-parent-only. Atomically links the caller (auth.uid()) to every resolved student
   id, or raises INVALID_STUDENT_IDS:.../ALREADY_LINKED_STUDENT_IDS:... and inserts nothing at all
   if any submitted id fails validation. Called right after signUp (or on first post-confirmation
   login) by AuthContext -- never exposes another parent''s or student''s data beyond existence.';
