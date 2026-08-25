// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createAnnouncementService(data) {
  return {
    list: () => data.db.announcements,
    create: (payload) => data.createAnnouncement(payload),
  };
}
