-- Migration 3 of N: timetable, student/staff attendance, leave requests,
-- school closures, owner leave log.
--
-- leave_requests.subject_id is a polymorphic reference (points at either
-- students.id or staff.id depending on kind) and intentionally has no FK
-- constraint -- Postgres can't natively FK across two target tables. The
-- RPC that inserts leave requests must validate the target exists.

create type school_day as enum ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday');

create type attendance_status as enum ('Present', 'Late', 'Sick', 'Permission', 'Excused', 'Absent');

create type staff_attendance_period as enum ('AM', 'PM', 'FULL_DAY');

create type leave_reason as enum ('Sick', 'Permission', 'Excused');

create type leave_kind as enum ('STUDENT', 'STAFF');

create type leave_approval_status as enum ('PENDING', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------
-- timetable_config: singleton row (id is always literal `true`, and the
-- primary key + check(id) together make a second row impossible).
-- ---------------------------------------------------------------------

create table public.timetable_config (
  id boolean primary key default true,
  periods_count integer not null default 6,
  start_time time not null default '08:00',
  period_duration_mins integer not null default 45,
  break_duration_mins integer not null default 20,
  break_after_period integer,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint timetable_config_singleton check (id),
  constraint timetable_config_periods_range check (periods_count between 1 and 8)
);

alter table public.timetable_config enable row level security;

create trigger timetable_config_set_updated_at
  before update on public.timetable_config
  for each row
  execute function public.set_updated_at();

insert into public.timetable_config (id) values (true);

-- ---------------------------------------------------------------------
-- timetable_entries
-- ---------------------------------------------------------------------

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  day school_day not null,
  period integer not null,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint timetable_entries_unique unique (class_id, day, period)
);

alter table public.timetable_entries enable row level security;

create index timetable_entries_teacher_day_period_idx on public.timetable_entries (teacher_id, day, period);

-- ---------------------------------------------------------------------
-- leave_requests (created before attendance tables since they reference it)
-- ---------------------------------------------------------------------

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  kind leave_kind not null,
  subject_id uuid not null,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  reason leave_reason not null,
  from_date date not null,
  to_date date not null,
  note text,
  approval_status leave_approval_status not null default 'PENDING',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  rejection_reason text,
  completion_notified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint leave_requests_dates_ordered check (from_date <= to_date),
  constraint leave_requests_rejection_reason_required
    check (approval_status <> 'REJECTED' or rejection_reason is not null)
);

alter table public.leave_requests enable row level security;

create index leave_requests_subject_idx on public.leave_requests (kind, subject_id);
create index leave_requests_status_idx on public.leave_requests (approval_status);

-- ---------------------------------------------------------------------
-- attendance: daily class-level student attendance
-- ---------------------------------------------------------------------

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  date date not null,
  status attendance_status not null,
  note text,
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  leave_request_id uuid references public.leave_requests (id) on delete set null,
  constraint attendance_unique unique (student_id, date)
);

alter table public.attendance enable row level security;

create index attendance_class_date_idx on public.attendance (class_id, date);
create index attendance_date_idx on public.attendance (date);

-- ---------------------------------------------------------------------
-- staff_attendance
-- ---------------------------------------------------------------------

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  date date not null,
  period staff_attendance_period not null default 'FULL_DAY',
  status attendance_status not null,
  arrival_time time,
  note text,
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  leave_request_id uuid references public.leave_requests (id) on delete set null,
  constraint staff_attendance_unique unique (staff_id, date, period),
  constraint staff_attendance_arrival_time_only_when_late
    check (arrival_time is null or status = 'Late')
);

alter table public.staff_attendance enable row level security;

create index staff_attendance_date_idx on public.staff_attendance (date);

-- ---------------------------------------------------------------------
-- period_logs: per-timetable-period-per-day journal
-- ---------------------------------------------------------------------

create table public.period_logs (
  id uuid primary key default gen_random_uuid(),
  timetable_entry_id uuid not null references public.timetable_entries (id) on delete cascade,
  date date not null,
  status text not null default 'done',
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  attendance jsonb,
  attendance_marked_by uuid references public.profiles (id) on delete set null,
  attendance_marked_at timestamptz,
  constraint period_logs_unique unique (timetable_entry_id, date)
);

alter table public.period_logs enable row level security;

-- ---------------------------------------------------------------------
-- substitutions
-- ---------------------------------------------------------------------

create table public.substitutions (
  id uuid primary key default gen_random_uuid(),
  timetable_entry_id uuid not null references public.timetable_entries (id) on delete cascade,
  date date not null,
  original_teacher_id uuid not null references public.profiles (id) on delete cascade,
  substitute_teacher_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint substitutions_unique unique (timetable_entry_id, date)
);

alter table public.substitutions enable row level security;

-- ---------------------------------------------------------------------
-- school_closures
-- ---------------------------------------------------------------------

create table public.school_closures (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  reason text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.school_closures enable row level security;

-- ---------------------------------------------------------------------
-- owner_leave_log: log-only, no approver (Owner has no staff row)
-- ---------------------------------------------------------------------

create table public.owner_leave_log (
  id uuid primary key default gen_random_uuid(),
  status leave_reason not null,
  from_date date not null,
  to_date date not null,
  note text,
  created_at timestamptz not null default now(),
  constraint owner_leave_log_dates_ordered check (from_date <= to_date)
);

alter table public.owner_leave_log enable row level security;
