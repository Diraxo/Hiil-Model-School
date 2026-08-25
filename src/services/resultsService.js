// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createResultsService(data) {
  return {
    list: () => data.db.results,
    listForStudent: (studentId) => data.db.results.filter((r) => r.studentId === studentId),
    listForClassSubject: (classId, subject, semester, academicYearId) => data.resultsForClassSubject(classId, subject, semester, academicYearId),
    saveComponent: (payload, actorId, actorRole) => data.saveResultComponent(payload, actorId, actorRole),
    publish: (classId, subject, semester, studentIds, actorId, actorRole) => data.publishResults(classId, subject, semester, studentIds, actorId, actorRole),
    lock: (recordId, actorId, actorRole) => data.lockResult(recordId, actorId, actorRole),
    unlock: (recordId, actorId, actorRole, reason) => data.unlockResult(recordId, actorId, actorRole, reason),
    announceExam: (payload, authorId) => data.announceExam(payload, authorId),
  };
}
