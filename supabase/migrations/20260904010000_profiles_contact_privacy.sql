-- Phase 7 F1: profiles.email / profiles.phone were readable by every authenticated user.
-- profiles_select_authenticated is a row-only policy (USING current_role() IS NOT NULL), so any
-- PARENT could `select * from profiles` and read every staff member's and every other parent's
-- email + phone.
--
-- Fix, narrowest form:
--   * Drop the blanket table-level SELECT grant and re-grant SELECT on the non-sensitive columns
--     only. Postgres column-level REVOKE cannot carve a column out of a table-wide grant, so the
--     table grant has to go and be replaced by an explicit column list. email + phone are the
--     only columns left out. Every other column (id, full_name, role, photo_url, status, name
--     parts, timestamps) stays readable under the SAME existing RLS policy, so name / avatar /
--     role resolution across the app is untouched.
--   * anon loses profiles SELECT entirely -- nothing pre-login reads the table (AuthContext uses
--     the my_profile() SECURITY DEFINER RPC), and the RLS policy already returned 0 rows to anon.
--   * directory_contacts() -- SECURITY DEFINER RPC returning (id, email, phone) ONLY for the
--     accounts the caller administers: always self; Owner -> everyone; Educational Director ->
--     Teachers + Parents; Finance & Operations Director -> Other Staff. The three account-list
--     services (parent / teacher / director) merge it back in, so an Owner/Director still sees
--     contact details in the management UIs while a Parent/Teacher session gets blanks for
--     everyone but themselves. my_profile() already returns the caller's own full row.
--
-- Idempotent: revoke/grant are declarative; create-or-replace on the function.

revoke select on public.profiles from anon, authenticated;

grant select (
  id, role, full_name, first_name, middle_name, last_name,
  photo_url, status, must_change_password, created_at, updated_at
) on public.profiles to authenticated;

create or replace function public.directory_contacts()
returns table (id uuid, email text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.phone
  from public.profiles p
  where
    p.id = auth.uid()
    or public.is_owner()
    or (public.is_owner_or_admin() and p.role in ('TEACHER', 'PARENT'))
    or (public.is_finance() and exists (
      select 1 from public.staff s
      where s.user_id = p.id
        and public.staff_group_for_position(s.position) = 'Other Staff'
    ));
$$;

revoke all on function public.directory_contacts() from public;
grant execute on function public.directory_contacts() to authenticated;
