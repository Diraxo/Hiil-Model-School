-- Migration 13 of N: Supabase Storage buckets + object-level RLS.
--
-- Migrations 4/6 flagged that several file fields are `*_url` text columns "pointing at Supabase
-- Storage objects -- see the Storage migration that comes later, once buckets/policies are
-- designed." This is that migration.
--
-- CURRENT STATE (Phase A audit, 2026-09-01): the frontend still writes base64 data-URIs into
-- those text columns. The only tables that actually hold any data today are the converted ones:
--   * profiles.photo_url          -- data-URI (AuthContext.updateOwnProfile)
--   * students.photo_url          -- data-URI (studentService.studentPayload)
--   * student_documents.file_url  -- data-URI (studentService.createDocument)
-- Every other file column (homework.attachment_url, result_evidence.file_url,
-- expenses.receipt_image_url, ...) belongs to an unconverted domain and has ZERO rows.
-- This migration does NOT migrate any existing base64 data (see the Phase A report, section 5):
-- it only stands up the buckets + policies so the Phase B frontend uploads NEW files to Storage
-- instead of creating new base64. A dedicated backfill migration for the three columns above is
-- left for later and is low-risk (small row counts, nullable columns).
--
-- All buckets are PRIVATE (public = false). Objects are reached only through the Supabase client
-- with the caller's session; every bucket's object policies below mirror the RLS on the
-- corresponding database record, reusing the exact same helper functions
-- (20260825190000_rls_policies.sql) so Storage access can never drift from row access.
--
-- OBJECT PATH CONVENTIONS (the Phase B upload code MUST follow these -- the policies parse the
-- first one or two path segments to find the owning record):
--   profile-photos/<profile_id>/<filename>
--   student-photos/<student_id>/<filename>
--   student-documents/<student_id>/<filename>
--   result-evidence/<result_id>/<assessment_component>/<filename>
--   receipts/<payment_id>/<filename>
-- (storage.foldername(name) returns the folder segments as text[]; [1] is the first, [2] the
--  second. A path with no folder yields NULL for [1] and every policy below fails closed.)

-- =====================================================================
-- Buckets
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-photos',    'profile-photos',    false,  5 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('student-photos',     'student-photos',     false,  5 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('student-documents',  'student-documents',  false, 20 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('result-evidence',    'result-evidence',    false, 20 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('receipts',           'receipts',           false, 20 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase. Policies are additive and namespaced by
-- bucket_id so they never touch objects in buckets this migration does not own. Each is dropped
-- first so the migration is safe to re-run.
--
-- DEPLOYMENT NOTE: `create policy ... on storage.objects` normally succeeds under `supabase db
-- push` (runs as `postgres`), but on some projects it raises `42501: must be owner of table
-- objects`. If that happens, run everything from the first `drop policy` below through the end
-- of this file in the Dashboard -> SQL Editor (which executes with sufficient rights). The
-- bucket INSERT above is unaffected.

drop policy if exists "profile_photos_read"      on storage.objects;
drop policy if exists "profile_photos_insert"    on storage.objects;
drop policy if exists "profile_photos_update"    on storage.objects;
drop policy if exists "profile_photos_delete"    on storage.objects;
drop policy if exists "student_photos_read"      on storage.objects;
drop policy if exists "student_photos_insert"    on storage.objects;
drop policy if exists "student_photos_update"    on storage.objects;
drop policy if exists "student_photos_delete"    on storage.objects;
drop policy if exists "student_documents_read"   on storage.objects;
drop policy if exists "student_documents_insert" on storage.objects;
drop policy if exists "student_documents_delete" on storage.objects;
drop policy if exists "result_evidence_read"     on storage.objects;
drop policy if exists "result_evidence_insert"   on storage.objects;
drop policy if exists "result_evidence_delete"   on storage.objects;
drop policy if exists "receipts_read"            on storage.objects;
drop policy if exists "receipts_insert"          on storage.objects;
drop policy if exists "receipts_update"          on storage.objects;
drop policy if exists "receipts_delete"          on storage.objects;

-- =====================================================================
-- profile-photos
--   read  : any authenticated ACTIVE member of the school (mirrors profiles_select_authenticated)
--   write : the profile owner themselves, or Owner, or the manager of that profile's staff group
--           (Educational Director -> Teachers, Finance & Operations Director -> Other Staff) --
--           mirrors profiles_update_self_or_manager.
-- =====================================================================

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
      or (public.is_admin() and exists (
        select 1 from public.staff s
        where s.user_id::text = (storage.foldername(name))[1] and s.position = 'Teacher'
      ))
      or (public.is_finance() and exists (
        select 1 from public.staff s
        where s.user_id::text = (storage.foldername(name))[1]
          and public.staff_group_for_position(s.position) = 'Other Staff'
      ))
    )
  );

create policy "profile_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
      or (public.is_admin() and exists (
        select 1 from public.staff s
        where s.user_id::text = (storage.foldername(name))[1] and s.position = 'Teacher'
      ))
      or (public.is_finance() and exists (
        select 1 from public.staff s
        where s.user_id::text = (storage.foldername(name))[1]
          and public.staff_group_for_position(s.position) = 'Other Staff'
      ))
    )
  )
  with check (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
      or (public.is_admin() and exists (
        select 1 from public.staff s
        where s.user_id::text = (storage.foldername(name))[1] and s.position = 'Teacher'
      ))
      or (public.is_finance() and exists (
        select 1 from public.staff s
        where s.user_id::text = (storage.foldername(name))[1]
          and public.staff_group_for_position(s.position) = 'Other Staff'
      ))
    )
  );

create policy "profile_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_owner()
    )
  );

-- =====================================================================
-- student-photos
--   read  : mirrors students_select (Owner/Educational Director, Finance, a teacher who
--           teaches/heads the student's class, a linked parent).
--   write : Owner / Educational Director only (canChangeStudentPhoto), and only for a student
--           row that actually exists.
-- =====================================================================

create policy "student_photos_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-photos'
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1]
        and (
          public.is_owner_or_admin()
          or public.is_finance()
          or (public.is_teacher() and st.class_id is not null and public.teaches_or_heads_class(st.class_id))
          or (public.is_parent() and public.is_parent_of(st.id))
        )
    )
  );

create policy "student_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-photos'
    and public.is_owner_or_admin()
    and exists (select 1 from public.students st where st.id::text = (storage.foldername(name))[1])
  );

create policy "student_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'student-photos' and public.is_owner_or_admin())
  with check (
    bucket_id = 'student-photos'
    and public.is_owner_or_admin()
    and exists (select 1 from public.students st where st.id::text = (storage.foldername(name))[1])
  );

create policy "student_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-photos' and public.is_owner_or_admin());

-- =====================================================================
-- student-documents
--   read  : mirrors student_documents_select (Owner/Educational Director, a teacher who
--           teaches/heads the class, a linked parent). NO Finance access -- matches the DB
--           policy, which deliberately omits Finance here.
--   write : Owner / Educational Director only (student_documents_insert/delete).
-- =====================================================================

create policy "student_documents_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-documents'
    and exists (
      select 1 from public.students st
      where st.id::text = (storage.foldername(name))[1]
        and (
          public.is_owner_or_admin()
          or (public.is_teacher() and st.class_id is not null and public.teaches_or_heads_class(st.class_id))
          or (public.is_parent() and public.is_parent_of(st.id))
        )
    )
  );

create policy "student_documents_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-documents'
    and public.is_owner_or_admin()
    and exists (select 1 from public.students st where st.id::text = (storage.foldername(name))[1])
  );

create policy "student_documents_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-documents' and public.is_owner_or_admin());

-- =====================================================================
-- result-evidence   path: <result_id>/<assessment_component>/<filename>
--   read  : mirrors result_evidence_select exactly -- Owner/Educational Director; a teacher who
--           teaches that class+subject; a linked parent ONLY when the result is PUBLISHED/LOCKED
--           AND that specific component has shared_with_parents = true. (The bucket is private
--           and LIST is filtered per-object, so a parent cannot enumerate evidence they are not
--           entitled to.)
--   write : mirrors can_edit_result_component(result_id) -- LOCKED blocks everyone.
-- =====================================================================

create policy "result_evidence_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'result-evidence'
    and exists (
      select 1 from public.results r
      where r.id::text = (storage.foldername(name))[1]
        and (
          public.is_owner_or_admin()
          or (public.is_teacher() and public.teaches_class_subject(r.class_id, r.subject_id))
          or (
            public.is_parent() and public.is_parent_of(r.student_id)
            and r.publish_status in ('PUBLISHED', 'LOCKED')
            and exists (
              select 1 from public.result_components rc
              where rc.result_id = r.id
                and rc.component::text = (storage.foldername(name))[2]
                and rc.shared_with_parents
            )
          )
        )
    )
  );

create policy "result_evidence_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'result-evidence'
    and exists (
      select 1 from public.results r
      where r.id::text = (storage.foldername(name))[1]
        and public.can_edit_result_component(r.id)
    )
  );

create policy "result_evidence_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'result-evidence'
    and exists (
      select 1 from public.results r
      where r.id::text = (storage.foldername(name))[1]
        and public.can_edit_result_component(r.id)
    )
  );

-- =====================================================================
-- receipts   path: <payment_id>/<filename>
--   read/write : Owner / Finance & Operations Director only -- mirrors the
--   canViewStudentPayments / canVoidPayment boundary. Per the Phase A instructions, a parent
--   does NOT gain access to receipt objects through Storage (they still see receipt DATA via
--   the payments RLS path). If parent access to their own receipt images is wanted later, add a
--   read policy scoped exactly like payments_select:
--     or (public.is_parent() and exists (
--        select 1 from public.payment_allocations pa
--        join public.student_fee_obligations o on o.id = pa.obligation_id
--        where pa.payment_id::text = (storage.foldername(name))[1] and public.is_parent_of(o.student_id)))
-- =====================================================================

create policy "receipts_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_owner_or_finance());

create policy "receipts_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_owner_or_finance());

create policy "receipts_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and public.is_owner_or_finance())
  with check (bucket_id = 'receipts' and public.is_owner_or_finance());

create policy "receipts_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.is_owner_or_finance());
