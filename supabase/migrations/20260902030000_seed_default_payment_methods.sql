-- Phase 4: seed the default payment-method catalog so Fees / Payroll / Expenses forms have
-- sensible options on a fresh database. These are NOT hardcoded into any workflow -- Owner/Finance
-- can rename, deactivate, or add to them on the Payment Methods page, and record_payment_batch
-- still auto-creates any method used by name that isn't in the table yet.
--
-- Mirrors DEFAULT_PAYMENT_METHODS in src/utils/constants.js. Idempotent (name is UNIQUE +
-- ON CONFLICT DO NOTHING) -- safe to re-run, never disturbs an existing row.

insert into public.payment_methods (name, active) values
  ('Cash', true),
  ('EVC Plus', true),
  ('eDahab', true),
  ('Zaad', true),
  ('Bank Transfer', true),
  ('Other', true)
on conflict (name) do nothing;
