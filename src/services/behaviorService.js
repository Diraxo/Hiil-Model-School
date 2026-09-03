// Supabase-backed student behavior / discipline records (behavior_records).
//
// Bridging: rows come back in the app's camelCase shape (`staff` <-> db `staff_name`,
// `parentNotified` <-> db `parent_notified`).
//
// RLS is the real boundary:
//   * select : Owner/ED always; a Teacher for a student in a class they teach or head; a Parent
//              for their own child. Finance has no access.
//   * insert/update/delete : Owner + Educational Director only (canAddBehavior) — a Teacher can
//              view but never add or edit.
import { supabase } from "../lib/supabaseClient";

function mapRecord(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    date: row.date,
    type: row.type,
    severity: row.severity,
    description: row.description || "",
    staff: row.staff_name || "",
    action: row.action || "",
    parentNotified: !!row.parent_notified,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createBehaviorService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("behavior_records")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapRecord);
    },

    async create({ studentId, date, type, severity, description, action, staff, parentNotified }) {
      const row = {
        student_id: studentId,
        date,
        type,
        severity,
        description: description || null,
        action: action || null,
        staff_name: staff || null,
        parent_notified: !!parentNotified,
      };
      const { data, error } = await supabase.from("behavior_records").insert(row).select().single();
      if (error) throw error;
      return mapRecord(data);
    },
  };
}
