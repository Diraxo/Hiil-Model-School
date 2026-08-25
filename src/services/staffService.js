// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createStaffService(data) {
  return {
    list: () => data.db.staff,
    create: (payload) => data.createStaff(payload),
    update: (id, payload) => data.updateStaff(id, payload),
    setStatus: (id, status, actorId) => data.setStaffStatus(id, status, actorId),
    delete: (id) => data.deleteStaff(id),
  };
}
