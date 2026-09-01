// Real Supabase-backed school closures (school_closures). A closure overrides the timetable and
// attendance for that single date everywhere in the app (see utils/academicCalendar.js's
// classifyAttendanceDate and DataContext's classifyAttendanceDay / classifyStaffAttendanceDay).
//
// RLS is the real boundary: school_closures write = is_owner_or_admin(); every ACTIVE account can
// read. The table has UNIQUE(date), so a duplicate insert is rejected by Postgres — DataContext
// pre-checks for a friendlier message and this is the last-line guard.
import { supabase } from "../lib/supabaseClient";

function mapClosure(row) {
  return {
    id: row.id,
    date: row.date,
    reason: row.reason,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createClosureService() {
  return {
    async list() {
      const { data, error } = await supabase.from("school_closures").select("*").order("date");
      if (error) throw error;
      return (data || []).map(mapClosure);
    },
    async create({ date, reason }, createdBy) {
      const row = { date, reason: (reason || "").trim(), created_by: createdBy ?? null };
      const { data, error } = await supabase.from("school_closures").insert(row).select().single();
      if (error) throw error;
      return mapClosure(data);
    },
    async remove(id) {
      const { error } = await supabase.from("school_closures").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
