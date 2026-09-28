-- ROLLBACK for 20260930000000_result_structure_delete_guard.sql (NOT a migration: it lives in supabase/rollbacks/ so
-- `supabase db push` never runs it). Restores the previous function bodies exactly (a structure with results is
-- ARCHIVED instead of refusing to delete; results_guard / result_effective_configuration as in 20260920000000) and
-- drops the two functions the migration added. No data is touched: rows already detached from a deleted structure
-- stay detached and simply re-pin on their next write, as they always could.
-- Run in the SQL editor / `supabase db query` as a privileged role.

create or replace function public.result_effective_configuration(p_result_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.results%rowtype;
  cfg uuid;
begin
  select * into r from public.results where id = p_result_id;
  if not found then return null; end if;
  if r.configuration_id is not null then return r.configuration_id; end if;

  select c.id into cfg
    from public.result_configurations c
    join public.classes cl on cl.grade = c.grade
   where cl.id = r.class_id
     and c.academic_year_id = r.academic_year_id
     and c.semester = r.semester
     and c.status = 'ACTIVE';
  if cfg is null then
    raise exception 'RESULT_CONFIG_MISSING: no result structure is configured for this grade and semester. Please contact the Educational Director.'
      using errcode = 'P0001';
  end if;
  update public.results set configuration_id = cfg where id = r.id;
  return cfg;
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
begin
  if new.student_id is distinct from old.student_id
     or new.class_id is distinct from old.class_id
     or new.subject_id is distinct from old.subject_id
     or new.semester is distinct from old.semester
     or new.academic_year_id is distinct from old.academic_year_id then
    raise exception 'A result''s student, class, subject, semester and academic year cannot be changed.' using errcode = 'P0001';
  end if;
  if new.configuration_id is distinct from old.configuration_id and old.configuration_id is not null then
    raise exception 'A result stays on the assessment structure it was recorded under.' using errcode = 'P0001';
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
  v_outcome text;
  v_actor_name text;
begin
  -- is_owner_or_admin() is NULL (not false) for a caller with no active profile: deny explicitly.
  if coalesce(public.is_owner_or_admin(), false) is not true then
    raise exception 'Only the Owner or Educational Director can configure results.' using errcode = '42501';
  end if;

  select * into v_cfg
    from public.result_configurations
   where academic_year_id = p_academic_year_id and semester = p_semester and grade = v_grade and status = 'ACTIVE'
   for update;
  if not found then
    raise exception 'There is no result structure to delete for % in this semester.', v_grade using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'weight', weight, 'kind', kind) order by sort_order), '[]'::jsonb)
    into v_before
    from public.result_assessment_components
   where configuration_id = v_cfg.id and active;

  if exists (select 1 from public.results where configuration_id = v_cfg.id) then
    update public.result_configurations
       set status = 'SUPERSEDED', updated_by = auth.uid(), updated_at = now()
     where id = v_cfg.id;
    v_outcome := 'ARCHIVED';
  else
    delete from public.result_assessment_components where configuration_id = v_cfg.id;
    delete from public.result_configurations where id = v_cfg.id;
    v_outcome := 'DELETED';
  end if;

  select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.result_configuration_audit
    (configuration_id, academic_year_id, semester, grade, version, action, actor_id, actor_role, actor_name, diff)
  values
    (case when v_outcome = 'ARCHIVED' then v_cfg.id else null end,
     p_academic_year_id, p_semester, v_grade, v_cfg.version, 'DELETED', auth.uid(), public.current_role(), v_actor_name,
     jsonb_build_object('before', v_before, 'after', null, 'outcome', v_outcome));

  return jsonb_build_object('grade', v_grade, 'semester', p_semester, 'version', v_cfg.version, 'outcome', v_outcome);
end;
$$;

revoke all on function public.delete_result_configuration(uuid, semester, text) from public, anon;
grant execute on function public.delete_result_configuration(uuid, semester, text) to authenticated;

drop function if exists public.result_configuration_delete_impact(uuid, semester, text);
drop function if exists public.result_has_recorded_data(uuid);
