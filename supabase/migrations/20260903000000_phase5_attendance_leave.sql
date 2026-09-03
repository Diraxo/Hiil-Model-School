-- Phase 5 CP1: server-side hardening for student attendance + the leave -> attendance
-- auto-apply pipeline, which the frontend converts from mock to real Supabase in the same
-- checkpoint.
--
-- Nothing structural is added -- every table already exists (migration
-- 20260825181122_timetable_attendance_leave). This migration adds:
--   1. attendance_date_guard  -- BEFORE INSERT/UPDATE trigger mirroring classifyAttendanceDate
--      (utils/academicCalendar.js): no future dates, no closures, no weekends, no
--      out-of-semester / break dates. Bypassed only for rows carrying a leave_request_id
--      (those come from decide_leave_request below, which is pre-approved in advance by design
--      and does its own weekend/closure/semester skipping).
--   2. decide_leave_request(p_id, p_status, p_reason) -- SECURITY DEFINER RPC: the single
--      approve/reject path. One caller/role check (can_decide_leave), one PENDING guard, then
--      an APPROVED request is transactionally applied to every eligible school day's
--      attendance (STUDENT) or staff_attendance (STAFF).
--   3. a few supporting indexes.
--
-- idempotent: create-or-replace throughout; drop-if-exists before each trigger/index.

-- =====================================================================
-- 1. attendance date guard
-- =====================================================================

create or replace function public.attendance_phase_blocked(p_date date)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cal public.academic_years%rowtype;
  brk_end date;
begin
  if p_date > current_date then
    return 'Attendance cannot be recorded for a future date.';
  end if;
  if exists (select 1 from public.school_closures where date = p_date) then
    return 'The school is closed on this date — attendance cannot be recorded.';
  end if;
  if extract(isodow from p_date) >= 6 then
    return 'Attendance cannot be recorded on a weekend.';
  end if;
  select * into cal from public.academic_years where is_current limit 1;
  if found then
    if p_date < cal.sem1_start then
      return 'Attendance has not started yet for the current academic year.';
    end if;
    brk_end := cal.sem1_end + greatest(coalesce(cal.break_days, 0), 0);
    if p_date > cal.sem1_end and p_date <= brk_end then
      return 'School activities are paused for the break.';
    end if;
    if p_date > brk_end and p_date < cal.sem2_start then
      return 'This date is not part of Semester 1 or Semester 2.';
    end if;
    if p_date > cal.sem2_end then
      return 'The current academic year has ended — attendance is read-only.';
    end if;
  end if;
  return null;
end;
$$;

comment on function public.attendance_phase_blocked is
  'NULL when p_date is a recordable school day, else the reason string. Mirrors
   classifyAttendanceDate() in src/utils/academicCalendar.js so the server enforces the same
   calendar gate the UI shows.';

-- Boolean companion for decide_leave_request: is p_date inside Semester 1 or Semester 2 of the
-- current academic year (ignoring future/weekend/closure, which that RPC handles separately)?
-- True when no academic year is configured yet.
create or replace function public.attendance_day_in_session(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.academic_years where is_current) then true
    else exists (
      select 1 from public.academic_years y
      where y.is_current
        and ((p_date between y.sem1_start and y.sem1_end)
          or (p_date between y.sem2_start and y.sem2_end))
    )
  end;
$$;

create or replace function public.enforce_attendance_date_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  -- Rows written by decide_leave_request() carry a leave_request_id and are pre-approved in
  -- advance -- that RPC skips weekends/closures/out-of-semester dates itself, so the only thing
  -- it legitimately needs to bypass here is the "future date" gate (leave is granted ahead of
  -- time by design). A hand-marked row never has a leave_request_id.
  if new.leave_request_id is not null then
    return new;
  end if;
  v_reason := public.attendance_phase_blocked(new.date);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_date_guard on public.attendance;
create trigger attendance_date_guard
  before insert or update on public.attendance
  for each row
  execute function public.enforce_attendance_date_guard();

-- staff_attendance: same future-date + closure gate, but NOT the semester/break gate -- staff
-- can legitimately be on the clock during a student break. Weekend rows are allowed for
-- shift-based staff (a Saturday driver run), so weekends are not blocked here either.
create or replace function public.enforce_staff_attendance_date_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.leave_request_id is not null then
    return new;
  end if;
  if new.date > current_date then
    raise exception 'Staff attendance cannot be recorded for a future date.';
  end if;
  if exists (select 1 from public.school_closures where date = new.date) then
    raise exception 'The school is closed on this date — attendance cannot be recorded.';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_attendance_date_guard on public.staff_attendance;
create trigger staff_attendance_date_guard
  before insert or update on public.staff_attendance
  for each row
  execute function public.enforce_staff_attendance_date_guard();

-- =====================================================================
-- 2. decide_leave_request
-- =====================================================================

create or replace function public.decide_leave_request(
  p_id uuid,
  p_status leave_approval_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.leave_requests%rowtype;
  v_student public.students%rowtype;
  v_staff public.staff%rowtype;
  v_periods text[];
  v_period text;
  v_date date;
  v_att_status attendance_status;
  v_applied integer := 0;
begin
  if p_status not in ('APPROVED', 'REJECTED') then
    raise exception 'A leave request can only be APPROVED or REJECTED.';
  end if;

  select * into req from public.leave_requests where id = p_id for update;
  if not found then
    raise exception 'Leave request not found.';
  end if;

  -- Idempotent: a request already decided (e.g. a double-click race that got past the frontend
  -- guard) is a no-op, not an error.
  if req.approval_status <> 'PENDING' then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  if not public.can_decide_leave(req.kind, req.subject_id) then
    raise exception 'You are not authorized to decide this leave request.';
  end if;

  if p_status = 'REJECTED' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection needs a reason.';
  end if;

  update public.leave_requests
     set approval_status = p_status,
         decided_by = auth.uid(),
         decided_at = now(),
         rejection_reason = case when p_status = 'REJECTED' then btrim(p_reason) else null end
   where id = p_id;

  if p_status <> 'APPROVED' then
    return jsonb_build_object('ok', true, 'applied', 0);
  end if;

  -- leave_reason ('Sick' | 'Permission' | 'Excused') maps 1:1 onto attendance_status.
  v_att_status := req.reason::text::attendance_status;

  if req.kind = 'STUDENT' then
    select * into v_student from public.students where id = req.subject_id;
    if not found then
      raise exception 'The student for this leave request no longer exists.';
    end if;
  else
    select * into v_staff from public.staff where id = req.subject_id;
    if not found then
      raise exception 'The staff member for this leave request no longer exists.';
    end if;
    v_periods := case when v_staff.has_shifts then array['AM', 'PM'] else array['FULL_DAY'] end;
  end if;

  v_date := req.from_date;
  while v_date <= req.to_date loop
    -- Skip weekends and closures always; for students also skip out-of-semester / break dates.
    if extract(isodow from v_date) < 6
       and not exists (select 1 from public.school_closures where date = v_date)
    then
      if req.kind = 'STUDENT' then
        -- Apply on any in-session day (including future ones — leave is pre-approved), never on a
        -- pre-school-start / break / post-year date.
        if public.attendance_day_in_session(v_date) then
          insert into public.attendance (student_id, class_id, date, status, note, marked_by, marked_at, leave_request_id)
          values (v_student.id, v_student.class_id, v_date, v_att_status, req.note, auth.uid(), now(), req.id)
          on conflict (student_id, date) do update
            set status = excluded.status,
                note = excluded.note,
                marked_by = excluded.marked_by,
                marked_at = now(),
                leave_request_id = excluded.leave_request_id;
          v_applied := v_applied + 1;
        end if;
      else
        foreach v_period in array v_periods loop
          insert into public.staff_attendance (staff_id, date, period, status, note, marked_by, marked_at, leave_request_id)
          values (v_staff.id, v_date, v_period::staff_attendance_period, v_att_status, req.note, auth.uid(), now(), req.id)
          on conflict (staff_id, date, period) do update
            set status = excluded.status,
                note = excluded.note,
                marked_by = excluded.marked_by,
                marked_at = now(),
                leave_request_id = excluded.leave_request_id;
          v_applied := v_applied + 1;
        end loop;
      end if;
    end if;
    v_date := v_date + 1;
  end loop;

  return jsonb_build_object('ok', true, 'applied', v_applied);
end;
$$;

comment on function public.decide_leave_request is
  'The only approve/reject path for leave_requests. One can_decide_leave() check, one PENDING
   guard (idempotent no-op otherwise), then an APPROVED request is transactionally applied to
   every eligible school day''s attendance (STUDENT) / staff_attendance (STAFF), skipping
   weekends, closures and — for students — out-of-semester dates.';

revoke all on function public.decide_leave_request(uuid, leave_approval_status, text) from public;
grant execute on function public.decide_leave_request(uuid, leave_approval_status, text) to authenticated;

-- =====================================================================
-- 2a. period_logs parent SELECT — parity with substitutions_select_parent
-- (20260901000000). data.getPeriodCoverage() joins period_logs.attendance down to a parent's
-- own child on ParentAttendancePage; the base period_logs_select policy only covers Owner/ED and
-- the period's teacher/substitute, so parents saw nothing once period_logs became real. Purely
-- additive (Postgres ORs permissive policies).
-- =====================================================================

drop policy if exists period_logs_select_parent on public.period_logs;
create policy period_logs_select_parent on public.period_logs
  for select
  using (
    public.is_parent()
    and exists (
      select 1
      from public.timetable_entries te
      join public.students s on s.class_id = te.class_id
      where te.id = period_logs.timetable_entry_id
        and public.is_parent_of(s.id)
    )
  );

-- =====================================================================
-- 2b. leave_requests DELETE policy — cleanup path for a deleted student / staff member.
-- leave_requests.subject_id is polymorphic (no FK), so a student/staff delete does NOT cascade
-- these rows; without a delete path an orphaned PENDING request keeps showing in a decider's
-- queue with a broken subject name. Scoped to exactly who could have decided it.
-- =====================================================================

drop policy if exists leave_requests_delete on public.leave_requests;
create policy leave_requests_delete on public.leave_requests
  for delete
  using (public.can_decide_leave(kind, subject_id));

-- =====================================================================
-- 3. supporting indexes
-- =====================================================================

create index if not exists attendance_leave_request_idx on public.attendance (leave_request_id);
create index if not exists staff_attendance_leave_request_idx on public.staff_attendance (leave_request_id);
create index if not exists period_logs_date_idx on public.period_logs (date);
create index if not exists substitutions_date_idx on public.substitutions (date);
create index if not exists substitutions_substitute_idx on public.substitutions (substitute_teacher_id);
create index if not exists leave_requests_requested_by_idx on public.leave_requests (requested_by);
