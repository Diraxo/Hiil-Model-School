-- One-time Owner bootstrap. Run this AFTER all numbered migrations in
-- supabase/migrations/ have been applied, and AFTER creating the Owner's
-- Supabase Auth user (Dashboard -> Authentication -> Users -> Add user).
--
-- Steps:
--   1. Dashboard -> Authentication -> Users -> Add user
--        Email:    <the owner's real email address>
--        Password: <a strong password you choose; the owner changes it on first login>
--        Check "Auto Confirm User" (no email verification step needed).
--   2. Copy the new user's UUID (shown in the Users table / user detail page).
--   3. Replace the three <...> placeholders below with the real values.
--   4. Run this whole file in the SQL Editor.
--
-- This is the ONLY row that will exist in the entire database afterward
-- -- every other table (students, teachers, staff, classes, fees,
-- payments, ...) starts completely empty.

insert into public.profiles (id, role, full_name, email, status)
values (
  '<REPLACE_WITH_OWNER_AUTH_UUID>',
  'OWNER',
  '<Owner full name>',
  '<the owner''s real email address>',
  'ACTIVE'
);
