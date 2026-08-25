// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createHomeworkService(data) {
  return {
    list: () => data.db.homework,
    create: (payload) => data.createHomework(payload),
  };
}
