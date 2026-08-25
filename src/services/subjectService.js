// Real Supabase-backed subject catalog service. Subjects are still referenced by NAME (not id)
// everywhere else in the still-mock DataContext (homework.subject, teacherAssignments.subject,
// classSubjects.subject, results.subject, teacher.subject) -- see migration notes on
// `subjects.name unique`. As long as the real rows carry the same names, every one of those
// still-mock string-keyed lookups keeps working unchanged. DataContext.jsx calls this directly
// for the subjects table itself, and still runs its own commit()-based cascade rename across
// those other (not-yet-converted) mock tables.
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
