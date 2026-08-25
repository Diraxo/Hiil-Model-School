// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createClassService(data) {
  return {
    list: () => data.db.classes,
    get: (id) => data.getClass(id),
    label: (cls) => data.classLabel(cls),
    create: (payload) => data.createClass(payload),
    update: (id, payload) => data.updateClass(id, payload),
    remove: (id) => data.deleteClass(id),
  };
}
