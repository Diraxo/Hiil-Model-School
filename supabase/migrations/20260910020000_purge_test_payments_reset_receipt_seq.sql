-- Pre-handover: wipe the payment test data so the client starts from a clean slate.
--
-- As of 2026-09-10 public.payments holds 7 rows, all dated 2026-09-08, all test data from an
-- earlier manual finance run (NOT from the 2026-09-10 acceptance test, whose receipts were
-- already removed): six whole-receipt VOIDs (#0001-#0006) and one POSTED test payment (#0012).
-- The school has not recorded a single real payment yet.
--
-- Obligation balances are fully derived (net_owed_for_obligation computes from live allocations
-- + non-voided payments), so removing the payments simply returns every touched obligation to
-- "unpaid" with no stored field to reconcile.
--
-- payment_allocations and payment_audit_log are ON DELETE CASCADE off payments. Payment
-- notifications (notifications.payment_id -> ON DELETE SET NULL) are caught by the
-- notifications_update_guard BEFORE UPDATE trigger, so it is suspended for the transaction.

alter table public.notifications disable trigger notifications_update_guard;

do $$
begin
  -- every 'PAYMENT' notification points at one of the receipts being deleted (all payments go)
  delete from public.notifications where type = 'PAYMENT';

  -- recent-activity lines / deep-links for those receipts would 404 after the delete
  delete from public.activities
  where text ilike '%payment%' or text ilike '%receipt%'
     or navigation ? 'paymentId' or navigation ->> 'page' = 'payments';

  -- the receipts themselves (cascades payment_allocations + payment_audit_log)
  delete from public.payments;
end $$;

alter table public.notifications enable trigger notifications_update_guard;

-- Restart receipt numbering at #0001 for the client's first real payment.
-- (payroll_payment_ref_seq / expense_no_seq were already reset by the previous migration.)
alter sequence public.receipt_no_seq restart with 1;

do $$
declare
  v_payments int;
begin
  select count(*) into v_payments from public.payments;
  if v_payments <> 0 then
    raise exception 'purge incomplete: % payment rows remain', v_payments;
  end if;
  raise notice 'payments purged; receipt_no_seq restarted at 1';
end $$;
