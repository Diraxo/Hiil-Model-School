-- Rollback for 20260930030000_repin_emptied_results.sql: previous definitions (from 20260930000000 / 20260930010000).

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

drop function if exists public.result_has_recorded_values(uuid);
