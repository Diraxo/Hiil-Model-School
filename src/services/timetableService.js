// Real Supabase-backed timetable service: timetable_entries, timetable_config (singleton),
// substitutions. Period-level journal/attendance (period_logs) is converted in Phase 2 checkpoint
// 2 alongside student attendance and lives here too once it lands.
//
// Bridging: timetable_entries stores subject_id (real FK) + teacher_id (real profiles FK).
// DataContext resolves subject_id -> subject NAME on top of this (its `timetableEntries` useMemo),
// same pattern classService/subjectService already established, so every still-mock consumer that
// reads `entry.subject` keeps working unchanged. teacher_id is a profiles id, which is exactly the
// `user.id` the rest of the app compares against (cls.headTeacherId, auth.currentUser.id, ...).
//
// RLS is the real boundary: timetable_entries / timetable_config write = is_owner_or_admin();
// substitutions write = is_owner_or_admin(). This service forwards writes and lets Postgres reject
// what it must; DataContext turns the error into a user-facing message.
import { supabase } from "../lib/supabaseClient";

function mapEntry(row) {
  return {
    id: row.id,
    classId: row.class_id,
    day: row.day,
    period: row.period,
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

function mapConfig(row) {
  if (!row) return null;
  return {
    periodsCount: row.periods_count,
    startTime: (row.start_time || "08:00").slice(0, 5),
    periodDurationMins: row.period_duration_mins,
    breakDurationMins: row.break_duration_mins,
    breakAfterPeriod: row.break_after_period ?? null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    updatedBy: row.updated_by ?? null,
  };
}

function mapSubstitution(row) {
  return {
    id: row.id,
    timetableEntryId: row.timetable_entry_id,
    date: row.date,
    originalTeacherId: row.original_teacher_id,
    substituteTeacherId: row.substitute_teacher_id,
    assignedBy: row.assigned_by ?? null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createTimetableService() {
  return {
    async listEntries() {
      const { data, error } = await supabase.from("timetable_entries").select("*");
      if (error) throw error;
      return (data || []).map(mapEntry);
    },
    async getConfig() {
      const { data, error } = await supabase.from("timetable_config").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return mapConfig(data);
    },
    async listSubstitutions() {
      const { data, error } = await supabase.from("substitutions").select("*");
      if (error) throw error;
      return (data || []).map(mapSubstitution);
    },

    async createEntry({ classId, day, period, subjectId, teacherId }) {
      const row = { class_id: classId, day, period, subject_id: subjectId, teacher_id: teacherId };
      const { data, error } = await supabase.from("timetable_entries").insert(row).select().single();
      if (error) throw error;
      return mapEntry(data);
    },
    async deleteEntry(id) {
      const { error } = await supabase.from("timetable_entries").delete().eq("id", id);
      if (error) throw error;
    },
    // Every entry a teacher owns — used before deleting the teacher's profile, since
    // timetable_entries.teacher_id is ON DELETE RESTRICT (a profile delete would otherwise fail).
    async deleteEntriesByTeacher(teacherId) {
      const { error } = await supabase.from("timetable_entries").delete().eq("teacher_id", teacherId);
      if (error) throw error;
    },

    async updateConfig(patch, actorId) {
      const row = { updated_by: actorId ?? null };
      if (patch.periodsCount !== undefined) row.periods_count = Number(patch.periodsCount);
      if (patch.startTime !== undefined) row.start_time = patch.startTime;
      if (patch.periodDurationMins !== undefined) row.period_duration_mins = Number(patch.periodDurationMins);
      if (patch.breakDurationMins !== undefined) row.break_duration_mins = Number(patch.breakDurationMins);
      if (patch.breakAfterPeriod !== undefined) row.break_after_period = patch.breakAfterPeriod == null ? null : Number(patch.breakAfterPeriod);
      const { data, error } = await supabase.from("timetable_config").update(row).eq("id", true).select().single();
      if (error) throw error;
      return mapConfig(data);
    },

    // Upserts on the table's own unique(timetable_entry_id, date) constraint — one assignment per
    // period per day, mirroring assignSubstitute's own "existing ? update : insert" logic.
    async upsertSubstitution({ timetableEntryId, date, originalTeacherId, substituteTeacherId, assignedBy }) {
      const row = {
        timetable_entry_id: timetableEntryId, date,
        original_teacher_id: originalTeacherId, substitute_teacher_id: substituteTeacherId,
        assigned_by: assignedBy ?? null,
      };
      const { data, error } = await supabase
        .from("substitutions")
        .upsert(row, { onConflict: "timetable_entry_id,date" })
        .select()
        .single();
      if (error) throw error;
      return mapSubstitution(data);
    },
    async deleteSubstitution(timetableEntryId, date) {
      const { error } = await supabase
        .from("substitutions")
        .delete()
        .eq("timetable_entry_id", timetableEntryId)
        .eq("date", date);
      if (error) throw error;
    },
  };
}
