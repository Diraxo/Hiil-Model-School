-- Results structure lifecycle: a structure with saved results can no longer be deleted.
--
-- BEFORE: delete_result_configuration() ARCHIVED a structure that had results (status SUPERSEDED, no
-- active structure left). The recorded rows then looked like live, editable results of a grade that had
-- "no structure" -- one student's leftover row was shown as the whole class's result.
--
-- NOW (all enforced here, in the database; the browser only explains):
--   * SAVED result  = published/locked, OR any scored component, OR any evidence page. A structure with
--     even one saved result CANNOT be deleted: delete_result_configuration() raises, naming how many
--     students are affected. Nothing is deleted or archived.
--   * EMPTY DRAFT   = a DRAFT results row with no score and no evidence (created the moment a teacher
--     opened a student, holds no data). It never protects a structure. Deleting the structure DETACHES
--     it (configuration_id -> NULL); the row, the student and every audit entry are kept, and the row
--     re-pins to whichever structure is active the next time something is recorded.
--   * A result recorded under a structure that is no longer active AND has no active successor is
--     HISTORICAL: it stays readable, and the database refuses new scores / evidence for it. (A result
--     under an earlier VERSION that has an active successor is unchanged: versions keep old results.)
--   * result_configuration_delete_impact(): the exact, current list of students a delete would be
--     blocked by -- read from the tables, never from the browser's cached state.
--
-- The foreign key results.configuration_id ... ON DELETE RESTRICT already stops a direct DELETE of a
-- structure that any results row still points at; this migration makes the friendly RPC agree with it.
-- No student, enrollment, result, component, evidence or audit row is deleted or changed here.
-- Rollback: supabase/rollbacks/20260930000000_rollback.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. What counts as "saved"
-- ---------------------------------------------------------------------------------------------

create or replace function public.result_has_recorded_data(p_result_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.results r
     where r.id = p_result_id
       and (
         r.publish_status <> 'DRAFT'
         or exists (select 1 from public.result_components rc where rc.result_id = r.id and rc.score is not null)
         or exists (select 1 from public.result_evidence e where e.result_id = r.id)
       )
  )
$$;
revoke all on function public.result_has_recorded_data(uuid) from public, anon;
grant execute on function public.result_has_recorded_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Which structure a result writes to
--    active pin                          -> that structure (unchanged)
--    pinned to a non-active structure:
--      empty draft                       -> re-pin to the active structure (or refuse: none configured)
--      has saved data, active successor  -> keep the earlier version (unchanged)
--      has saved data, NO active one     -> historical: refuse
-- ---------------------------------------------------------------------------------------------

create or replace function public.result_effective_configuration(p_result_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.results%rowtype;
  cfg uuid;
  pinned_status text;
begin
  select * into r from public.results where id = p_result_id;
  if not found then return null; end if;

  if r.configuration_id is not null then
    select status into pinned_status from public.result_configurations where id = r.configuration_id;
    if pinned_status = 'ACTIVE' then return r.configuration_id; end if;
  end if;

  select c.id into cfg
    from public.result_configurations c
    join public.classes cl on cl.grade = c.grade
   where cl.id = r.class_id
     and c.academic_year_id = r.academic_year_id
     and c.semester = r.semester
     and c.status = 'ACTIVE';

  if r.configuration_id is null then
    if cfg is null then
      raise exception 'RESULT_CONFIG_MISSING: no result structure is configured for this grade and semester. Please contact the Educational Director.'
        using errcode = 'P0001';
    end if;
    update public.results set configuration_id = cfg where id = r.id;
    return cfg;
  end if;

  -- Pinned to a structure that is no longer active.
  if not public.result_has_recorded_data(r.id) then
    if cfg is null then
      raise exception 'RESULT_CONFIG_MISSING: no result structure is configured for this grade and semester. Please contact the Educational Director.'
        using errcode = 'P0001';
    end if;
    update public.results set configuration_id = cfg where id = r.id;
    return cfg;
  end if;
  if cfg is null then
    raise exception 'RESULT_CONFIG_CLOSED: this result was recorded under a structure that has since been closed. It is kept as history and can no longer be edited.'
      using errcode = 'P0001';
  end if;
  return r.configuration_id;
end;
$$;

-- results_guard(): identical to 20260920000000 except that an EMPTY draft pinned to a non-active
-- structure may be re-pinned (or detached) -- it holds nothing that could be reinterpreted.
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
-- 3. Delete impact: exactly what a delete would be blocked by, from the tables
-- ---------------------------------------------------------------------------------------------

create or replace function public.result_configuration_delete_impact(
  p_academic_year_id uuid,
  p_semester semester,
  p_grade text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grade text := btrim(coalesce(p_grade, ''));
  v_cfg public.result_configurations%rowtype;
  v_students jsonb;
  v_saved_results integer;
  v_saved_students integer;
  v_empty_drafts integer;
begin
  if coalesce(public.is_owner_or_admin(), false) is not true then
    raise exception 'Only the Owner or Educational Director can configure results.' using errcode = '42501';
  end if;

  select * into v_cfg
    from public.result_configurations
   where academic_year_id = p_academic_year_id and semester = p_semester and grade = v_grade and status = 'ACTIVE';
  if not found then
    return jsonb_build_object('configurationId', null, 'grade', v_grade, 'semester', p_semester,
      'savedStudentCount', 0, 'savedResultCount', 0, 'emptyDraftCount', 0, 'students', '[]'::jsonb, 'canDelete', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', s.id,
           'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)),
           'subject', sub.name,
           'status', case when r.publish_status <> 'DRAFT' then r.publish_status::text else 'DRAFT' end
         ) order by btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), sub.name), '[]'::jsonb),
         count(*),
         count(distinct s.id)
    into v_students, v_saved_results, v_saved_students
    from public.results r
    join public.students s on s.id = r.student_id
    left join public.subjects sub on sub.id = r.subject_id
   where r.configuration_id = v_cfg.id
     and public.result_has_recorded_data(r.id);

  select count(*) into v_empty_drafts
    from public.results r
   where r.configuration_id = v_cfg.id
     and not public.result_has_recorded_data(r.id);

  return jsonb_build_object(
    'configurationId', v_cfg.id, 'grade', v_grade, 'semester', p_semester, 'version', v_cfg.version,
    'savedStudentCount', v_saved_students, 'savedResultCount', v_saved_results, 'emptyDraftCount', v_empty_drafts,
    'students', v_students, 'canDelete', v_saved_results = 0);
end;
$$;
revoke all on function public.result_configuration_delete_impact(uuid, semester, text) from public, anon;
grant execute on function public.result_configuration_delete_impact(uuid, semester, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. delete_result_configuration(): refuses when anything is saved; otherwise deletes
-- ---------------------------------------------------------------------------------------------

create or replace function public.delete_result_configuration(
  p_academic_year_id uuid,
  p_semester semester,
  p_grade text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grade text := btrim(coalesce(p_grade, ''));
  v_cfg public.result_configurations%rowtype;
  v_before jsonb;
  v_impact jsonb;
  v_saved_students integer;
  v_saved_results integer;
  v_detached integer;
  v_sem_label text := case p_semester when 'S1' then 'Semester 1' else 'Semester 2' end;
  v_msg text;
  v_actor_name text;
begin
  -- is_owner_or_admin() is NULL (not false) for a caller with no active profile: deny explicitly.
  if coalesce(public.is_owner_or_admin(), false) is not true then
    raise exception 'Only the Owner or Educational Director can configure results.' using errcode = '42501';
  end if;

  -- The row lock serializes this with anyone saving a first score: a writer pinning a result to this
  -- structure holds a key-share lock on it, so we wait for that write to commit, then see it below.
  select * into v_cfg
    from public.result_configurations
   where academic_year_id = p_academic_year_id and semester = p_semester and grade = v_grade and status = 'ACTIVE'
   for update;
  if not found then
    raise exception 'There is no result structure to delete for % in this semester.', v_grade using errcode = 'P0001';
  end if;

  v_impact := public.result_configuration_delete_impact(p_academic_year_id, p_semester, v_grade);
  v_saved_students := (v_impact ->> 'savedStudentCount')::integer;
  v_saved_results := (v_impact ->> 'savedResultCount')::integer;
  if v_saved_results > 0 then
    v_msg := 'Cannot delete this assessment structure. ' || v_grade || ' — ' || v_sem_label || '. ';
    if v_saved_students = 1 then
      v_msg := v_msg || '1 student has saved results under it: ' || (v_impact -> 'students' -> 0 ->> 'name')
                     || '. Remove or move that student''s saved results before deleting the structure.';
    else
      v_msg := v_msg || v_saved_students || ' students have saved results under it. Review the saved results before deleting the structure.';
    end if;
    raise exception '%', v_msg using errcode = 'P0001', detail = v_impact::text, hint = 'STRUCTURE_HAS_SAVED_RESULTS';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'weight', weight, 'kind', kind) order by sort_order), '[]'::jsonb)
    into v_before
    from public.result_assessment_components
   where configuration_id = v_cfg.id and active;

  -- Empty drafts (no score, no evidence) never protect a structure: detach them. Nothing else about
  -- the row changes, and the student/enrollment are untouched. Closing the structure first is what lets
  -- results_guard() accept the detach; if the delete then fails, the whole call rolls back.
  update public.result_configurations set status = 'SUPERSEDED', updated_by = auth.uid(), updated_at = now() where id = v_cfg.id;
  update public.results set configuration_id = null where configuration_id = v_cfg.id;
  get diagnostics v_detached = row_count;

  delete from public.result_assessment_components where configuration_id = v_cfg.id;
  delete from public.result_configurations where id = v_cfg.id;

  select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.result_configuration_audit
    (configuration_id, academic_year_id, semester, grade, version, action, actor_id, actor_role, actor_name, diff)
  values
    (null, p_academic_year_id, p_semester, v_grade, v_cfg.version, 'DELETED', auth.uid(), public.current_role(), v_actor_name,
     jsonb_build_object('before', v_before, 'after', null, 'outcome', 'DELETED', 'detachedEmptyDrafts', v_detached));

  return jsonb_build_object('grade', v_grade, 'semester', p_semester, 'version', v_cfg.version, 'outcome', 'DELETED', 'detachedEmptyDrafts', v_detached);
end;
$$;

revoke all on function public.delete_result_configuration(uuid, semester, text) from public, anon;
grant execute on function public.delete_result_configuration(uuid, semester, text) to authenticated;
