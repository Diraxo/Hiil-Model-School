// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createAuditLogService(data) {
  return {
    list: () => data.db.activities,
    log: (text) => data.logActivity(text),
  };
}
