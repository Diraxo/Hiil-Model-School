-- Migration 2 of N: academic years, classes, subjects, teacher assignments,
-- students, enrollments, parent-student links.
--
-- Design notes:
-- * subject is normalized to subjects.id everywhere (class_subjects,
--   teacher_assignments, homework, results, timetable_entries in later
--   migrations) instead of the mock app's subject-NAME-string convention.
--   A rename now cascades automatically via the FK instead of the app's
--   manual find-and-replace-in-4-places rename logic.
-- * academic_year_id is required (not nullable) everywhere the mock app
--   needed it as a disambiguator (results, enrollments, obligations, ...)
--   because a repeating/retained student keeps the same class_id across
--   years -- class_id alone is never sufficient.
-- * Still zero RLS policies (see migration 1's header) -- tables remain
--   fully locked until the dedicated RLS migration.

create type student_status as enum (
  'ACTIVE', 'ABSENT', 'SUSPENDED', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'ARCHIVED'
);

-- ---------------------------------------------------------------------
-- academic_years
-- ---------------------------------------------------------------------

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  gc_label text not null,
  ec_label text,
  year_start date not null,
  year_end date not null,
  sem1_start date not null,
  sem1_end date not null,
  break_days integer not null default 0,
  sem2_start date not null,
  sem2_end date not null,
  result_finalization_grace_days integer not null default 14,
  is_current boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint academic_years_dates_ordered check (
    year_start <= sem1_start and sem1_start <= sem1_end
    and sem1_end <= sem2_start and sem2_start <= sem2_end and sem2_end <= year_end
  )
);

comment on table public.academic_years is
  'One row per school year. At most one row has is_current = true (enforced by the partial unique index below).';

alter table public.academic_years enable row level security;

create unique index academic_years_one_current_idx
  on public.academic_years (is_current)
  where is_current;

create trigger academic_years_set_updated_at
  before update on public.academic_years
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- subjects (global catalog)
-- ---------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint subjects_name_unique unique (name)
);

alter table public.subjects enable row level security;

-- ---------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  grade text not null,
  section text not null default '',
  head_teacher_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint classes_grade_section_unique unique (grade, section)
);

alter table public.classes enable row level security;

create index classes_head_teacher_idx on public.classes (head_teacher_id);

-- ---------------------------------------------------------------------
-- class_subjects: curriculum for a class (many-to-many classes<->subjects)
-- ---------------------------------------------------------------------

create table public.class_subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint class_subjects_unique unique (class_id, subject_id)
);

alter table public.class_subjects enable row level security;

create index class_subjects_class_idx on public.class_subjects (class_id);
create index class_subjects_subject_idx on public.class_subjects (subject_id);

-- ---------------------------------------------------------------------
-- teacher_assignments: who teaches what subject in what class
-- ---------------------------------------------------------------------

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint teacher_assignments_unique unique (class_id, subject_id)
);

comment on table public.teacher_assignments is
  'Authoritative "who owns this class+subject" record. Reassigning a class+subject explicitly replaces whoever held it (unique(class_id, subject_id) enforces this at the DB level).';

alter table public.teacher_assignments enable row level security;

create index teacher_assignments_teacher_idx on public.teacher_assignments (teacher_id);
create index teacher_assignments_class_idx on public.teacher_assignments (class_id);

-- ---------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------

create sequence public.student_number_seq start 1;

create or replace function public.generate_student_id()
returns text
language sql
as $$
  select 'TMA-' || extract(year from coalesce(
           (select year_start from public.academic_years where is_current limit 1),
           current_date
         ))::text
         || '-' || lpad(nextval('public.student_number_seq')::text, 5, '0');
$$;

comment on function public.generate_student_id is
  'Business-facing student code TMA-{current academic year start year}-{5-digit gap-safe sequence}. Call before insert; the value is NOT auto-generated by a trigger because it depends on the current academic year row.';

create table public.students (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  gender text,
  dob date,
  grade text not null,
  section text not null default '',
  class_id uuid references public.classes (id) on delete set null,
  admission_date date not null,
  photo_url text,
  status student_status not null default 'ACTIVE',
  suspension jsonb,
  emergency_contact text,
  uses_bus boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.students enable row level security;

create index students_class_idx on public.students (class_id);
create index students_status_idx on public.students (status);
create index students_grade_section_idx on public.students (grade, section);

create trigger students_set_updated_at
  before update on public.students
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- enrollments: one row per student per academic year (history)
-- ---------------------------------------------------------------------

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  grade text not null,
  section text not null default '',
  class_id uuid references public.classes (id) on delete set null,
  status student_status not null,
  suspension jsonb,
  enrollment_date date not null,
  created_at timestamptz not null default now(),
  constraint enrollments_unique unique (student_id, academic_year_id)
);

alter table public.enrollments enable row level security;

create index enrollments_student_idx on public.enrollments (student_id);
create index enrollments_year_idx on public.enrollments (academic_year_id);

-- ---------------------------------------------------------------------
-- parent_students: normalizes the mock app's users.childIds array
-- ---------------------------------------------------------------------

create table public.parent_students (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint parent_students_unique unique (parent_id, student_id)
);

comment on table public.parent_students is
  'A parent may only see/act on students linked here. This relationship -- not any client-supplied studentId -- is what RLS checks for parent-scoped access.';

alter table public.parent_students enable row level security;

create index parent_students_parent_idx on public.parent_students (parent_id);
create index parent_students_student_idx on public.parent_students (student_id);
