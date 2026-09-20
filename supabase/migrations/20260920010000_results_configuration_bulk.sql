-- Blocker 11 follow-up: apply ONE assessment structure to several grades and/or both semesters in a
-- single save, so the Educational Director does not have to re-enter the same structure per class.
--
-- Additive: a thin wrapper over save_result_configuration(), so every rule stays in one place
-- (Owner/Educational Director only, weights total exactly 100, one active structure per year +
-- semester + grade, a structure that already has results becomes a NEW VERSION, audit row per
-- combination stamped from auth.uid()). It runs as ONE transaction: if any combination is
-- rejected, none of them is saved.

create or replace function public.save_result_configuration_bulk(
  p_academic_year_id uuid,
  p_semesters semester[],
  p_grades text[],
  p_components jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sem semester;
  v_grade text;
  v_out jsonb := '[]'::jsonb;
  v_one jsonb;
  v_sems semester[];
  v_grades text[];
begin
  -- is_owner_or_admin() is NULL (not false) for a caller with no active profile: deny explicitly.
  if coalesce(public.is_owner_or_admin(), false) is not true then
    raise exception 'Only the Owner or Educational Director can configure results.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct s), '{}') into v_sems from unnest(p_semesters) s;
  select coalesce(array_agg(distinct btrim(g)), '{}') into v_grades from unnest(p_grades) g where btrim(coalesce(g, '')) <> '';
  if coalesce(array_length(v_sems, 1), 0) = 0 or coalesce(array_length(v_grades, 1), 0) = 0 then
    raise exception 'Choose at least one grade and one semester.' using errcode = 'P0001';
  end if;
  if array_length(v_sems, 1) * array_length(v_grades, 1) > 40 then
    raise exception 'Too many grade/semester combinations in one save.' using errcode = 'P0001';
  end if;

  foreach v_grade in array v_grades loop
    foreach v_sem in array v_sems loop
      v_one := public.save_result_configuration(p_academic_year_id, v_sem, v_grade, p_components);
      v_out := v_out || jsonb_build_array(v_one || jsonb_build_object('grade', v_grade, 'semester', v_sem));
    end loop;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.save_result_configuration_bulk(uuid, semester[], text[], jsonb) from public, anon;
grant execute on function public.save_result_configuration_bulk(uuid, semester[], text[], jsonb) to authenticated;
