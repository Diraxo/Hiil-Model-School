// Thin adapter over DataContext: reads come from the already-materialized `db.results`
// (populated from Supabase via resultService), writes delegate to DataContext's RPC-backed
// mutators. (See resultService.js for the actual Supabase queries.)
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
