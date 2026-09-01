// Real Supabase-backed students + enrollments + student_documents service (see classService.js /
// subjectService.js for the same pattern: DataContext.jsx owns the read-side state/refetch and
// wraps every write in an async api.* method that calls into this file, then refetches, then
// commit()s only the leftover mock-side-effects (activities, notifications, fee-obligation
// materialization -- those domains haven't converted yet).
//
// `parentIds` is joined in from `parent_students` for read compatibility with every existing
// consumer that reads `student.parentIds` -- now real (see parentService.js / DataContext.jsx's
// createParentAccount/connectChild/disconnectChild), populated as soon as a parent is linked.
//
// Photo/document files are stored as data-URI strings directly in the real `photo_url`/`file_url`
// text columns rather than Supabase Storage -- a deliberate simplification (both columns are plain
// `text`, nothing enforces an actual URL) to avoid standing up a storage bucket + path-scoped RLS
// policies in this pass. Fine for the current file sizes; worth revisiting if uploads grow large.
import { supabase } from "../lib/supabaseClient";

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
  if (fields.photo !== undefined) p.photo_url = fields.photo || null;
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
    fileDataUrl: row.file_url,
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
      return mapStudent(data, new Map());
    },
    async update(id, fields) {
      const payload = studentPayload(fields);
      const { data, error } = await supabase.from("students").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return mapStudent(data, new Map());
    },
    async remove(id) {
      // enrollments + student_documents cascade-delete in Postgres (both FK'd on delete cascade).
      const { error } = await supabase.from("students").delete().eq("id", id);
      if (error) throw error;
    },
    // Creates (or reuses) this student's enrollment row for `academicYearId`, updating its
    // grade/section/classId/status/suspension to match -- but only setting `enrollmentDate` at
    // creation time, never on an update, exactly mirroring the mock `_syncEnrollment`'s behavior
    // (so e.g. later editing a student's admissionDate doesn't retroactively rewrite an existing
    // enrollment's enrollmentDate). Plain upsert() can't express "set this column on insert only",
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
    async createDocument(studentId, { category, title, fileDataUrl, fileType, fileName }, academicYearId) {
      const payload = { student_id: studentId, category, title, file_url: fileDataUrl, file_type: fileType, file_name: fileName, academic_year_id: academicYearId || null };
      const { data, error } = await supabase.from("student_documents").insert(payload).select().single();
      if (error) throw error;
      return mapDocument(data);
    },
    async deleteDocument(id) {
      const { error } = await supabase.from("student_documents").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
