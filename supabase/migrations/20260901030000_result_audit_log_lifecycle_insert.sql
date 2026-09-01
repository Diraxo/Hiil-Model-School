-- Phase 3 checkpoint 2 (Results / Exams): narrow additive fix to result_audit_log INSERT.
--
-- The original policy (20260825190000_rls_policies.sql L800-801) gated every audit-row insert on
-- can_edit_result_component(result_id), which returns FALSE the moment a result's publish_status
-- is 'LOCKED'. That is correct for COMPONENT_UPDATED entries, but it also makes it impossible to
-- record the LOCKED / UNLOCKED / PUBLISHED lifecycle entries themselves:
--   * LOCKED  -- written right after publish_status becomes 'LOCKED'  -> can_edit_...() is false
--   * UNLOCKED -- the result is still 'LOCKED' at the moment of the write -> false
-- i.e. the audit trail for exactly the actions the audit trail exists to capture could not be
-- written, and the mutator surfaced a spurious RLS error to the user even though the lock/unlock
-- itself had succeeded.
--
-- Fix: also allow the insert when the caller is Owner / Educational Director (is_owner_or_admin()).
-- This is the smallest possible widening -- that role already holds full results_update rights
-- (publish / lock / unlock are Owner/Director-only per results_update), so it can already perform
-- every lifecycle transition; this just lets it record them. Teachers are unaffected: they still
-- insert audit rows only via can_edit_result_component (their COMPONENT_UPDATED edits), and the
-- actor columns are still overwritten by stamp_result_audit_actor() from auth.uid() regardless.

drop policy if exists result_audit_log_insert on public.result_audit_log;

create policy result_audit_log_insert on public.result_audit_log
  for insert
  with check (
    public.is_owner_or_admin()
    or public.can_edit_result_component(result_id)
  );
