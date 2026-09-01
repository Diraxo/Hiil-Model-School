// Phase 4 (Fees / Payments / Expenses): real Supabase-backed payment service.
//
// Owns payments / payment_allocations / payment_methods / payment_audit_log. Every money-
// moving write goes through a hardened SECURITY DEFINER RPC -- the client never inserts a
// payments or payment_allocations row directly (there is no RLS INSERT policy for them):
//   record_payment_batch(lines, method, date, note, recorded_by)  -- one receipt, N allocations,
//                                                                    Decision B overpayment cap,
//                                                                    row-locked per obligation.
//   void_payment(payment_id, reason, actor_id, actor_role, actor_name) -- whole-receipt void.
//
// DataContext.jsx shadows list()/listAllocations()/listPaymentMethods() into the mock `db`
// shape so describeAllocation / paymentsForStudents / paymentMethodName / the family payment
// history all keep working unchanged.
//
// RLS (20260825190000_rls_policies.sql L1201-1269, L1317+):
//   payments / payment_allocations : SELECT Owner/Finance, or a linked parent for a receipt that
//     funds one of their own children (per-line filtered). No client INSERT/UPDATE/DELETE.
//   payment_methods : SELECT any ACTIVE member; INSERT/UPDATE Owner/Finance.
//   payment_audit_log : SELECT Owner/Finance.
//   record_payment_batch / void_payment : EXECUTE authenticated, re-checked Owner/Finance inside.
import { supabase } from "../lib/supabaseClient";

const ts = (v) => (v ? new Date(v).getTime() : null);
const num = (v) => (v == null ? null : Number(v));

function mapPayment(r) {
  return {
    id: r.id,
    receiptNo: r.receipt_no,
    paymentMethodId: r.payment_method_id,
    amountTotal: num(r.amount_total) || 0,
    date: r.date,
    note: r.note || "",
    recordedBy: r.recorded_by || null,
    status: r.status,
    voidedAt: ts(r.voided_at),
    voidedBy: r.voided_by || null,
    voidReason: r.void_reason || null,
    createdAt: ts(r.created_at),
  };
}

function mapAllocation(r) {
  return {
    id: r.id,
    paymentId: r.payment_id,
    obligationId: r.obligation_id,
    amount: num(r.amount) || 0,
    createdAt: ts(r.created_at),
  };
}

function mapMethod(r) {
  return { id: r.id, name: r.name, active: r.active !== false };
}

function mapAuditRow(r) {
  return {
    id: r.id,
    entityType: "payment",
    entityId: r.payment_id,
    studentIds: r.student_ids || [],
    action: r.action || "VOIDED",
    actorId: r.actor_id || null,
    actorRole: r.actor_role || null,
    actorName: r.actor_name || "Unknown",
    amount: num(r.amount),
    receiptNo: r.receipt_no || null,
    reason: r.reason || null,
    at: ts(r.at),
  };
}

export function createPaymentService() {
  return {
    async list() {
      const { data, error } = await supabase.from("payments").select("*").order("created_at");
      if (error) throw error;
      return (data || []).map(mapPayment);
    },
    async listAllocations() {
      const { data, error } = await supabase.from("payment_allocations").select("*");
      if (error) throw error;
      return (data || []).map(mapAllocation);
    },
    async listMethods() {
      const { data, error } = await supabase.from("payment_methods").select("*").order("name");
      if (error) throw error;
      return (data || []).map(mapMethod);
    },
    async listAuditLog() {
      const { data, error } = await supabase.from("payment_audit_log").select("*").order("at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapAuditRow);
    },

    // lines: [{ studentId, installmentId, amount, method, date, note }] -- method/date/note are
    // uniform across the batch (the modal collects them once). Returns the created payments row.
    async recordPaymentBatch(lines, recordedBy) {
      const first = lines[0] || {};
      const { data, error } = await supabase.rpc("record_payment_batch", {
        p_lines: lines.map((l) => ({
          student_id: l.studentId,
          installment_id: l.installmentId,
          amount: Number(l.amount) || 0,
        })),
        p_method_name: (first.method || "Cash").trim(),
        p_date: first.date,
        p_note: first.note || null,
        p_recorded_by: recordedBy,
      });
      if (error) throw error;
      const payment = mapPayment(Array.isArray(data) ? data[0] : data);
      // The RPC returns only the payments row; fetch its allocations so the caller can build the
      // printed receipt lines with the real (Decision-B-capped) applied amounts.
      const { data: allocs, error: allocErr } = await supabase
        .from("payment_allocations").select("*").eq("payment_id", payment.id);
      if (allocErr) throw allocErr;
      return { payment, allocations: (allocs || []).map(mapAllocation) };
    },

    async voidPayment(paymentId, reason, actorId, actorRole, actorName) {
      const { data, error } = await supabase.rpc("void_payment", {
        p_payment_id: paymentId,
        p_reason: reason,
        p_actor_id: actorId,
        p_actor_role: actorRole || null,
        p_actor_name: actorName || null,
      });
      if (error) throw error;
      return mapPayment(Array.isArray(data) ? data[0] : data);
    },

    /* ---------- payment_methods ---------- */
    async addMethod(name) {
      const trimmed = (name || "").trim();
      if (!trimmed) return null;
      const { data, error } = await supabase.from("payment_methods")
        .insert({ name: trimmed, active: true }).select().single();
      if (error) throw error;
      return mapMethod(data);
    },
    async updateMethod(id, name) {
      const { data, error } = await supabase.from("payment_methods")
        .update({ name: name.trim() }).eq("id", id).select().single();
      if (error) throw error;
      return mapMethod(data);
    },
    async setMethodActive(id, active) {
      const { error } = await supabase.from("payment_methods").update({ active }).eq("id", id);
      if (error) throw error;
    },
  };
}
