-- Phase 3 checkpoint 3 (Result Evidence / Exam Evidence): move result_evidence off the base64
-- `file_url` data-URI and onto the real private `result-evidence` Storage bucket.
--
-- The bucket + its read/insert/delete policies already exist (20260827010000). This migration only:
--   1. adds the metadata columns the Storage workflow needs (storage_path / mime_type / file_size /
--      created_at / updated_at) and relaxes the legacy NOT NULL on file_url;
--   2. adds a unique index on storage_path so a retried / double-clicked upload that resolves the
--      same object key is rejected instead of creating a duplicate evidence page;
--   3. adds an UPDATE path (RLS policy + grant on the table, matching policy on storage.objects)
--      so "replace evidence" and page reordering are possible under the same gate as insert/delete
--      -- can_edit_result_component(): Owner / Educational Director or the assigned subject teacher,
--      and never once the result is LOCKED.
--
-- Idempotent (every statement guards itself). Non-destructive: result_evidence has zero rows today
-- (results were a clean cutover -- see src/data/seed.js), and no existing column is dropped.
--
-- DEPLOYMENT: apply remotely alongside the still-pending CP2 migrations
--   20260901030000_result_audit_log_lifecycle_insert.sql   (REQUIRED for CP2 + CP3 audit rows)
--   20260901040000_results_parent_published_only.sql       (hardening)
-- and this file. Order does not matter between them.

-- ---------------------------------------------------------------------------------------------
-- 1. Metadata columns
-- ---------------------------------------------------------------------------------------------
alter table public.result_evidence
  add column if not exists storage_path text,
  add column if not exists mime_type   text,
  add column if not exists file_size   bigint,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz;

-- file_url was NOT NULL and held a `data:` URI. New rows put the Storage object key in
-- storage_path instead; keep file_url (nullable) so any historical row stays intact.
alter table public.result_evidence alter column file_url drop not null;

-- Carry forward any legacy row that already held a real path rather than a data URI (none today).
update public.result_evidence
   set storage_path = file_url
 where storage_path is null
   and file_url is not null
   and file_url not like 'data:%';

-- ---------------------------------------------------------------------------------------------
-- 2. Idempotency guard -- one physical object == one row
-- ---------------------------------------------------------------------------------------------
create unique index if not exists result_evidence_storage_path_key
  on public.result_evidence (storage_path)
  where storage_path is not null;

-- ---------------------------------------------------------------------------------------------
-- 3. updated_at maintenance
-- ---------------------------------------------------------------------------------------------
create or replace function public.touch_result_evidence_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists result_evidence_touch_updated_at on public.result_evidence;
create trigger result_evidence_touch_updated_at
  before update on public.result_evidence
  for each row
  execute function public.touch_result_evidence_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 4. UPDATE policy + grant on the table (replace evidence / reorder pages)
--    Same gate as result_evidence_insert / result_evidence_delete.
-- ---------------------------------------------------------------------------------------------
drop policy if exists result_evidence_update on public.result_evidence;
create policy result_evidence_update on public.result_evidence
  for update
  using (public.can_edit_result_component(result_id))
  with check (public.can_edit_result_component(result_id));

grant update on public.result_evidence to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. storage.objects UPDATE policy for the result-evidence bucket
--    read / insert / delete were created in 20260827010000; add UPDATE so an authorized replace
--    that re-uploads to the same key (upsert) is permitted under the same rule as insert.
--    path: <result_id>/<assessment_component>/<safe-file-name>
-- ---------------------------------------------------------------------------------------------
drop policy if exists "result_evidence_update" on storage.objects;
create policy "result_evidence_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'result-evidence'
    and exists (
      select 1 from public.results r
      where r.id::text = (storage.foldername(name))[1]
        and public.can_edit_result_component(r.id)
    )
  )
  with check (
    bucket_id = 'result-evidence'
    and exists (
      select 1 from public.results r
      where r.id::text = (storage.foldername(name))[1]
        and public.can_edit_result_component(r.id)
    )
  );
