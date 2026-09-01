// Real Supabase-backed classes + curriculum (class_subjects) service. Classes are still
// referenced by grade/section/headTeacherId exactly like the mock app; curriculum rows come back
// as {classId, subjectId} (the real class_subjects shape) -- DataContext.jsx resolves subjectId to
// a subject NAME on top of this (see its `classSubjects` useMemo) so every still-mock consumer
// that reads a subject by name (teacherAssignments, homework, results, ...) keeps working
// unchanged, same bridging pattern subjectService.js already established.
//
// `classes.head_teacher_id` is a real FK to `profiles(id)` -- but Teacher accounts aren't real
// Supabase Auth users yet (see project notes), so there is no valid profiles row to point it at.
// Rather than silently drop a head-teacher selection, create()/update() below just let Postgres's
// FK constraint reject it; DataContext.jsx turns that into a clear user-facing message instead of
// pretending the assignment succeeded.
import { supabase } from "../lib/supabaseClient";

function mapClass(row) {
  return { id: row.id, grade: row.grade, section: row.section, headTeacherId: row.head_teacher_id };
}

export function createClassService() {
  return {
    async list() {
      const { data, error } = await supabase.from("classes").select("*").order("grade").order("section");
      if (error) throw error;
      return (data || []).map(mapClass);
    },
    async listCurriculum() {
      const { data, error } = await supabase.from("class_subjects").select("*");
      if (error) throw error;
      return (data || []).map((row) => ({ id: row.id, classId: row.class_id, subjectId: row.subject_id }));
    },
    async create({ grade, section, headTeacherId }) {
      const payload = { grade, section: section || "", head_teacher_id: headTeacherId || null };
      const { data, error } = await supabase.from("classes").insert(payload).select().single();
      if (error) throw error;
      return mapClass(data);
    },
    async update(id, patch) {
      const payload = {};
      if (patch.grade !== undefined) payload.grade = patch.grade;
      if (patch.section !== undefined) payload.section = patch.section || "";
      if (patch.headTeacherId !== undefined) payload.head_teacher_id = patch.headTeacherId || null;
      const { data, error } = await supabase.from("classes").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return mapClass(data);
    },
    async remove(id) {
      const { error } = await supabase.from("classes").delete().eq("id", id);
      if (error) throw error;
    },
    async addCurriculumSubject(classId, subjectId) {
      const { error } = await supabase.from("class_subjects").insert({ class_id: classId, subject_id: subjectId });
      if (error) throw error;
    },
    async removeCurriculumSubject(classId, subjectId) {
      const { error } = await supabase.from("class_subjects").delete().eq("class_id", classId).eq("subject_id", subjectId);
      if (error) throw error;
    },
  };
}
