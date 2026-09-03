// Phase 5 (CP1): real Supabase-backed student attendance + per-period journal/attendance.
//
// Two tables live here:
//   * attendance         — daily, class-level student attendance (unique per student+date)
//   * period_logs         — per-timetable-period-per-day journal, optionally carrying a jsonb
//                           snapshot of that period's per-student attendance
//
// Bridging: rows come back in the mock app's camelCase shape so every still-mock consumer
// (dashboards, registers, parent views) keeps reading `a.studentId` / `log.attendance` unchanged.
//
// RLS is the real security boundary:
//   * attendance write  = is_owner_or_admin(), or a Teacher who heads the class AND is not
//                         themselves marked Absent/Sick/Permission that day (teacher_academic_action_ok)
//   * period_logs write = can_act_on_period(entry, date) — Owner always; ED's uncovered-period
//                         exception; the acting teacher (substitute if assigned, else the
//                         timetable's own teacher) gated by teacher_academic_action_ok
// This service forwards writes and lets Postgres reject what it must; DataContext turns the
// error into a user-facing message. Calendar/date gating (before school start, break, future
// dates, closures) is enforced client-side in DataContext via classifyAttendanceDate — the same
// rule the mock app always applied — and re-stated server-side by the attendance_date_guard
// trigger added in the CP1 migration.
import { supabase } from "../lib/supabaseClient";

function mapAttendance(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    date: row.date,
    status: row.status,
    note: row.note || "",
    markedBy: row.marked_by ?? null,
    markedAt: row.marked_at ? new Date(row.marked_at).getTime() : null,
    leaveRequestId: row.leave_request_id ?? null,
  };
}

function mapPeriodLog(row) {
  return {
    id: row.id,
    timetableEntryId: row.timetable_entry_id,
    date: row.date,
    status: row.status || "done",
    completedBy: row.completed_by ?? null,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    attendance: row.attendance ?? null,
    attendanceMarkedBy: row.attendance_marked_by ?? null,
    attendanceMarkedAt: row.attendance_marked_at ? new Date(row.attendance_marked_at).getTime() : null,
  };
}

export function createAttendanceService() {
  return {
    async list() {
      const { data, error } = await supabase.from("attendance").select("*");
      if (error) throw error;
      return (data || []).map(mapAttendance);
    },

    async listPeriodLogs() {
      const { data, error } = await supabase.from("period_logs").select("*");
      if (error) throw error;
      return (data || []).map(mapPeriodLog);
    },

    // One upsert per student, on the table's unique(student_id, date) constraint — the same
    // "existing ? update : insert" semantics _upsertAttendanceRecord always had, now atomic in PG.
    async upsertRecord({ studentId, classId, date, status, note, markedBy, leaveRequestId, resetParentNotified }) {
      const row = {
        student_id: studentId,
        class_id: classId,
        date,
        status,
        note: note || "",
        marked_by: markedBy ?? null,
        marked_at: new Date().toISOString(),
      };
      if (leaveRequestId !== undefined) row.leave_request_id = leaveRequestId ?? null;
      // Phase 6: a genuine status change re-arms the parent notification (notify_student_attendance
      // no-ops while attendance.parent_notified is true -- see migration 20260827000000).
      if (resetParentNotified) row.parent_notified = false;
      const { data, error } = await supabase
        .from("attendance")
        .upsert(row, { onConflict: "student_id,date" })
        .select()
        .single();
      if (error) throw error;
      return mapAttendance(data);
    },

    async markPeriodDone({ timetableEntryId, date, completedBy }) {
      const row = {
        timetable_entry_id: timetableEntryId,
        date,
        status: "done",
        completed_by: completedBy ?? null,
        completed_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("period_logs")
        .upsert(row, { onConflict: "timetable_entry_id,date" })
        .select()
        .single();
      if (error) throw error;
      return mapPeriodLog(data);
    },

    // Saving per-period attendance also marks the period done — a period with attendance recorded
    // is definitionally a period that happened, so the two never drift apart (same invariant the
    // mock savePeriodAttendance kept).
    async savePeriodAttendance({ timetableEntryId, date, records, markedBy }) {
      const nowIso = new Date().toISOString();
      const row = {
        timetable_entry_id: timetableEntryId,
        date,
        status: "done",
        completed_by: markedBy ?? null,
        completed_at: nowIso,
        attendance: records,
        attendance_marked_by: markedBy ?? null,
        attendance_marked_at: nowIso,
      };
      const { data, error } = await supabase
        .from("period_logs")
        .upsert(row, { onConflict: "timetable_entry_id,date" })
        .select()
        .single();
      if (error) throw error;
      return mapPeriodLog(data);
    },
  };
}
