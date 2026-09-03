// Supabase-backed subject catalog service. Several read-side shapes in DataContext still expose a
// subject by NAME rather than id (homework.subject, teacherAssignments.subject,
// classSubjects.subject, results.subject, teacher.subject) -- see migration notes on
// `subjects.name unique`. The underlying rows (homework, results, class_subjects,
// teacher_assignments) all store the real subject_id and resolve the display name fresh from the
// subjects row, so a rename only needs a subjects refetch -- there is no cross-table cascade to
// run. DataContext.jsx calls this directly for the subjects table itself.
import { supabase } from "../lib/supabaseClient";

function mapSubject(row) {
  return { id: row.id, name: row.name };
}

export function createSubjectService() {
  return {
    async list() {
      const { data, error } = await supabase.from("subjects").select("*").order("name");
      if (error) throw error;
      return (data || []).map(mapSubject);
    },
    async create(name) {
      const { data, error } = await supabase.from("subjects").insert({ name }).select().single();
      if (error) throw error;
      return mapSubject(data);
    },
    async rename(id, name) {
      const { data, error } = await supabase.from("subjects").update({ name }).eq("id", id).select().single();
      if (error) throw error;
      return mapSubject(data);
    },
    async remove(id) {
      const { error } = await supabase.from("subjects").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
