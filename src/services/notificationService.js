// Phase 6: real Supabase-backed notifications.
//
// Rows are RLS-scoped to the caller (notifications_select = user_id = auth.uid()), so `list()`
// only ever returns the current session's own notifications -- account switching can never leak
// another user's feed.
//
// Notifications are NEVER created from the client. Every fan-out goes through a SECURITY DEFINER
// notify_* RPC (migration 20260827000000) that resolves recipients + entitlement server-side.
// This service only READS them and flips the `read` flag (the one field notifications_update +
// the enforce_notification_update_guard trigger allow the recipient to change).
//
// Rows come back in the mock app's shape: snake_case columns mapped to
// { id, userId, title, message, image, read, type, announcementId, navigation, createdAt }.
import { supabase } from "../lib/supabaseClient";

// Keep the default page bounded -- the table keeps full history, the UI shows recent activity.
const DEFAULT_LIMIT = 300;

function mapNotification(row) {
  const navigation = row.navigation || null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message || "",
    image: row.image || null,
    read: !!row.read,
    type: row.type,
    announcementId: row.announcement_id || null,
    // PAYMENT rows carry a real payments FK; PAYROLL rows can't (notifications.payment_id is FK'd
    // to payments, and a payroll_payments id would violate it) -- notify_salary_paid puts the
    // payslip id in navigation.payrollPaymentId instead. Surface it as `paymentId` so the
    // existing NotificationsPage/MySalary "View Payslip" handlers keep working unchanged.
    paymentId: row.payment_id || (navigation && navigation.payrollPaymentId) || null,
    navigation,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createNotificationService() {
  return {
    async list(limit = DEFAULT_LIMIT) {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []).map(mapNotification);
    },

    // Idempotent: flipping an already-read row to read is a harmless no-op write. RLS + the
    // update guard trigger ensure only the recipient can do this and only to the `read` column.
    async markRead(id) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id)
        .eq("read", false);
      if (error) throw error;
    },

    // Marks every currently-unread notification for the caller read. `userId` is accepted for
    // call-site compatibility but ignored -- RLS already scopes the update to auth.uid(), so a
    // spoofed id changes nothing.
    async markAllRead() {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("read", false);
      if (error) throw error;
    },

    // Bulk-clears the caller's unread notifications whose id is in `ids` (the set the UI computed
    // as belonging to one sidebar section, via notificationPageKey).
    async markManyRead(ids) {
      if (!ids || ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .in("id", ids)
        .eq("read", false);
      if (error) throw error;
    },
  };
}
