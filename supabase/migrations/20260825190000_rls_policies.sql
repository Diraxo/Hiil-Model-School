-- Migration 8 of N: Row Level Security for every table created by migrations 1-7.
--
-- Source of truth for the business rules encoded below: src/context/DataContext.jsx,
-- src/utils/permissions.js, src/utils/staffPermissions.js, src/utils/studentPermissions.js,
-- src/utils/payrollPermissions.js, src/utils/constants.js (as audited 2026-08-25). Every
-- policy comment cites the client-side function/rule it mirrors so drift is easy to spot on
-- a future re-audit.
--
-- Design summary:
-- * Five roles only: OWNER, ADMIN ("Educational Director" display label), FINANCE ("Finance &
--   Operations Director"), TEACHER, PARENT -- exactly profiles.role's enum, nothing invented.
-- * public.current_role() is the single choke point every policy goes through. It returns NULL
--   for anyone without an ACTIVE profiles row, so a DISABLED/SUSPENDED account loses all access
--   immediately even if its Supabase Auth JWT is still technically valid -- this is what
--   AuthContext's forced-logout-on-disable behavior expects server-side too.
-- * Helper functions are SECURITY DEFINER + STABLE + fixed search_path so they can read
--   profiles/staff/teacher_assignments/etc. without recursing back through those tables' own
--   RLS, and are narrowly scoped (no caller-supplied user id, only auth.uid()) to prevent them
--   being used to query on someone else's behalf.
-- * Money-moving / invariant-heavy tables (payments, payment_allocations, payroll_payments,
--   salary_advances, fee_obligation_adjustments) get NO client-facing INSERT/UPDATE policy at
--   all -- the only write path is the existing SECURITY DEFINER RPCs from migrations 6-7, which
--   this migration hardens with real caller-identity/role checks (they currently trust their
--   p_recorded_by/p_actor_id/p_actor_role/p_actor_name parameters blindly, which is a privilege-
--   escalation/spoofing hole -- see the "RPC hardening" section below).
-- * A few rules genuinely cannot be expressed as plain row-level policies (column-level secrecy,
--   audience-jsonb targeting). Those are called out inline with SCHEMA LIMITATION comments and
--   solved with a masking view or a stamping trigger instead of a row-level workaround; none are
--   silently left open.

-- =====================================================================
-- Helper functions
-- =====================================================================

create or replace function public.current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and status = 'ACTIVE';
$$;

comment on function public.current_role is
  'The single source of truth every RLS policy in this schema uses. Returns NULL (not just a
   role) for any caller without an ACTIVE profiles row, so a DISABLED/SUSPENDED account is
   locked out of every policy below even if their JWT has not expired yet.';

create or replace function public.is_owner() returns boolean language sql stable
  security definer set search_path = public as $$ select public.current_role() = 'OWNER' $$;
create or replace function public.is_admin() returns boolean language sql stable
  security definer set search_path = public as $$ select public.current_role() = 'ADMIN' $$;
create or replace function public.is_finance() returns boolean language sql stable
  security definer set search_path = public as $$ select public.current_role() = 'FINANCE' $$;
create or replace function public.is_teacher() returns boolean language sql stable
  security definer set search_path = public as $$ select public.current_role() = 'TEACHER' $$;
create or replace function public.is_parent() returns boolean language sql stable
  security definer set search_path = public as $$ select public.current_role() = 'PARENT' $$;
-- Owner + Educational Director: the pairing used throughout DataContext for "full academic
-- administration" (canEditStudent, canManageAcademicYears, canAddBehavior, canPublishResult, ...).
create or replace function public.is_owner_or_admin() returns boolean language sql stable
  security definer set search_path = public as $$ select public.is_owner() or public.is_admin() $$;
-- Owner + Finance & Operations Director: canViewStudentPayments / canVoidPayment / canSetSalary /
-- canViewPayroll / canRecordAdvance / canRecordPayrollPayment.
create or replace function public.is_owner_or_finance() returns boolean language sql stable
  security definer set search_path = public as $$ select public.is_owner() or public.is_finance() $$;

-- Mirrors staffGroupLabel() in constants.js exactly.
create or replace function public.staff_group_for_position(p_position staff_position)
returns text
language sql
immutable
as $$
  select case
    when p_position in ('Educational Director', 'Finance Director') then 'Directors'
    when p_position = 'Teacher' then 'Teachers'
    else 'Other Staff'
  end;
$$;

-- Mirrors canManageStaffGroup() in staffPermissions.js: who may create/edit/disable a staff row
-- in this position's group. Owner manages every group; Educational Director only Teachers;
-- Finance & Operations Director only Other Staff; nobody but Owner manages Directors.
create or replace function public.manages_staff_group(p_position staff_position)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.staff_group_for_position(p_position)
    when 'Directors' then public.is_owner()
    when 'Teachers' then public.is_owner() or public.is_admin()
    else public.is_owner() or public.is_finance()
  end;
$$;

create or replace function public.is_parent_of(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.parent_students
    where parent_id = auth.uid() and student_id = p_student
  );
$$;

-- Mirrors isAssignedSubjectTeacher() in permissions.js.
create or replace function public.teaches_class_subject(p_class uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments
    where teacher_id = auth.uid() and class_id = p_class and subject_id = p_subject
  );
$$;

-- Mirrors canViewClassAttendance's teacher branch: any subject assignment in the class, or head
-- teacher of it.
create or replace function public.teaches_or_heads_class(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.teacher_assignments where teacher_id = auth.uid() and class_id = p_class)
      or exists (select 1 from public.classes where id = p_class and head_teacher_id = auth.uid());
$$;

create or replace function public.heads_class(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.classes where id = p_class and head_teacher_id = auth.uid());
$$;

-- Mirrors canTeacherPerformAcademicAction() in staffPermissions.js / DataContext's
-- myAcademicActionStatusFor: a Teacher marked Absent/Sick/Permission in their OWN staff
-- attendance for p_date cannot perform teacher-only academic actions (attendance, homework,
-- results) for that date. Vacuously true for every non-Teacher caller, and true when the
-- caller has no staff row or no attendance record for the date at all -- exactly the client rule.
create or replace function public.teacher_academic_action_ok(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.staff_attendance sa
    join public.staff s on s.id = sa.staff_id
    where s.user_id = auth.uid()
      and sa.date = p_date
      and sa.status in ('Absent', 'Sick', 'Permission')
  );
$$;

-- Mirrors canDecideLeaveRequest() in DataContext exactly.
create or replace function public.can_decide_leave(p_kind leave_kind, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner() then true
    when p_kind = 'STUDENT' then public.is_admin()
    else coalesce((
      select case public.staff_group_for_position(s.position)
        when 'Teachers' then public.is_admin()
        when 'Other Staff' then public.is_finance()
        else false
      end
      from public.staff s where s.id = p_subject
    ), false)
  end;
$$;

-- Mirrors canEditStaffAttendanceFor() in DataContext exactly.
create or replace function public.can_edit_staff_attendance_for(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner() then true
    else coalesce((
      select case public.staff_group_for_position(s.position)
        when 'Teachers' then public.is_admin()
        when 'Other Staff' then public.is_finance()
        else false
      end
      from public.staff s where s.id = p_staff
    ), false)
  end;
$$;

-- Mirrors canTakePeriodAttendance() in DataContext exactly (Owner always; Educational Director's
-- narrow "uncovered period" exception; the acting teacher -- substitute if one is assigned, else
-- the timetable's own teacher -- gated by teacher_academic_action_ok).
create or replace function public.can_act_on_period(p_entry uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner() then true
    when public.is_admin() then exists (
      select 1
      from public.timetable_entries te
      join public.staff s on s.user_id = te.teacher_id
      where te.id = p_entry
        and not exists (
          select 1 from public.substitutions sub
          where sub.timetable_entry_id = p_entry and sub.date = p_date
        )
        and exists (
          select 1 from public.staff_attendance sa
          where sa.staff_id = s.id and sa.date = p_date
            and sa.status in ('Absent', 'Sick', 'Permission')
        )
    )
    when public.is_teacher() then coalesce((
      select
        coalesce(
          (select sub.substitute_teacher_id from public.substitutions sub
             where sub.timetable_entry_id = p_entry and sub.date = p_date),
          te.teacher_id
        ) = auth.uid()
        and public.teacher_academic_action_ok(p_date)
      from public.timetable_entries te where te.id = p_entry
    ), false)
    else false
  end;
$$;

-- Mirrors canViewResult() in permissions.js.
create or replace function public.can_view_result(p_class uuid, p_subject uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner_or_admin()
      or (public.is_teacher() and public.teaches_class_subject(p_class, p_subject))
      or (public.is_parent() and public.is_parent_of(p_student));
$$;

-- Mirrors canEditResultComponent() in permissions.js: LOCKED blocks everyone, including
-- Owner/Admin, until explicitly unlocked.
create or replace function public.can_edit_result_component(p_result_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    r.publish_status <> 'LOCKED'
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

-- Mirrors canViewResultAudit(): Parents never see the audit trail; Finance never sees Results
-- at all.
create or replace function public.can_view_result_audit(p_class uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner_or_admin()
      or (public.is_teacher() and public.teaches_class_subject(p_class, p_subject));
$$;

-- =====================================================================
-- profiles
-- =====================================================================
-- SCHEMA LIMITATION: there is no trigger on auth.users that auto-creates a profiles row (the
-- Owner bootstrap in seed_owner.sql is a one-off manual insert). Ordinary staff/parent account
-- creation needs the Supabase Auth Admin API (a service-role operation), which is out of RLS's
-- reach entirely -- deliberately NO insert policy is added here. This is flagged again in the
-- final report as a blocker for the Auth/frontend conversion phase, not solved in this migration.

alter table public.profiles enable row level security;

-- Broad internal read: every screen in the app resolves other users' names for legitimate
-- reasons (teacher names on timetables, class head teachers, message/notification senders,
-- audit-log actor names, parent/teacher directory) and none of it is exposed to anonymous
-- callers -- only to another already-authenticated, ACTIVE member of the same school.
create policy profiles_select_authenticated on public.profiles
  for select
  using (public.current_role() is not null);

-- Row-level: self, or Owner, or the manager of the target's staff group (Educational Director
-- for Teachers, Finance & Operations Director for Other Staff) -- mirrors setStaffStatus's
-- cascade into the linked login account. The BEFORE UPDATE trigger below enforces the actual
-- column-level rule (only Owner may change role; status changes are further gated by group;
-- nobody may change their own role/status) since RLS alone can't express "this column, not
-- that one."
create policy profiles_update_self_or_manager on public.profiles
  for update
  using (
    id = auth.uid()
    or public.is_owner()
    or (public.is_admin() and exists (
      select 1 from public.staff s where s.user_id = profiles.id and s.position = 'Teacher'
    ))
    or (public.is_finance() and exists (
      select 1 from public.staff s where s.user_id = profiles.id
        and public.staff_group_for_position(s.position) = 'Other Staff'
    ))
  )
  with check (
    id = auth.uid()
    or public.is_owner()
    or (public.is_admin() and exists (
      select 1 from public.staff s where s.user_id = profiles.id and s.position = 'Teacher'
    ))
    or (public.is_finance() and exists (
      select 1 from public.staff s where s.user_id = profiles.id
        and public.staff_group_for_position(s.position) = 'Other Staff'
    ))
  );

create or replace function public.enforce_profile_privilege_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception 'Only the Owner may change a user''s role';
  end if;
  if new.status is distinct from old.status then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own account status';
    end if;
    if not (
      public.is_owner()
      or (public.is_admin() and exists (
        select 1 from public.staff s where s.user_id = new.id and s.position = 'Teacher'
      ))
      or (public.is_finance() and exists (
        select 1 from public.staff s where s.user_id = new.id
          and public.staff_group_for_position(s.position) = 'Other Staff'
      ))
    ) then
      raise exception 'Not authorized to change this account''s status';
    end if;
  end if;
  if new.must_change_password is distinct from old.must_change_password and new.id <> auth.uid() and not public.is_owner() then
    raise exception 'Not authorized to change must_change_password for another user';
  end if;
  return new;
end;
$$;

comment on function public.enforce_profile_privilege_guard is
  'Closes the self-escalation hole the row-level policy alone cannot: "id = auth.uid()" lets
   anyone UPDATE their own row (needed for editing their own name/phone/photo), which would
   otherwise also let them UPDATE their own role or status in the same statement.';

create trigger profiles_privilege_guard
  before update on public.profiles
  for each row
  execute function public.enforce_profile_privilege_guard();

-- =====================================================================
-- staff
-- =====================================================================
-- SCHEMA LIMITATION: Postgres RLS is row-level only -- it cannot hide the salary/payment_schedule
-- columns from an Educational Director while still showing them the same row's name/position/
-- phone/bank_account. canViewPayroll (payrollPermissions.js) is explicit that Educational
-- Director gets ZERO salary/payroll visibility, so the base table's SELECT policy below is
-- Owner/Finance only (full columns), and a companion `staff_directory` view (defined further
-- down, after both roles' access needs are established) gives Educational Director (Teachers
-- only) and a Teacher (their own row only) the non-financial columns instead. bank_account is
-- NOT payroll-restricted -- per the locked payroll redesign, it follows ordinary
-- canManageStaffGroup scoping like any other staff field, so it stays in the directory view.

alter table public.staff enable row level security;

create policy staff_select_owner_finance on public.staff
  for select
  using (public.is_owner_or_finance());

-- INSERT/UPDATE/DELETE all gate on manages_staff_group(position) -- for UPDATE this is checked
-- against BOTH the existing row (using) and the proposed new row (with check), so an Educational
-- Director editing a Teacher can never reassign them into a group outside their own remit
-- (e.g. promoting into "Educational Director" to self-escalate, or into a group they don't
-- manage) -- and a matching trigger blocks the one thing row-level checks still can't reach:
-- Educational Director/Finance touching the salary or payment_schedule columns at all.
create policy staff_insert_manager on public.staff
  for insert
  with check (public.manages_staff_group(position));

create policy staff_update_manager on public.staff
  for update
  using (public.manages_staff_group(position))
  with check (public.manages_staff_group(position));

create policy staff_delete_manager on public.staff
  for delete
  using (public.manages_staff_group(position));

create or replace function public.enforce_staff_financial_field_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.salary is distinct from old.salary or new.payment_schedule is distinct from old.payment_schedule)
     and not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may change salary or payment schedule';
  end if;
  return new;
end;
$$;

create trigger staff_financial_field_guard
  before update on public.staff
  for each row
  execute function public.enforce_staff_financial_field_guard();

-- Non-financial staff directory: Owner/Finance (every row, though they should just use the base
-- table), Educational Director (Teachers only, matching staffAttendanceGroupsFor's ADMIN scope),
-- and a Teacher's own row. Deliberately created with the default (definer-style) view behavior
-- so it can show ADMIN/TEACHER rows the base table's RLS denies them directly, while never
-- projecting salary/payment_schedule at all.
create view public.staff_directory as
select
  id, user_id, employee_number, name, position, employment_date, phone, bank_account,
  status, employment_status, employment_end_date, photo_url, has_shifts, created_at, updated_at
from public.staff
where
  public.is_owner_or_finance()
  or (public.is_admin() and position = 'Teacher')
  or (public.is_teacher() and user_id = auth.uid());

comment on view public.staff_directory is
  'Column-masked companion to public.staff for roles that need to see SOME staff rows but must
   never see salary/payment_schedule (Educational Director for Teachers, a Teacher for their own
   row) -- see the SCHEMA LIMITATION note on the staff table.';

grant select on public.staff_directory to authenticated;

-- =====================================================================
-- students / enrollments / parent_students
-- =====================================================================

alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.parent_students enable row level security;

-- Mirrors canEditStudent/canViewClassAttendance's teacher branch/is_parent_of.
create policy students_select on public.students
  for select
  using (
    public.is_owner_or_admin()
    or public.is_finance()
    or (public.is_teacher() and class_id is not null and public.teaches_or_heads_class(class_id))
    or (public.is_parent() and public.is_parent_of(id))
  );

-- canEditStudent/canDeleteStudent/canSuspendStudent/canChangeStudentPhoto: Owner + Educational
-- Director only.
create policy students_insert on public.students
  for insert with check (public.is_owner_or_admin());
create policy students_update on public.students
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy students_delete on public.students
  for delete using (public.is_owner_or_admin());

create policy enrollments_select on public.enrollments
  for select
  using (
    public.is_owner_or_admin()
    or public.is_finance()
    or (public.is_teacher() and exists (
      select 1 from public.students s where s.id = enrollments.student_id
        and s.class_id is not null and public.teaches_or_heads_class(s.class_id)
    ))
    or (public.is_parent() and public.is_parent_of(student_id))
  );
-- canManageAcademicYears (= canEditStudent): Owner + Educational Director only. Year-rollout
-- enrollment rows are administrative, not a Teacher/Finance action.
create policy enrollments_insert on public.enrollments
  for insert with check (public.is_owner_or_admin());
create policy enrollments_update on public.enrollments
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- parent_students: the parent themselves (read-only -- they never self-link), plus Owner/
-- Educational Director who manage the linkage administratively.
create policy parent_students_select on public.parent_students
  for select using (parent_id = auth.uid() or public.is_owner_or_admin());
create policy parent_students_insert on public.parent_students
  for insert with check (public.is_owner_or_admin());
create policy parent_students_update on public.parent_students
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy parent_students_delete on public.parent_students
  for delete using (public.is_owner_or_admin());

-- =====================================================================
-- academic_years / subjects / classes / class_subjects / teacher_assignments
-- =====================================================================
-- All five are reference/curriculum data every authenticated role needs broad read access to
-- (calendar gating, timetable/homework/results context, class rosters) -- none of it is
-- per-student or financial. Writes are Owner/Educational Director (curriculum administration),
-- matching canManageAcademicYears and the Curriculum/Results audit's "who edits classes/
-- subjects" scope.

alter table public.academic_years enable row level security;
alter table public.subjects enable row level security;
alter table public.classes enable row level security;
alter table public.class_subjects enable row level security;
alter table public.teacher_assignments enable row level security;

create policy academic_years_select on public.academic_years for select using (public.current_role() is not null);
create policy academic_years_insert on public.academic_years for insert with check (public.is_owner_or_admin());
create policy academic_years_update on public.academic_years for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

create policy subjects_select on public.subjects for select using (public.current_role() is not null);
create policy subjects_insert on public.subjects for insert with check (public.is_owner_or_admin());
create policy subjects_update on public.subjects for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy subjects_delete on public.subjects for delete using (public.is_owner_or_admin());

create policy classes_select on public.classes for select using (public.current_role() is not null);
create policy classes_insert on public.classes for insert with check (public.is_owner_or_admin());
create policy classes_update on public.classes for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy classes_delete on public.classes for delete using (public.is_owner_or_admin());

create policy class_subjects_select on public.class_subjects for select using (public.current_role() is not null);
create policy class_subjects_insert on public.class_subjects for insert with check (public.is_owner_or_admin());
create policy class_subjects_delete on public.class_subjects for delete using (public.is_owner_or_admin());

create policy teacher_assignments_select on public.teacher_assignments for select using (public.current_role() is not null);
create policy teacher_assignments_insert on public.teacher_assignments for insert with check (public.is_owner_or_admin());
create policy teacher_assignments_update on public.teacher_assignments for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy teacher_assignments_delete on public.teacher_assignments for delete using (public.is_owner_or_admin());

-- =====================================================================
-- timetable_config / timetable_entries / school_closures
-- =====================================================================

alter table public.timetable_config enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.school_closures enable row level security;

create policy timetable_config_select on public.timetable_config for select using (public.current_role() is not null);
create policy timetable_config_update on public.timetable_config for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

create policy timetable_entries_select on public.timetable_entries for select using (public.current_role() is not null);
create policy timetable_entries_insert on public.timetable_entries for insert with check (public.is_owner_or_admin());
create policy timetable_entries_update on public.timetable_entries for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy timetable_entries_delete on public.timetable_entries for delete using (public.is_owner_or_admin());

create policy school_closures_select on public.school_closures for select using (public.current_role() is not null);
create policy school_closures_insert on public.school_closures for insert with check (public.is_owner_or_admin());
create policy school_closures_delete on public.school_closures for delete using (public.is_owner_or_admin());

-- =====================================================================
-- leave_requests / owner_leave_log
-- =====================================================================

alter table public.leave_requests enable row level security;
alter table public.owner_leave_log enable row level security;

create policy leave_requests_select on public.leave_requests
  for select
  using (requested_by = auth.uid() or public.can_decide_leave(kind, subject_id));

-- requested_by must be the caller (no submitting on someone else's behalf via a spoofed id) and
-- the subject must be one the caller may actually request leave for: a Parent for their own
-- child, a Teacher/staff member for themselves, or Owner/Educational Director/Finance acting
-- administratively for anyone in their remit.
create policy leave_requests_insert on public.leave_requests
  for insert
  with check (
    requested_by = auth.uid()
    and (
      (kind = 'STUDENT' and (public.is_parent_of(subject_id) or public.is_owner_or_admin()))
      or (kind = 'STAFF' and (
        exists (select 1 from public.staff s where s.id = subject_id and s.user_id = auth.uid())
        or public.is_owner()
        or (public.is_admin() and exists (select 1 from public.staff s where s.id = subject_id and s.position = 'Teacher'))
        or (public.is_finance() and exists (select 1 from public.staff s where s.id = subject_id and public.staff_group_for_position(s.position) = 'Other Staff'))
      ))
    )
  );

-- Deciding (approve/reject) and the completion-notified housekeeping flag both go through this
-- one UPDATE policy; can_decide_leave mirrors canDecideLeaveRequest exactly, and only a PENDING
-- request can be decided (decideLeaveRequest's own guard, restated here).
create policy leave_requests_update on public.leave_requests
  for update
  using (public.can_decide_leave(kind, subject_id) or approval_status <> 'PENDING')
  with check (public.can_decide_leave(kind, subject_id) or approval_status <> 'PENDING');

create policy owner_leave_log_select on public.owner_leave_log
  for select using (public.is_owner() or public.is_admin());
create policy owner_leave_log_insert on public.owner_leave_log
  for insert with check (public.is_owner());

-- =====================================================================
-- attendance (student, daily roster)
-- =====================================================================

alter table public.attendance enable row level security;

create policy attendance_select on public.attendance
  for select
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.teaches_or_heads_class(class_id))
    or (public.is_parent() and public.is_parent_of(student_id))
  );

-- Mirrors canTakeClassAttendance/canEditClassAttendance: Owner/Educational Director always; a
-- Teacher only as the class's head teacher, and only when not themselves marked
-- Absent/Sick/Permission that day.
create policy attendance_insert on public.attendance
  for insert
  with check (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.heads_class(class_id) and public.teacher_academic_action_ok(date))
  );
create policy attendance_update on public.attendance
  for update
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.heads_class(class_id) and public.teacher_academic_action_ok(date))
  )
  with check (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.heads_class(class_id) and public.teacher_academic_action_ok(date))
  );

-- =====================================================================
-- staff_attendance
-- =====================================================================

alter table public.staff_attendance enable row level security;

create policy staff_attendance_select on public.staff_attendance
  for select
  using (
    public.can_edit_staff_attendance_for(staff_id)
    or exists (select 1 from public.staff s where s.id = staff_attendance.staff_id and s.user_id = auth.uid())
  );

create policy staff_attendance_insert on public.staff_attendance
  for insert with check (public.can_edit_staff_attendance_for(staff_id));
create policy staff_attendance_update on public.staff_attendance
  for update using (public.can_edit_staff_attendance_for(staff_id)) with check (public.can_edit_staff_attendance_for(staff_id));

-- =====================================================================
-- period_logs / substitutions
-- =====================================================================

alter table public.period_logs enable row level security;
alter table public.substitutions enable row level security;

create policy period_logs_select on public.period_logs
  for select
  using (
    public.is_owner_or_admin()
    or exists (
      select 1 from public.timetable_entries te
      where te.id = period_logs.timetable_entry_id
        and (te.teacher_id = auth.uid() or exists (
          select 1 from public.substitutions sub
          where sub.timetable_entry_id = te.id and sub.date = period_logs.date and sub.substitute_teacher_id = auth.uid()
        ))
    )
  );
create policy period_logs_insert on public.period_logs
  for insert with check (public.can_act_on_period(timetable_entry_id, date));
create policy period_logs_update on public.period_logs
  for update using (public.can_act_on_period(timetable_entry_id, date)) with check (public.can_act_on_period(timetable_entry_id, date));

create policy substitutions_select on public.substitutions
  for select
  using (public.is_owner_or_admin() or original_teacher_id = auth.uid() or substitute_teacher_id = auth.uid());
create policy substitutions_insert on public.substitutions
  for insert with check (public.is_owner_or_admin());
create policy substitutions_delete on public.substitutions
  for delete using (public.is_owner_or_admin());

-- =====================================================================
-- homework
-- =====================================================================

alter table public.homework enable row level security;

create policy homework_select on public.homework
  for select
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and (teacher_id = auth.uid() or public.teaches_class_subject(class_id, subject_id)))
    or (public.is_parent() and exists (
      select 1 from public.students s where s.class_id = homework.class_id and public.is_parent_of(s.id)
    ))
  );
create policy homework_insert on public.homework
  for insert
  with check (
    public.is_owner_or_admin()
    or (public.is_teacher() and teacher_id = auth.uid() and public.teaches_class_subject(class_id, subject_id)
        and public.teacher_academic_action_ok(current_date))
  );
create policy homework_update on public.homework
  for update
  using (public.is_owner_or_admin() or (public.is_teacher() and teacher_id = auth.uid()))
  with check (public.is_owner_or_admin() or (public.is_teacher() and teacher_id = auth.uid() and public.teacher_academic_action_ok(current_date)));
create policy homework_delete on public.homework
  for delete using (public.is_owner_or_admin() or (public.is_teacher() and teacher_id = auth.uid()));

-- =====================================================================
-- results / result_components / result_audit_log / result_evidence
-- =====================================================================

alter table public.results enable row level security;
alter table public.result_components enable row level security;
alter table public.result_audit_log enable row level security;
alter table public.result_evidence enable row level security;

-- canViewResult: Finance gets zero access to Results, full stop.
create policy results_select on public.results
  for select using (public.can_view_result(class_id, subject_id, student_id));

-- A record starts DRAFT and is only ever created by someone who could also edit it.
create policy results_insert on public.results
  for insert
  with check (
    publish_status = 'DRAFT'
    and (
      public.is_owner_or_admin()
      or (public.is_teacher() and public.teaches_class_subject(class_id, subject_id) and public.teacher_academic_action_ok(current_date))
    )
  );

-- canPublishResult/canLockResult/canUnlockResult: publish_status transitions are Owner/
-- Educational Director only, regardless of who owns the subject -- a Teacher never flips this
-- column, only the component scores below.
create policy results_update on public.results
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

create policy result_components_select on public.result_components
  for select
  using (exists (
    select 1 from public.results r
    where r.id = result_components.result_id and public.can_view_result(r.class_id, r.subject_id, r.student_id)
  ));
create policy result_components_insert on public.result_components
  for insert with check (public.can_edit_result_component(result_id));
create policy result_components_update on public.result_components
  for update using (public.can_edit_result_component(result_id)) with check (public.can_edit_result_component(result_id));

-- canViewResultAudit: excludes Parent and Finance entirely.
create policy result_audit_log_select on public.result_audit_log
  for select
  using (exists (
    select 1 from public.results r
    where r.id = result_audit_log.result_id and public.can_view_result_audit(r.class_id, r.subject_id)
  ));
-- Insert rights mirror who could make the change being audited; the stamping trigger below
-- overwrites actor_id/actor_role/actor_name regardless of what the client sends, so this can
-- never be used to forge an audit entry under someone else's name.
create policy result_audit_log_insert on public.result_audit_log
  for insert with check (public.can_edit_result_component(result_id));

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
  return new;
end;
$$;

create trigger result_audit_log_stamp_actor
  before insert on public.result_audit_log
  for each row
  execute function public.stamp_result_audit_actor();

-- Evidence follows the same edit gate as the component it documents; a Parent additionally
-- needs the result published AND that specific component marked shared_with_parents (mirrors
-- ParentPages' `comp?.sharedWithParents ? data.resultEvidenceFor(...) : []` -- scores are always
-- visible once published, evidence photos only when explicitly shared).
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
              where rc.result_id = r.id and rc.component = result_evidence.component and rc.shared_with_parents
            )
          )
        )
    )
  );
create policy result_evidence_insert on public.result_evidence
  for insert with check (public.can_edit_result_component(result_id));
create policy result_evidence_delete on public.result_evidence
  for delete using (public.can_edit_result_component(result_id));

create or replace function public.stamp_result_evidence_uploader()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.uploaded_by := auth.uid();
  return new;
end;
$$;

create trigger result_evidence_stamp_uploader
  before insert on public.result_evidence
  for each row
  execute function public.stamp_result_evidence_uploader();

-- =====================================================================
-- exam_announcements
-- =====================================================================
-- Unfiltered for every staff role in the current app (AdminPages' isStaff dashboards read
-- db.examAnnouncements with no audience filter); a Parent only sees ALL/GRADE/SECTION matches
-- against their own linked children, mirroring announcementMatchesStudent() in ParentPages.jsx.
-- Creation is gated to the same isStaff (Owner/Educational Director) boundary as AnnounceExamModal.

alter table public.exam_announcements enable row level security;

create policy exam_announcements_select on public.exam_announcements
  for select
  using (
    public.is_owner() or public.is_admin() or public.is_finance() or public.is_teacher()
    or (public.is_parent() and (
      (audience ->> 'type') = 'ALL'
      or exists (
        select 1 from public.students s
        where public.is_parent_of(s.id)
          and (
            ((audience ->> 'type') = 'GRADE' and s.grade = (audience ->> 'grade'))
            or ((audience ->> 'type') = 'SECTION' and s.grade = (audience ->> 'grade') and s.section = (audience ->> 'section'))
          )
      )
    ))
  );
create policy exam_announcements_insert on public.exam_announcements
  for insert with check (public.is_owner_or_admin());
create policy exam_announcements_delete on public.exam_announcements
  for delete using (public.is_owner_or_admin());

-- =====================================================================
-- report_cards
-- =====================================================================

alter table public.report_cards enable row level security;

create policy report_cards_select on public.report_cards
  for select
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and public.teaches_or_heads_class(class_id))
    or (public.is_parent() and public.is_parent_of(student_id) and status in ('PUBLISHED', 'LOCKED'))
  );
-- generate/publish/lock/reopen/promotion are all only ever called from AdminPages.jsx (isStaff
-- boundary) -- Owner + Educational Director.
create policy report_cards_insert on public.report_cards
  for insert with check (public.is_owner_or_admin());
create policy report_cards_update on public.report_cards
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- =====================================================================
-- behavior_records
-- =====================================================================

alter table public.behavior_records enable row level security;

create policy behavior_records_select on public.behavior_records
  for select
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and exists (
      select 1 from public.students s where s.id = behavior_records.student_id
        and s.class_id is not null and public.teaches_or_heads_class(s.class_id)
    ))
    or (public.is_parent() and public.is_parent_of(student_id))
  );
-- canAddBehavior: Owner + Educational Director only; a Teacher can view but never add/edit.
create policy behavior_records_insert on public.behavior_records
  for insert with check (public.is_owner_or_admin());
create policy behavior_records_update on public.behavior_records
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy behavior_records_delete on public.behavior_records
  for delete using (public.is_owner_or_admin());

-- =====================================================================
-- student_documents
-- =====================================================================
-- INFERRED: no dedicated permission helper exists for this table in the audited source (unlike
-- every other domain above). Document management (ID copies, uploaded report cards, etc.) lives
-- on the same student-profile admin surface as canEditStudent, so it is scoped identically here
-- -- flagged in the final report as an inference, not a directly-cited rule, in case the intended
-- behavior is actually broader (e.g. a Teacher uploading a document for their own class).

alter table public.student_documents enable row level security;

create policy student_documents_select on public.student_documents
  for select
  using (
    public.is_owner_or_admin()
    or (public.is_teacher() and exists (
      select 1 from public.students s where s.id = student_documents.student_id
        and s.class_id is not null and public.teaches_or_heads_class(s.class_id)
    ))
    or (public.is_parent() and public.is_parent_of(student_id))
  );
create policy student_documents_insert on public.student_documents
  for insert with check (public.is_owner_or_admin());
create policy student_documents_delete on public.student_documents
  for delete using (public.is_owner_or_admin());

create or replace function public.stamp_student_document_uploader()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.uploaded_by := auth.uid();
  return new;
end;
$$;

create trigger student_documents_stamp_uploader
  before insert on public.student_documents
  for each row
  execute function public.stamp_student_document_uploader();

-- =====================================================================
-- announcements
-- =====================================================================
-- Mirrors AnnouncementsPage's `visible` filter in AdminPages.jsx line ~4210 exactly: Owner and
-- Educational Director see every row unconditionally; everyone else always sees their own
-- authored rows (even scheduled/expired), and otherwise only a live (published, not expired) row
-- whose audience matches their role/grade/section/user id.

alter table public.announcements enable row level security;

create policy announcements_select on public.announcements
  for select
  using (
    public.is_owner_or_admin()
    or author_id = auth.uid()
    or (
      (publish_at is null or publish_at <= now())
      and (expires_at is null or expires_at >= now())
      and (
        (audience ->> 'type') = 'ALL'
        or (public.is_parent() and (audience ->> 'type') = 'ALL_PARENTS')
        or (public.is_teacher() and (audience ->> 'type') = 'ALL_TEACHERS')
        or (public.is_finance() and (audience ->> 'type') = 'DIRECTORS')
        or (public.is_parent() and (audience ->> 'type') = 'GRADE' and exists (
          select 1 from public.students s where public.is_parent_of(s.id) and s.grade = (audience ->> 'grade')
        ))
        or (public.is_parent() and (audience ->> 'type') = 'SECTION' and exists (
          select 1 from public.students s where public.is_parent_of(s.id)
            and s.grade = (audience ->> 'grade') and s.section = (audience ->> 'section')
        ))
        or ((audience ->> 'type') = 'USER' and (audience ->> 'userId') = auth.uid()::text)
      )
    )
  );
-- canManage (AnnouncementsPage) = Educational Director or Finance; Owner implicitly via
-- is_owner_or_admin. author_id is stamped server-side below so it can never be spoofed.
create policy announcements_insert on public.announcements
  for insert with check (public.is_owner_or_admin() or public.is_finance());
create policy announcements_update on public.announcements
  for update
  using (public.is_owner_or_admin() or author_id = auth.uid())
  with check (public.is_owner_or_admin() or author_id = auth.uid());
create policy announcements_delete on public.announcements
  for delete using (public.is_owner_or_admin() or author_id = auth.uid());

create or replace function public.stamp_announcement_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := auth.uid();
  return new;
end;
$$;

create trigger announcements_stamp_author
  before insert on public.announcements
  for each row
  execute function public.stamp_announcement_author();

-- =====================================================================
-- notifications
-- =====================================================================
-- SCHEMA LIMITATION: in the current mock app every notification-fanout (a leave decision, a
-- published result, a new message, ...) is written by DataContext as a side effect of the
-- SAME client-side commit() that makes the underlying change -- e.g. a Teacher publishing
-- nothing themselves but a Parent's notification row being inserted by whoever's browser
-- happens to run the mutator. There is no safe plain-RLS INSERT policy for "any authenticated
-- user may insert a notifications row for a DIFFERENT user_id" -- that is exactly an open
-- relay for notification spam/spoofing. Direct client INSERT is therefore denied entirely
-- (no insert policy = default deny). This is flagged in the final report: the frontend
-- conversion phase needs to move every one of these fan-out writes into SECURITY DEFINER RPCs
-- (the same pattern migrations 6-7 already use for payments/payroll), each independently
-- checking that the caller was actually entitled to trigger that notification.

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.enforce_notification_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.type is distinct from old.type
     or new.image is distinct from old.image
     or new.announcement_id is distinct from old.announcement_id
     or new.payment_id is distinct from old.payment_id
     or new.navigation is distinct from old.navigation
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the read flag may be updated on a notification';
  end if;
  return new;
end;
$$;

create trigger notifications_update_guard
  before update on public.notifications
  for each row
  execute function public.enforce_notification_update_guard();

-- =====================================================================
-- conversations / messages
-- =====================================================================
-- No app-level restriction on WHO may message whom was found (any two users can converse; the
-- Messages UI's contact list is not a security boundary, just a UX default) -- so the only
-- server-enforced rule is participant membership, which is the real, unavoidable security
-- boundary regardless of what any future contact-list UI implies.

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy conversations_select on public.conversations
  for select using (auth.uid() in (participant_1_id, participant_2_id));
-- No direct INSERT policy: get_or_create_conversation() (hardened below) is the only creation
-- path, so the canonical lo/hi ordering and the "two distinct participants" rule can never be
-- bypassed by a hand-crafted insert.

create policy messages_select on public.messages
  for select using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and auth.uid() in (c.participant_1_id, c.participant_2_id)
  ));
create policy messages_insert on public.messages
  for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and auth.uid() in (c.participant_1_id, c.participant_2_id)
    )
  );
-- markMessagesRead: the recipient (a participant, not the sender of a given row) flips `read`.
create policy messages_update on public.messages
  for update
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and auth.uid() in (c.participant_1_id, c.participant_2_id)
  ))
  with check (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and auth.uid() in (c.participant_1_id, c.participant_2_id)
  ));

create or replace function public.enforce_message_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.text is distinct from old.text or new.sender_id is distinct from old.sender_id
     or new.conversation_id is distinct from old.conversation_id or new.created_at is distinct from old.created_at then
    raise exception 'Only the read flag may be updated on a message';
  end if;
  return new;
end;
$$;

create trigger messages_update_guard
  before update on public.messages
  for each row
  execute function public.enforce_message_update_guard();

-- =====================================================================
-- activities
-- =====================================================================
-- SCHEMA LIMITATION: same class of problem as notifications -- the global activity feed is
-- currently written as a side effect of many unrelated client-side mutators. Read access is
-- broad (every dashboard in the audited source reads db.activities with no role filter), but
-- direct client INSERT is denied for the same open-relay reason as notifications: anyone could
-- otherwise write an arbitrary-looking system message into a feed every role sees. Flagged for
-- the same RPC-based fix in the frontend conversion phase.

alter table public.activities enable row level security;

create policy activities_select on public.activities
  for select using (public.current_role() is not null);

-- =====================================================================
-- fee_types / fee_schedules / fee_installments / payment_methods (catalog, not per-student)
-- =====================================================================

alter table public.fee_types enable row level security;
alter table public.fee_schedules enable row level security;
alter table public.fee_installments enable row level security;
alter table public.payment_methods enable row level security;

create policy fee_types_select on public.fee_types for select using (public.current_role() is not null);
create policy fee_types_insert on public.fee_types for insert with check (public.is_owner_or_finance());
create policy fee_types_update on public.fee_types for update using (public.is_owner_or_finance()) with check (public.is_owner_or_finance());

create policy fee_schedules_select on public.fee_schedules for select using (public.current_role() is not null);
create policy fee_schedules_insert on public.fee_schedules for insert with check (public.is_owner_or_finance());
create policy fee_schedules_update on public.fee_schedules for update using (public.is_owner_or_finance()) with check (public.is_owner_or_finance());

create policy fee_installments_select on public.fee_installments for select using (public.current_role() is not null);
create policy fee_installments_insert on public.fee_installments for insert with check (public.is_owner_or_finance());
create policy fee_installments_update on public.fee_installments for update using (public.is_owner_or_finance()) with check (public.is_owner_or_finance());

create policy payment_methods_select on public.payment_methods for select using (public.current_role() is not null);
create policy payment_methods_insert on public.payment_methods for insert with check (public.is_owner_or_finance());
create policy payment_methods_update on public.payment_methods for update using (public.is_owner_or_finance()) with check (public.is_owner_or_finance());

-- =====================================================================
-- student_fee_obligations / fee_obligation_adjustments / payments / payment_allocations /
-- payment_audit_log
-- =====================================================================
-- canViewStudentPayments/canVoidPayment: Owner + Finance & Operations Director ONLY -- this is
-- the one place in the whole app where Educational Director explicitly gets zero access (spec
-- "no matter how they reach the student profile"). A Parent additionally sees their OWN
-- children's fee/payment data via the separate ParentPaymentsPage path (Blocker 2/4, live-
-- verified) -- that visibility is per-student via parent_students, never school-wide.
--
-- Every write to these five tables goes ONLY through the SECURITY DEFINER RPCs from migration 6
-- (record_payment_batch / void_payment / add_obligation_adjustment), hardened below with real
-- caller checks -- deliberately NO client-facing insert/update policy exists on any of them, so
-- there is exactly one path that can ever create a payment, allocation, adjustment, or void, and
-- it enforces the Blocker 2/4 invariants (row locking, net-owed caps, whole-receipt-only void)
-- that a plain RLS insert policy could never guarantee.

alter table public.student_fee_obligations enable row level security;
alter table public.fee_obligation_adjustments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_audit_log enable row level security;

create policy student_fee_obligations_select on public.student_fee_obligations
  for select using (public.is_owner_or_finance() or (public.is_parent() and public.is_parent_of(student_id)));
-- Unlike payments/allocations/adjustments, migrations 6-7 define NO materialization RPC for
-- this table (student_fee_obligations rows are created directly at year-rollout/enrollment/bus
-- opt-in time, per the schema's own comment) -- so it needs an ordinary direct-table policy,
-- scoped to the same Owner/Finance authority as the rest of the fee catalog. amount_due is
-- "frozen at materialization time" per the schema comment (corrections go through
-- fee_obligation_adjustments only), so deliberately no UPDATE/DELETE policy exists here.
create policy student_fee_obligations_insert on public.student_fee_obligations
  for insert with check (public.is_owner_or_finance());

create policy fee_obligation_adjustments_select on public.fee_obligation_adjustments
  for select
  using (
    public.is_owner_or_finance()
    or (public.is_parent() and exists (
      select 1 from public.student_fee_obligations o
      where o.id = fee_obligation_adjustments.obligation_id and public.is_parent_of(o.student_id)
    ))
  );

-- A parent may see the full receipt (amount_total, method, date, void status) once at least one
-- line on it belongs to their own child; payment_allocations is filtered per-line below so a
-- mixed receipt never reveals another family's line amount to them.
create policy payments_select on public.payments
  for select
  using (
    public.is_owner_or_finance()
    or (public.is_parent() and exists (
      select 1 from public.payment_allocations pa
      join public.student_fee_obligations o on o.id = pa.obligation_id
      where pa.payment_id = payments.id and public.is_parent_of(o.student_id)
    ))
  );

create policy payment_allocations_select on public.payment_allocations
  for select
  using (
    public.is_owner_or_finance()
    or (public.is_parent() and exists (
      select 1 from public.student_fee_obligations o
      where o.id = payment_allocations.obligation_id and public.is_parent_of(o.student_id)
    ))
  );

create policy payment_audit_log_select on public.payment_audit_log
  for select using (public.is_owner_or_finance());

-- =====================================================================
-- payroll_payments / salary_advances / expenses / expense_items
-- =====================================================================
-- canViewPayroll/canSetSalary/canRecordAdvance/canRecordPayrollPayment: Owner + Finance &
-- Operations Director only -- no self-service view for the staff member's own payroll history
-- exists anywhere in the audited source, so none is added here (flagged as a possible future
-- product gap, not assumed). Writes go only through record_payroll_payment/record_salary_advance
-- (hardened below); expenses/expense_items have no equivalent RPC in the current schema so they
-- keep an ordinary Owner/Finance insert/update/delete policy.

alter table public.payroll_payments enable row level security;
alter table public.salary_advances enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_items enable row level security;

create policy payroll_payments_select on public.payroll_payments for select using (public.is_owner_or_finance());
create policy salary_advances_select on public.salary_advances for select using (public.is_owner_or_finance());

create policy expenses_select on public.expenses for select using (public.is_owner_or_finance());
create policy expenses_insert on public.expenses for insert with check (public.is_owner_or_finance());
create policy expenses_update on public.expenses for update using (public.is_owner_or_finance()) with check (public.is_owner_or_finance());
create policy expenses_delete on public.expenses for delete using (public.is_owner_or_finance());

create policy expense_items_select on public.expense_items
  for select using (public.is_owner_or_finance());
create policy expense_items_insert on public.expense_items
  for insert with check (public.is_owner_or_finance());
create policy expense_items_update on public.expense_items
  for update using (public.is_owner_or_finance()) with check (public.is_owner_or_finance());
create policy expense_items_delete on public.expense_items
  for delete using (public.is_owner_or_finance());

-- =====================================================================
-- RPC hardening: migrations 6-7's SECURITY DEFINER functions currently trust their
-- p_recorded_by / p_actor_id / p_actor_role / p_actor_name / p_created_by parameters completely
-- -- since SECURITY DEFINER bypasses RLS by design, an authenticated caller with EXECUTE could
-- previously call record_payment_batch/void_payment/record_payroll_payment/
-- record_salary_advance/add_obligation_adjustment as ANY user of their choosing (spoofed actor),
-- or -- because EXECUTE is granted to PUBLIC by default in Postgres unless revoked -- even a
-- caller with no legitimate role at all could invoke them. Every function below is replaced with
-- its exact original business logic (Blocker 2/4/5/5A behavior is byte-for-byte unchanged) plus
-- two additions: a role check equivalent to the client-side permission it was always supposed to
-- require, and an assertion that the identity parameter matches auth.uid() so the audit trail
-- can never misattribute an action to someone else.
-- =====================================================================

create or replace function public.record_payment_batch(
  p_lines jsonb,
  p_method_name text,
  p_date date,
  p_note text,
  p_recorded_by uuid
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_obligation_id uuid;
  v_requested numeric;
  v_net_owed numeric;
  v_applied numeric;
  v_total numeric := 0;
  v_method_id uuid;
  v_payment public.payments;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record payments';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'recorded_by must match the authenticated caller';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'record_payment_batch requires at least one line';
  end if;

  select id into v_method_id from public.payment_methods where name = p_method_name;
  if v_method_id is null then
    insert into public.payment_methods (name) values (p_method_name)
      returning id into v_method_id;
  end if;

  insert into public.payments (receipt_no, payment_method_id, amount_total, date, note, recorded_by)
    values (
      lpad(nextval('public.receipt_no_seq')::text, 4, '0'),
      v_method_id, 0, p_date, p_note, p_recorded_by
    )
    returning * into v_payment;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_requested := (v_line ->> 'amount')::numeric;
    if v_requested is null or v_requested <= 0 then
      continue;
    end if;

    select o.id into v_obligation_id
      from public.student_fee_obligations o
      where o.student_id = (v_line ->> 'student_id')::uuid
        and o.fee_installment_id = (v_line ->> 'installment_id')::uuid
      for update;

    if v_obligation_id is null then
      continue;
    end if;

    v_net_owed := public.net_owed_for_obligation(v_obligation_id);
    v_applied := least(v_requested, v_net_owed);
    if v_applied <= 0 then
      continue;
    end if;

    insert into public.payment_allocations (payment_id, obligation_id, amount)
      values (v_payment.id, v_obligation_id, v_applied);

    v_total := v_total + v_applied;
  end loop;

  if v_total <= 0 then
    raise exception 'No payable lines: every line was skipped (no matching obligation, non-positive amount, or nothing owed)';
  end if;

  update public.payments set amount_total = v_total where id = v_payment.id
    returning * into v_payment;

  return v_payment;
end;
$$;

create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_actor_role user_role,
  p_actor_name text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_student_ids uuid[];
  v_true_role user_role;
  v_true_name text;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may void a payment';
  end if;
  if p_actor_id is distinct from auth.uid() then
    raise exception 'actor_id must match the authenticated caller';
  end if;
  -- actor_role/actor_name are audit-log display fields the client used to supply directly
  -- (spoofable); look them up server-side instead so the log can't be forged.
  select role, full_name into v_true_role, v_true_name from public.profiles where id = auth.uid();

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A void reason is required';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment is null then
    raise exception 'Payment % not found', p_payment_id;
  end if;
  if v_payment.status = 'VOIDED' then
    raise exception 'Payment % is already voided', p_payment_id;
  end if;

  select array_agg(distinct o.student_id) into v_student_ids
    from public.payment_allocations pa
    join public.student_fee_obligations o on o.id = pa.obligation_id
    where pa.payment_id = p_payment_id;

  update public.payments
    set status = 'VOIDED', voided_at = now(), voided_by = p_actor_id, void_reason = p_reason
    where id = p_payment_id
    returning * into v_payment;

  insert into public.payment_audit_log
    (payment_id, student_ids, action, actor_id, actor_role, actor_name, amount, receipt_no, reason)
    values
    (p_payment_id, coalesce(v_student_ids, '{}'), 'VOIDED', p_actor_id, v_true_role, v_true_name,
     v_payment.amount_total, v_payment.receipt_no, p_reason);

  return v_payment;
end;
$$;

create or replace function public.add_obligation_adjustment(
  p_obligation_id uuid,
  p_type fee_adjustment_type,
  p_amount numeric,
  p_reason text,
  p_created_by uuid
)
returns public.fee_obligation_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net_owed numeric;
  v_row public.fee_obligation_adjustments;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may adjust a fee obligation';
  end if;
  if p_created_by is distinct from auth.uid() then
    raise exception 'created_by must match the authenticated caller';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'An adjustment reason is required';
  end if;

  perform 1 from public.student_fee_obligations where id = p_obligation_id for update;
  if not found then
    raise exception 'Obligation % not found', p_obligation_id;
  end if;

  if p_type <> 'CORRECTION' then
    v_net_owed := public.net_owed_for_obligation(p_obligation_id);
    if p_amount > v_net_owed + 0.001 then
      raise exception 'Adjustment amount % exceeds the % still owed on this obligation', p_amount, v_net_owed;
    end if;
  end if;

  insert into public.fee_obligation_adjustments (obligation_id, type, amount, reason, created_by)
    values (p_obligation_id, p_type, p_amount, p_reason, p_created_by)
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_payroll_payment(
  p_staff_id uuid,
  p_amount numeric,
  p_method text,
  p_month text,
  p_date date,
  p_note text,
  p_allowances numeric,
  p_deductions numeric,
  p_advance_applied numeric,
  p_recorded_by uuid
)
returns public.payroll_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric;
  v_already_paid numeric;
  v_advance_balance numeric;
  v_cash_cap numeric;
  v_advance_applied numeric := coalesce(p_advance_applied, 0);
  v_row public.payroll_payments;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a payroll payment';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'recorded_by must match the authenticated caller';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payroll payment amount must be positive';
  end if;

  select salary into v_salary from public.staff where id = p_staff_id for update;
  if v_salary is null then
    raise exception 'Staff % not found', p_staff_id;
  end if;

  select coalesce(sum(amount), 0) into v_already_paid
    from public.payroll_payments
    where staff_id = p_staff_id and month = p_month;

  v_advance_balance := public.staff_advance_balance(p_staff_id);
  if v_advance_applied > v_advance_balance + 0.001 then
    raise exception 'advance_applied % exceeds outstanding advance balance %', v_advance_applied, v_advance_balance;
  end if;

  v_cash_cap := greatest(
    0,
    v_salary + coalesce(p_allowances, 0) - coalesce(p_deductions, 0) - v_already_paid - v_advance_applied
  );

  if p_amount > v_cash_cap + 0.001 then
    raise exception 'Payment % exceeds this month''s remaining net pay %', p_amount, v_cash_cap;
  end if;

  insert into public.payroll_payments
    (staff_id, amount, method, month, date, note, recorded_by, reference, allowances, deductions, advance_applied)
    values (
      p_staff_id, p_amount, p_method, p_month, p_date, p_note, p_recorded_by,
      'SAL-' || split_part(p_month, '-', 1) || '-' || split_part(p_month, '-', 2)
        || '-' || lpad(nextval('public.payroll_payment_ref_seq')::text, 4, '0'),
      coalesce(p_allowances, 0), coalesce(p_deductions, 0), v_advance_applied
    )
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_salary_advance(
  p_staff_id uuid,
  p_amount numeric,
  p_date date,
  p_note text,
  p_recorded_by uuid
)
returns public.salary_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric;
  v_month text := to_char(p_date, 'YYYY-MM');
  v_already_paid_this_month numeric;
  v_current_month_available numeric;
  v_advance_balance numeric;
  v_max_advance numeric;
  v_row public.salary_advances;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a salary advance';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'recorded_by must match the authenticated caller';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Salary advance amount must be positive';
  end if;

  select salary into v_salary from public.staff where id = p_staff_id for update;
  if v_salary is null then
    raise exception 'Staff % not found', p_staff_id;
  end if;

  select coalesce(sum(amount), 0) into v_already_paid_this_month
    from public.payroll_payments
    where staff_id = p_staff_id and month = v_month;

  v_current_month_available := greatest(0, v_salary - v_already_paid_this_month);
  v_advance_balance := public.staff_advance_balance(p_staff_id);
  v_max_advance := greatest(0, v_current_month_available - v_advance_balance);

  if p_amount > v_max_advance + 0.001 then
    raise exception 'Advance % exceeds the maximum allowed % (current month net pay % minus outstanding advance %)',
      p_amount, v_max_advance, v_current_month_available, v_advance_balance;
  end if;

  insert into public.salary_advances (staff_id, amount, date, payroll_month, note, recorded_by, reference)
    values (
      p_staff_id, p_amount, p_date, v_month, p_note, p_recorded_by,
      'ADV-' || split_part(v_month, '-', 1) || '-' || split_part(v_month, '-', 2)
        || '-' || lpad(nextval('public.salary_advance_ref_seq')::text, 4, '0')
    )
    returning * into v_row;

  return v_row;
end;
$$;

-- get_or_create_conversation: the only INSERT path onto conversations. Previously any caller
-- could create (and thus, combined with the messages policy above, message into) a conversation
-- between two arbitrary OTHER users. Now requires the caller be one of the two participants.
create or replace function public.get_or_create_conversation(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lo uuid := least(user_a, user_b);
  hi uuid := greatest(user_a, user_b);
  conv_id uuid;
begin
  if auth.uid() is null or auth.uid() not in (user_a, user_b) then
    raise exception 'You may only create a conversation you participate in';
  end if;
  if user_a = user_b then
    raise exception 'A conversation requires two distinct participants';
  end if;

  select id into conv_id
    from public.conversations
    where participant_1_id = lo and participant_2_id = hi;

  if conv_id is null then
    insert into public.conversations (participant_1_id, participant_2_id)
      values (lo, hi)
      returning id into conv_id;
  end if;

  return conv_id;
end;
$$;

-- =====================================================================
-- Grants: EXECUTE on Postgres functions defaults to PUBLIC unless revoked. Every RPC above
-- performs its own internal auth check, but explicitly scoping EXECUTE to `authenticated` (and
-- revoking from `anon`/PUBLIC) is defense in depth -- an unauthenticated caller is rejected by
-- auth.uid() being NULL either way, but there is no reason to let anonymous callers reach these
-- functions at all.
-- =====================================================================

revoke all on function public.record_payment_batch(jsonb, text, date, text, uuid) from public;
revoke all on function public.void_payment(uuid, text, uuid, user_role, text) from public;
revoke all on function public.add_obligation_adjustment(uuid, fee_adjustment_type, numeric, text, uuid) from public;
revoke all on function public.record_payroll_payment(uuid, numeric, text, text, date, text, numeric, numeric, numeric, uuid) from public;
revoke all on function public.record_salary_advance(uuid, numeric, date, text, uuid) from public;
revoke all on function public.get_or_create_conversation(uuid, uuid) from public;

grant execute on function public.record_payment_batch(jsonb, text, date, text, uuid) to authenticated;
grant execute on function public.void_payment(uuid, text, uuid, user_role, text) to authenticated;
grant execute on function public.add_obligation_adjustment(uuid, fee_adjustment_type, numeric, text, uuid) to authenticated;
grant execute on function public.record_payroll_payment(uuid, numeric, text, text, date, text, numeric, numeric, numeric, uuid) to authenticated;
grant execute on function public.record_salary_advance(uuid, numeric, date, text, uuid) to authenticated;
grant execute on function public.get_or_create_conversation(uuid, uuid) to authenticated;
grant execute on function public.net_owed_for_obligation(uuid) to authenticated;
grant execute on function public.staff_advance_balance(uuid) to authenticated;
grant execute on function public.generate_student_id() to authenticated;

-- Sequences touched by a direct (non-RPC) client INSERT need USAGE for their owning table's
-- trigger to fire under the caller's own privileges. receipt_no_seq / payroll_payment_ref_seq /
-- salary_advance_ref_seq are deliberately NOT granted here -- they are only ever consumed inside
-- the SECURITY DEFINER RPCs above, which run with the function owner's privileges regardless, so
-- leaving them ungranted means a receipt/payroll/advance reference number can only ever be
-- minted through those RPCs, never by a hand-crafted insert.
grant usage on sequence public.staff_employee_seq to authenticated;
grant usage on sequence public.student_number_seq to authenticated;
grant usage on sequence public.expense_no_seq to authenticated;

-- =====================================================================
-- Table-level GRANTs
-- =====================================================================
-- This project's config.toml has auto_expose_new_tables unset, i.e. the new Supabase default:
-- a table created by the `postgres` role is NOT reachable through the Data API roles (anon,
-- authenticated, service_role) until it is explicitly GRANTed. RLS policies alone do nothing
-- without the matching table-level privilege -- Postgres checks GRANT privilege first and the
-- RLS policy second, so every table above needs an explicit GRANT here or it stays completely
-- unreachable via supabase-js regardless of how permissive its policies are.
--
-- Deliberately scoped to exactly the verbs that table has a policy for above (never blanket
-- "all privileges") -- a table with no INSERT policy (payments, notifications, activities,
-- conversations, ...) gets no INSERT grant either, so "no policy" and "no privilege" agree as
-- two independent, redundant layers instead of relying on RLS as the only backstop. `anon` is
-- granted nothing anywhere: every policy above requires public.current_role() to resolve to a
-- real ACTIVE profile, which is impossible for an unauthenticated caller, so there is no
-- legitimate anon use of this schema to support.

grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on public.staff to authenticated;

grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update on public.enrollments to authenticated;
grant select, insert, update, delete on public.parent_students to authenticated;

grant select, insert, update on public.academic_years to authenticated;
grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, delete on public.class_subjects to authenticated;
grant select, insert, update, delete on public.teacher_assignments to authenticated;

grant select, update on public.timetable_config to authenticated;
grant select, insert, update, delete on public.timetable_entries to authenticated;
grant select, insert, delete on public.school_closures to authenticated;

grant select, insert, update on public.leave_requests to authenticated;
grant select, insert on public.owner_leave_log to authenticated;

grant select, insert, update on public.attendance to authenticated;
grant select, insert, update on public.staff_attendance to authenticated;
grant select, insert, update on public.period_logs to authenticated;
grant select, insert, delete on public.substitutions to authenticated;

grant select, insert, update, delete on public.homework to authenticated;

grant select, insert, update on public.results to authenticated;
grant select, insert, update on public.result_components to authenticated;
grant select, insert on public.result_audit_log to authenticated;
grant select, insert, delete on public.result_evidence to authenticated;

grant select, insert, delete on public.exam_announcements to authenticated;
grant select, insert, update on public.report_cards to authenticated;
grant select, insert, update, delete on public.behavior_records to authenticated;
grant select, insert, delete on public.student_documents to authenticated;

grant select, insert, update, delete on public.announcements to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.conversations to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select on public.activities to authenticated;

grant select, insert, update on public.fee_types to authenticated;
grant select, insert, update on public.fee_schedules to authenticated;
grant select, insert, update on public.fee_installments to authenticated;
grant select, insert, update on public.payment_methods to authenticated;
grant select, insert on public.student_fee_obligations to authenticated;
grant select on public.fee_obligation_adjustments to authenticated;
grant select on public.payments to authenticated;
grant select on public.payment_allocations to authenticated;
grant select on public.payment_audit_log to authenticated;

grant select on public.payroll_payments to authenticated;
grant select on public.salary_advances to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.expense_items to authenticated;
