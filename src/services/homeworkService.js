// Phase 3 checkpoint 1 (Homework): real Supabase-backed homework service. Same pattern every
// earlier converted domain uses (see timetableService.js / studentService.js): this file only
// ever talks to the `homework` table; DataContext.jsx owns the read-side state + refetch, resolves
// the real `subject_id` to the mock app's subject-NAME convention on top of the rows this returns
// (its `homework` useMemo -- same bridge as classSubjects/teacherAssignments/timetableEntries), and
// wraps every write in an async api.* method that writes here, refetches, then commit()s only the
// leftover mock side-effects (activities + parent notifications -- those domains haven't converted).
//
// RLS is the real security boundary (see supabase/migrations/20260825190000_rls_policies.sql
// L721-747): insert/update require the assigning teacher themselves (teacher_id = auth.uid()) and
// teacher_academic_action_ok(current_date), or Owner/Educational Director; parents get read-only
// visibility of their own child's class. This service forwards writes and lets Postgres reject what
// it must; DataContext turns the error into a user-facing message.
//
// homework.attachment_url is left untouched here -- the app has never had a homework-attachment
// upload path (see components/DocumentViewer.jsx), so `attachment` is always null. Wiring real
// Storage uploads for it belongs with the result-evidence Storage work in checkpoint 3, not here.
import { supabase } from "../lib/supabaseClient";

function mapHomework(row) {
  return {
    id: row.id,
    subjectId: row.subject_id,
    grade: row.grade,
    section: row.section,
    classId: row.class_id,
    title: row.title,
    description: row.description || "",
    dueDate: row.due_date,
    teacherId: row.teacher_id,
    // Snapshot of the assigning teacher's name -- only used for display once teacher_id goes null
    // (the teacher account was deleted). While teacher_id resolves, callers read the live name.
    teacherName: row.teacher_name || null,
    attachment: row.attachment_url || null,
    academicYearId: row.academic_year_id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createHomeworkService() {
  return {
    async list() {
      const { data, error } = await supabase.from("homework").select("*").order("created_at");
      if (error) throw error;
      return (data || []).map(mapHomework);
    },
    async create({ subjectId, grade, section, classId, title, description, dueDate, teacherId, teacherName, academicYearId }) {
      const payload = {
        subject_id: subjectId,
        grade,
        section: section || "",
        class_id: classId,
        title,
        description: description || null,
        due_date: dueDate,
        teacher_id: teacherId,
        teacher_name: teacherName || null,
        academic_year_id: academicYearId || null,
      };
      const { data, error } = await supabase.from("homework").insert(payload).select().single();
      if (error) throw error;
      return mapHomework(data);
    },
    async update(id, patch) {
      const payload = {};
      if (patch.subjectId !== undefined) payload.subject_id = patch.subjectId;
      if (patch.grade !== undefined) payload.grade = patch.grade;
      if (patch.section !== undefined) payload.section = patch.section || "";
      if (patch.classId !== undefined) payload.class_id = patch.classId;
      if (patch.title !== undefined) payload.title = patch.title;
      if (patch.description !== undefined) payload.description = patch.description || null;
      if (patch.dueDate !== undefined) payload.due_date = patch.dueDate;
      const { data, error } = await supabase.from("homework").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return mapHomework(data);
    },
    async remove(id) {
      const { error } = await supabase.from("homework").delete().eq("id", id);
      if (error) throw error;
    },
    // Re-tags every homework row for a class after its grade/section is renamed (the columns are
    // denormalized onto homework, same as students) -- Owner/Educational Director only, no calendar
    // gate (RLS's homework_update owner/admin branch). Mirrors the mock updateClass cascade.
    async retagClass(classId, grade, section) {
      const { error } = await supabase
        .from("homework")
        .update({ grade, section: section || "" })
        .eq("class_id", classId);
      if (error) throw error;
    },
  };
}
