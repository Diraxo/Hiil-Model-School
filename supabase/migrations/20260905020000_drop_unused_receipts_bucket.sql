-- Storage hardening, part 3 of 4: retire the obsolete `receipts` bucket.
--
-- 20260827010000 created a `receipts` bucket (path `<payment_id>/<filename>`, Owner/Finance only)
-- anticipating uploaded student-payment receipt images. That never happened: student payment
-- receipts are rendered on the fly from `payments` data by src/components/Receipt.jsx and printed,
-- never uploaded or stored as files. Phase 4 instead introduced `expense-receipts` for the one
-- real receipt-file domain (expense purchase receipts), fully wired in expenseService.js.
--
-- The `receipts` bucket has zero code references and zero stored objects. This migration strips
-- its RLS policies so it is inert (no role can read or write it). The empty bucket row itself
-- must be deleted from the Storage API / dashboard (Storage -> receipts -> Delete bucket):
-- the Supabase platform blocks `DELETE FROM storage.buckets` from SQL
-- ("Direct deletion from storage tables is not allowed. Use the Storage API instead.").
-- `expense-receipts` is untouched.
--
-- Guarded by an emptiness check so this can never run against a bucket that unexpectedly
-- holds real data.

do $$
declare
  n integer;
begin
  select count(*) into n from storage.objects where bucket_id = 'receipts';
  if n > 0 then
    raise exception 'receipts bucket is not empty (% objects) -- aborting; investigate before retiring.', n;
  end if;
end $$;

drop policy if exists "receipts_read"   on storage.objects;
drop policy if exists "receipts_insert" on storage.objects;
drop policy if exists "receipts_update" on storage.objects;
drop policy if exists "receipts_delete" on storage.objects;
