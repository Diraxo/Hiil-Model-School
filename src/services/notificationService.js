// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase +
// this is also where Firebase Cloud Messaging push gets layered on top of
// the in-app notification list (see notificationService docs in the README).
export function createNotificationService(data) {
  return {
    list: () => data.db.notifications,
    markRead: (id) => data.markNotificationRead(id),
    markAllRead: (userId) => data.markAllNotificationsRead(userId),
  };
}
