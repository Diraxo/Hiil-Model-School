// Tiny module store for "the user tapped a push notification": only a notification ID is kept.
// The app resolves it AFTER sign-in against the signed-in user's own RLS-scoped notifications, so an
// old or forged link can never show anything the user isn't currently allowed to see.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pending = null;
const subs = new Set();

export function isNotificationId(v) {
  return typeof v === "string" && UUID.test(v);
}

/** Reads `?n=<uuid>` from a location.search string; anything else is ignored. */
export function notificationIdFromSearch(search) {
  try {
    const v = new URLSearchParams(search || "").get("n");
    return isNotificationId(v) ? v : null;
  } catch {
    return null;
  }
}

export function setPendingNotification(id) {
  if (!isNotificationId(id)) return false;
  pending = id;
  subs.forEach((fn) => fn(pending));
  return true;
}

export function getPendingNotification() { return pending; }

export function clearPendingNotification() { pending = null; }

export function subscribePendingNotification(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Cold start from a tapped notification: capture the id and strip it from the address bar. */
export function captureNotificationFromLocation(win = typeof window !== "undefined" ? window : undefined) {
  if (!win?.location) return null;
  const id = notificationIdFromSearch(win.location.search);
  if (!id) return null;
  setPendingNotification(id);
  try {
    const url = new URL(win.location.href);
    url.searchParams.delete("n");
    win.history.replaceState(win.history.state, "", url.pathname + url.search + url.hash);
  } catch { /* non-critical */ }
  return id;
}

/** Warm path: the service worker posts messages to open pages. Returns an unsubscribe function. */
export function listenForServiceWorkerMessages({ nav = typeof navigator !== "undefined" ? navigator : undefined, onPush } = {}) {
  const sw = nav?.serviceWorker;
  if (!sw?.addEventListener) return () => {};
  const handler = (event) => {
    const m = event?.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "HIIL_NOTIFICATION_CLICK") setPendingNotification(m.notificationId);
    else if (m.type === "HIIL_PUSH_RECEIVED" && onPush) onPush(m);
  };
  sw.addEventListener("message", handler);
  return () => sw.removeEventListener("message", handler);
}
