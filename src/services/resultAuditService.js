// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createResultAuditService(data) {
  return {
    listForResult: (resultId) => (data.db.resultAuditLog || []).filter((e) => e.entityId === resultId),
    listForStudent: (studentId) => (data.db.resultAuditLog || []).filter((e) => e.studentId === studentId),
  };
}
