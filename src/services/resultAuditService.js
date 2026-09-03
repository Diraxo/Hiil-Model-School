// Thin read adapter over DataContext's already-materialized `db.resultAuditLog` (populated from
// the Supabase `result_audit_log` table).
export function createResultAuditService(data) {
  return {
    listForResult: (resultId) => (data.db.resultAuditLog || []).filter((e) => e.entityId === resultId),
    listForStudent: (studentId) => (data.db.resultAuditLog || []).filter((e) => e.studentId === studentId),
  };
}
