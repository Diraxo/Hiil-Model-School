// Supabase-backed results service. Same pattern as every other domain (see homeworkService.js /
// timetableService.js): this file only ever talks to the `results`, `result_components` and
// `result_audit_log` tables; DataContext.jsx owns the read-side state + refetch, resolves the real
// `subject_id` to a subject NAME on top of the rows this returns, rebuilds the record's
// `components` object (one key per assessment component) from the flat `componentRows` here, and
// wraps every write in an async api.* method that writes through here, refetches, then fans out
// the activity line (log_activity RPC) and, on publish, the batched parent notification
// (notify_results_published).
//
// RLS is the real security boundary (supabase/migrations/20260825190000_rls_policies.sql
// L749-820):
//   - results_select / result_components_select: can_view_result() -- Owner/Director, the
//     assigned subject teacher, or a parent of the student. Finance: zero access.
//   - results_insert: DRAFT only, by Owner/Director or the assigned teacher (the latter also
//     gated by teacher_academic_action_ok(current_date)).
//   - results_update (publish_status / lock / auto_lock_override): Owner/Director ONLY -- a
//     teacher never flips this column.
//   - result_components_insert/update: can_edit_result_component() -- blocked outright once the
//     result is LOCKED, otherwise Owner/Director or the assigned teacher (teacher also gated by
//     teacher_academic_action_ok).
//   - result_audit_log_insert: same gate as editing the component; actor_id/actor_role/
//     actor_name are overwritten by a BEFORE INSERT trigger from auth.uid(), so the client value
//     is advisory only and an entry can't be forged under another name.
// This service forwards writes and lets Postgres reject what it must; DataContext turns the error
// into a user-facing message. Calendar-derived semester auto-locking (academicCalendar.js) stays
// a client-side gate for a friendly message -- RLS has no calendar concept, same as homework.
//
// result_evidence is NOT touched here -- CP3 gave it its own resultEvidenceService.js (real
// private Storage + signed URLs). This service still owns result_audit_log, so evidence
// upload/replace/remove audit rows are appended via resultService.addAudit from DataContext.
import { supabase } from "../lib/supabaseClient";

const ts = (v) => (v ? new Date(v).getTime() : null);

function mapComponent(row) {
  return {
    component: row.component,
    score: row.score == null ? null : Number(row.score),
    max: Number(row.max),
    sharedWithParents: !!row.shared_with_parents,
    updatedAt: ts(row.updated_at),
    updatedBy: row.updated_by || null,
  };
}

function mapResult(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    semester: row.semester,
    academicYearId: row.academic_year_id,
    publishStatus: row.publish_status,
    publishedAt: ts(row.published_at),
    publishedBy: row.published_by || null,
    lockedAt: ts(row.locked_at),
    lockedBy: row.locked_by || null,
    autoLockOverride: row.auto_lock_override || null,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
    componentRows: (row.result_components || []).map(mapComponent),
  };
}

function mapAudit(row) {
  return {
    id: row.id,
    entityId: row.result_id,
    studentId: row.student_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    semester: row.semester,
    component: row.component || null,
    action: row.action,
    actorId: row.actor_id || null,
    actorRole: row.actor_role || null,
    actorName: row.actor_name || null,
    diff: Array.isArray(row.diff) ? row.diff : [],
    reason: row.reason || null,
    at: ts(row.at),
  };
}

export function createResultService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("results")
        .select("*, result_components(*)")
        .order("created_at");
      if (error) throw error;
      return (data || []).map(mapResult);
    },

    async listAudit() {
      const { data, error } = await supabase
        .from("result_audit_log")
        .select("*")
        .order("at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapAudit);
    },

    // Resolves an existing {student, subject, semester, year} result to its id, creating a fresh
    // DRAFT row if none exists yet (mirrors DataContext's old findOrCreateResultRecord). Callers
    // must have already passed the effectiveResultLock gate -- this does not check locking.
    async ensureRecord({ studentId, classId, subjectId, semester, academicYearId }) {
      const { data: existing, error: selErr } = await supabase
        .from("results")
        .select("id")
        .eq("student_id", studentId)
        .eq("subject_id", subjectId)
        .eq("semester", semester)
        .eq("academic_year_id", academicYearId)
        .maybeSingle();
      if (selErr) throw selErr;
      if (existing) return { id: existing.id, created: false };

      const { data, error } = await supabase
        .from("results")
        .insert({
          student_id: studentId,
          class_id: classId,
          subject_id: subjectId,
          semester,
          academic_year_id: academicYearId,
          publish_status: "DRAFT",
        })
        .select("id")
        .single();
      if (error) {
        // Lost a race with a concurrent create -- fall back to the now-existing row.
        if (error.code === "23505") {
          const { data: row, error: reErr } = await supabase
            .from("results")
            .select("id")
            .eq("student_id", studentId)
            .eq("subject_id", subjectId)
            .eq("semester", semester)
            .eq("academic_year_id", academicYearId)
            .single();
          if (reErr) throw reErr;
          return { id: row.id, created: false };
        }
        throw error;
      }
      return { id: data.id, created: true };
    },

    // Upserts one assessment component's full desired state (score + max + share flag) on the
    // table's own unique(result_id, component) constraint -- the caller computes the next state
    // from the previous one, so a share-only toggle still passes the current score through.
    async saveComponent({ resultId, component, score, max, sharedWithParents, updatedBy }) {
      const { data, error } = await supabase
        .from("result_components")
        .upsert(
          {
            result_id: resultId,
            component,
            score: score == null ? null : score,
            max,
            shared_with_parents: !!sharedWithParents,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy || null,
          },
          { onConflict: "result_id,component" },
        )
        .select()
        .single();
      if (error) throw error;
      return mapComponent(data);
    },

    // Publish only the rows still in DRAFT (a re-publish of an already-PUBLISHED student is a
    // no-op), returning the rows actually flipped so the caller can audit + notify exactly them.
    async publish(resultIds, publishedBy) {
      if (!resultIds || resultIds.length === 0) return [];
      const { data, error } = await supabase
        .from("results")
        .update({ publish_status: "PUBLISHED", published_at: new Date().toISOString(), published_by: publishedBy || null })
        .in("id", resultIds)
        .eq("publish_status", "DRAFT")
        .select("id, student_id, class_id, subject_id, semester");
      if (error) throw error;
      return data || [];
    },

    async lock(resultId, lockedBy) {
      const { error } = await supabase
        .from("results")
        .update({ publish_status: "LOCKED", locked_at: new Date().toISOString(), locked_by: lockedBy || null, auto_lock_override: null })
        .eq("id", resultId);
      if (error) throw error;
    },

    // toStatus is "PUBLISHED" if the result had been published before the manual lock, else "DRAFT".
    async unlock(resultId, toStatus) {
      const { error } = await supabase
        .from("results")
        .update({ publish_status: toStatus, locked_at: null, locked_by: null })
        .eq("id", resultId);
      if (error) throw error;
    },

    // override is either the {reason, grantedBy, grantedByRole, grantedAt} object or null (re-lock).
    async setAutoLockOverride(resultId, override) {
      const { error } = await supabase
        .from("results")
        .update({ auto_lock_override: override })
        .eq("id", resultId);
      if (error) throw error;
    },

    async addAudit({ resultId, studentId, classId, subjectId, semester, component, action, diff, reason }) {
      const { error } = await supabase.from("result_audit_log").insert({
        result_id: resultId,
        student_id: studentId,
        class_id: classId || null,
        subject_id: subjectId || null,
        semester,
        component: component || null,
        action,
        diff: diff || [],
        reason: reason || null,
      });
      if (error) throw error;
    },
  };
}
