// Real Supabase-backed academic year service. Maps `academic_years` rows (snake_case Postgres
// columns) onto the camelCase shape the rest of the app already reads (gcLabel, yearStart,
// sem1Start, isCurrent, ...) so utils/academicCalendar.js and every existing consumer of
// `db.academicYears` keeps working unchanged.
//
// The lifecycle (current / previous / upcoming) is the stored pair `isCurrent` + `closedAt`. The
// current year changes ONLY through the atomic, audited set_current_academic_year RPC. Everything that
// needs migration 20260929000000 (that RPC, re-enrollment, the audit trail) degrades gracefully when the
// database hasn't been updated yet: reads return [] and `setCurrent` falls back to the old two-step
// switch, so the app behaves exactly as before until the migration is applied.
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
    // undefined (not null) when the column doesn't exist yet: academicYearStatus() then infers the
    // status from the dates, as it always did.
    closedAt: row.closed_at === undefined ? undefined : row.closed_at,
    closedBy: row.closed_by || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    updatedBy: row.updated_by,
  };
}

function mapDecision(row) {
  return {
    id: row.id, studentId: row.student_id, academicYearId: row.academic_year_id,
    decision: row.decision, reason: row.reason || "", decidedBy: row.decided_by,
    decidedAt: row.decided_at ? new Date(row.decided_at).getTime() : null,
  };
}

function mapAudit(row) {
  return {
    id: row.id, academicYearId: row.academic_year_id, action: row.action, actorId: row.actor_id,
    actorName: row.actor_name || null, reason: row.reason || "", details: row.details || null,
    at: row.at ? new Date(row.at).getTime() : null,
  };
}

// PostgREST / Postgres errors that mean "that table / function isn't there" — i.e. the database has
// not had migration 20260929000000 applied yet.
export function isMissingDbObject(error) {
  const msg = String((error && (error.message || error.details)) || "");
  return !!error && (
    ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code)
    || /could not find the (function|table)|does not exist|schema cache/i.test(msg)
  );
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

    // Makes `id` the operational year — atomically, with an audit row, closing the outgoing year and syncing
    // the student roster to the incoming year's enrollments. `reason` is required to reopen a closed year;
    // `allowUndecided` lets a year be activated while some students still have no register / not-returning
    // decision (they are then recorded as not returning). Returns { ok, reopened, synced, archived, ... }.
    //
    // Before migration 20260929000000 the RPC doesn't exist: fall back to the previous two-step switch (clear
    // the flag, set the target). A failure between those two calls leaves zero rows flagged current, which
    // utils/academicCalendar.js `currentAcademicYear()` already tolerates.
    async setCurrent(id, { reason, allowUndecided = false, updatedBy } = {}) {
      const { data, error } = await supabase.rpc("set_current_academic_year", {
        p_year_id: id, p_reason: reason || null, p_allow_undecided: !!allowUndecided,
      });
      if (!error) return { ...(data || {}), legacy: false };
      if (!isMissingDbObject(error)) throw error;
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
      return { changed: true, legacy: true };
    },

    // "Not returning" decisions (student_year_decisions). [] until the migration is applied.
    async listDecisions() {
      const { data, error } = await supabase.from("student_year_decisions").select("*");
      if (error) { if (isMissingDbObject(error)) return []; throw error; }
      return (data || []).map(mapDecision);
    },

    // Registers an existing student for a year (creates that year's enrollment — never a second student) and
    // bills them from their joining month. Requires the migration.
    async registerStudent({ studentId, yearId, grade, section }) {
      const { error } = await supabase.rpc("register_student_for_year", {
        p_student_id: studentId, p_year_id: yearId, p_grade: grade, p_section: section || "",
      });
      if (error) throw error;
    },

    // Records that a student is not returning this year (no enrollment is created; nothing is deleted).
    async markNotReturning({ studentId, yearId, reason }) {
      const { error } = await supabase.rpc("mark_student_not_returning", {
        p_student_id: studentId, p_year_id: yearId, p_reason: reason || null,
      });
      if (error) throw error;
    },

    // Who taught what, as it stood when a year was closed ([] until the migration is applied).
    async listTeacherAssignmentSnapshots() {
      const { data, error } = await supabase.from("academic_year_teacher_assignments").select("*");
      if (error) { if (isMissingDbObject(error)) return []; throw error; }
      return (data || []).map((r) => ({ id: r.id, academicYearId: r.academic_year_id, teacherId: r.teacher_id, teacherName: r.teacher_name || "", subjectId: r.subject_id, classId: r.class_id }));
    },

    // Append-only lifecycle history (created / calendar changed / activated / reopened / historical
    // adjustments), newest first. [] until the migration is applied or for a role that can't read it.
    async listAudit(limit = 60) {
      const { data, error } = await supabase.from("academic_year_audit").select("*").order("at", { ascending: false }).limit(limit);
      if (error) { if (isMissingDbObject(error)) return []; throw error; }
      return (data || []).map(mapAudit);
    },
  };
}
