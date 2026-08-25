// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createTeacherService(data) {
  return {
    list: () => data.db.users.filter((u) => u.role === "TEACHER"),
    create: (payload) => data.createTeacher(payload),
    update: (id, payload) => data.updateTeacher(id, payload),
    assignClasses: (id, subjects, classIds, reassignments) => data.updateTeacherAssignments(id, subjects, classIds, reassignments),
    resetPassword: (id) => data.resetTeacherPassword(id),
    recordAbsence: (payload) => data.recordTeacherAbsence(payload),
    saveAttendance: (date, records, markedBy) => data.saveStaffAttendance(date, records, markedBy),
    delete: (id) => data.deleteTeacher(id),
  };
}
