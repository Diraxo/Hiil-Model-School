// Supabase-backed leave / permission requests + the Owner leave log.
//
// leave_requests.subject_id is polymorphic (students.id when kind = 'STUDENT', staff.id when
// kind = 'STAFF') and deliberately has no FK — see the timetable_attendance_leave migration.
//
// Bridging: rows come back in the app's camelCase shape. Note the two field names that differ
// from the DB columns:
//   app `status`         -> db `reason`          (the leave TYPE: Sick / Permission / Excused)
//   app `approvalStatus` -> db `approval_status` (the DECISION: PENDING / APPROVED / REJECTED)
//
// RLS is the real boundary:
//   * select : the requester, or anyone who can_decide_leave(kind, subject)
//   * insert : requested_by must equal auth.uid() AND the caller must be entitled to request
//              leave for that subject (parent-of-child / self / administrative remit)
//   * decide : goes through the decide_leave_request() SECURITY DEFINER RPC only, which flips
//              the row AND transactionally auto-applies an APPROVED request to every eligible
//              school day's attendance (student) / staff_attendance (staff) — skipping weekends,
//              closures and out-of-semester dates — under one caller/role check.
import { supabase } from "../lib/supabaseClient";

function mapLeaveRequest(row) {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    requestedBy: row.requested_by,
    status: row.reason, // leave TYPE — app field name for db column `reason`
    fromDate: row.from_date,
    toDate: row.to_date,
    note: row.note || "",
    approvalStatus: row.approval_status,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ? new Date(row.decided_at).getTime() : null,
    rejectionReason: row.rejection_reason ?? null,
    completionNotified: !!row.completion_notified,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

function mapOwnerLeave(row) {
  return {
    id: row.id,
    status: row.status,
    fromDate: row.from_date,
    toDate: row.to_date,
    note: row.note || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createLeaveService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapLeaveRequest);
    },

    async listOwnerLeave() {
      const { data, error } = await supabase
        .from("owner_leave_log")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapOwnerLeave);
    },

    async create({ kind, subjectId, requestedBy, status, fromDate, toDate, note }) {
      const row = {
        kind,
        subject_id: subjectId,
        requested_by: requestedBy,
        reason: status,
        from_date: fromDate,
        to_date: toDate,
        note: note || null,
      };
      const { data, error } = await supabase.from("leave_requests").insert(row).select().single();
      if (error) throw error;
      return mapLeaveRequest(data);
    },

    // Transactional flip + auto-apply. Returns { ok, noop } — the caller refetches
    // leave_requests / attendance / staff_attendance and fans out notifications.
    async decide(id, approvalStatus, reason) {
      const { data, error } = await supabase.rpc("decide_leave_request", {
        p_id: id,
        p_status: approvalStatus,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return data || { ok: true };
    },

    // Marks an APPROVED request's completion notification as sent (idempotent housekeeping —
    // the UPDATE policy allows this once approval_status <> 'PENDING').
    async markCompletionNotified(ids) {
      if (!ids || ids.length === 0) return;
      const { error } = await supabase
        .from("leave_requests")
        .update({ completion_notified: true })
        .in("id", ids);
      if (error) throw error;
    },

    // Cleanup path when the subject (student / staff) is deleted — RLS delete policy is scoped to
    // whoever could have decided the request (can_decide_leave).
    async deleteForSubject(kind, subjectId) {
      const { error } = await supabase
        .from("leave_requests")
        .delete()
        .eq("kind", kind)
        .eq("subject_id", subjectId);
      if (error) throw error;
    },

    async logOwnerLeave({ status, fromDate, toDate, note }) {
      const row = { status, from_date: fromDate, to_date: toDate, note: note || null };
      const { data, error } = await supabase.from("owner_leave_log").insert(row).select().single();
      if (error) throw error;
      return mapOwnerLeave(data);
    },
  };
}
