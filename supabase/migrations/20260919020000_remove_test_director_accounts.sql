-- Follow-up to 20260919000000: remove the LOGIN ACCOUNTS of the same two test staff so they no
-- longer appear under Accounts & Access (Leadership Accounts / Staff Access — View as).
--
--   * ABDIRHAMAN MOHAMED ASKER (Educational Director) — garsadstyle@gmail.com — 9901bcf6-9a45-4a3c-974d-3cd03793ce8e
--   * M.Kader Sheikh Dayib     (Finance Director)     — inashdayib@gmail.com   — a229c042-d152-4ab4-b988-3ab35e0ac114
--
-- Deleting the auth.users row cascades their profiles, notifications and user_presence rows
-- (no timetable/leave/message/announcement/payment rows reference them). The Recent Activity
-- lines that name either person are removed too. Scoped to these two ids / names only.

do $$
begin
  delete from public.activities
   where text ilike '%M.Kader Sheikh Dayib%'
      or text ilike '%ABDIRHAMAN MOHAMED ASKER%'
      or actor_id in ('9901bcf6-9a45-4a3c-974d-3cd03793ce8e', 'a229c042-d152-4ab4-b988-3ab35e0ac114')
      or actor_name in ('M.Kader Sheikh Dayib', 'ABDIRHAMAN MOHAMED ASKER');

  delete from auth.users
   where id in ('9901bcf6-9a45-4a3c-974d-3cd03793ce8e', 'a229c042-d152-4ab4-b988-3ab35e0ac114');

  if exists (select 1 from public.profiles
              where id in ('9901bcf6-9a45-4a3c-974d-3cd03793ce8e', 'a229c042-d152-4ab4-b988-3ab35e0ac114')) then
    raise exception 'test director account cleanup incomplete';
  end if;
end $$;
