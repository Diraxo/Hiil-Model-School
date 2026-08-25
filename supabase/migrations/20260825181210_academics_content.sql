-- Migration 4 of N: homework, results (+ components, audit log, evidence),
-- exam announcements, report cards, behavior records, student documents.
--
-- results.components is normalized into its own result_components table
-- (one row per {result, component}) rather than the mock app's jsonb
-- blob, so a single component update/audit touches one row instead of
-- rewriting the whole record -- cleaner for RLS and for the audit trail.
--
-- File fields that were inline base64 dataURLs in the mock app (homework
-- attachments, result evidence photos, student documents) become *_url
-- text columns pointing at Supabase Storage objects -- see the Storage
-- migration that comes later, once buckets/policies are designed.

create type semester as enum ('S1', 'S2');

create type assessment_component as enum ('midterm1', 'midterm2', 'studentBook', 'finalExam');

create type result_publish_status as enum ('DRAFT', 'PUBLISHED', 'LOCKED');

create type result_audit_action as enum (
  'COMPONENT_UPDATED', 'PUBLISHED', 'LOCKED', 'UNLOCKED',
  'AUTO_LOCK_OVERRIDDEN', 'AUTO_LOCK_REINSTATED', 'EVIDENCE_ADDED', 'EVIDENCE_REMOVED'
);

create type behavior_type as enum (
  'Positive', 'Warning', 'Fighting', 'Late', 'Disrespect', 'Academic concern', 'Other'
);

create type behavior_severity as enum ('Low', 'Medium', 'High');

create type report_card_status as enum ('DRAFT', 'READY', 'GENERATED', 'PUBLISHED', 'LOCKED');

-- ---------------------------------------------------------------------
-- homework
-- ---------------------------------------------------------------------

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  grade text not null,
  section text not null default '',
  class_id uuid not null references public.classes (id) on delete cascade,
  title text not null,
  description text,
  due_date date not null,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  attachment_url text,
  academic_year_id uuid references public.academic_years (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.homework enable row level security;

create index homework_class_idx on public.homework (class_id);
create index homework_teacher_idx on public.homework (teacher_id);
create index homework_due_date_idx on public.homework (due_date);

-- ---------------------------------------------------------------------
-- results
-- ---------------------------------------------------------------------

create table public.results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  semester semester not null,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  publish_status result_publish_status not null default 'DRAFT',
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null,
  auto_lock_override jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint results_unique unique (student_id, subject_id, semester, academic_year_id)
);

comment on table public.results is
  'academic_year_id is required, not derivable from class_id alone: a repeating/retained student keeps the same class_id across years.';

alter table public.results enable row level security;

create index results_student_year_idx on public.results (student_id, academic_year_id);
create index results_class_idx on public.results (class_id);

create trigger results_set_updated_at
  before update on public.results
  for each row
  execute function public.set_updated_at();

create table public.result_components (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results (id) on delete cascade,
  component assessment_component not null,
  score numeric(5, 2),
  max numeric(5, 2) not null,
  shared_with_parents boolean not null default false,
  updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  constraint result_components_unique unique (result_id, component),
  constraint result_components_score_in_range
    check (score is null or (score >= 0 and score <= max))
);

alter table public.result_components enable row level security;

-- ---------------------------------------------------------------------
-- result_audit_log: append-only, unlimited retention (the mock app
-- capped this at 500 rows purely as an in-memory-object size limit --
-- a real audit table should not replicate that).
-- ---------------------------------------------------------------------

create table public.result_audit_log (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid references public.classes (id) on delete set null,
  subject_id uuid references public.subjects (id) on delete set null,
  semester semester not null,
  component assessment_component,
  action result_audit_action not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role user_role,
  actor_name text,
  diff jsonb,
  reason text,
  at timestamptz not null default now()
);

alter table public.result_audit_log enable row level security;

create index result_audit_log_result_idx on public.result_audit_log (result_id);
create index result_audit_log_student_idx on public.result_audit_log (student_id);

-- ---------------------------------------------------------------------
-- result_evidence: exam-paper photo/scan pages
-- ---------------------------------------------------------------------

create table public.result_evidence (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid references public.classes (id) on delete set null,
  semester semester not null,
  component assessment_component not null,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  page_order integer not null default 0,
  file_url text not null,
  file_type text,
  file_name text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

alter table public.result_evidence enable row level security;

create index result_evidence_result_component_idx on public.result_evidence (result_id, component);

-- ---------------------------------------------------------------------
-- exam_announcements
-- ---------------------------------------------------------------------

create table public.exam_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text,
  audience jsonb not null,
  priority text,
  exam_date date,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.exam_announcements enable row level security;

-- ---------------------------------------------------------------------
-- report_cards
-- ---------------------------------------------------------------------

create table public.report_cards (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  status report_card_status not null default 'DRAFT',
  generated_at timestamptz,
  generated_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null,
  promoted boolean,
  promotion_note text,
  constraint report_cards_unique unique (student_id, class_id, academic_year_id)
);

alter table public.report_cards enable row level security;

create index report_cards_student_year_idx on public.report_cards (student_id, academic_year_id);

-- ---------------------------------------------------------------------
-- behavior_records
-- ---------------------------------------------------------------------

create table public.behavior_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  date date not null,
  type behavior_type not null,
  severity behavior_severity not null,
  description text,
  staff_name text,
  action text,
  parent_notified boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.behavior_records enable row level security;

create index behavior_records_student_idx on public.behavior_records (student_id);

-- ---------------------------------------------------------------------
-- student_documents
-- ---------------------------------------------------------------------

create table public.student_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  category text,
  title text not null,
  file_url text not null,
  file_type text,
  file_name text,
  academic_year_id uuid references public.academic_years (id) on delete set null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

alter table public.student_documents enable row level security;

create index student_documents_student_idx on public.student_documents (student_id);
