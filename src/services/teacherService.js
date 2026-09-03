// Real Supabase-backed teacher accounts + teacher_assignments service (see classService.js /
// parentService.js for the same pattern). A "teacher" is a `profiles` row with role = 'TEACHER';
// creating the actual Supabase Auth account + profiles row happens through accountService.js (the
// manage-staff-account Edge Function) -- this file only ever reads `profiles` and reads/writes
// `teacher_assignments`. DataContext.jsx orchestrates create-account-then-assign as one
// user-facing action, same as it already does for Parents.
//
// teacher_assignments.subject_id is a real FK to subjects(id) (not a name string) -- DataContext.jsx
// resolves subjectId -> a subject NAME on top of the raw rows this returns (same bridging pattern
// classService.js uses for class_subjects), so every consumer that reads an assignment's
// `.subject` as a name keeps working unchanged.
//
// RLS note (see supabase/migrations/20260825190000_rls_policies.sql): teacher_assignments INSERT/
// UPDATE/DELETE is restricted to is_owner_or_admin() (Owner or Educational Director) -- Postgres
// itself rejects anything else, this file doesn't re-implement that check client-side. The table
// also enforces UNIQUE(class_id, subject_id) at the DB level, so a class+subject slot can never be
// double-assigned even if client-side conflict resolution is ever bypassed.
import { supabase } from "../lib/supabaseClient";
import { directoryContactsMap } from "./profileContacts";

function mapTeacher(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email || "",
    phone: row.phone || "",
    photo: row.photo_url || null,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    firstName: row.first_name || "",
    middleName: row.middle_name || "",
    lastName: row.last_name || "",
  };
}

function mapAssignment(row) {
  return { id: row.id, teacherId: row.teacher_id, subjectId: row.subject_id, classId: row.class_id };
}

export function createTeacherService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, photo_url, status, must_change_password, first_name, middle_name, last_name")
        .eq("role", "TEACHER")
        .order("full_name");
      if (error) throw error;
      const contacts = await directoryContactsMap();
      return (data || []).map((row) => mapTeacher({ ...row, ...contacts.get(row.id) }));
    },
    // name/phone/photo only -- email/role are school-controlled and never edited here (mirrors
    // AuthContext.updateOwnProfile's self-service scope). RLS's profiles_privilege_guard trigger
    // still applies: the caller must manage this teacher's staff group (Owner or Educational
    // Director), same as every other staff write.
    async updateProfile(id, patch) {
      const row = {};
      if (patch.name !== undefined) row.full_name = patch.name;
      if (patch.phone !== undefined) row.phone = patch.phone || null;
      if (patch.photo !== undefined) row.photo_url = patch.photo || null;
      const { error } = await supabase.from("profiles").update(row).eq("id", id);
      if (error) throw error;
    },
    async listAssignments() {
      const { data, error } = await supabase.from("teacher_assignments").select("*");
      if (error) throw error;
      return (data || []).map(mapAssignment);
    },
    async assign(teacherId, subjectId, classId) {
      const { error } = await supabase.from("teacher_assignments").insert({ teacher_id: teacherId, subject_id: subjectId, class_id: classId });
      if (error) throw error;
    },
    async unassignPair(classId, subjectId) {
      const { error } = await supabase.from("teacher_assignments").delete().eq("class_id", classId).eq("subject_id", subjectId);
      if (error) throw error;
    },
    async unassignAllForTeacher(teacherId) {
      const { error } = await supabase.from("teacher_assignments").delete().eq("teacher_id", teacherId);
      if (error) throw error;
    },
  };
}
