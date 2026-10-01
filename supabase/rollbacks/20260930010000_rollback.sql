-- Rollback for 20260930010000_teacher_publish_results.sql: restores the previous behaviour
-- (Owner/Educational Director-only publication; parent evidence gated by shared_with_parents).
-- Copies of the previous definitions from 20260825190000, 20260827000000, 20260920000000, 20260930000000.

drop policy if exists results_update on public.results;
create policy results_update on public.results
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

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
            and exists (
              select 1 from public.result_components rc
              where rc.result_id = r.id
                and rc.shared_with_parents
                and (
                  (rc.assessment_id is not null and rc.assessment_id = result_evidence.assessment_id)
                  or (rc.component is not null and rc.component = result_evidence.component)
                )
            )
          )
        )
    )
  );

-- Storage object key: <result_id>/<assessment_id>/<file> (legacy: <result_id>/<enum>/<file>).
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
            and exists (
              select 1 from public.result_components rc
              where rc.result_id = r.id
                and (
                  rc.assessment_id::text = (storage.foldername(name))[2]
                  or rc.component::text = (storage.foldername(name))[2]
                )
                and rc.shared_with_parents
            )
          )
        )
    )
  );

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
  -- results_update (publish) policy = Owner / Educational Director only.
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may publish results';
  end if;

  -- Mark every not-yet-notified published/locked result for this exact
  -- class+subject+semester+year among the supplied students, and fan a notification out to the
  -- parents of only those (server-filtered) students.
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
