// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createSubjectService(data) {
  return {
    list: () => data.db.subjects,
    create: (payload) => data.createSubject(payload),
    update: (id, payload) => data.updateSubject(id, payload),
    remove: (id) => data.deleteSubject(id),
  };
}
