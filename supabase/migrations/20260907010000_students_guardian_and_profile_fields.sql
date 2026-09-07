-- Blocker 5 — Student Registration data expansion & Excel compatibility.
--
-- The school's real registration sheet carries more per-student information than the app stored:
-- a dedicated parent/guardian contact (name + phone + relationship) that is a DIFFERENT concept
-- from the emergency contact, a custody note, a free-text home address, and the previous school.
--
-- Design (matches 20260826000000_students_emergency_contact_columns.sql exactly — purely additive,
-- every column nullable, nothing to back-fill):
--   * The existing emergency_contact / emergency_contact_name / emergency_contact_relationship
--     columns are LEFT ALONE and now represent ONLY the emergency contact. The new guardian_*
--     columns are the parent/guardian contact — the two are stored independently and never
--     overwrite each other.
--   * *_relationship stays a plain text column (one of Father/Mother/Guardian/Sibling/Uncle/Other,
--     or NULL). When it is 'Other', the free-text value the user typed is stored in the matching
--     *_relationship_other column — so "Other" + "Grandfather" round-trips without forcing Somali
--     families into a fixed list.
--   * custody is a short free-text note, kept in the parent/guardian section of the form.
--   * home_address / previous_school are single free-text columns (V1 — no separate address or
--     school tables; the schema stays clean enough for a future Excel importer to map straight in).
--
-- RLS: unchanged and correct as-is. public.students policies (20260825190000_rls_policies.sql)
-- are ROW-level (Owner/Educational Director full; Finance read; Teacher only students in a class
-- they teach/head; Parent only their parent_students-linked children) — adding columns cannot
-- widen who can see a row, and `grant select ... on public.students to authenticated` already
-- covers every column of the table. No new policy, no new grant.

alter table public.students
  add column if not exists guardian_name text,
  add column if not exists guardian_phone text,
  add column if not exists guardian_relationship text,
  add column if not exists guardian_relationship_other text,
  add column if not exists custody text,
  add column if not exists emergency_contact_relationship_other text,
  add column if not exists home_address text,
  add column if not exists previous_school text;

comment on column public.students.guardian_name is
  'Parent/guardian contact full name (school record only — NOT proof of Parent Portal access, which is always via parent_students).';
comment on column public.students.guardian_relationship is
  'One of Father/Mother/Guardian/Sibling/Uncle/Other, or NULL. When ''Other'', the typed value is in guardian_relationship_other.';
comment on column public.students.emergency_contact_relationship_other is
  'Free-text relationship used when emergency_contact_relationship = ''Other''.';
comment on column public.students.custody is
  'Short free-text custody note (e.g. "Mother", "Shared", "Legal guardian — uncle").';
comment on column public.students.home_address is
  'Free-text home address (village / kebele / city / area / landmarks). Not structured in V1.';
comment on column public.students.previous_school is
  'Free-text previous school ("None" / "KG" / "Transferred from ..." / a school name).';
