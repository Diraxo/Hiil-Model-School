// Real Supabase-backed parents + parent_students service (see studentService.js / classService.js
// for the same pattern). A "parent" is simply a `profiles` row with role = 'PARENT'; the
// parent<->student relationship lives entirely in `parent_students`, never in a mock array field.
//
// Creating the actual Supabase Auth account + profiles row happens through accountService.js (the
// manage-staff-account Edge Function) -- this file only ever touches `profiles` (read) and
// `parent_students` (read/write). DataContext.jsx orchestrates create-account-then-link as one
// user-facing action.
//
// RLS note (see supabase/migrations/20260825190000_rls_policies.sql): parent_students insert/
// update/delete is restricted to is_owner_or_admin() -- a parent can never link themselves to a
// student from the client, by design (see AuthPages.jsx's RegisterScreen comment). Every write
// here is expected to be called by an Owner/Educational Director session; Postgres itself rejects
// anything else, this file doesn't re-implement that check client-side.
import { supabase } from "../lib/supabaseClient";
import { directoryContactsMap } from "./profileContacts";

function mapParent(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email || "",
    phone: row.phone || "",
    photo: row.photo_url || null,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
  };
}

function mapLink(row) {
  return { id: row.id, parentId: row.parent_id, studentId: row.student_id, createdAt: row.created_at ? new Date(row.created_at).getTime() : null };
}

// Postgres unique_violation -- see parent_students_unique in the schema.
const UNIQUE_VIOLATION = "23505";

export function createParentService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, photo_url, status, must_change_password")
        .eq("role", "PARENT")
        .order("full_name");
      if (error) throw error;
      const contacts = await directoryContactsMap();
      return (data || []).map((row) => mapParent({ ...row, ...contacts.get(row.id) }));
    },
    async listLinks() {
      const { data, error } = await supabase.from("parent_students").select("*");
      if (error) throw error;
      return (data || []).map(mapLink);
    },
    async link(parentId, studentId) {
      const { data: parent, error: parentErr } = await supabase.from("profiles").select("id, role").eq("id", parentId).maybeSingle();
      if (parentErr) throw parentErr;
      if (!parent || parent.role !== "PARENT") throw new Error("Parent account not found.");
      const { data: student, error: studentErr } = await supabase.from("students").select("id").eq("id", studentId).maybeSingle();
      if (studentErr) throw studentErr;
      if (!student) throw new Error("Student not found.");
      const { error } = await supabase.from("parent_students").insert({ parent_id: parentId, student_id: studentId });
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new Error("This child is already connected to this parent account.");
        throw error;
      }
    },
    async unlink(parentId, studentId) {
      const { error } = await supabase.from("parent_students").delete().eq("parent_id", parentId).eq("student_id", studentId);
      if (error) throw error;
    },
  };
}
