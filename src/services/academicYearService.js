// Real Supabase-backed academic year service. Maps `academic_years` rows (snake_case Postgres
// columns) onto the camelCase shape the rest of the app already reads (gcLabel, yearStart,
// sem1Start, isCurrent, ...) so utils/academicCalendar.js and every existing consumer of
// `db.academicYears` keeps working unchanged.
import { supabase } from "../lib/supabaseClient";

function mapYear(row) {
  return {
    id: row.id,
    gcLabel: row.gc_label,
    ecLabel: row.ec_label,
    yearName: row.gc_label, // back-compat alias some older display code still reads
    yearStart: row.year_start,
    yearEnd: row.year_end,
    sem1Start: row.sem1_start,
    sem1End: row.sem1_end,
    breakDays: row.break_days,
    sem2Start: row.sem2_start,
    sem2End: row.sem2_end,
    resultFinalizationGraceDays: row.result_finalization_grace_days,
    isCurrent: row.is_current,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    updatedBy: row.updated_by,
  };
}

export function createAcademicYearService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("academic_years")
        .select("*")
        .order("year_start", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapYear);
    },

    async create(fields, updatedBy) {
      const payload = {
        gc_label: fields.gcLabel,
        ec_label: fields.ecLabel ?? null,
        year_start: fields.yearStart,
        year_end: fields.yearEnd,
        sem1_start: fields.sem1Start,
        sem1_end: fields.sem1End,
        break_days: fields.breakDays,
        sem2_start: fields.sem2Start,
        sem2_end: fields.sem2End,
        result_finalization_grace_days: fields.resultFinalizationGraceDays,
        updated_by: updatedBy ?? null,
      };
      const { data, error } = await supabase.from("academic_years").insert(payload).select().single();
      if (error) throw error;
      return mapYear(data);
    },

    async update(id, fields, updatedBy) {
      const payload = { updated_by: updatedBy ?? null };
      if (fields.gcLabel !== undefined) payload.gc_label = fields.gcLabel;
      if (fields.ecLabel !== undefined) payload.ec_label = fields.ecLabel ?? null;
      if (fields.yearStart !== undefined) payload.year_start = fields.yearStart;
      if (fields.yearEnd !== undefined) payload.year_end = fields.yearEnd;
      if (fields.sem1Start !== undefined) payload.sem1_start = fields.sem1Start;
      if (fields.sem1End !== undefined) payload.sem1_end = fields.sem1End;
      if (fields.breakDays !== undefined) payload.break_days = fields.breakDays;
      if (fields.sem2Start !== undefined) payload.sem2_start = fields.sem2Start;
      if (fields.sem2End !== undefined) payload.sem2_end = fields.sem2End;
      if (fields.resultFinalizationGraceDays !== undefined) payload.result_finalization_grace_days = fields.resultFinalizationGraceDays;
      const { data, error } = await supabase.from("academic_years").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return mapYear(data);
    },

    // Not a single atomic statement (no RPC for this yet) -- clear the existing current flag first,
    // then set the target. A failure between the two calls leaves zero rows flagged current, which
    // utils/academicCalendar.js `currentAcademicYear()` already tolerates (falls back to the
    // most-recently-started year), so this stays safe without needing a dedicated RPC.
    async setCurrent(id, updatedBy) {
      const { error: clearError } = await supabase
        .from("academic_years")
        .update({ is_current: false, updated_by: updatedBy ?? null })
        .eq("is_current", true);
      if (clearError) throw clearError;
      const { error: setError } = await supabase
        .from("academic_years")
        .update({ is_current: true, updated_by: updatedBy ?? null })
        .eq("id", id);
      if (setError) throw setError;
    },
  };
}
