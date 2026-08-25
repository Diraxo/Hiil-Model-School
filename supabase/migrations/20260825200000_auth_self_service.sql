-- Migration 9 of N: self-service auth RPCs for the frontend's Phase A conversion
-- (login/session/profile) to real Supabase Auth.
--
-- profiles_select_authenticated (migration 8) gates every read on the CALLER's own
-- current_role(), which is NULL for a non-ACTIVE profile -- so a SUSPENDED/DISABLED user
-- can authenticate with Supabase Auth (that layer knows nothing about `status`) but then
-- cannot read even their own profiles row, and the two statuses are indistinguishable from
-- an empty result alone. my_profile() is SECURITY DEFINER, bypasses RLS, and is scoped to
-- auth.uid() only (no caller-supplied id), so AuthContext can always resolve "who am I and
-- what's my status" right after sign-in and show the correct disabled/suspended message.

create or replace function public.my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

comment on function public.my_profile is
  'Returns the caller''s own profiles row regardless of status (bypasses profiles_select_authenticated), so the client can distinguish ACTIVE vs SUSPENDED vs DISABLED vs "no profile provisioned yet" right after Supabase Auth sign-in.';
