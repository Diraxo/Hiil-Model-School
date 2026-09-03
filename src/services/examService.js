// Supabase-backed exam-announcement service. The school administers exams on paper -- there is no
// "exam" entity in the app; an exam announcement is purely the heads-up notice to parents/teachers
// that a paper exam is scheduled. Same pattern as every other domain: this file only ever talks to
// `exam_announcements`; DataContext.jsx owns the read-side state + refetch and wraps writes in an
// async api.* method that writes here, refetches, then fans out the parent + head-teacher
// notification via notify_exam_announcement and the activity line via log_activity.
//
// RLS (supabase/migrations/20260825190000_rls_policies.sql L868-897):
//   - exam_announcements_select: every staff role sees all; a parent sees ALL / GRADE / SECTION
//     announcements that match one of their own children (mirrors announcementMatchesStudent()).
//   - exam_announcements_insert / _delete: is_owner_or_admin() (Owner / Educational Director) --
//     the same boundary as AnnounceExamModal.
import { supabase } from "../lib/supabaseClient";

const ts = (v) => (v ? new Date(v).getTime() : null);

function mapAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message || "",
    audience: row.audience || { type: "ALL" },
    priority: row.priority || "Important",
    examDate: row.exam_date,
    authorId: row.author_id || null,
    createdAt: ts(row.created_at),
  };
}

export function createExamService() {
  return {
    async list() {
      const { data, error } = await supabase.from("exam_announcements").select("*").order("created_at");
      if (error) throw error;
      return (data || []).map(mapAnnouncement);
    },
    async create({ title, message, audience, priority, examDate, authorId }) {
      const { data, error } = await supabase
        .from("exam_announcements")
        .insert({
          title,
          message: message || null,
          audience,
          priority: priority || "Important",
          exam_date: examDate || null,
          author_id: authorId || null,
        })
        .select()
        .single();
      if (error) throw error;
      return mapAnnouncement(data);
    },
    async remove(id) {
      const { error } = await supabase.from("exam_announcements").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
