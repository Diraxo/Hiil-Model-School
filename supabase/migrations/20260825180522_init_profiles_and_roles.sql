-- Migration 1 of N: extensions, enums, profiles (tied to Supabase Auth), staff.
--
-- Design notes:
-- * profiles.id === auth.users.id (1:1). Authorization lives ONLY in
--   profiles.role, a trusted app table protected by RLS -- never in
--   auth.users' editable raw_user_meta_data.
-- * No password/reset-code columns anywhere in this schema: Supabase Auth
--   owns credentials and password-reset entirely (see the app's Phase 2
--   auth rewrite, done separately from schema work).
-- * Every table is created with RLS enabled and ZERO policies, so it is
--   fully inaccessible (even to its owner role) until a dedicated RLS
--   migration adds policies. This is the safe default while the schema is
--   still being built out across several migrations.
-- * Business-facing codes (employee numbers, student ids, receipt numbers,
--   ...) are backed by real Postgres SEQUENCEs, not derived from row
--   count/position, matching the app's existing "gap-safe, never renumber"
--   requirement.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

create type user_role as enum ('OWNER', 'ADMIN', 'FINANCE', 'TEACHER', 'PARENT');

create type account_status as enum ('ACTIVE', 'SUSPENDED', 'DISABLED');

create type employment_status as enum ('ACTIVE', 'ENDED');

create type staff_position as enum (
  'Teacher', 'Educational Director', 'Finance Director',
  'Cleaner', 'Guard', 'Driver', 'Cook', 'Other'
);

-- ---------------------------------------------------------------------
-- profiles: one row per Supabase Auth user, the app's identity + role.
-- ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null,
  full_name text not null,
  first_name text,
  middle_name text,
  last_name text,
  email text not null,
  phone text,
  photo_url text,
  status account_status not null default 'ACTIVE',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'App-level identity + role for every Supabase Auth user. role is the sole source of authorization truth (never auth.users metadata).';

alter table public.profiles enable row level security;

create index profiles_role_idx on public.profiles (role);
create index profiles_status_idx on public.profiles (status);

-- ---------------------------------------------------------------------
-- staff: every paid employee, login or not. Not every staff row has a
-- linked profile (non-login staff like cleaners/guards/drivers).
-- ---------------------------------------------------------------------

create sequence public.staff_employee_seq start 1;

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  employee_number text not null unique,
  name text not null,
  position staff_position not null,
  employment_date date not null,
  phone text,
  salary numeric(12, 2) not null default 0,
  payment_schedule text not null default 'MONTHLY',
  status account_status not null default 'ACTIVE',
  employment_status employment_status not null default 'ACTIVE',
  employment_end_date date,
  photo_url text,
  has_shifts boolean not null default false,
  bank_account jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_salary_nonnegative check (salary >= 0),
  constraint staff_employment_end_date_requires_ended
    check (employment_end_date is null or employment_status = 'ENDED')
);

comment on table public.staff is
  'Every paid employee (login or not). user_id links to profiles for staff who can log in (Teacher/Educational Director/Finance Director).';

alter table public.staff enable row level security;

create index staff_user_id_idx on public.staff (user_id);
create index staff_position_idx on public.staff (position);
create index staff_status_idx on public.staff (status);
create index staff_employment_status_idx on public.staff (employment_status);

create or replace function public.assign_employee_number()
returns trigger
language plpgsql
as $$
begin
  if new.employee_number is null then
    new.employee_number := 'TMA-EMP-' || lpad(nextval('public.staff_employee_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger staff_assign_employee_number
  before insert on public.staff
  for each row
  execute function public.assign_employee_number();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Generic BEFORE UPDATE trigger: stamps updated_at = now(). Reused by every table below that has an updated_at column.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

create trigger staff_set_updated_at
  before update on public.staff
  for each row
  execute function public.set_updated_at();
