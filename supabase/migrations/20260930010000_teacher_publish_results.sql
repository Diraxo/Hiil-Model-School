-- Results publication policy (final):
--
--   * The ASSIGNED TEACHER may publish results -- but ONLY for a class + subject pair they are
--     assigned to (teacher_assignments row = teacher_id + class_id + subject_id; teaches_class_subject()
--     is an exact-pair test, never classes x subjects). Owner / Educational Director keep full
--     publish / lock / unlock rights. Finance: no Results access. Parent: read-only.
--   * A teacher may ONLY move a result DRAFT -> PUBLISHED. Locking, unlocking, un-publishing, the
--     auto-lock override and every identity column stay Owner/Educational Director only; the
--     results_guard trigger enforces this on top of the RLS policy, so a hand-crafted request that
--     changes student / class / subject / result id / status cannot get around it.
--   * Publishing IS the share. A parent sees the score AND the evidence images of a PUBLISHED / LOCKED
--     result of their own child, with no per-image "Share?" step. (result_components.shared_with_parents
--     is kept as a column for history but no longer gates anything.) Drafts stay hidden from parents.
--   * notify_results_published() may be called by the assigned teacher for their own pair, so the
--     parents get the (unread) notification -- and the existing push fan-out -- when a teacher publishes.
--
-- Additive / re-runnable. No row is written, updated or deleted by this migration.
-- Rollback: supabase/rollbacks/20260930010000_rollback.sql

-- ---------------------------------------------------------------------------------------------
-- 1. results_update: Owner / Educational Director, or the teacher assigned to this exact pair
-- ---------------------------------------------------------------------------------------------
drop policy if exists results_update on public.results;
create policy results_update on public.results
  for update
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.teaches_class_subject(class_id, subject_id) and public.teacher_academic_action_ok(current_date))
  )
  with check (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.teaches_class_subject(class_id, subject_id) and public.teacher_academic_action_ok(current_date))
  );

-- ---------------------------------------------------------------------------------------------
-- 2. results_guard(): identical to 20260930000000, plus the teacher rules at the top.
-- ---------------------------------------------------------------------------------------------
create or replace function public.results_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  missing text;
  reason text;
  old_cfg_status text;
begin
  -- A signed-in NON-owner/director (i.e. the assigned teacher; RLS already limited who reaches
  -- here) may only publish: DRAFT -> PUBLISHED, inside the open edit window, changing nothing else.
  if auth.uid() is not null and not public.is_owner_or_admin() then
    if new.publish_status is distinct from old.publish_status then
      if not (old.publish_status = 'DRAFT' and new.publish_status = 'PUBLISHED') then
        raise exception 'Only the Owner or Educational Director may lock, unlock or un-publish a result.' using errcode = '42501';
      end if;
      if not public.teaches_class_subject(old.class_id, old.subject_id) then
        raise exception 'You can only publish results for a class and subject you are assigned to.' using errcode = '42501';
      end if;
      if not public.result_edit_window_open(old.academic_year_id, old.semester, old.auto_lock_override) then
        raise exception 'This semester is locked, so the result can no longer be published.' using errcode = '42501';
      end if;
      new.published_at := now();
      new.published_by := auth.uid();
    elsif new.published_at is distinct from old.published_at or new.published_by is distinct from old.published_by then
      raise exception 'Publication details are set by the system.' using errcode = '42501';
    end if;
    if new.locked_at is distinct from old.locked_at
       or new.locked_by is distinct from old.locked_by
       or new.auto_lock_override is distinct from old.auto_lock_override then
      raise exception 'Only the Owner or Educational Director may lock or unlock a result.' using errcode = '42501';
    end if;
    if old.publish_status = 'LOCKED' then
      raise exception 'This result is locked.' using errcode = '42501';
    end if;
  end if;

  if new.student_id is distinct from old.student_id
     or new.class_id is distinct from old.class_id
     or new.subject_id is distinct from old.subject_id
     or new.semester is distinct from old.semester
     or new.academic_year_id is distinct from old.academic_year_id then
    raise exception 'A result''s student, class, subject, semester and academic year cannot be changed.' using errcode = 'P0001';
  end if;
  if new.configuration_id is distinct from old.configuration_id and old.configuration_id is not null then
    select status into old_cfg_status from public.result_configurations where id = old.configuration_id;
    if not (
      coalesce(old_cfg_status, '') <> 'ACTIVE'
      and old.publish_status = 'DRAFT'
      and new.publish_status = 'DRAFT'
      and not public.result_has_recorded_data(old.id)
    ) then
      raise exception 'A result stays on the assessment structure it was recorded under.' using errcode = 'P0001';
    end if;
  end if;

  -- Decision: evidence is REQUIRED BEFORE PUBLISH. Every scored TEST component needs >= 1 page.
  if old.publish_status = 'DRAFT' and new.publish_status in ('PUBLISHED', 'LOCKED') then
    select string_agg(a.name, ', ' order by a.sort_order) into missing
      from public.result_components rc
      join public.result_assessment_components a on a.id = rc.assessment_id
     where rc.result_id = new.id
       and rc.score is not null
       and a.kind = 'TEST'
       and not exists (
         select 1 from public.result_evidence e
          where e.result_id = new.id and e.assessment_id = a.id
       );
    if missing is not null then
      raise exception 'EVIDENCE_REQUIRED: attach test evidence before publishing (%).', missing
        using errcode = 'P0001';
    end if;
  end if;

  -- Turning an auto-lock override ON: a reason is mandatory and the actor is the authenticated
  -- user, never something the browser supplies. Only meaningful for a semester that is locked.
  if new.auto_lock_override is not null and new.auto_lock_override is distinct from old.auto_lock_override then
    reason := btrim(coalesce(new.auto_lock_override ->> 'reason', ''));
    if reason = '' then
      raise exception 'A reason is required to unlock a locked semester.' using errcode = 'P0001';
    end if;
    if public.result_semester_phase(new.academic_year_id, new.semester) <> 'locked' then
      raise exception 'This semester is not locked, so there is nothing to override.' using errcode = 'P0001';
    end if;
    new.auto_lock_override := jsonb_build_object(
      'reason', reason,
      'grantedBy', auth.uid(),
      'grantedByRole', public.current_role(),
      'grantedAt', (extract(epoch from now()) * 1000)::bigint
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Parent evidence visibility follows publication (no per-image share step)
--    Teacher / Owner / Director branches are unchanged.
-- ---------------------------------------------------------------------------------------------
drop policy if exists result_evidence_select on public.result_evidence;
create policy result_evidence_select on public.result_evidence
  for select
  using (
    exists (
      select 1 from public.results r
      where r.id = result_evidence.result_id
        and (
          public.is_owner_or_admin()
          or (public.is_teacher() and public.teaches_class_subject(r.class_id, r.subject_id))
          or (
            public.is_parent() and public.is_parent_of(r.student_id)
            and r.publish_status in ('PUBLISHED', 'LOCKED')
          )
        )
    )
  );

-- Storage object key: <result_id>/<assessment_id>/<file>. The bucket stays PRIVATE; this is the same
-- rule as above applied per object, so a signed URL can only be minted for a permitted reader.
drop policy if exists "result_evidence_read" on storage.objects;
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
          )
        )
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 4. notify_results_published(): the assigned teacher may notify for their own class + subject
-- ---------------------------------------------------------------------------------------------
create or replace function public.notify_results_published(
  p_class_id uuid,
  p_subject_id uuid,
  p_semester semester,
  p_academic_year_id uuid,
  p_student_ids uuid[],
  p_title text,
  p_message text,
  p_navigation jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.teaches_class_subject(p_class_id, p_subject_id))
  ) then
    raise exception 'Only the Owner, the Educational Director or the assigned subject teacher may publish results' using errcode = '42501';
  end if;

  -- Mark every not-yet-notified published/locked result for this exact
  -- class+subject+semester+year among the supplied students, and fan a notification out to the
  -- parents of only those (server-filtered) students. New notification rows are unread.
  with marked as (
    update public.results r
      set publish_notified_at = now()
      where r.class_id = p_class_id
        and r.subject_id = p_subject_id
        and r.semester = p_semester
        and r.academic_year_id = p_academic_year_id
        and r.student_id = any (p_student_ids)
        and r.publish_status in ('PUBLISHED', 'LOCKED')
        and r.publish_notified_at is null
      returning r.student_id
  )
  insert into public.notifications (user_id, title, message, type, navigation)
  select ps.parent_id, p_title, p_message, 'RESULT',
         coalesce(p_navigation, '{}'::jsonb)
           || jsonb_build_object('page', 'exams', 'studentId', m.student_id, 'semester', p_semester)
  from marked m
  join public.parent_students ps on ps.student_id = m.student_id;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.notify_results_published(uuid, uuid, semester, uuid, uuid[], text, text, jsonb) from public;
grant execute on function public.notify_results_published(uuid, uuid, semester, uuid, uuid[], text, text, jsonb) to authenticated;
