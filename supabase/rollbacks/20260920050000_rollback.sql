-- ROLLBACK for 20260920050000_finance_announcement_audience_guard.sql (NOT a migration; it lives in
-- supabase/rollbacks/ so `supabase db push` never runs it).
-- WARNING: this re-opens the hole - a Finance account could again insert/update an announcement with the audience
-- "everyone" / "Directors" / a single user through the API. No data is touched.

drop trigger if exists announcements_enforce_audience on public.announcements;
drop function if exists public.enforce_announcement_audience();
