// Thin read adapter over DataContext's already-materialized `db.activities` (populated from the
// Supabase `activities` table); `log` calls DataContext's log_activity RPC wrapper.
export function createAuditLogService(data) {
  return {
    list: () => data.db.activities,
    log: (text) => data.logActivity(text),
  };
}
