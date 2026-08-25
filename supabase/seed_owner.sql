-- One-time Owner bootstrap. Run this AFTER all numbered migrations in
-- supabase/migrations/ have been applied, and AFTER creating the Owner's
-- Supabase Auth user (Dashboard -> Authentication -> Users -> Add user).
--
-- Steps:
--   1. Dashboard -> Authentication -> Users -> Add user
--        Email:    owner@tilmaan-demo.com
--        Password: Demo123!
--        Check "Auto Confirm User" (no email verification step needed).
--   2. Copy the new user's UUID (shown in the Users table / user detail page).
--   3. Replace REPLACE_WITH_OWNER_AUTH_UUID below with that UUID.
--   4. Run this whole file in the SQL Editor.
--
-- This is the ONLY row that will exist in the entire database afterward
-- -- every other table (students, teachers, staff, classes, fees,
-- payments, ...) starts completely empty, per the "wipe every demo
-- thing, Owner account only" instruction.

insert into public.profiles (id, role, full_name, email, status)
values (
  'REPLACE_WITH_OWNER_AUTH_UUID',
  'OWNER',
  'Abdirahman Ali',
  'owner@tilmaan-demo.com',
  'ACTIVE'
);
