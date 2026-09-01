-- Migration 12 of N: server-side notification + activity-feed creation RPCs.
--
-- Migration 8 (20260825190000_rls_policies.sql) deliberately left `notifications` and
-- `activities` with NO client INSERT policy and NO INSERT grant -- a plain "any authenticated
-- user may insert a row for any user_id" policy is an open notification-spoofing / spam relay.
-- That migration's own comments flag the fix: "the frontend conversion phase needs to move
-- every one of these fan-out writes into SECURITY DEFINER RPCs ... each independently checking
-- that the caller was actually entitled to trigger that notification."
--
-- This migration is that fix. Every notification fan-out event currently produced by the mock
-- DataContext (src/context/DataContext.jsx, audited 2026-09-01) gets exactly one SECURITY
-- DEFINER function here. Each one:
--   * looks up its anchor row(s) and checks the caller with auth.uid() + the SAME RLS helper
--     that gates the underlying domain write (is_owner_or_admin(), can_decide_leave(),
--     teaches_class_subject(), is_owner_or_finance(), ...);
--   * RESOLVES THE RECIPIENT SET SERVER-SIDE from the anchor row(s). It never accepts a
--     caller-supplied list of recipient user ids. The single bounded exception,
--     notify_payment_reminder, is documented at its own definition (Finance explicitly selects
--     parents to remind; every id is still validated to resolve to an ACTIVE PARENT profile).
--   * sets the notification `type` and the announcement_id / payment_id FK columns itself;
--   * treats `p_title` / `p_message` / `p_navigation` as opaque DISPLAY text supplied by the
--     already-entitled caller. A notification row carries no authority: `type` only drives an
--     icon/filter, and message formatting (dates, money, month labels, name joins, role labels)
--     stays in the JS layer with its locale helpers rather than being re-implemented in
--     to_char(). See the Phase A report, decision E1. The handful of events with per-recipient
--     message variants (exam announcement, substitute assignment, student suspension, leave
--     completion) take one text parameter per variant; their titles are fixed server-side.
--
-- NOT added here (verify in review): no INSERT policy and no INSERT/UPDATE grant on
-- `notifications` or `activities`. These functions remain the only write path.
--
-- Idempotency: events the mock re-checked before firing (scheduled-announcement publish, leave
-- completion, result / report-card (re)publish, and the rest) get a dedicated *_notified /
-- *_notified_at guard column added below, so a repeat call is a no-op. Events fired once at the
-- point of action rely on the Phase B caller invoking them once; a replay by the same
-- already-entitled caller is at worst self-directed spam, never cross-user.
--
-- All functions: language plpgsql, security definer, `set search_path = public` (matching every
-- existing hardened RPC in migrations 6-9), return integer = number of notification rows
-- inserted. Grants: revoked from PUBLIC, granted to `authenticated` only.

-- =====================================================================
-- Guard columns (additive, nullable / defaulted -- safe on the live DB)
-- =====================================================================

alter table public.exam_announcements add column if not exists notified_at timestamptz;
alter table public.homework            add column if not exists notified_at timestamptz;
alter table public.attendance          add column if not exists parent_notified boolean not null default false;
alter table public.staff_attendance    add column if not exists notified_at timestamptz;
alter table public.behavior_records    add column if not exists notified_at timestamptz;
alter table public.results             add column if not exists publish_notified_at timestamptz;
alter table public.report_cards        add column if not exists publish_notified_at timestamptz;
alter table public.payments            add column if not exists notified_at timestamptz;
alter table public.payroll_payments    add column if not exists notified_at timestamptz;
alter table public.salary_advances     add column if not exists notified_at timestamptz;
alter table public.owner_leave_log     add column if not exists notified_at timestamptz;
alter table public.leave_requests      add column if not exists submitted_notified boolean not null default false;
alter table public.leave_requests      add column if not exists decision_notified boolean not null default false;

comment on column public.attendance.parent_notified is
  'Set true by notify_student_attendance once the "marked absent/late/..." parent notification has
   been sent. The Phase B attendance-write path MUST reset this to false whenever a record''s
   status actually changes, so a later genuine change re-notifies (mirrors the mock
   _upsertAttendanceRecord statusChanged guard).';

-- =====================================================================
-- ANNOUNCEMENTS  (mock: dispatchAnnouncementNotifications, createAnnouncement,
--                 checkScheduledAnnouncements)
-- =====================================================================

create or replace function public.notify_announcement(
  p_announcement_id uuid,
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
  v_ann public.announcements;
  v_count integer := 0;
begin
  select * into v_ann from public.announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement % not found', p_announcement_id;
  end if;
  -- announcements_insert policy = is_owner_or_admin() OR is_finance(), with author_id stamped
  -- server-side; only the author (or an Owner/Educational Director) may dispatch it.
  if not (public.is_owner_or_admin() or v_ann.author_id = auth.uid()) then
    raise exception 'Not authorized to dispatch this announcement';
  end if;
  -- Not yet due, or already dispatched -> no-op (idempotent; safe for a polling caller).
  if v_ann.publish_notified or (v_ann.publish_at is not null and v_ann.publish_at > now()) then
    return 0;
  end if;

  with recipients as (
    select p.id as user_id
    from public.profiles p
    where p.status = 'ACTIVE'
      and (
        case v_ann.audience ->> 'type'
          when 'ALL' then true
          when 'ALL_PARENTS' then p.role = 'PARENT'
          when 'ALL_TEACHERS' then p.role = 'TEACHER'
          when 'USER' then p.id::text = (v_ann.audience ->> 'userId')
          when 'DIRECTORS' then exists (
            select 1 from public.staff s
            where s.user_id = p.id
              and public.staff_group_for_position(s.position) = 'Directors'
          )
          when 'GRADE' then p.role = 'PARENT' and exists (
            select 1 from public.parent_students ps
            join public.students st on st.id = ps.student_id
            where ps.parent_id = p.id and st.status = 'ACTIVE'
              and st.grade = (v_ann.audience ->> 'grade')
          )
          when 'SECTION' then p.role = 'PARENT' and exists (
            select 1 from public.parent_students ps
            join public.students st on st.id = ps.student_id
            where ps.parent_id = p.id and st.status = 'ACTIVE'
              and st.grade = (v_ann.audience ->> 'grade')
              and st.section = (v_ann.audience ->> 'section')
          )
          else false
        end
      )
  )
  insert into public.notifications (user_id, title, message, type, navigation, announcement_id)
  select user_id, p_title, p_message, 'ANNOUNCEMENT', p_navigation, p_announcement_id
  from recipients;
  get diagnostics v_count = row_count;

  update public.announcements set publish_notified = true where id = p_announcement_id;
  return v_count;
end;
$$;

-- =====================================================================
-- EXAM ANNOUNCEMENTS  (mock: announceExam)
-- Two recipient groups with different wording: parents of students in the targeted classes,
-- and the head teachers of those classes.
-- =====================================================================

create or replace function public.notify_exam_announcement(
  p_exam_announcement_id uuid,
  p_parent_title text,
  p_parent_message text,
  p_teacher_title text,
  p_teacher_message text,
  p_parent_navigation jsonb default null,
  p_teacher_navigation jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ea public.exam_announcements;
  v_count integer := 0;
  v_n integer;
begin
  select * into v_ea from public.exam_announcements where id = p_exam_announcement_id;
  if not found then
    raise exception 'Exam announcement % not found', p_exam_announcement_id;
  end if;
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may dispatch an exam announcement';
  end if;
  if v_ea.notified_at is not null then
    return 0;
  end if;

  with target_classes as (
    select c.id, c.head_teacher_id
    from public.classes c
    where case v_ea.audience ->> 'type'
            when 'ALL' then true
            when 'GRADE' then c.grade = (v_ea.audience ->> 'grade')
            when 'SECTION' then c.grade = (v_ea.audience ->> 'grade')
                              and c.section = (v_ea.audience ->> 'section')
            else false
          end
  ),
  parent_rows as (
    select distinct on (ps.parent_id) ps.parent_id as user_id, ps.student_id
    from target_classes tc
    join public.students st on st.class_id = tc.id
    join public.parent_students ps on ps.student_id = st.id
    order by ps.parent_id, ps.student_id
  )
  insert into public.notifications (user_id, title, message, type, navigation)
  select user_id, p_parent_title, p_parent_message, 'EXAM',
         coalesce(p_parent_navigation, '{}'::jsonb) || jsonb_build_object('studentId', student_id)
  from parent_rows;
  get diagnostics v_count = row_count;

  with target_classes as (
    select c.id, c.head_teacher_id
    from public.classes c
    where case v_ea.audience ->> 'type'
            when 'ALL' then true
            when 'GRADE' then c.grade = (v_ea.audience ->> 'grade')
            when 'SECTION' then c.grade = (v_ea.audience ->> 'grade')
                              and c.section = (v_ea.audience ->> 'section')
            else false
          end
  ),
  head_rows as (
    select distinct on (tc.head_teacher_id) tc.head_teacher_id as user_id, tc.id as class_id
    from target_classes tc
    where tc.head_teacher_id is not null
    order by tc.head_teacher_id, tc.id
  )
  insert into public.notifications (user_id, title, message, type, navigation)
  select user_id, p_teacher_title, p_teacher_message, 'EXAM',
         coalesce(p_teacher_navigation, '{}'::jsonb) || jsonb_build_object('classId', class_id)
  from head_rows;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  update public.exam_announcements set notified_at = now() where id = p_exam_announcement_id;
  return v_count;
end;
$$;

-- =====================================================================
-- HOMEWORK  (mock: createHomework)
-- =====================================================================

create or replace function public.notify_homework(
  p_homework_id uuid,
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
  v_hw public.homework;
  v_count integer := 0;
begin
  select * into v_hw from public.homework where id = p_homework_id;
  if not found then
    raise exception 'Homework % not found', p_homework_id;
  end if;
  -- homework_insert policy: Owner/Educational Director, or the assigning teacher themselves.
  if not (public.is_owner_or_admin()
          or (public.is_teacher() and v_hw.teacher_id = auth.uid())) then
    raise exception 'Not authorized to notify for this homework';
  end if;
  if v_hw.notified_at is not null then
    return 0;
  end if;

  with parent_rows as (
    select distinct on (ps.parent_id) ps.parent_id as user_id, ps.student_id
    from public.students st
    join public.parent_students ps on ps.student_id = st.id
    where st.class_id = v_hw.class_id
    order by ps.parent_id, ps.student_id
  )
  insert into public.notifications (user_id, title, message, type, navigation)
  select user_id, p_title, p_message, 'HOMEWORK',
         coalesce(p_navigation, '{}'::jsonb)
           || jsonb_build_object('page', 'homework', 'homeworkId', v_hw.id, 'studentId', student_id)
  from parent_rows;
  get diagnostics v_count = row_count;

  update public.homework set notified_at = now() where id = p_homework_id;
  return v_count;
end;
$$;

-- =====================================================================
-- STUDENT ATTENDANCE  (mock: _upsertAttendanceRecord -- only non-Present, only on change)
-- =====================================================================

create or replace function public.notify_student_attendance(
  p_attendance_id uuid,
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
  v_att public.attendance;
  v_count integer := 0;
begin
  select * into v_att from public.attendance where id = p_attendance_id;
  if not found then
    raise exception 'Attendance record % not found', p_attendance_id;
  end if;
  -- Mirrors attendance_insert / attendance_update policy exactly.
  if not (public.is_owner_or_admin()
          or (public.is_teacher()
              and public.heads_class(v_att.class_id)
              and public.teacher_academic_action_ok(v_att.date))) then
    raise exception 'Not authorized to notify for this attendance record';
  end if;
  -- Present is never notified; a record already announced is not re-announced (the Phase B
  -- write path resets parent_notified on a genuine status change -- see the column comment).
  if v_att.status = 'Present' or v_att.parent_notified then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select ps.parent_id, p_title, p_message, 'ATTENDANCE',
         coalesce(p_navigation, '{}'::jsonb)
           || jsonb_build_object('page', 'attendance', 'studentId', v_att.student_id, 'date', v_att.date)
  from public.parent_students ps
  where ps.student_id = v_att.student_id;
  get diagnostics v_count = row_count;

  update public.attendance set parent_notified = true where id = p_attendance_id;
  return v_count;
end;
$$;

-- =====================================================================
-- STAFF ATTENDANCE  (mock: _applyStaffAttendanceNotifications -- to the staff member only)
-- =====================================================================

create or replace function public.notify_staff_attendance(
  p_staff_attendance_id uuid,
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
  v_sa public.staff_attendance;
  v_user uuid;
  v_count integer := 0;
begin
  select * into v_sa from public.staff_attendance where id = p_staff_attendance_id;
  if not found then
    raise exception 'Staff attendance record % not found', p_staff_attendance_id;
  end if;
  if not public.can_edit_staff_attendance_for(v_sa.staff_id) then
    raise exception 'Not authorized to notify for this staff attendance record';
  end if;
  if v_sa.status = 'Present' or v_sa.notified_at is not null then
    return 0;
  end if;

  select user_id into v_user from public.staff where id = v_sa.staff_id;
  if v_user is not null then
    insert into public.notifications (user_id, title, message, type, navigation)
    values (v_user, p_title, p_message, 'ATTENDANCE', p_navigation);
    v_count := 1;
  end if;

  update public.staff_attendance set notified_at = now() where id = p_staff_attendance_id;
  return v_count;
end;
$$;

-- =====================================================================
-- LEAVE REQUESTS  (mock: createLeaveRequest / decideLeaveRequest / checkLeaveCompletions /
--                        logOwnerLeave)
-- =====================================================================

-- Recipients of a "leave submitted / completed" broadcast: the Owner always, plus every
-- Educational Director UNLESS the subject is a Director (whose leave only the Owner decides) --
-- mirrors createLeaveRequest's recipientRoles.
create or replace function public._leave_admin_recipients(p_leave_request_id uuid)
returns table (recipient_id uuid)
language sql
stable
set search_path = public
as $$
  select p.id
  from public.leave_requests lr
  join public.profiles p on p.status = 'ACTIVE'
  where lr.id = p_leave_request_id
    and (
      p.role = 'OWNER'
      or (
        p.role = 'ADMIN'
        and not (
          lr.kind = 'STAFF'
          and exists (
            select 1 from public.staff s
            where s.id = lr.subject_id
              and public.staff_group_for_position(s.position) = 'Directors'
          )
        )
      )
    );
$$;
revoke all on function public._leave_admin_recipients(uuid) from public;

create or replace function public.notify_leave_submitted(
  p_leave_request_id uuid,
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
  v_lr public.leave_requests;
  v_count integer := 0;
begin
  select * into v_lr from public.leave_requests where id = p_leave_request_id;
  if not found then
    raise exception 'Leave request % not found', p_leave_request_id;
  end if;
  -- leave_requests_insert requires requested_by = auth.uid(); only the submitter notifies.
  if v_lr.requested_by is distinct from auth.uid() then
    raise exception 'Only the request submitter may send the submission notification';
  end if;
  if v_lr.submitted_notified then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select rec.recipient_id, p_title, p_message, 'LEAVE', p_navigation
  from public._leave_admin_recipients(p_leave_request_id) as rec;
  get diagnostics v_count = row_count;

  update public.leave_requests set submitted_notified = true where id = p_leave_request_id;
  return v_count;
end;
$$;

create or replace function public.notify_leave_decided(
  p_leave_request_id uuid,
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
  v_lr public.leave_requests;
  v_count integer := 0;
begin
  select * into v_lr from public.leave_requests where id = p_leave_request_id;
  if not found then
    raise exception 'Leave request % not found', p_leave_request_id;
  end if;
  if not public.can_decide_leave(v_lr.kind, v_lr.subject_id) then
    raise exception 'Only a user who can decide this leave request may send its decision notification';
  end if;
  if v_lr.approval_status = 'PENDING' then
    raise exception 'Leave request % has not been decided yet', p_leave_request_id;
  end if;
  if v_lr.decision_notified then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_lr.requested_by, p_title, p_message, 'LEAVE', p_navigation);
  v_count := 1;

  update public.leave_requests set decision_notified = true where id = p_leave_request_id;
  return v_count;
end;
$$;

-- Fired once an APPROVED leave's last day has passed. State-guarded + idempotent
-- (completion_notified), so it is safe to expose to any authenticated ACTIVE user -- the
-- recipient set (requester + the leave-admin broadcast) is fixed and cannot be steered.
create or replace function public.notify_leave_completed(
  p_leave_request_id uuid,
  p_requester_title text,
  p_requester_message text,
  p_admin_title text,
  p_admin_message text,
  p_navigation jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lr public.leave_requests;
  v_count integer := 0;
  v_n integer;
begin
  if public.current_role() is null then
    raise exception 'Not authorized';
  end if;
  select * into v_lr from public.leave_requests where id = p_leave_request_id;
  if not found then
    raise exception 'Leave request % not found', p_leave_request_id;
  end if;
  if v_lr.approval_status <> 'APPROVED'
     or v_lr.to_date >= current_date
     or v_lr.completion_notified then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_lr.requested_by, p_requester_title, p_requester_message, 'LEAVE', p_navigation);
  v_count := 1;

  insert into public.notifications (user_id, title, message, type, navigation)
  select rec.recipient_id, p_admin_title, p_admin_message, 'LEAVE', p_navigation
  from public._leave_admin_recipients(p_leave_request_id) as rec;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  update public.leave_requests set completion_notified = true where id = p_leave_request_id;
  return v_count;
end;
$$;

create or replace function public.notify_owner_leave(
  p_owner_leave_log_id uuid,
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
  v_row public.owner_leave_log;
  v_count integer := 0;
begin
  select * into v_row from public.owner_leave_log where id = p_owner_leave_log_id;
  if not found then
    raise exception 'Owner leave log entry % not found', p_owner_leave_log_id;
  end if;
  if not public.is_owner() then
    raise exception 'Only the Owner may log owner leave';
  end if;
  if v_row.notified_at is not null then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select p.id, p_title, p_message, 'LEAVE', p_navigation
  from public.profiles p
  where p.role = 'ADMIN' and p.status = 'ACTIVE';
  get diagnostics v_count = row_count;

  update public.owner_leave_log set notified_at = now() where id = p_owner_leave_log_id;
  return v_count;
end;
$$;

-- =====================================================================
-- SUBSTITUTIONS  (mock: assignSubstitute / removeSubstitute)
-- Recipients are all server-derived (parents of the class, the substitution's own
-- substitute_teacher_id) except p_previous_substitute_id, which the caller passes because the
-- prior value is gone once the row is updated -- it is still validated to be a TEACHER profile
-- and the caller is Owner/Educational Director, so the worst case is one spurious "coverage
-- changed" note to a teacher from an authorized dispatcher.
-- =====================================================================

create or replace function public.notify_substitute_assigned(
  p_substitution_id uuid,
  p_class_message text,
  p_substitute_message text,
  p_previous_substitute_id uuid default null,
  p_previous_message text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.substitutions;
  v_entry public.timetable_entries;
  v_count integer := 0;
  v_n integer;
begin
  select * into v_sub from public.substitutions where id = p_substitution_id;
  if not found then
    raise exception 'Substitution % not found', p_substitution_id;
  end if;
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may assign a substitute';
  end if;
  select * into v_entry from public.timetable_entries where id = v_sub.timetable_entry_id;

  -- Parents of every student in the class.
  insert into public.notifications (user_id, title, message, type, navigation)
  select distinct ps.parent_id, 'Class schedule changed', p_class_message, 'SCHEDULE',
         jsonb_build_object('page', 'timetable')
  from public.students st
  join public.parent_students ps on ps.student_id = st.id
  where st.class_id = v_entry.class_id;
  get diagnostics v_count = row_count;

  -- The incoming substitute.
  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_sub.substitute_teacher_id, 'You''re covering a class today', p_substitute_message,
          'SCHEDULE', jsonb_build_object('page', 'timetable'));
  v_count := v_count + 1;

  -- The teacher who was previously assigned and is now replaced.
  if p_previous_substitute_id is not null
     and p_previous_substitute_id <> v_sub.substitute_teacher_id
     and p_previous_message is not null
     and exists (select 1 from public.profiles p
                 where p.id = p_previous_substitute_id and p.role = 'TEACHER' and p.status = 'ACTIVE') then
    insert into public.notifications (user_id, title, message, type, navigation)
    values (p_previous_substitute_id, 'Substitute coverage changed', p_previous_message,
            'SCHEDULE', jsonb_build_object('page', 'timetable'));
    v_count := v_count + 1;
  end if;

  return v_count;
end;
$$;

create or replace function public.notify_substitute_removed(
  p_substitute_teacher_id uuid,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may cancel a substitute';
  end if;
  if not exists (select 1 from public.profiles p
                 where p.id = p_substitute_teacher_id and p.role = 'TEACHER' and p.status = 'ACTIVE') then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (p_substitute_teacher_id, 'Substitute coverage cancelled', p_message,
          'SCHEDULE', jsonb_build_object('page', 'timetable'));
  return 1;
end;
$$;

-- =====================================================================
-- RESULTS PUBLISHED  (mock: publishResults -- one batched notification per parent per student)
-- The client passes the student ids it just published; the function ignores any that do not
-- actually have a PUBLISHED/LOCKED result row for that class+subject+semester+year, and skips
-- any already notified (publish_notified_at). Recipients are the parents of the surviving set.
-- =====================================================================

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

-- =====================================================================
-- REPORT CARD PUBLISHED  (mock: publishReportCard)
-- =====================================================================

create or replace function public.notify_report_card_published(
  p_report_card_id uuid,
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
  v_rc public.report_cards;
  v_count integer := 0;
begin
  select * into v_rc from public.report_cards where id = p_report_card_id;
  if not found then
    raise exception 'Report card % not found', p_report_card_id;
  end if;
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may publish a report card';
  end if;
  if v_rc.status not in ('PUBLISHED', 'LOCKED') or v_rc.publish_notified_at is not null then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select ps.parent_id, p_title, p_message, 'RESULT',
         coalesce(p_navigation, '{}'::jsonb)
           || jsonb_build_object('page', 'exams', 'studentId', v_rc.student_id, 'openReportCard', true)
  from public.parent_students ps
  where ps.student_id = v_rc.student_id;
  get diagnostics v_count = row_count;

  update public.report_cards set publish_notified_at = now() where id = p_report_card_id;
  return v_count;
end;
$$;

-- =====================================================================
-- BEHAVIOR RECORD  (mock: createBehaviorRecord -- only when parent_notified was chosen)
-- =====================================================================

create or replace function public.notify_behavior_record(
  p_behavior_record_id uuid,
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
  v_br public.behavior_records;
  v_count integer := 0;
begin
  select * into v_br from public.behavior_records where id = p_behavior_record_id;
  if not found then
    raise exception 'Behavior record % not found', p_behavior_record_id;
  end if;
  -- behavior_records_insert policy = Owner / Educational Director only.
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may add a behavior record';
  end if;
  if not v_br.parent_notified or v_br.notified_at is not null then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select ps.parent_id, p_title, p_message, 'BEHAVIOR',
         coalesce(p_navigation, '{}'::jsonb)
           || jsonb_build_object('page', 'behavior', 'studentId', v_br.student_id)
  from public.parent_students ps
  where ps.student_id = v_br.student_id;
  get diagnostics v_count = row_count;

  update public.behavior_records set notified_at = now() where id = p_behavior_record_id;
  return v_count;
end;
$$;

-- =====================================================================
-- STUDENT SUSPENSION  (mock: suspendStudent)
-- Parents of the student + the student's class head teacher and subject teachers, with
-- different wording for each group. No dedupe flag: suspension is a rare manual action, and a
-- replay only re-notifies the same already-entitled recipients.
-- =====================================================================

create or replace function public.notify_student_suspension(
  p_student_id uuid,
  p_parent_title text,
  p_parent_message text,
  p_teacher_title text,
  p_teacher_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
  v_count integer := 0;
  v_n integer;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found then
    raise exception 'Student % not found', p_student_id;
  end if;
  -- students_update / suspension = Owner / Educational Director only.
  if not public.is_owner_or_admin() then
    raise exception 'Only the Owner or Educational Director may suspend a student';
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select ps.parent_id, p_parent_title, p_parent_message, 'BEHAVIOR',
         jsonb_build_object('page', 'behavior', 'studentId', p_student_id)
  from public.parent_students ps
  where ps.student_id = p_student_id;
  get diagnostics v_count = row_count;

  if v_student.class_id is not null then
    with teacher_ids as (
      select c.head_teacher_id as tid from public.classes c
        where c.id = v_student.class_id and c.head_teacher_id is not null
      union
      select ta.teacher_id from public.teacher_assignments ta
        where ta.class_id = v_student.class_id
    )
    insert into public.notifications (user_id, title, message, type, navigation)
    select distinct tid, p_teacher_title, p_teacher_message, 'BEHAVIOR',
           jsonb_build_object('page', 'behavior', 'studentId', p_student_id)
    from teacher_ids
    where tid is not null;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end if;

  return v_count;
end;
$$;

-- =====================================================================
-- MESSAGES  (mock: sendMessage -- notify the other participant)
-- =====================================================================

create or replace function public.notify_message(
  p_message_id uuid,
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
  v_msg public.messages;
  v_conv public.conversations;
  v_recipient uuid;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if not found then
    raise exception 'Message % not found', p_message_id;
  end if;
  if v_msg.sender_id is distinct from auth.uid() then
    raise exception 'Only the message sender may send its notification';
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if auth.uid() not in (v_conv.participant_1_id, v_conv.participant_2_id) then
    raise exception 'Not a participant in this conversation';
  end if;
  -- Idempotent: one notification per message id.
  if exists (
    select 1 from public.notifications
    where type = 'MESSAGE' and (navigation ->> 'messageId') = p_message_id::text
  ) then
    return 0;
  end if;

  v_recipient := case when v_conv.participant_1_id = auth.uid()
                      then v_conv.participant_2_id else v_conv.participant_1_id end;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_recipient, p_title, p_message, 'MESSAGE',
          coalesce(p_navigation, '{}'::jsonb)
            || jsonb_build_object('page', 'messages', 'userId', v_msg.sender_id,
                                  'messageId', p_message_id));
  return 1;
end;
$$;

-- =====================================================================
-- PAYMENT RECEIVED  (mock: recordPaymentBatch -- one consolidated notification per parent,
-- covering only that parent's own children's lines on the receipt)
-- This is the one notification whose text genuinely cannot be a single client string (the
-- amount and the child list differ per parent), so it is built server-side. Money is formatted
-- as "<comma-grouped rounded amount> Birr" (mock formatMoney); the child list uses the mock
-- joinWithAnd ("A", "A and B", "A, B, and C").
-- =====================================================================

create or replace function public.notify_payment_received(
  p_payment_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments;
  v_count integer := 0;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Payment % not found', p_payment_id;
  end if;
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a payment';
  end if;
  if v_pay.status = 'VOIDED' or v_pay.notified_at is not null then
    return 0;
  end if;

  with parent_lines as (
    select ps.parent_id,
           o.student_id,
           st.first_name || ' ' || st.last_name || ' · ' || coalesce(c.grade || c.section, '') as lbl,
           sum(pa.amount) as amount
    from public.payment_allocations pa
    join public.student_fee_obligations o on o.id = pa.obligation_id
    join public.students st on st.id = o.student_id
    left join public.classes c on c.id = st.class_id
    join public.parent_students ps on ps.student_id = o.student_id
    where pa.payment_id = p_payment_id
    group by ps.parent_id, o.student_id, st.first_name, st.last_name, c.grade, c.section
  ),
  per_parent as (
    -- joinWithAnd: 1 -> "A", 2 -> "A and B", 3+ -> "A, B, and C"
    select parent_id,
           sum(amount) as total,
           case
             when count(*) = 1 then min(lbl)
             when count(*) = 2 then string_agg(lbl, ' and ' order by lbl)
             else regexp_replace(string_agg(lbl, ', ' order by lbl), ', ([^,]+)$', ', and \1')
           end as children_label
    from parent_lines
    group by parent_id
  )
  insert into public.notifications (user_id, title, message, type, navigation, payment_id)
  select parent_id,
         'Payment Received',
         'Your payment of ' || to_char(round(total), 'FM999,999,999,999') || ' Birr for '
           || children_label || ' has been recorded.',
         'PAYMENT',
         jsonb_build_object('page', 'payments'),
         p_payment_id
  from per_parent;
  get diagnostics v_count = row_count;

  update public.payments set notified_at = now() where id = p_payment_id;
  return v_count;
end;
$$;

-- =====================================================================
-- PAYMENT REMINDER  (mock: sendPaymentReminder)
-- The ONLY function that takes a caller-supplied recipient list: a payment reminder is a
-- deliberate Finance action targeting a hand-picked set of parents, and the reminder body is
-- Finance-authored free text. Every id is still validated to resolve to an ACTIVE PARENT
-- profile, and only the Owner / Finance & Operations Director may call it.
-- =====================================================================

create or replace function public.notify_payment_reminder(
  p_parent_ids uuid[],
  p_message text,
  p_fee_type_name text default null,
  p_image text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_title text;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may send a payment reminder';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'A reminder message is required';
  end if;
  v_title := case when p_fee_type_name is not null and length(trim(p_fee_type_name)) > 0
                  then 'Payment reminder — ' || p_fee_type_name
                  else 'Payment reminder' end;

  insert into public.notifications (user_id, title, message, type, navigation, image)
  select p.id, v_title, p_message, 'PAYMENT', jsonb_build_object('page', 'payments'), p_image
  from public.profiles p
  where p.id = any (p_parent_ids)
    and p.role = 'PARENT'
    and p.status = 'ACTIVE';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- =====================================================================
-- PAYROLL  (mock: recordPayrollPayment / recordSalaryAdvance -- to the staff member)
-- NOTE: the payslip deep-link goes in `navigation`, NOT `notifications.payment_id` -- that
-- column is FK'd to public.payments(id), and a payroll_payments id would violate it (a latent
-- bug in the mock, which has no FKs).
-- =====================================================================

create or replace function public.notify_salary_paid(
  p_payroll_payment_id uuid,
  p_title text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp public.payroll_payments;
  v_user uuid;
begin
  select * into v_pp from public.payroll_payments where id = p_payroll_payment_id;
  if not found then
    raise exception 'Payroll payment % not found', p_payroll_payment_id;
  end if;
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a payroll payment';
  end if;
  if v_pp.notified_at is not null then
    return 0;
  end if;

  select user_id into v_user from public.staff where id = v_pp.staff_id;
  update public.payroll_payments set notified_at = now() where id = p_payroll_payment_id;
  if v_user is null then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_user, p_title, p_message, 'PAYROLL',
          jsonb_build_object('page', 'payroll', 'payrollPaymentId', p_payroll_payment_id));
  return 1;
end;
$$;

create or replace function public.notify_salary_advance(
  p_salary_advance_id uuid,
  p_title text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adv public.salary_advances;
  v_user uuid;
begin
  select * into v_adv from public.salary_advances where id = p_salary_advance_id;
  if not found then
    raise exception 'Salary advance % not found', p_salary_advance_id;
  end if;
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record a salary advance';
  end if;
  if v_adv.notified_at is not null then
    return 0;
  end if;

  select user_id into v_user from public.staff where id = v_adv.staff_id;
  update public.salary_advances set notified_at = now() where id = p_salary_advance_id;
  if v_user is null then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_user, p_title, p_message, 'PAYROLL', jsonb_build_object('page', 'payroll'));
  return 1;
end;
$$;

-- =====================================================================
-- ACTIVITY FEED  (mock: addActivity / logActivity / every d.activities.unshift)
-- `activities` has NO actor columns (id, text, navigation, created_at only) -- there is no
-- actor_id/actor_name/actor_role to spoof. `text` is descriptive display copy built in the JS
-- layer; the feed is capped at read time and shown only on staff dashboards. The enforced
-- boundary is "an authenticated, ACTIVE staff account": Owner / Educational Director / Finance
-- & Operations Director / Teacher. Per-event authorization is implicit in Phase B -- log_activity
-- is only ever called immediately after a domain write that RLS already gated, so a feed line
-- can only describe an action the caller was actually allowed to perform.
--
-- Known follow-up (Phase B): AuthContext.changePassword currently logs "<name> changed their
-- password" for every role, including PARENT. Guard that call to staff, or drop it for parents,
-- when auth is revisited -- a PARENT calling this RPC today raises 'Not authorized'.
-- =====================================================================

create or replace function public.log_activity(
  p_text text,
  p_navigation jsonb default null
)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.activities;
begin
  if not (public.is_owner() or public.is_admin() or public.is_finance() or public.is_teacher()) then
    raise exception 'Only staff may write to the activity feed';
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'Activity text is required';
  end if;

  insert into public.activities (text, navigation)
  values (p_text, p_navigation)
  returning * into v_row;
  return v_row;
end;
$$;

-- =====================================================================
-- Grants: EXECUTE defaults to PUBLIC in Postgres -- revoke, then grant to `authenticated` only
-- (every function checks auth.uid()/current_role() internally; this is defence in depth).
-- =====================================================================

revoke all on function public.notify_announcement(uuid, text, text, jsonb) from public;
revoke all on function public.notify_exam_announcement(uuid, text, text, text, text, jsonb, jsonb) from public;
revoke all on function public.notify_homework(uuid, text, text, jsonb) from public;
revoke all on function public.notify_student_attendance(uuid, text, text, jsonb) from public;
revoke all on function public.notify_staff_attendance(uuid, text, text, jsonb) from public;
revoke all on function public.notify_leave_submitted(uuid, text, text, jsonb) from public;
revoke all on function public.notify_leave_decided(uuid, text, text, jsonb) from public;
revoke all on function public.notify_leave_completed(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.notify_owner_leave(uuid, text, text, jsonb) from public;
revoke all on function public.notify_substitute_assigned(uuid, text, text, uuid, text) from public;
revoke all on function public.notify_substitute_removed(uuid, text) from public;
revoke all on function public.notify_results_published(uuid, uuid, semester, uuid, uuid[], text, text, jsonb) from public;
revoke all on function public.notify_report_card_published(uuid, text, text, jsonb) from public;
revoke all on function public.notify_behavior_record(uuid, text, text, jsonb) from public;
revoke all on function public.notify_student_suspension(uuid, text, text, text, text) from public;
revoke all on function public.notify_message(uuid, text, text, jsonb) from public;
revoke all on function public.notify_payment_received(uuid) from public;
revoke all on function public.notify_payment_reminder(uuid[], text, text, text) from public;
revoke all on function public.notify_salary_paid(uuid, text, text) from public;
revoke all on function public.notify_salary_advance(uuid, text, text) from public;
revoke all on function public.log_activity(text, jsonb) from public;

grant execute on function public.notify_announcement(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_exam_announcement(uuid, text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.notify_homework(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_student_attendance(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_staff_attendance(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_leave_submitted(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_leave_decided(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_leave_completed(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.notify_owner_leave(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_substitute_assigned(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.notify_substitute_removed(uuid, text) to authenticated;
grant execute on function public.notify_results_published(uuid, uuid, semester, uuid, uuid[], text, text, jsonb) to authenticated;
grant execute on function public.notify_report_card_published(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_behavior_record(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_student_suspension(uuid, text, text, text, text) to authenticated;
grant execute on function public.notify_message(uuid, text, text, jsonb) to authenticated;
grant execute on function public.notify_payment_received(uuid) to authenticated;
grant execute on function public.notify_payment_reminder(uuid[], text, text, text) to authenticated;
grant execute on function public.notify_salary_paid(uuid, text, text) to authenticated;
grant execute on function public.notify_salary_advance(uuid, text, text) to authenticated;
grant execute on function public.log_activity(text, jsonb) to authenticated;
