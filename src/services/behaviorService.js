// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createBehaviorService(data) {
  return {
    list: () => data.db.behaviorRecords,
    create: (payload) => data.createBehaviorRecord(payload),
  };
}
