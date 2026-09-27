// Web Push (FCM) device registration for the installed PWA / browser.
//
// Flow (all user-initiated -- nothing here asks for permission on page load):
//   enable():  Notification.requestPermission -> register /firebase-messaging-sw.js -> Firebase
//              getToken (VAPID) -> supabase.rpc('register_device_token').
//   Supabase is the source of truth for WHO owns a device: register_device_token derives the owner
//   from the session (auth.uid()); this client never sends a user id. FCM is only the delivery layer.
//
// Firebase is used for Cloud Messaging ONLY (no Auth/Firestore/Analytics), and is imported lazily so it
// never weighs on the initial bundle. All browser/Firebase/Supabase dependencies are injectable so the
// permission + registration state machine is unit-tested without a browser.
import { supabase } from "../lib/supabaseClient";
import { getFirebaseConfig, isFirebaseConfigured, getVapidKey } from "../lib/firebaseConfig";

export const PUSH_SW_URL = "/firebase-messaging-sw.js";
export const PUSH_SW_SCOPE = "/";

const DEVICE_KEY = "hiil.push.deviceId";
const optInKey = (uid) => `hiil.push.optin.${uid}`;
const dismissKey = (uid) => `hiil.push.dismissed.${uid}`;

function safeStorage(win) {
  try { return win?.localStorage || null; } catch { return null; }
}

function randomId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function loadFirebaseMessaging() {
  const [{ initializeApp, getApps, getApp }, messaging] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  return { initializeApp, getApps, getApp, ...messaging };
}

export function createPushService(deps = {}) {
  const win = deps.window ?? (typeof window !== "undefined" ? window : undefined);
  const nav = deps.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);
  const NotificationApi = deps.Notification ?? win?.Notification;
  const storage = deps.storage ?? safeStorage(win);
  const client = deps.supabase ?? supabase;
  const configured = deps.isConfigured ?? isFirebaseConfigured;
  const loadFirebase = deps.loadFirebase ?? loadFirebaseMessaging;
  const firebaseConfig = deps.firebaseConfig ?? getFirebaseConfig;
  const vapidKey = deps.vapidKey ?? getVapidKey;

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* listener errors never break push */ } });
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  const read = (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } };
  const write = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode: degrade silently */ } };
  const remove = (k) => { try { storage?.removeItem(k); } catch { /* ignore */ } };

  function isStandalone() {
    return !!(nav?.standalone || win?.matchMedia?.("(display-mode: standalone)")?.matches);
  }
  function isIos() {
    return /iPad|iPhone|iPod/.test(nav?.userAgent || "") || (nav?.platform === "MacIntel" && (nav?.maxTouchPoints || 0) > 1);
  }

  /** { supported, reason } -- reason is one of: ios-needs-install | no-notifications | no-service-worker | no-push | not-configured. */
  function support() {
    if (!configured()) return { supported: false, reason: "not-configured" };
    if (!NotificationApi) return { supported: false, reason: isIos() && !isStandalone() ? "ios-needs-install" : "no-notifications" };
    if (!nav || !("serviceWorker" in nav)) return { supported: false, reason: "no-service-worker" };
    if (!win || !("PushManager" in win)) return { supported: false, reason: isIos() && !isStandalone() ? "ios-needs-install" : "no-push" };
    // iOS only delivers Web Push to a site added to the Home Screen; in a normal Safari tab the
    // permission prompt cannot succeed, so say so instead of failing later.
    if (isIos() && !isStandalone()) return { supported: false, reason: "ios-needs-install" };
    return { supported: true, reason: null };
  }

  /** 'unsupported' | 'default' | 'granted' | 'denied' */
  function permission() {
    if (!support().supported) return "unsupported";
    return NotificationApi.permission;
  }

  function deviceId() {
    let id = read(DEVICE_KEY);
    if (!id) { id = randomId(); write(DEVICE_KEY, id); }
    return id;
  }

  function appVersion() {
    return isStandalone() ? "pwa-standalone" : "browser";
  }

  async function registerServiceWorker() {
    const reg = await nav.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
    await nav.serviceWorker.ready;
    return reg;
  }

  async function getFcmToken(registration) {
    const fb = await loadFirebase();
    const app = fb.getApps().length ? fb.getApp() : fb.initializeApp(firebaseConfig());
    const messaging = fb.getMessaging(app);
    const token = await fb.getToken(messaging, { vapidKey: vapidKey(), serviceWorkerRegistration: registration });
    return { token, fb, messaging };
  }

  async function sendToBackend(token) {
    const { error } = await client.rpc("register_device_token", {
      p_token: token,
      p_platform: "web",
      p_device_id: deviceId(),
      p_app_version: appVersion(),
    });
    if (error) throw error;
  }

  /**
   * Explicit user action. Returns { ok: true } or { ok: false, code } with code one of:
   * unsupported | denied | dismissed | service-worker-failed | token-failed | registration-failed.
   * `requestPermission` is the FIRST await so it stays inside the click's user-activation window.
   */
  async function enable(userId) {
    const s = support();
    if (!s.supported) return { ok: false, code: "unsupported", reason: s.reason };
    if (NotificationApi.permission === "denied") return { ok: false, code: "denied" };

    if (NotificationApi.permission !== "granted") {
      let result;
      try { result = await NotificationApi.requestPermission(); } catch { return { ok: false, code: "denied" }; }
      if (result === "denied") return { ok: false, code: "denied" };
      if (result !== "granted") return { ok: false, code: "dismissed" };
    }

    let registration;
    try { registration = await registerServiceWorker(); } catch { return { ok: false, code: "service-worker-failed" }; }

    let token;
    try { ({ token } = await getFcmToken(registration)); } catch { return { ok: false, code: "token-failed" }; }
    if (!token) return { ok: false, code: "token-failed" };

    try { await sendToBackend(token); } catch { return { ok: false, code: "registration-failed" }; }

    if (userId) { write(optInKey(userId), "1"); remove(dismissKey(userId)); }
    notify();
    return { ok: true };
  }

  /**
   * Silent re-registration at sign-in for a user who already opted in on this browser: FCM tokens
   * rotate, and a previous sign-out removed this device's row. Never prompts. Returns
   * { ok: true } | { ok: false, code } | { ok: false, code: 'skipped' } when nothing is owed.
   */
  async function refresh(userId) {
    if (!userId || read(optInKey(userId)) !== "1") return { ok: false, code: "skipped" };
    if (!support().supported || NotificationApi.permission !== "granted") return { ok: false, code: "skipped" };
    let registration;
    try { registration = await registerServiceWorker(); } catch { return { ok: false, code: "service-worker-failed" }; }
    let token;
    try { ({ token } = await getFcmToken(registration)); } catch { return { ok: false, code: "token-failed" }; }
    if (!token) return { ok: false, code: "token-failed" };
    try { await sendToBackend(token); } catch { return { ok: false, code: "registration-failed" }; }
    return { ok: true };
  }

  /** The user turns notifications off for this device: forget the row, drop the FCM token, clear the opt-in. */
  async function disable(userId) {
    if (userId) remove(optInKey(userId));
    try { await client.rpc("unregister_device_token", { p_device_id: deviceId() }); } catch { /* best effort */ }
    try {
      const fb = await loadFirebase();
      if (fb.getApps().length) await fb.deleteToken(fb.getMessaging(fb.getApp()));
    } catch { /* token may already be gone */ }
    notify();
    return { ok: true };
  }

  /**
   * Sign-out: stop pushes for THIS install (the next person to sign in on this phone must not receive the
   * previous user's alerts). Keeps the browser permission + the per-user opt-in so signing back in
   * re-registers silently. Must run BEFORE supabase.auth.signOut (the RPC needs the session).
   */
  async function unregisterForLogout() {
    try { await client.rpc("unregister_device_token", { p_device_id: deviceId() }); } catch { /* best effort */ }
  }

  function isOptedIn(userId) { return !!userId && read(optInKey(userId)) === "1"; }
  function isDismissed(userId) { return !!userId && read(dismissKey(userId)) === "1"; }
  function dismiss(userId) { if (userId) { write(dismissKey(userId), "1"); notify(); } }

  return { subscribe, support, permission, enable, refresh, disable, unregisterForLogout, isOptedIn, isDismissed, dismiss, deviceId, isStandalone };
}

let singleton = null;
export function getPushService() {
  if (!singleton) singleton = createPushService();
  return singleton;
}
