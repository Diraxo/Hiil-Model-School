/* Hiil Model School -- push service worker (FCM Web Push).
 *
 * Served at /firebase-messaging-sw.js with scope "/". There is no other service worker in this app
 * and this one deliberately has NO fetch handler and NO cache: it changes nothing about how pages or
 * assets load (no offline mode, no stale-shell risk). Its only jobs are receiving pushes while the
 * page is backgrounded or the installed PWA is closed, and routing notification taps.
 *
 * It uses the standard Web Push `push` event directly instead of importing the Firebase SW SDK from a
 * CDN: FCM delivers to the browser's push service, the payload arrives here, and we render it. The page
 * side (src/services/pushService.js) still uses the official Firebase SDK to mint the FCM token.
 *
 * Payload contract (supabase/functions/push-fanout/logic.ts buildMessage, platform "web"):
 *   data-only { title, body, url, tag, notificationId, type, navigation }  -- our backend
 *   notification { title, body }                                            -- Firebase Console "Send test message"
 * The OS notification always carries the Hiil Model School identity (title + app icon). Only a
 * notification id travels in the URL; the app re-checks the signed-in user's access when it opens.
 */
var HIIL_ICON = "/icons/icon-192.png?v=hiil1";
var HIIL_BADGE = "/icons/icon-192.png?v=hiil1";
var HIIL_TITLE = "Hiil Model School";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/** Accepts only same-origin relative targets; anything else becomes the app root. */
function hiilSafeUrl(raw) {
  try {
    if (typeof raw !== "string" || raw.charAt(0) !== "/" || raw.charAt(1) === "/" || raw.charAt(1) === "\\") return "/";
    var u = new URL(raw, self.location.origin);
    if (u.origin !== self.location.origin) return "/";
    return u.pathname + u.search;
  } catch (e) {
    return "/";
  }
}

/** Normalises FCM's payload shapes into one { title, body, url, tag, notificationId, type } object. */
function hiilParsePayload(event) {
  var j = null;
  try { j = event.data ? event.data.json() : null; } catch (e) { j = null; }
  if (!j || typeof j !== "object") {
    var text = "";
    try { text = event.data ? event.data.text() : ""; } catch (e) { text = ""; }
    j = text ? { notification: { body: text } } : {};
  }
  var d = (j.data && typeof j.data === "object") ? j.data : {};
  var n = (j.notification && typeof j.notification === "object") ? j.notification : {};
  var id = d.notificationId ? String(d.notificationId) : "";
  return {
    title: String(d.title || n.title || HIIL_TITLE),
    body: String(d.body || n.body || "You have a new notification"),
    url: hiilSafeUrl(d.url || (id ? "/?n=" + encodeURIComponent(id) : "/")),
    tag: String(d.tag || id || "hiil-general"),
    notificationId: id,
    type: String(d.type || ""),
  };
}

function hiilIsIos() {
  try { return /iPhone|iPad|iPod/.test(self.navigator.userAgent || ""); } catch (e) { return false; }
}

self.addEventListener("push", function (event) {
  event.waitUntil((async function () {
    var p = hiilParsePayload(event);
    var wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    var visible = false;
    for (var i = 0; i < wins.length; i++) {
      if (wins[i].visibilityState === "visible") visible = true;
      // Tell any open page so it can show an in-app toast (its notification list refreshes itself
      // through Supabase Realtime -- no polling).
      wins[i].postMessage({ type: "HIIL_PUSH_RECEIVED", notificationId: p.notificationId, title: p.title, body: p.body, pushType: p.type });
    }
    // App is open and visible: the in-app toast + notification center already tell the user, so skip
    // the OS banner. iOS/WebKit requires every push to be user-visible (repeated silent pushes can get
    // the subscription revoked), so there we always show it (the tag makes it replace, not stack).
    if (visible && !hiilIsIos()) return;
    await self.registration.showNotification(p.title, {
      body: p.body,
      icon: HIIL_ICON,
      badge: HIIL_BADGE,
      tag: p.tag,
      data: { url: p.url, notificationId: p.notificationId, type: p.type },
    });
  })());
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = hiilSafeUrl(data.url);
  event.waitUntil((async function () {
    var wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var i = 0; i < wins.length; i++) {
      var c = wins[i];
      var sameOrigin = false;
      try { sameOrigin = new URL(c.url).origin === self.location.origin; } catch (e) { sameOrigin = false; }
      if (!sameOrigin) continue;
      if (c.focus) await c.focus();
      c.postMessage({ type: "HIIL_NOTIFICATION_CLICK", notificationId: data.notificationId || "", url: url });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
