// Keeps the installed PWA's app-icon badge in sync with the caller's own unread-notification count.
// `count` should always be the authoritative value (e.g. AppShell's `unreadNotifs`, itself derived
// from the live Supabase notifications list) -- never a locally incremented counter. Unsupported
// browsers (desktop Chrome when not installed, Firefox, iOS Safari has no Badging API at all) simply
// have no navigator.setAppBadge/clearAppBadge to call, so this silently no-ops there.
export async function syncAppBadge(count) {
  try {
    if (typeof count !== "number" || isNaN(count)) return;
    if (count > 0 && navigator.setAppBadge) await navigator.setAppBadge(count);
    else if (count <= 0 && navigator.clearAppBadge) await navigator.clearAppBadge();
  } catch (e) { /* Badging API not supported here -- no-op */ }
}
