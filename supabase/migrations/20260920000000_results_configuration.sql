-- Blocker 11: configurable Results (assessment structure per academic year + semester + grade),
-- server-enforced semester locking / correction window, and test-evidence rules.
--
-- WHY: the assessment structure (Midterm 1/2 = 20/20, Student Book = 10, Final = 50) was baked into
-- a Postgres ENUM (`assessment_component`) and into client constants. The school must define its
-- own 100-point structure per grade/semester/year without a code change, and old results must keep
-- the structure they were recorded under.
--
-- DESIGN (additive only -- nothing is dropped, no row is deleted, no UUID changes):
--   result_configurations           one row per (academic_year, semester, grade, version); exactly
--                                   one ACTIVE per key (partial unique index). Editing a structure
--                                   that already has results creates version N+1 and marks the old
--                                   one SUPERSEDED -- old results stay pinned to the version they
--                                   were recorded under (results.configuration_id).
--   result_assessment_components    the components of one configuration version (name, weight,
--                                   TEST|NON_TEST, order). Weights of a version total exactly 100
--                                   (deferred constraint trigger).
--   result_configuration_audit      append-only "who configured this" trail (result_audit_log is
--                                   keyed on result_id and cannot hold configuration events).
--   results.configuration_id / result_components.assessment_id / result_evidence.assessment_id /
--   result_audit_log.assessment_id  new links. The legacy enum `component` columns are kept
--                                   (now nullable) so historical rows stay intact.
--
-- SERVER-SIDE ENFORCEMENT (nothing below trusts the client):
--   * result_semester_phase() mirrors src/utils/academicCalendar.js classifySemesterResultLock and
--     is now part of can_edit_result_component() and the results INSERT policy, so a teacher cannot
--     bypass the semester lock / correction window through a direct request. The audited per-result
--     override (results.auto_lock_override, Owner/Educational Director only) is still honoured.
--   * result_components_guard: assessment must belong to the result's pinned configuration, score
--     must be within 0..weight, `max` and `updated_by` are stamped server-side.
--   * result_evidence_guard: evidence only on TEST assessments of the result's own configuration;
--     student/class/semester/year are derived from the result row, not the client.
--   * results_guard: identity columns are immutable; publishing requires >=1 evidence page for every
--     scored TEST component (decision: "required before publish"); an auto-lock override needs a
--     reason and is stamped with the authenticated actor.
--
-- LIVE DATA AT AUTHORING TIME (checked read-only): results=1 (DRAFT, no components),
-- result_components=0, result_evidence=0, result_audit_log=2, report_cards=0. The legacy mapping
-- below is nevertheless written generally and RAISES (rolling the whole migration back) if any
-- existing component / evidence row cannot be mapped -- it never guesses.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------

create table public.result_configurations (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  semester semester not null,
  grade text not null check (btrim(grade) <> ''),
  version integer not null default 1 check (version >= 1),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint result_configurations_version_key unique (academic_year_id, semester, grade, version)
);

-- At most ONE active structure per academic year + semester + grade.
create unique index result_configurations_one_active
  on public.result_configurations (academic_year_id, semester, grade)
  where status = 'ACTIVE';

create table public.result_assessment_components (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.result_configurations (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  weight numeric(5, 2) not null check (weight > 0 and weight <= 100),
  kind text not null check (kind in ('TEST', 'NON_TEST')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index result_assessment_components_name_key
  on public.result_assessment_components (configuration_id, lower(btrim(name)));
create index result_assessment_components_config_idx
  on public.result_assessment_components (configuration_id, sort_order);

create table public.result_configuration_audit (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid references public.result_configurations (id) on delete set null,
  academic_year_id uuid not null,
  semester semester not null,
  grade text not null,
  version integer not null,
  action text not null check (action in ('CREATED', 'UPDATED', 'NEW_VERSION')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role user_role,
  actor_name text,
  diff jsonb,
  at timestamptz not null default now()
);
create index result_configuration_audit_config_idx on public.result_configuration_audit (configuration_id);

alter table public.result_configurations enable row level security;
alter table public.result_assessment_components enable row level security;
alter table public.result_configuration_audit enable row level security;

-- Writes only ever go through save_result_configuration() (SECURITY DEFINER); there is no
-- INSERT/UPDATE/DELETE policy and no write grant for API roles.
revoke all on public.result_configurations, public.result_assessment_components, public.result_configuration_audit from anon, authenticated;
grant select on public.result_configurations, public.result_assessment_components, public.result_configuration_audit to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Additive columns on the existing result tables
-- ---------------------------------------------------------------------------------------------

alter table public.results
  add column if not exists configuration_id uuid references public.result_configurations (id) on delete restrict;
create index if not exists results_configuration_idx on public.results (configuration_id);

alter table public.result_components
  add column if not exists assessment_id uuid references public.result_assessment_components (id) on delete restrict;
alter table public.result_components alter column component drop not null;
-- One row per (result, assessment). A FULL unique constraint (not partial) so PostgREST upsert can
-- use onConflict=result_id,assessment_id; NULL assessment_id (legacy rows) never collide.
alter table public.result_components
  add constraint result_components_assessment_key unique (result_id, assessment_id);
alter table public.result_components
  add constraint result_components_has_assessment check (component is not null or assessment_id is not null);
create index if not exists result_components_assessment_idx on public.result_components (assessment_id);

alter table public.result_evidence
  add column if not exists assessment_id uuid references public.result_assessment_components (id) on delete restrict;
alter table public.result_evidence alter column component drop not null;
alter table public.result_evidence
  add constraint result_evidence_has_assessment check (component is not null or assessment_id is not null);
create index if not exists result_evidence_result_assessment_idx on public.result_evidence (result_id, assessment_id);

alter table public.result_audit_log
  add column if not exists assessment_id uuid references public.result_assessment_components (id) on delete set null,
  add column if not exists assessment_name text;

-- ---------------------------------------------------------------------------------------------
-- 3. Map the existing hard-coded structure into configuration data (no guessing)
-- ---------------------------------------------------------------------------------------------

do $$
declare
  k record;
  new_cfg uuid;
begin
  -- One legacy configuration per (academic year, semester, grade) that already holds real data
  -- (a scored/attached component or an evidence page). A results row with no components and no
  -- evidence has nothing to map; it is pinned lazily on its first write.
  for k in
    select distinct r.academic_year_id, r.semester, c.grade
    from public.results r
    join public.classes c on c.id = r.class_id
    where exists (select 1 from public.result_components rc where rc.result_id = r.id)
       or exists (select 1 from public.result_evidence e where e.result_id = r.id)
  loop
    insert into public.result_configurations (academic_year_id, semester, grade, version, status)
    values (k.academic_year_id, k.semester, k.grade, 1, 'ACTIVE')
    returning id into new_cfg;

    insert into public.result_assessment_components (configuration_id, name, weight, kind, sort_order) values
      (new_cfg, 'Midterm 1',    20, 'TEST',     0),
      (new_cfg, 'Midterm 2',    20, 'TEST',     1),
      (new_cfg, 'Student Book', 10, 'NON_TEST', 2),
      (new_cfg, 'Final Exam',   50, 'TEST',     3);
  end loop;

  update public.results r
     set configuration_id = cfg.id
    from public.classes cl, public.result_configurations cfg
   where r.configuration_id is null
     and cl.id = r.class_id
     and cfg.academic_year_id = r.academic_year_id
     and cfg.semester = r.semester
     and cfg.grade = cl.grade
     and cfg.status = 'ACTIVE'
     and (exists (select 1 from public.result_components rc where rc.result_id = r.id)
          or exists (select 1 from public.result_evidence e where e.result_id = r.id));

  update public.result_components rc
     set assessment_id = a.id
    from public.results r, public.result_assessment_components a
   where rc.assessment_id is null
     and r.id = rc.result_id
     and a.configuration_id = r.configuration_id
     and a.name = case rc.component::text
                    when 'midterm1' then 'Midterm 1' when 'midterm2' then 'Midterm 2'
                    when 'studentBook' then 'Student Book' when 'finalExam' then 'Final Exam' end;

  update public.result_evidence e
     set assessment_id = a.id
    from public.results r, public.result_assessment_components a
   where e.assessment_id is null
     and r.id = e.result_id
     and a.configuration_id = r.configuration_id
     and a.name = case e.component::text
                    when 'midterm1' then 'Midterm 1' when 'midterm2' then 'Midterm 2'
                    when 'studentBook' then 'Student Book' when 'finalExam' then 'Final Exam' end;

  -- Audit rows are immutable history: only the new descriptive columns are filled in.
  update public.result_audit_log l
     set assessment_name = case l.component::text
                    when 'midterm1' then 'Midterm 1' when 'midterm2' then 'Midterm 2'
                    when 'studentBook' then 'Student Book' when 'finalExam' then 'Final Exam' end
   where l.component is not null and l.assessment_name is null;

  -- STOP conditions: refuse to commit anything that could not be mapped safely.
  if exists (select 1 from public.result_components where assessment_id is null) then
    raise exception 'Results configuration migration aborted: % result_components row(s) could not be mapped to an assessment.',
      (select count(*) from public.result_components where assessment_id is null);
  end if;
  if exists (select 1 from public.result_evidence where assessment_id is null) then
    raise exception 'Results configuration migration aborted: % result_evidence row(s) could not be mapped to an assessment.',
      (select count(*) from public.result_evidence where assessment_id is null);
  end if;
  if exists (
    select 1 from public.result_components rc
    join public.result_assessment_components a on a.id = rc.assessment_id
    where rc.max <> a.weight or (rc.score is not null and (rc.score < 0 or rc.score > a.weight))
  ) then
    raise exception 'Results configuration migration aborted: an existing score/max does not match its assessment weight.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Calendar / lock helpers (server-side mirror of classifySemesterResultLock)
-- ---------------------------------------------------------------------------------------------

-- The school is in Ethiopia; "today" for lock decisions is the Addis Ababa calendar date, not UTC.
create or replace function public.school_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Africa/Addis_Ababa')::date; $$;

-- 'before_semester' | 'active' | 'grace_period' | 'locked' | 'no_calendar'.
-- S1: locked from Semester 2's first day (hard cutoff) or once the correction window
--     (result_finalization_grace_days after sem1_end) has passed, whichever comes first.
-- S2: locked once the correction window has passed or the academic year has ended.
create or replace function public.result_semester_phase(p_year uuid, p_semester semester, p_on date default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  y public.academic_years%rowtype;
  today date := coalesce(p_on, public.school_today());
  grace integer;
  ceiling date;
begin
  select * into y from public.academic_years where id = p_year;
  if not found then return 'no_calendar'; end if;
  grace := coalesce(y.result_finalization_grace_days, 15);

  if p_semester = 'S1' then
    if today < y.sem1_start then return 'before_semester'; end if;
    if today >= y.sem2_start then return 'locked'; end if;
    ceiling := least(y.sem1_end + grace, y.sem2_start - 1);
    if today > ceiling then return 'locked'; end if;
    return case when today <= y.sem1_end then 'active' else 'grace_period' end;
  end if;

  if today < y.sem2_start then return 'before_semester'; end if;
  if today > y.year_end then return 'locked'; end if;
  ceiling := least(y.sem2_end + grace, y.year_end);
  if today > ceiling then return 'locked'; end if;
  return case when today <= y.sem2_end then 'active' else 'grace_period' end;
end;
$$;

-- True while scores may be written: active or correction window, or an audited override on a
-- locked semester. Never true before the semester has started.
create or replace function public.result_edit_window_open(p_year uuid, p_semester semester, p_override jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.result_semester_phase(p_year, p_semester)
           when 'active' then true
           when 'grace_period' then true
           when 'locked' then p_override is not null
           else false
         end;
$$;

-- Adds the calendar gate to the existing rule (LOCKED blocks everyone; Owner/Educational Director,
-- or the assigned subject teacher who is not marked absent today).
create or replace function public.can_edit_result_component(p_result_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    r.publish_status <> 'LOCKED'
    and public.result_edit_window_open(r.academic_year_id, r.semester, r.auto_lock_override)
    and (
      public.is_owner_or_admin()
      or (
        public.is_teacher()
        and public.teaches_class_subject(r.class_id, r.subject_id)
        and public.teacher_academic_action_ok(current_date)
      )
    )
  from public.results r
  where r.id = p_result_id;
$$;

-- Resolves (and, for a legacy row that was never pinned, pins) the configuration a result uses.
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

-- ---------------------------------------------------------------------------------------------
-- 5. Visibility of configurations (Owner/Director all; teacher for grades they teach; parent for
--    their child's grade/year or a configuration one of their child's published results uses;
--    Finance and everyone else: nothing)
-- ---------------------------------------------------------------------------------------------

create or replace function public.can_view_result_configuration(p_cfg uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.result_configurations c
    where c.id = p_cfg
      and (
        public.is_owner_or_admin()
        or (
          public.is_teacher()
          and exists (
            select 1 from public.teacher_assignments ta
            join public.classes cl on cl.id = ta.class_id
            where ta.teacher_id = auth.uid() and cl.grade = c.grade
          )
        )
        or (
          public.is_parent()
          and (
            exists (
              select 1 from public.parent_students ps
              join public.enrollments e on e.student_id = ps.student_id
              where ps.parent_id = auth.uid()
                and e.academic_year_id = c.academic_year_id
                and e.grade = c.grade
            )
            or exists (
              select 1 from public.results r
              where r.configuration_id = c.id
                and public.is_parent_of(r.student_id)
                and r.publish_status in ('PUBLISHED', 'LOCKED')
            )
          )
        )
      )
  );
$$;

create policy result_configurations_select on public.result_configurations
  for select using (public.can_view_result_configuration(id));

create policy result_assessment_components_select on public.result_assessment_components
  for select using (public.can_view_result_configuration(configuration_id));

create policy result_configuration_audit_select on public.result_configuration_audit
  for select using (public.is_owner_or_admin());

-- ---------------------------------------------------------------------------------------------
-- 6. Integrity: every configuration version totals exactly 100
-- ---------------------------------------------------------------------------------------------

create or replace function public.result_config_total_check()
returns trigger
language plpgsql
as $$
declare
  cid uuid := coalesce(new.configuration_id, old.configuration_id);
  total numeric;
begin
  if not exists (select 1 from public.result_configurations where id = cid) then
    return null;
  end if;
  select coalesce(sum(weight), 0) into total
    from public.result_assessment_components
   where configuration_id = cid and active;
  if total <> 100 then
    raise exception 'Assessment weights must total exactly 100 (configuration total is %).', total
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger result_assessment_components_total
  after insert or update or delete on public.result_assessment_components
  deferrable initially deferred
  for each row execute function public.result_config_total_check();

-- ---------------------------------------------------------------------------------------------
-- 7. Write guards on the existing result tables
-- ---------------------------------------------------------------------------------------------

-- 7a. results: pin the active configuration and validate scope on INSERT.
create or replace function public.results_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  grade_of_class text;
  cfg uuid;
begin
  select grade into grade_of_class from public.classes where id = new.class_id;
  if grade_of_class is null then
    raise exception 'Unknown class.' using errcode = 'P0001';
  end if;

  -- The student must actually belong to the class for that academic year.
  if not (
    exists (select 1 from public.students s where s.id = new.student_id and s.class_id = new.class_id)
    or exists (
      select 1 from public.enrollments e
      where e.student_id = new.student_id
        and e.academic_year_id = new.academic_year_id
        and e.class_id = new.class_id
    )
  ) then
    raise exception 'This student is not enrolled in that class.' using errcode = 'P0001';
  end if;

  select c.id into cfg
    from public.result_configurations c
   where c.academic_year_id = new.academic_year_id
     and c.semester = new.semester
     and c.grade = grade_of_class
     and c.status = 'ACTIVE';
  if cfg is null then
    raise exception 'RESULT_CONFIG_MISSING: no result structure is configured for % in this semester. Please contact the Educational Director.', grade_of_class
      using errcode = 'P0001';
  end if;
  new.configuration_id := cfg;
  return new;
end;
$$;

-- 7b. results: identity is immutable; publish gate; audited override stamping.
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

-- 7c. result_components: assessment membership, score range, server-stamped max/actor.
create or replace function public.result_components_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.result_assessment_components%rowtype;
  cfg uuid;
begin
  if tg_op = 'UPDATE' then
    if new.result_id is distinct from old.result_id or new.assessment_id is distinct from old.assessment_id then
      raise exception 'A score cannot be moved to another result or assessment.' using errcode = 'P0001';
    end if;
    if new.assessment_id is null then
      return new; -- legacy enum-keyed row: untouched apart from share flag / score
    end if;
  elsif new.assessment_id is null then
    raise exception 'An assessment is required.' using errcode = 'P0001';
  end if;

  select * into a from public.result_assessment_components where id = new.assessment_id;
  if not found then
    raise exception 'Unknown assessment.' using errcode = 'P0001';
  end if;
  cfg := public.result_effective_configuration(new.result_id);
  if a.configuration_id is distinct from cfg then
    raise exception 'That assessment does not belong to this result''s configured structure.' using errcode = 'P0001';
  end if;
  if not a.active then
    raise exception 'That assessment is archived.' using errcode = 'P0001';
  end if;
  if new.score is not null and (new.score < 0 or new.score > a.weight) then
    raise exception 'The score for % must be between 0 and %.', a.name, a.weight using errcode = '23514';
  end if;

  new.max := a.weight;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;

-- 7d. result_evidence: TEST assessments only, of the result's own configuration; derived columns.
create or replace function public.result_evidence_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.results%rowtype;
  a public.result_assessment_components%rowtype;
  cfg uuid;
begin
  if tg_op = 'UPDATE' then
    if new.result_id is distinct from old.result_id or new.assessment_id is distinct from old.assessment_id then
      raise exception 'Evidence cannot be moved to another result or assessment.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.assessment_id is null then
    raise exception 'An assessment is required for evidence.' using errcode = 'P0001';
  end if;
  select * into r from public.results where id = new.result_id;
  if not found then
    raise exception 'Unknown result.' using errcode = 'P0001';
  end if;
  select * into a from public.result_assessment_components where id = new.assessment_id;
  if not found then
    raise exception 'Unknown assessment.' using errcode = 'P0001';
  end if;
  cfg := public.result_effective_configuration(new.result_id);
  if a.configuration_id is distinct from cfg then
    raise exception 'That assessment does not belong to this result''s configured structure.' using errcode = 'P0001';
  end if;
  if a.kind <> 'TEST' then
    raise exception 'Evidence can only be attached to TEST assessments.' using errcode = 'P0001';
  end if;

  new.student_id := r.student_id;
  new.class_id := r.class_id;
  new.semester := r.semester;
  new.academic_year_id := r.academic_year_id;
  return new;
end;
$$;

create trigger results_before_insert_guard
  before insert on public.results
  for each row execute function public.results_before_insert();
create trigger results_update_guard
  before update on public.results
  for each row execute function public.results_guard();
create trigger result_components_write_guard
  before insert or update on public.result_components
  for each row execute function public.result_components_guard();
create trigger result_evidence_write_guard
  before insert or update on public.result_evidence
  for each row execute function public.result_evidence_guard();

-- The audit row describes the assessment by name so it stays readable after a structure change.
create or replace function public.stamp_result_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.actor_id := auth.uid();
  new.actor_role := public.current_role();
  select p.full_name into new.actor_name from public.profiles p where p.id = auth.uid();
  if new.assessment_id is not null and new.assessment_name is null then
    select a.name into new.assessment_name from public.result_assessment_components a where a.id = new.assessment_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Policies that referenced the legacy enum
-- ---------------------------------------------------------------------------------------------

drop policy if exists results_insert on public.results;
create policy results_insert on public.results
  for insert
  with check (
    publish_status = 'DRAFT'
    and (
      public.is_owner_or_admin()
      or (
        public.is_teacher()
        and public.teaches_class_subject(class_id, subject_id)
        and public.teacher_academic_action_ok(current_date)
        and public.result_edit_window_open(academic_year_id, semester, null)
      )
    )
  );

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

-- ---------------------------------------------------------------------------------------------
-- 9. save_result_configuration(): the ONLY writer of configurations
-- ---------------------------------------------------------------------------------------------

create or replace function public.save_result_configuration(
  p_academic_year_id uuid,
  p_semester semester,
  p_grade text,
  p_components jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grade text := btrim(coalesce(p_grade, ''));
  v_cfg public.result_configurations%rowtype;
  v_item jsonb;
  v_i integer := 0;
  v_name text;
  v_kind text;
  v_weight numeric;
  v_total numeric := 0;
  v_names text[] := '{}';
  v_old jsonb;
  v_new jsonb;
  v_target uuid;
  v_version integer;
  v_action text;
  v_actor_name text;
begin
  -- is_owner_or_admin() is NULL (not false) for a caller with no active profile, so compare
  -- explicitly: NULL must be denied too.
  if coalesce(public.is_owner_or_admin(), false) is not true then
    raise exception 'Only the Owner or Educational Director can configure results.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.academic_years where id = p_academic_year_id) then
    raise exception 'Unknown academic year.' using errcode = 'P0001';
  end if;
  if v_grade = '' or not exists (select 1 from public.classes where grade = v_grade) then
    raise exception 'Unknown grade.' using errcode = 'P0001';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'Add at least one assessment.' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_components) loop
    v_i := v_i + 1;
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_kind := upper(coalesce(v_item ->> 'kind', ''));
    begin
      v_weight := (v_item ->> 'weight')::numeric;
    exception when others then
      raise exception 'Assessment % has an invalid weight.', v_i using errcode = 'P0001';
    end;
    if v_name = '' then raise exception 'Assessment % needs a name.', v_i using errcode = 'P0001'; end if;
    if v_kind not in ('TEST', 'NON_TEST') then
      raise exception 'Assessment "%" must be a Test or a Non-test.', v_name using errcode = 'P0001';
    end if;
    if v_weight is null or v_weight <= 0 or v_weight > 100 or v_weight <> round(v_weight, 2) then
      raise exception 'Assessment "%" needs a weight above 0 (up to 2 decimals).', v_name using errcode = 'P0001';
    end if;
    if lower(v_name) = any (v_names) then
      raise exception 'Two assessments are both named "%".', v_name using errcode = 'P0001';
    end if;
    v_names := v_names || lower(v_name);
    v_total := v_total + v_weight;
  end loop;
  if v_total <> 100 then
    raise exception 'Assessment weights must total exactly 100 (currently %).', v_total using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', btrim(e ->> 'name'), 'weight', (e ->> 'weight')::numeric, 'kind', upper(e ->> 'kind')) order by ord), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(p_components) with ordinality as t(e, ord);

  select * into v_cfg
    from public.result_configurations
   where academic_year_id = p_academic_year_id and semester = p_semester and grade = v_grade and status = 'ACTIVE'
   for update;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'weight', weight, 'kind', kind) order by sort_order), '[]'::jsonb)
      into v_old
      from public.result_assessment_components
     where configuration_id = v_cfg.id and active;

    if v_old = v_new then
      return jsonb_build_object('configurationId', v_cfg.id, 'version', v_cfg.version, 'action', 'UNCHANGED');
    end if;

    if exists (select 1 from public.results where configuration_id = v_cfg.id) then
      -- Results already recorded: keep the old version intact, future entries use the new one.
      update public.result_configurations set status = 'SUPERSEDED', updated_by = auth.uid(), updated_at = now() where id = v_cfg.id;
      v_version := v_cfg.version + 1;
      v_action := 'NEW_VERSION';
    else
      delete from public.result_assessment_components where configuration_id = v_cfg.id;
      update public.result_configurations set updated_by = auth.uid(), updated_at = now() where id = v_cfg.id;
      v_target := v_cfg.id;
      v_version := v_cfg.version;
      v_action := 'UPDATED';
    end if;
  else
    select coalesce(max(version), 0) + 1 into v_version
      from public.result_configurations
     where academic_year_id = p_academic_year_id and semester = p_semester and grade = v_grade;
    v_old := null;
    v_action := 'CREATED';
  end if;

  if v_target is null then
    insert into public.result_configurations (academic_year_id, semester, grade, version, status, created_by, updated_by)
    values (p_academic_year_id, p_semester, v_grade, v_version, 'ACTIVE', auth.uid(), auth.uid())
    returning id into v_target;
  end if;

  v_i := 0;
  for v_item in select * from jsonb_array_elements(v_new) loop
    insert into public.result_assessment_components (configuration_id, name, weight, kind, sort_order)
    values (v_target, v_item ->> 'name', (v_item ->> 'weight')::numeric, v_item ->> 'kind', v_i);
    v_i := v_i + 1;
  end loop;

  select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.result_configuration_audit
    (configuration_id, academic_year_id, semester, grade, version, action, actor_id, actor_role, actor_name, diff)
  values
    (v_target, p_academic_year_id, p_semester, v_grade, v_version, v_action, auth.uid(), public.current_role(), v_actor_name,
     jsonb_build_object('before', v_old, 'after', v_new));

  return jsonb_build_object('configurationId', v_target, 'version', v_version, 'action', v_action);
end;
$$;

revoke all on function public.save_result_configuration(uuid, semester, text, jsonb) from public, anon;
grant execute on function public.save_result_configuration(uuid, semester, text, jsonb) to authenticated;
grant execute on function public.result_semester_phase(uuid, semester, date) to authenticated;
grant execute on function public.school_today() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. Correction window: 15 days is the school policy (was 14 default / 30 configured live)
-- ---------------------------------------------------------------------------------------------

alter table public.academic_years alter column result_finalization_grace_days set default 15;
update public.academic_years
   set result_finalization_grace_days = 15
 where id = '86d4ff72-ac18-4568-ae08-df84d2aad9ff'
   and result_finalization_grace_days = 30;

-- ---------------------------------------------------------------------------------------------
-- 11. Realtime (reuses the existing per-user channel in DataContext): a saved score / new
--     configuration reaches other signed-in users without a manual reload. RLS still filters rows.
-- ---------------------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['results', 'result_components', 'result_configurations'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
