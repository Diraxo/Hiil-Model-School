-- Storage hardening, follow-up fix: the `profile-photos` manager branch never matched.
--
-- 20260827010000 and then 20260905000000 both wrote the "a staff-group manager may write another
-- person's photo" branch as:
--     exists (select 1 from public.staff s
--             where (storage.foldername(name))[1] in (s.id::text, s.user_id::text) and ...)
-- Inside that sub-select `name` is UNQUALIFIED, and `public.staff` has its own `name` column
-- (the person's display name), so Postgres binds `name` to `staff.name` -- not the storage
-- object key. `storage.foldername('Amina Yusuf')[1]` is never a uuid, so the whole branch is
-- dead: on the live database only the object's own folder (self) or `is_owner()` can
-- insert/update/delete a `profile-photos` object. The Educational Director (Teachers) and the
-- Finance & Operations Director (Other Staff) cannot manage a photo for someone in the group
-- they administer, even though the app (DataContext.updateTeacher / addTeacher, staffService)
-- is wired to let them.
--
-- Fix: qualify the folder segment as `objects.name` (the same pattern the student_* / result_*
-- policies already use) so it refers to the storage object, and re-create the three write
-- policies. Read policy is unchanged and re-created only for self-containment.

drop policy if exists "profile_photos_read"   on storage.objects;
drop policy if exists "profile_photos_insert" on storage.objects;
drop policy if exists "profile_photos_update" on storage.objects;
drop policy if exists "profile_photos_delete" on storage.objects;

create policy "profile_photos_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and public.current_role() is not null);

create policy "profile_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(objects.name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where (storage.foldername(objects.name))[1] in (s.id::text, s.user_id::text)
          and public.manages_staff_group(s.position)
      )
    )
  );

create policy "profile_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(objects.name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where (storage.foldername(objects.name))[1] in (s.id::text, s.user_id::text)
          and public.manages_staff_group(s.position)
      )
    )
  )
  with check (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(objects.name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where (storage.foldername(objects.name))[1] in (s.id::text, s.user_id::text)
          and public.manages_staff_group(s.position)
      )
    )
  );

create policy "profile_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(objects.name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where (storage.foldername(objects.name))[1] in (s.id::text, s.user_id::text)
          and public.manages_staff_group(s.position)
      )
    )
  );
