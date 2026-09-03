-- Storage hardening, part 1 of 4: widen the `profile-photos` object policies so they also cover
-- staff records that have no login account (Other Staff), and so a staff-group manager
-- (Educational Director -> Teachers, Finance & Operations Director -> Other Staff, Owner ->
-- everyone) can write/replace/delete a photo for anyone in a group they manage.
--
-- BACKGROUND. 20260827010000 stood up `profile-photos` with write policies keyed only on
-- `staff.user_id` and the Teacher/Other-Staff split spelled out inline. The frontend has now been
-- wired to actually upload profile photos to this bucket (previously base64 in profiles.photo_url
-- / staff.photo_url). Object path convention:
--   profile-photos/<owner_id>/<filename>
-- where <owner_id> is the person's `profiles.id` (= auth.uid) when they have a login account
-- (Owner, Educational Director, Finance Director, Teacher, Parent), or their `staff.id` when the
-- staff record has no linked account (Other Staff). Both cases are covered below.
--
-- The read policy is unchanged in spirit (any active member of the school) and is re-created here
-- only so this migration is self-contained and re-runnable.

-- A caller may write/replace/delete an object at profile-photos/<owner_id>/... when:
--   * it is their own folder (owner_id = auth.uid), or
--   * they are the Owner, or
--   * <owner_id> identifies a staff row (by staff.id OR staff.user_id) whose staff group the
--     caller manages -- public.manages_staff_group() already encodes Owner=all,
--     Educational Director=Teachers, Finance Director=Other Staff.
-- Directors' own photos (ADMIN/FINANCE profiles, which have no staff row) are reachable only via
-- the self branch or the Owner branch, exactly like the `profiles` table policy.

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
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where ((storage.foldername(name))[1] in (s.id::text, s.user_id::text))
          and public.manages_staff_group(s.position)
      )
    )
  );

create policy "profile_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where ((storage.foldername(name))[1] in (s.id::text, s.user_id::text))
          and public.manages_staff_group(s.position)
      )
    )
  )
  with check (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where ((storage.foldername(name))[1] in (s.id::text, s.user_id::text))
          and public.manages_staff_group(s.position)
      )
    )
  );

create policy "profile_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
      or exists (
        select 1 from public.staff s
        where ((storage.foldername(name))[1] in (s.id::text, s.user_id::text))
          and public.manages_staff_group(s.position)
      )
    )
  );
