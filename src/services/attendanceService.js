// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase
// (this is also the seam where Realtime subscriptions get wired in, so
// admin/teacher edits push live to open parent dashboards).
export function createAttendanceService(data) {
  return {
    list: () => data.db.attendance,
    save: (payload) => data.saveAttendance(payload),
  };
}
