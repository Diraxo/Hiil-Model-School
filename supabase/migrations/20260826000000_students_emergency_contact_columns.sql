-- Students + Enrollments conversion: the mock app's student record carries three separate
-- emergency-contact fields (name, phone, relationship) but the original students table (see
-- 20260825181018_academic_structure.sql) only has a single `emergency_contact` column, which the
-- rest of the app already uses for the phone number. Adding the missing two columns rather than
-- collapsing the three mock fields into one lossy string -- purely additive, nullable, no data to
-- migrate (table is currently empty of real rows).

alter table public.students
  add column emergency_contact_name text,
  add column emergency_contact_relationship text;
