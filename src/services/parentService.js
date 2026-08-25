// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createParentService(data) {
  return {
    list: () => data.db.users.filter((u) => u.role === "PARENT"),
    create: (payload) => data.createParentAccount(payload),
    connectChild: (parentId, studentIdCode) => data.connectChild(parentId, studentIdCode),
    ofClass: (classId) => data.parentsOfClass(classId),
    ofStudent: (studentId) => data.parentsOfStudent(studentId),
  };
}
