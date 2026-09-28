// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SW_SRC = fs.readFileSync(path.join(ROOT, "public", "firebase-messaging-sw.js"), "utf8");
const ORIGIN = "https://hiil-model-school.vercel.app";

// Loads the real worker file into a sandbox with a fake ServiceWorkerGlobalScope.
function loadWorker({ clients = [], ua = "Mozilla/5.0 (Linux; Android 14) Chrome/120" } = {}) {
  const handlers = {};
  const self = {
    location: { origin: ORIGIN },
    navigator: { userAgent: ua },
    registration: { showNotification: vi.fn(async () => {}), setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) },
    clients: { matchAll: vi.fn(async () => clients), claim: vi.fn(async () => {}), openWindow: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  vm.runInNewContext(SW_SRC, { self, URL, console });
  const fire = async (type, event) => { const waits = []; handlers[type]({ ...event, waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
  return { self, handlers, fire };
}
const pushEvent = (payload) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });
const client = (o = {}) => ({ visibilityState: "hidden", url: `${ORIGIN}/`, postMessage: vi.fn(), focus: vi.fn(async () => {}), ...o });

describe("service worker registration surface", () => {
  it("is a real static file at /firebase-messaging-sw.js, served at root scope with no-cache, and is the ONLY worker", () => {
    expect(fs.existsSync(path.join(ROOT, "public", "firebase-messaging-sw.js"))).toBe(true);
    const extra = fs.readdirSync(path.join(ROOT, "public")).filter((f) => /^(sw|service-worker|serviceworker)/i.test(f) || (/\.js$/.test(f) && f !== "firebase-messaging-sw.js"));
    expect(extra).toEqual([]);
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const h = vercel.headers.find((x) => x.source === "/firebase-messaging-sw.js").headers;
    expect(h).toContainEqual({ key: "Service-Worker-Allowed", value: "/" });
    expect(h.find((x) => x.key === "Cache-Control").value).toMatch(/no-cache/);
  });

  it("registers install/activate/push/notificationclick and adds NO caching or fetch interception (no PWA behaviour change)", () => {
    const { handlers, self } = loadWorker();
    expect(Object.keys(handlers).sort()).toEqual(["activate", "install", "notificationclick", "push"]);
    expect(SW_SRC).not.toMatch(/addEventListener\(\s*["']fetch["']|caches\.|importScripts/);
    handlers.install();
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it("activate claims open pages", async () => {
    const { fire, self } = loadWorker();
    await fire("activate", {});
    expect(self.clients.claim).toHaveBeenCalled();
  });

  it("uses the official app icon from the manifest and contains no credentials", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "manifest.webmanifest"), "utf8"));
    const icon192 = manifest.icons.find((i) => i.sizes === "192x192").src;
    expect(SW_SRC).toContain(icon192);
    expect(SW_SRC).not.toMatch(/apiKey|private_key|BEGIN PRIVATE|client_email/i);
  });

  it("the Android status-bar badge icon is a dedicated asset, never the full-color content icon", () => {
    expect(fs.existsSync(path.join(ROOT, "public", "icons", "notification-badge.png"))).toBe(true);
    const iconMatch = SW_SRC.match(/HIIL_ICON\s*=\s*"([^"]+)"/);
    const badgeMatch = SW_SRC.match(/HIIL_BADGE\s*=\s*"([^"]+)"/);
    expect(iconMatch[1]).not.toBe(badgeMatch[1]);
    expect(badgeMatch[1]).toMatch(/notification-badge\.png/);
  });
});

describe("background / closed-app push", () => {
  it("closed app (no windows): shows an OS notification branded Hiil Model School with the app icon, tag and click url", async () => {
    const { fire, self } = loadWorker({ clients: [] });
    await fire("push", pushEvent({ data: { title: "Hiil Model School", body: "Amina Hassan: New announcement", url: "/?n=abc", tag: "n1", notificationId: "n1", type: "ANNOUNCEMENT", badge: "3" } }));
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = self.registration.showNotification.mock.calls[0];
    expect(title).toBe("Hiil Model School");
    expect(opts).toMatchObject({ body: "Amina Hassan: New announcement", icon: "/icons/icon-192.png?v=hiil1", badge: "/icons/notification-badge.png?v=hiil1", tag: "n1", data: { url: "/?n=abc", notificationId: "n1", type: "ANNOUNCEMENT" } });
  });

  it("backgrounded / minimized page (window exists but hidden): still shows the OS notification", async () => {
    const c = client({ visibilityState: "hidden" });
    const { fire, self } = loadWorker({ clients: [c] });
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n2" } }));
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
  });

  it("also renders a Firebase Console test message (notification payload, no data)", async () => {
    const { fire, self } = loadWorker();
    await fire("push", pushEvent({ notification: { title: "Test", body: "Hello from the console" } }));
    const [title, opts] = self.registration.showNotification.mock.calls[0];
    expect(title).toBe("Test");
    expect(opts.body).toBe("Hello from the console");
    expect(opts.data.url).toBe("/");
  });

  it("empty / malformed payloads still produce a safe branded notification (a push must never be silent)", async () => {
    const { fire, self } = loadWorker();
    await fire("push", { data: { json: () => { throw new Error("bad"); }, text: () => "plain text" } });
    await fire("push", {});
    expect(self.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(self.registration.showNotification.mock.calls[0][0]).toBe("Hiil Model School");
    expect(self.registration.showNotification.mock.calls[0][1].body).toBe("plain text");
    expect(self.registration.showNotification.mock.calls[1][1].body).toBe("You have a new notification");
  });
});

describe("app-icon badge (Badging API)", () => {
  it("sets the badge to the server's authoritative unread count, not a per-push increment", async () => {
    const { fire, self } = loadWorker({ clients: [] });
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n5", badge: "7" } }));
    expect(self.registration.setAppBadge).toHaveBeenCalledWith(7);
    expect(self.registration.clearAppBadge).not.toHaveBeenCalled();
  });
  it("clears the badge when the authoritative count is zero", async () => {
    const { fire, self } = loadWorker({ clients: [] });
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n6", badge: "0" } }));
    expect(self.registration.clearAppBadge).toHaveBeenCalled();
    expect(self.registration.setAppBadge).not.toHaveBeenCalled();
  });
  it("no badge field: leaves the badge untouched rather than guessing", async () => {
    const { fire, self } = loadWorker({ clients: [] });
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n7" } }));
    expect(self.registration.setAppBadge).not.toHaveBeenCalled();
    expect(self.registration.clearAppBadge).not.toHaveBeenCalled();
  });
  it("applies even when the OS banner is suppressed for a visible foreground tab", async () => {
    const c = client({ visibilityState: "visible" });
    const { fire, self } = loadWorker({ clients: [c] });
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n8", badge: "2" } }));
    expect(self.registration.showNotification).not.toHaveBeenCalled();
    expect(self.registration.setAppBadge).toHaveBeenCalledWith(2);
  });
  it("a missing Badging API (e.g. iOS Safari) never throws or blocks the OS notification", async () => {
    const { fire, self } = loadWorker({ clients: [] });
    delete self.registration.setAppBadge;
    delete self.registration.clearAppBadge;
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n9", badge: "1" } }));
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe("foreground push", () => {
  it("visible page: no duplicate OS banner, but the page is told (toast) with the same text", async () => {
    const c = client({ visibilityState: "visible" });
    const { fire, self } = loadWorker({ clients: [c] });
    await fire("push", pushEvent({ data: { body: "New announcement", notificationId: "n3", type: "ANNOUNCEMENT" } }));
    expect(self.registration.showNotification).not.toHaveBeenCalled();
    expect(c.postMessage).toHaveBeenCalledWith({ type: "HIIL_PUSH_RECEIVED", notificationId: "n3", title: "Hiil Model School", body: "New announcement", pushType: "ANNOUNCEMENT" });
  });

  it("iOS/WebKit must show every push, so a visible page still gets the (tag-replaced) notification there", async () => {
    const c = client({ visibilityState: "visible" });
    const { fire, self } = loadWorker({ clients: [c], ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)" });
    await fire("push", pushEvent({ data: { body: "b", notificationId: "n4" } }));
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe("notification click routing", () => {
  const clickEvent = (data) => ({ notification: { close: vi.fn(), data } });

  it("app already open: focuses it and posts the notification id (the page re-checks access)", async () => {
    const c = client();
    const { fire, self } = loadWorker({ clients: [c] });
    const ev = clickEvent({ url: "/?n=abc", notificationId: "abc" });
    await fire("notificationclick", ev);
    expect(ev.notification.close).toHaveBeenCalled();
    expect(c.focus).toHaveBeenCalled();
    expect(c.postMessage).toHaveBeenCalledWith({ type: "HIIL_NOTIFICATION_CLICK", notificationId: "abc", url: "/?n=abc" });
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("app closed: cold-starts at the same-origin url carrying only the id", async () => {
    const { fire, self } = loadWorker({ clients: [] });
    await fire("notificationclick", clickEvent({ url: "/?n=abc" }));
    expect(self.clients.openWindow).toHaveBeenCalledWith("/?n=abc");
  });

  it("ignores windows from other origins", async () => {
    const foreign = client({ url: "https://evil.example/" });
    const { fire, self } = loadWorker({ clients: [foreign] });
    await fire("notificationclick", clickEvent({ url: "/?n=abc" }));
    expect(foreign.postMessage).not.toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalled();
  });

  it("never navigates off-site: absolute, protocol-relative and malformed targets fall back to the app root", async () => {
    for (const bad of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", undefined, 42]) {
      const { fire, self } = loadWorker({ clients: [] });
      await fire("notificationclick", clickEvent({ url: bad }));
      expect(self.clients.openWindow, String(bad)).toHaveBeenCalledWith("/");
    }
  });
});
