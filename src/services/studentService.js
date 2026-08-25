// Phase 1: thin pass-through to the DataContext ("MockStudentService" in
// spirit). Components never call DataContext directly for student work -
// they call these functions. In Phase 2, replace the bodies below with
// Supabase queries/mutations (e.g. supabase.from("students")...) and every
// page that imports from here keeps working unchanged.
//
// Usage in a component:
//   const data = useData();
//   const studentService = createStudentService(data);
//   studentService.create({ ... });

export function createStudentService(data) {
  return {
    list: () => data.db.students,
    get: (id) => data.getStudent(id),
    fullName: (student) => data.studentFullName(student),
    generateStudentId: () => data.generateStudentId(),
    gradeOptions: () => data.gradeOptions(),
    create: (payload) => data.createStudent(payload),
    update: (id, payload) => data.updateStudent(id, payload),
    archive: (id, status) => data.archiveStudent(id, status),
    suspend: (id, payload) => data.suspendStudent(id, payload),
    delete: (id) => data.deleteStudent(id),
    promote: (id, payload) => data.promoteStudent(id, payload),
    listAcademicYears: () => data.db.academicYears,
    createAcademicYear: (fields, createdBy) => data.createAcademicYear(fields, createdBy),
    setCurrentAcademicYear: (id) => data.setCurrentAcademicYear(id),
    enrollmentsFor: (studentId) => data.enrollmentsForStudent(studentId),
    listDocuments: (studentId) => data.db.studentDocuments.filter((doc) => doc.studentId === studentId),
    createDocument: (studentId, payload, uploadedBy) => data.createStudentDocument(studentId, payload, uploadedBy),
    deleteDocument: (id) => data.deleteStudentDocument(id),
  };
}
