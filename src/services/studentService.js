// Supabase-backed students + enrollments + student_documents service (see classService.js /
// subjectService.js for the same pattern): DataContext.jsx owns the read-side state/refetch and
// wraps every write in an async api.* method that calls into this file, then refetches, then
// fans out the side effects -- activity lines via the log_activity RPC, parent notifications via
// notify_* RPCs, and fee-obligation materialization via materialize_obligations_for_student.
//
// `parentIds` is joined in from `parent_students` for read compatibility with every existing
// consumer that reads `student.parentIds` -- now real (see parentService.js / DataContext.jsx's
// createParentAccount/connectChild/disconnectChild), populated as soon as a parent is linked.
//
// Photo/document files live in private Supabase Storage: student photos in the `student-photos`
// bucket (path `<student_id>/<file>`), student documents in `student-documents` (same path shape).
// Postgres (`students.photo_url`, `student_documents.file_url`) stores ONLY the object path; the
// bytes are never base64'd into the column. Object RLS (20260827010000) mirrors the students /
// student_documents table policies. DataContext resolves the stored paths to short-lived signed
// URLs on read, so every consumer still reads a plain `student.photo` / `document.fileDataUrl`
// string. `student-documents` has no UPDATE policy by design — a replacement is delete-then-add.
import { supabase } from "../lib/supabaseClient";
import {
  isStoragePath, uploadObject, removeObjects, validateImageFile, validateDocFile, inferFileKind,
} from "../lib/storageMedia";

const PHOTO_BUCKET = "student-photos";
const DOC_BUCKET = "student-documents";

function mapStudent(row, parentIdsByStudent) {
  return {
    id: row.id,
    studentId: row.student_id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    gender: row.gender,
    dob: row.dob,
    grade: row.grade,
    section: row.section,
    classId: row.class_id,
    admissionDate: row.admission_date,
    photo: row.photo_url,
    status: row.status,
    suspension: row.suspension,
    emergencyContact: row.emergency_contact,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactRelationship: row.emergency_contact_relationship,
    usesBus: row.uses_bus,
    parentIds: (parentIdsByStudent && parentIdsByStudent.get(row.id)) || [],
  };
}

function studentPayload(fields) {
  const p = {};
  if (fields.firstName !== undefined) p.first_name = fields.firstName;
  if (fields.middleName !== undefined) p.middle_name = fields.middleName || null;
  if (fields.lastName !== undefined) p.last_name = fields.lastName;
  if (fields.gender !== undefined) p.gender = fields.gender || null;
  if (fields.dob !== undefined) p.dob = fields.dob || null;
  if (fields.grade !== undefined) p.grade = fields.grade;
  if (fields.section !== undefined) p.section = fields.section || "";
  if (fields.classId !== undefined) p.class_id = fields.classId;
  if (fields.admissionDate !== undefined) p.admission_date = fields.admissionDate;
  // `photo` is handled separately (Storage upload) whenever it is a File / explicit null — see
  // create()/update() below. A plain string here is an already-stored path passed straight through.
  if (typeof fields.photo === "string" && isStoragePath(fields.photo)) {
    p.photo_url = fields.photo;
  }
  if (fields.status !== undefined) p.status = fields.status;
  if (fields.suspension !== undefined) p.suspension = fields.suspension;
  if (fields.emergencyContact !== undefined) p.emergency_contact = fields.emergencyContact || null;
  if (fields.emergencyContactName !== undefined) p.emergency_contact_name = fields.emergencyContactName || null;
  if (fields.emergencyContactRelationship !== undefined) p.emergency_contact_relationship = fields.emergencyContactRelationship || null;
  if (fields.usesBus !== undefined) p.uses_bus = !!fields.usesBus;
  return p;
}

function mapEnrollment(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    academicYearId: row.academic_year_id,
    grade: row.grade,
    section: row.section,
    classId: row.class_id,
    status: row.status,
    suspension: row.suspension,
    enrollmentDate: row.enrollment_date,
  };
}

function mapDocument(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    category: row.category,
    title: row.title,
    // Stored value is a `student-documents` object path (or a legacy data URI on un-migrated
    // rows). DataContext swaps in a signed URL before this reaches a component.
    fileDataUrl: row.file_url,
    storagePath: isStoragePath(row.file_url) ? row.file_url : null,
    fileType: row.file_type,
    fileName: row.file_name,
    academicYearId: row.academic_year_id,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).getTime() : null,
  };
}

export function createStudentService() {
  return {
    async list() {
      const [{ data: rows, error }, { data: links, error: linkErr }] = await Promise.all([
        supabase.from("students").select("*").order("created_at"),
        supabase.from("parent_students").select("parent_id, student_id"),
      ]);
      if (error) throw error;
      if (linkErr) throw linkErr;
      const parentIdsByStudent = new Map();
      (links || []).forEach((l) => {
        if (!parentIdsByStudent.has(l.student_id)) parentIdsByStudent.set(l.student_id, []);
        parentIdsByStudent.get(l.student_id).push(l.parent_id);
      });
      return (rows || []).map((r) => mapStudent(r, parentIdsByStudent));
    },
    async listEnrollments() {
      const { data, error } = await supabase.from("enrollments").select("*");
      if (error) throw error;
      return (data || []).map(mapEnrollment);
    },
    async listDocuments() {
      const { data, error } = await supabase.from("student_documents").select("*").order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDocument);
    },
    async generateStudentId() {
      const { data, error } = await supabase.rpc("generate_student_id");
      if (error) throw error;
      return data;
    },
    async create(fields) {
      const studentId = await this.generateStudentId();
      const payload = { ...studentPayload(fields), student_id: studentId, status: fields.status || "ACTIVE" };
      const { data, error } = await supabase.from("students").insert(payload).select().single();
      if (error) throw error;
      let student = mapStudent(data, new Map());
      // Photo upload needs the student id (bucket RLS keys on it), so it happens after insert.
      if (fields.photo instanceof File) {
        const invalid = validateImageFile(fields.photo);
        if (invalid) throw new Error(invalid);
        const path = await uploadObject(PHOTO_BUCKET, student.id, fields.photo);
        const { data: withPhoto, error: upErr } = await supabase
          .from("students").update({ photo_url: path }).eq("id", student.id).select().single();
        if (upErr) { await removeObjects(PHOTO_BUCKET, path); throw upErr; }
        student = mapStudent(withPhoto, new Map());
      }
      return student;
    },
    async update(id, fields) {
      let photoPathToSet;
      if (fields.photo instanceof File || fields.photo === null) {
        const { data: cur } = await supabase.from("students").select("photo_url").eq("id", id).single();
        const previous = cur?.photo_url || null;
        if (fields.photo instanceof File) {
          const invalid = validateImageFile(fields.photo);
          if (invalid) throw new Error(invalid);
          const path = await uploadObject(PHOTO_BUCKET, id, fields.photo);
          photoPathToSet = path;
          if (isStoragePath(previous) && previous !== path) await removeObjects(PHOTO_BUCKET, previous);
        } else {
          photoPathToSet = null;
          if (isStoragePath(previous)) await removeObjects(PHOTO_BUCKET, previous);
        }
      }
      const payload = studentPayload(fields);
      if (photoPathToSet !== undefined) payload.photo_url = photoPathToSet;
      const { data, error } = await supabase.from("students").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return mapStudent(data, new Map());
    },
    async remove(id) {
      // enrollments + student_documents cascade-delete in Postgres (both FK'd on delete cascade);
      // the Storage objects do not, so DataContext best-effort removes the student's photo +
      // document objects around this call.
      const { error } = await supabase.from("students").delete().eq("id", id);
      if (error) throw error;
    },
    // Best-effort object cleanup for a hard-deleted student (photo + all documents).
    async removeStorageObjects({ photoPaths = [], documentPaths = [] }) {
      await removeObjects(PHOTO_BUCKET, photoPaths);
      await removeObjects(DOC_BUCKET, documentPaths);
    },
    // Creates (or reuses) this student's enrollment row for `academicYearId`, updating its
    // grade/section/classId/status/suspension to match -- but only setting `enrollmentDate` at
    // creation time, never on an update (so e.g. later editing a student's admissionDate doesn't
    // retroactively rewrite an existing enrollment's enrollmentDate). Plain upsert() can't
    // express "set this column on insert only",
    // hence the manual select-then-branch below.
    async syncEnrollment({ studentId, academicYearId, grade, section, classId, status, suspension, enrollmentDateForNew }) {
      if (!academicYearId) return null;
      const { data: existing, error: selErr } = await supabase
        .from("enrollments").select("id").eq("student_id", studentId).eq("academic_year_id", academicYearId).maybeSingle();
      if (selErr) throw selErr;
      const payload = { grade, section: section || "", class_id: classId, status, suspension: suspension || null };
      if (existing) {
        const { data, error } = await supabase.from("enrollments").update(payload).eq("id", existing.id).select().single();
        if (error) throw error;
        return mapEnrollment(data);
      }
      const { data, error } = await supabase.from("enrollments").insert({
        student_id: studentId, academic_year_id: academicYearId, enrollment_date: enrollmentDateForNew, ...payload,
      }).select().single();
      if (error) throw error;
      return mapEnrollment(data);
    },
    // `file` is the raw File from the picker. Bytes -> `student-documents/<student_id>/...`, then
    // one metadata row holding the object path. A metadata-insert failure removes the just-
    // uploaded object so a failed upload leaves nothing behind.
    async createDocument(studentId, { category, title, file }, academicYearId) {
      const invalid = validateDocFile(file);
      if (invalid) throw new Error(invalid);
      const path = await uploadObject(DOC_BUCKET, studentId, file);
      const payload = {
        student_id: studentId, category, title,
        file_url: path, file_type: inferFileKind(file), file_name: file.name || "document",
        academic_year_id: academicYearId || null,
      };
      const { data, error } = await supabase.from("student_documents").insert(payload).select().single();
      if (error) { await removeObjects(DOC_BUCKET, path); throw error; }
      return mapDocument(data);
    },
    async deleteDocument(id) {
      const { data: row } = await supabase.from("student_documents").select("file_url").eq("id", id).single();
      const { error } = await supabase.from("student_documents").delete().eq("id", id);
      if (error) throw error;
      if (row?.file_url) await removeObjects(DOC_BUCKET, row.file_url);
    },
  };
}
