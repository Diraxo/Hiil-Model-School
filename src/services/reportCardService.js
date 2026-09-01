// Phase 3 checkpoint 4 (Report Cards): real Supabase-backed report-card service. Same pattern
// every earlier converted domain uses (see resultService.js / homeworkService.js): this file only
// ever talks to the `report_cards` table. DataContext.jsx owns the read-side state + refetch and
// wraps every write in an async api.* method that writes through here, refetches, then commit()s
// only the leftover mock side-effects (activities + the parent "report card published"
// notification -- notifications stay on the mock bridge per the locked Phase 2 decision, even
// though notify_report_card_published() already exists on the remote).
//
// The report card itself is DERIVED, not stored: every subject / component score / total shown on
// the printed card comes from the already-real `results` + `result_components` data (CP2) via
// DataContext's resultsEngine helpers. This table only tracks the per-student+class+year
// lifecycle row (status + promotion decision + who generated/published/locked it and when) --
// exactly the mock `db.reportCards` shape, so no consumer changes.
//
// RLS is the real security boundary (supabase/migrations/20260825190000_rls_policies.sql
// L903-917):
//   - report_cards_select: Owner/Educational Director, a teacher who teaches/heads the class, or
//     a parent of the student AND status in ('PUBLISHED','LOCKED'). Finance: zero access.
//   - report_cards_insert / report_cards_update: is_owner_or_admin() ONLY -- generate / set
//     promotion / publish / lock / reopen are all Owner + Educational Director actions.
// This service forwards writes and lets Postgres reject what it must; DataContext turns the error
// into a user-facing message and keeps the friendly business-rule gates (S2 readiness, promotion
// decision set before publish) client-side for a better message.
import { supabase } from "../lib/supabaseClient";

const ts = (v) => (v ? new Date(v).getTime() : null);

function mapReportCard(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    academicYearId: row.academic_year_id,
    status: row.status,
    generatedAt: ts(row.generated_at),
    generatedBy: row.generated_by || null,
    publishedAt: ts(row.published_at),
    publishedBy: row.published_by || null,
    lockedAt: ts(row.locked_at),
    lockedBy: row.locked_by || null,
    promoted: row.promoted == null ? null : !!row.promoted,
    promotionNote: row.promotion_note || "",
  };
}

export function createReportCardService() {
  return {
    async list() {
      const { data, error } = await supabase.from("report_cards").select("*").order("generated_at");
      if (error) throw error;
      return (data || []).map(mapReportCard);
    },

    // Resolves the {student, class, year} report card to a GENERATED row, creating it if none
    // exists yet (mirrors DataContext's old generateReportCard). Callers must have already passed
    // the S2-readiness gate. Idempotent: re-generating an existing DRAFT/GENERATED card just
    // re-stamps generated_at/by; a PUBLISHED/LOCKED card is left untouched (reopen first).
    async ensure({ studentId, classId, academicYearId, generatedBy }) {
      const { data: existing, error: selErr } = await supabase
        .from("report_cards")
        .select("*")
        .eq("student_id", studentId)
        .eq("class_id", classId)
        .eq("academic_year_id", academicYearId)
        .maybeSingle();
      if (selErr) throw selErr;

      if (existing) {
        if (existing.status === "PUBLISHED" || existing.status === "LOCKED") return mapReportCard(existing);
        const { data, error } = await supabase
          .from("report_cards")
          .update({ status: "GENERATED", generated_at: new Date().toISOString(), generated_by: generatedBy || null })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        return mapReportCard(data);
      }

      const { data, error } = await supabase
        .from("report_cards")
        .insert({
          student_id: studentId,
          class_id: classId,
          academic_year_id: academicYearId,
          status: "GENERATED",
          generated_at: new Date().toISOString(),
          generated_by: generatedBy || null,
        })
        .select()
        .single();
      if (error) {
        // Lost a race with a concurrent generate -- fall back to the now-existing row.
        if (error.code === "23505") {
          const { data: row, error: reErr } = await supabase
            .from("report_cards")
            .select("*")
            .eq("student_id", studentId)
            .eq("class_id", classId)
            .eq("academic_year_id", academicYearId)
            .single();
          if (reErr) throw reErr;
          return mapReportCard(row);
        }
        throw error;
      }
      return mapReportCard(data);
    },

    async setPromotion(id, promoted, note) {
      const { data, error } = await supabase
        .from("report_cards")
        .update({ promoted, promotion_note: note || "" })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapReportCard(data);
    },

    // Publishes only if still un-published (a rapid double-click on an already-PUBLISHED/LOCKED
    // card is a safe no-op) -- returns the row only when this call actually flipped it, so the
    // caller sends the parent notification exactly once.
    async publish(id, publishedBy) {
      const { data, error } = await supabase
        .from("report_cards")
        .update({ status: "PUBLISHED", published_at: new Date().toISOString(), published_by: publishedBy || null })
        .eq("id", id)
        .neq("status", "PUBLISHED")
        .neq("status", "LOCKED")
        .select()
        .maybeSingle();
      if (error) throw error;
      return data ? mapReportCard(data) : null;
    },

    async lock(id, lockedBy) {
      const { data, error } = await supabase
        .from("report_cards")
        .update({ status: "LOCKED", locked_at: new Date().toISOString(), locked_by: lockedBy || null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapReportCard(data);
    },

    async reopen(id) {
      const { data, error } = await supabase
        .from("report_cards")
        .update({ status: "GENERATED", locked_at: null, locked_by: null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapReportCard(data);
    },
  };
}
