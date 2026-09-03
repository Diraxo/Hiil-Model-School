-- Phase 7: final production-hardening pass. Defence-in-depth only -- no behavioural change for
-- any legitimate caller. Two findings from the Phase 7 security audit:
--
--   1. leave_requests_update RLS is `can_decide_leave(...) OR approval_status <> 'PENDING'`.
--      The second clause exists so the completion sweep (leaveService.js) can flip
--      `completion_notified` on an already-decided request without being the approver -- but RLS
--      grants UPDATE on ALL columns, so *any* authenticated user could also rewrite a decided
--      request's dates / reason / decided_by, or flip REJECTED -> APPROVED. Add a guard trigger
--      (mirrors enforce_notification_update_guard / enforce_message_update_guard): a non-decider
--      may change nothing but `completion_notified`.
--
--   2. payments / payroll_payments / salary_advances / payment_allocations / payment_audit_log /
--      fee_obligation_adjustments are written ONLY through SECURITY DEFINER RPCs
--      (record_payment_batch, void_payment, record_payroll_payment, record_salary_advance,
--      add_obligation_adjustment). They have no INSERT/UPDATE/DELETE *policy*, so RLS already
--      denies a direct client write -- but the Supabase default blanket table GRANT to
--      anon/authenticated was never revoked. Same fix Phase 6 applied to notifications/
--      activities/conversations. Verified: no src/ code path writes these tables directly.
--
-- Idempotent: create-or-replace + drop-if-exists throughout.

-- =====================================================================
-- 1. leave_requests update guard
-- =====================================================================

create or replace function public.enforce_leave_request_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The approver (Owner / Educational Director / Finance, per can_decide_leave) may update the
  -- row freely -- decide_leave_request() is SECURITY DEFINER and does its own checks anyway.
  if public.can_decide_leave(old.kind, old.subject_id) then
    return new;
  end if;

  -- Anyone else only reaches here via the `approval_status <> 'PENDING'` arm of the RLS policy.
  -- Its only legitimate uses are the notify_* SECURITY DEFINER RPCs and the completion sweep,
  -- all of which touch nothing but the three *_notified idempotency flags. Every substantive
  -- column -- the dates, the reason, the decision, who decided it -- must stay frozen.
  if new.kind is distinct from old.kind
     or new.subject_id is distinct from old.subject_id
     or new.requested_by is distinct from old.requested_by
     or new.reason is distinct from old.reason
     or new.from_date is distinct from old.from_date
     or new.to_date is distinct from old.to_date
     or new.note is distinct from old.note
     or new.approval_status is distinct from old.approval_status
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.rejection_reason is distinct from old.rejection_reason
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the leave approver may modify a decided leave request';
  end if;
  -- submitted_notified / decision_notified / completion_notified may change freely here.
  return new;
end;
$$;

drop trigger if exists leave_requests_update_guard on public.leave_requests;
create trigger leave_requests_update_guard
  before update on public.leave_requests
  for each row execute function public.enforce_leave_request_update_guard();

-- =====================================================================
-- 2. Revoke blanket write grants on RPC-only financial tables
-- =====================================================================

revoke insert, update, delete on public.payments                   from anon, authenticated;
revoke insert, update, delete on public.payroll_payments           from anon, authenticated;
revoke insert, update, delete on public.salary_advances            from anon, authenticated;
revoke insert, update, delete on public.payment_allocations        from anon, authenticated;
revoke insert, update, delete on public.payment_audit_log          from anon, authenticated;
revoke insert, update, delete on public.fee_obligation_adjustments from anon, authenticated;
