import { describe, expect, it, vi } from "vitest";
import { createPushService, PUSH_SW_URL, PUSH_SW_SCOPE } from "../src/services/pushService";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// Builds a service wired to fakes. Every browser / Firebase / Supabase edge is injectable.
function make(o = {}) {
  const storage = o.storage ?? memoryStorage();
  const requestPermission = vi.fn(async () => o.requestResult ?? "granted");
  const NotificationApi = o.noNotification ? undefined : { permission: o.permission ?? "default", requestPermission };
  const registration = { scope: "/" };
  const nav = {
    userAgent: o.ua ?? "Mozilla/5.0 (Linux; Android 14) Chrome/120",
    standalone: o.standalone,
    ...(o.noServiceWorker ? {} : { serviceWorker: { register: vi.fn(o.registerImpl ?? (async () => registration)), ready: Promise.resolve(registration) } }),
  };
  const win = { ...(o.noPushManager ? {} : { PushManager: function () {} }), matchMedia: () => ({ matches: !!o.displayStandalone }) };
  const apps = [];
  const app = { name: "app" };
  const fb = {
    getApps: () => apps,
    getApp: () => app,
    initializeApp: vi.fn(() => { apps.push(app); return app; }),
    getMessaging: vi.fn(() => ({ m: 1 })),
    getToken: vi.fn(o.getTokenImpl ?? (async () => "fcm-token-1".padEnd(64, "x"))),
    deleteToken: vi.fn(async () => true),
  };
  const rpc = vi.fn(o.rpcImpl ?? (async () => ({ error: null })));
  const svc = createPushService({
    window: win, navigator: nav, Notification: NotificationApi, storage,
    supabase: { rpc }, isConfigured: () => o.configured ?? true,
    loadFirebase: async () => fb, firebaseConfig: () => ({ projectId: "hiil-model-school" }), vapidKey: () => "PUBLIC_VAPID",
  });
  return { svc, nav, fb, rpc, requestPermission, storage, registration };
}

describe("support + permission states", () => {
  it("supported browser reports its permission (default / granted / denied)", () => {
    for (const p of ["default", "granted", "denied"]) {
      const { svc } = make({ permission: p });
      expect(svc.support()).toEqual({ supported: true, reason: null });
      expect(svc.permission()).toBe(p);
    }
  });

  it("unsupported: no Notification API, no service worker, no PushManager, Firebase not configured", () => {
    expect(make({ noNotification: true }).svc.support()).toMatchObject({ supported: false, reason: "no-notifications" });
    expect(make({ noServiceWorker: true }).svc.support()).toMatchObject({ supported: false, reason: "no-service-worker" });
    expect(make({ noPushManager: true }).svc.support()).toMatchObject({ supported: false, reason: "no-push" });
    const nc = make({ configured: false });
    expect(nc.svc.support()).toMatchObject({ supported: false, reason: "not-configured" });
    expect(nc.svc.permission()).toBe("unsupported");
  });

  it("iPhone: a Safari tab can't get push (must be added to the Home Screen); the Home Screen app can", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1";
    expect(make({ ua: iphone }).svc.support()).toMatchObject({ supported: false, reason: "ios-needs-install" });
    expect(make({ ua: iphone, noNotification: true }).svc.support()).toMatchObject({ supported: false, reason: "ios-needs-install" });
    expect(make({ ua: iphone, standalone: true }).svc.support().supported).toBe(true);
  });

  it("never asks for permission just by being created / queried (only enable() does)", () => {
    const { svc, requestPermission } = make();
    svc.support(); svc.permission(); svc.deviceId();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("enable()", () => {
  it("prompts, registers the root-scoped worker, gets an FCM token with the public VAPID key and registers the device for the session user", async () => {
    const { svc, requestPermission, nav, fb, rpc, registration } = make({ standalone: true });
    const r = await svc.enable("user-1");
    expect(r).toEqual({ ok: true });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(nav.serviceWorker.register).toHaveBeenCalledWith(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
    expect(PUSH_SW_URL).toBe("/firebase-messaging-sw.js");
    expect(PUSH_SW_SCOPE).toBe("/");
    expect(fb.getToken).toHaveBeenCalledWith(expect.anything(), { vapidKey: "PUBLIC_VAPID", serviceWorkerRegistration: registration });
    expect(rpc).toHaveBeenCalledWith("register_device_token", expect.objectContaining({ p_platform: "web", p_app_version: "pwa-standalone", p_device_id: svc.deviceId() }));
    // ownership is derived server-side: the client never sends a user id
    expect(Object.keys(rpc.mock.calls[0][1]).join(",")).not.toMatch(/user|owner|actor|recipient|role/i);
    expect(svc.isOptedIn("user-1")).toBe(true);
  });

  it("requests permission FIRST (inside the click's user activation), before any async setup", async () => {
    const order = [];
    const { svc, requestPermission, nav } = make();
    requestPermission.mockImplementation(async () => { order.push("permission"); return "granted"; });
    nav.serviceWorker.register.mockImplementation(async () => { order.push("register"); return {}; });
    await svc.enable("u");
    expect(order).toEqual(["permission", "register"]);
  });

  it("permission denied by the user -> code 'denied', nothing registered", async () => {
    const { svc, rpc, nav } = make({ requestResult: "denied" });
    expect(await svc.enable("u")).toEqual({ ok: false, code: "denied" });
    expect(rpc).not.toHaveBeenCalled();
    expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    expect(svc.isOptedIn("u")).toBe(false);
  });

  it("permission ALREADY denied -> code 'denied' without prompting again", async () => {
    const { svc, requestPermission } = make({ permission: "denied" });
    expect(await svc.enable("u")).toEqual({ ok: false, code: "denied" });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("prompt dismissed (stays 'default') -> code 'dismissed'", async () => {
    const { svc } = make({ requestResult: "default" });
    expect(await svc.enable("u")).toEqual({ ok: false, code: "dismissed" });
  });

  it("already granted: no second prompt, still registers", async () => {
    const { svc, requestPermission, rpc } = make({ permission: "granted" });
    expect((await svc.enable("u")).ok).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("unsupported browser -> code 'unsupported' with the reason", async () => {
    expect(await make({ noServiceWorker: true }).svc.enable("u")).toEqual({ ok: false, code: "unsupported", reason: "no-service-worker" });
  });

  it("failure paths map to distinct codes and never mark the user opted in", async () => {
    const sw = make({ registerImpl: async () => { throw new Error("nope"); } });
    expect(await sw.svc.enable("u")).toEqual({ ok: false, code: "service-worker-failed" });
    const tk = make({ getTokenImpl: async () => { throw new Error("fcm down"); } });
    expect(await tk.svc.enable("u")).toEqual({ ok: false, code: "token-failed" });
    const empty = make({ getTokenImpl: async () => "" });
    expect(await empty.svc.enable("u")).toEqual({ ok: false, code: "token-failed" });
    const be = make({ rpcImpl: async () => ({ error: { message: "rls" } }) });
    expect(await be.svc.enable("u")).toEqual({ ok: false, code: "registration-failed" });
    for (const m of [sw, tk, empty, be]) expect(m.svc.isOptedIn("u")).toBe(false);
  });

  it("repeated registration reuses the same device id; a changed FCM token is re-sent for that device", async () => {
    let n = 0;
    const { svc, rpc } = make({ getTokenImpl: async () => `tok-${++n}`.padEnd(64, "x") });
    await svc.enable("u"); await svc.enable("u");
    const [a, b] = rpc.mock.calls.map((c) => c[1]);
    expect(a.p_device_id).toBe(b.p_device_id);
    expect(a.p_token).not.toBe(b.p_token);
  });

  it("multiple devices: separate installs get separate device ids", async () => {
    const one = make(); const two = make();
    await one.svc.enable("u"); await two.svc.enable("u");
    expect(one.svc.deviceId()).not.toBe(two.svc.deviceId());
  });
});

describe("refresh / logout / disable / re-enable", () => {
  it("refresh re-registers silently for an opted-in user and never prompts", async () => {
    const { svc, requestPermission, rpc } = make({ permission: "granted" });
    await svc.enable("u"); rpc.mockClear();
    expect(await svc.refresh("u")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("refresh does nothing for a user who never opted in, or when permission isn't granted", async () => {
    const a = make({ permission: "granted" });
    expect(await a.svc.refresh("u")).toEqual({ ok: false, code: "skipped" });
    const b = make({ permission: "default" });
    b.storage.setItem("hiil.push.optin.u", "1");
    expect(await b.svc.refresh("u")).toEqual({ ok: false, code: "skipped" });
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it("logout removes this device's row but keeps the opt-in, so signing back in re-registers without a prompt", async () => {
    const { svc, rpc, requestPermission } = make({ permission: "granted" });
    await svc.enable("u"); rpc.mockClear();
    await svc.unregisterForLogout();
    expect(rpc).toHaveBeenCalledWith("unregister_device_token", { p_device_id: svc.deviceId() });
    expect(svc.isOptedIn("u")).toBe(true);
    rpc.mockClear();
    expect((await svc.refresh("u")).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("register_device_token", expect.anything());
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("a different user signing in on the same device has no opt-in and is not registered silently", async () => {
    const { svc } = make({ permission: "granted" });
    await svc.enable("alice");
    expect(await svc.refresh("bob")).toEqual({ ok: false, code: "skipped" });
  });

  it("logout swallows a backend failure (sign-out must never be blocked)", async () => {
    const { svc } = make({ rpcImpl: async () => { throw new Error("offline"); } });
    await expect(svc.unregisterForLogout()).resolves.toBeUndefined();
  });

  it("disable unregisters the device, deletes the FCM token and clears the opt-in; enable works again afterwards", async () => {
    const { svc, rpc, fb } = make({ permission: "granted" });
    await svc.enable("u");
    await svc.disable("u");
    expect(rpc).toHaveBeenCalledWith("unregister_device_token", { p_device_id: svc.deviceId() });
    expect(fb.deleteToken).toHaveBeenCalledTimes(1);
    expect(svc.isOptedIn("u")).toBe(false);
    expect((await svc.enable("u")).ok).toBe(true);
    expect(svc.isOptedIn("u")).toBe(true);
  });

  it("'Not now' is remembered per user and cleared by a successful enable; subscribers hear about changes", async () => {
    const { svc } = make();
    const changed = vi.fn();
    svc.subscribe(changed);
    svc.dismiss("u");
    expect(svc.isDismissed("u")).toBe(true);
    expect(svc.isDismissed("other")).toBe(false);
    await svc.enable("u");
    expect(svc.isDismissed("u")).toBe(false);
    expect(changed).toHaveBeenCalled();
  });

  it("works with storage unavailable (private mode): degrades, never throws", async () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    const { svc } = make({ storage: broken });
    expect(typeof svc.deviceId()).toBe("string");
    expect((await svc.enable("u")).ok).toBe(true);
  });
});
