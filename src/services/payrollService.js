// Real Supabase-backed staff payroll (payroll_payments + salary_advances). Writes go exclusively
// through the record_payroll_payment/record_salary_advance RPCs (latest definitions in
// supabase/migrations/20260906030000_payroll_advance_salary_period.sql) -- they re-run the exact
// same per-month cap math DataContext.jsx's computeStaffPayrollSummary documents client-side (kept
// there only for display, e.g. showing the remaining amount before submit), so the server is the
// single authoritative enforcement point, not a duplicated client check. An advance is recorded
// against a salary period (p_payroll_month) and reduces that month directly; the RPC caps it to
// that month's own unmet obligation so no negative balance can arise. Direct INSERT on these
// tables isn't how the RLS design expects them to be written (same reasoning as
// record_payment_batch/void_payment for student fees), so this file never inserts directly.
import { supabase } from "../lib/supabaseClient";

function mapPayment(row) {
  return {
    id: row.id, staffId: row.staff_id, amount: Number(row.amount), method: row.method,
    month: row.month, date: row.date, note: row.note || "", recordedBy: row.recorded_by,
    reference: row.reference, allowances: Number(row.allowances) || 0,
    deductions: Number(row.deductions) || 0, advanceApplied: Number(row.advance_applied) || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

function mapAdvance(row) {
  return {
    id: row.id, staffId: row.staff_id, amount: Number(row.amount), date: row.date,
    payrollMonth: row.payroll_month, note: row.note || "", recordedBy: row.recorded_by,
    reference: row.reference, createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createPayrollService() {
  return {
    async listPayments() {
      const { data, error } = await supabase.from("payroll_payments").select("*");
      if (error) throw error;
      return (data || []).map(mapPayment);
    },
    async listAdvances() {
      const { data, error } = await supabase.from("salary_advances").select("*");
      if (error) throw error;
      return (data || []).map(mapAdvance);
    },
    // Self-service equivalents of the two lists above, scoped server-side to the caller's own
    // staff record only (see supabase/migrations/20260826010000_teacher_self_payroll_rpc.sql) --
    // the base table SELECT policies are Owner/Finance only, so a Teacher's own "My Salary" page
    // reads through these instead.
    async myPayments() {
      const { data, error } = await supabase.rpc("my_payroll_payments");
      if (error) throw error;
      return (data || []).map(mapPayment);
    },
    async myAdvances() {
      const { data, error } = await supabase.rpc("my_salary_advances");
      if (error) throw error;
      return (data || []).map(mapAdvance);
    },
    async recordPayment({ staffId, amount, method, month, date, note, allowances, deductions, advanceApplied, recordedBy }) {
      const { data, error } = await supabase.rpc("record_payroll_payment", {
        p_staff_id: staffId, p_amount: amount, p_method: method, p_month: month, p_date: date,
        p_note: note || null, p_allowances: allowances || 0, p_deductions: deductions || 0,
        p_advance_applied: advanceApplied || 0, p_recorded_by: recordedBy,
      });
      if (error) throw error;
      return mapPayment(data);
    },
    async recordAdvance({ staffId, amount, date, note, payrollMonth, recordedBy }) {
      const { data, error } = await supabase.rpc("record_salary_advance", {
        p_staff_id: staffId, p_amount: amount, p_date: date, p_note: note || null,
        p_payroll_month: payrollMonth || null, p_recorded_by: recordedBy,
      });
      if (error) throw error;
      return mapAdvance(data);
    },
  };
}
