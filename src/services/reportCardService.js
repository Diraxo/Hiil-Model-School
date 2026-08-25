// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createReportCardService(data) {
  return {
    readiness: (studentId, classId, academicYearId) => data.computeReportReadiness(studentId, classId, academicYearId),
    get: (studentId, classId, academicYearId) => data.getReportCard(studentId, classId, academicYearId),
    isLocked: (studentId, classId, academicYearId) => data.isReportLocked(studentId, classId, academicYearId),
    generate: (studentId, classId, generatedBy, academicYearId) => data.generateReportCard(studentId, classId, generatedBy, academicYearId),
    setPromotion: (id, promoted, note, actorId) => data.setReportCardPromotion(id, promoted, note, actorId),
    publish: (id, publishedBy) => data.publishReportCard(id, publishedBy),
    lock: (id, lockedBy) => data.lockReportCard(id, lockedBy),
    reopen: (id, actorId) => data.reopenReportCard(id, actorId),
  };
}
