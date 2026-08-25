// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createTimetableService(data) {
  return {
    list: () => data.db.timetableEntries,
    create: (payload) => data.createTimetableEntry(payload),
    remove: (id) => data.deleteTimetableEntry(id),
    assignSubstitute: (payload) => data.assignSubstitute(payload),
    removeSubstitute: (id) => data.removeSubstitute(id),
    markPeriodDone: (payload) => data.markPeriodDone(payload),
    savePeriodAttendance: (payload) => data.savePeriodAttendance(payload),
    getConfig: () => data.db.timetableConfig,
    updateConfig: (patch, actorId) => data.updateTimetableConfig(patch, actorId),
    periodSchedule: () => data.periodSchedule(),
  };
}
