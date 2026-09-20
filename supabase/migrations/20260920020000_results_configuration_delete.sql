-- Blocker 11 follow-up: delete a result structure (one academic year + semester + grade).
--
-- Deleting must never destroy recorded results, so the RPC picks the safe outcome itself:
--   * no result is recorded under the structure  -> it is DELETED outright (nothing depends on it);
--   * results ARE recorded under it              -> it is ARCHIVED (status SUPERSEDED, no active
--     structure left): teachers can no longer enter new results for that grade + semester, while every
--     recorded result keeps the structure it was entered under and stays visible everywhere.
-- Either way an audit row records who did it. Re-creating the structure later works normally (an
-- archived one just makes the next version number one higher).

alter table public.result_configuration_audit drop constraint if exists result_configuration_audit_action_check;
alter table public.result_configuration_audit
  add constraint result_configuration_audit_action_check
  check (action in ('CREATED', 'UPDATED', 'NEW_VERSION', 'DELETED'));

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
