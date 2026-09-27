import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureNotificationFromLocation, clearPendingNotification, getPendingNotification, isNotificationId,
  listenForServiceWorkerMessages, notificationIdFromSearch, setPendingNotification, subscribePendingNotification,
} from "../src/utils/pushNavigation";

const ID = "11111111-2222-4333-8444-555555555555";
beforeEach(() => clearPendingNotification());

describe("notification click -> pending id (only ids, only valid uuids)", () => {
  it("validates ids and rejects anything else", () => {
    expect(isNotificationId(ID)).toBe(true);
    for (const bad of ["", "abc", "../../x", `${ID}; drop`, null, undefined, 42, { id: ID }]) expect(isNotificationId(bad)).toBe(false);
    expect(setPendingNotification("nope")).toBe(false);
    expect(getPendingNotification()).toBeNull();
  });

  it("cold start (?n=<id>): captures the id and strips it from the address bar", () => {
    const replaceState = vi.fn();
    const win = { location: { search: `?n=${ID}&x=1`, href: `https://hiil-model-school.vercel.app/?n=${ID}&x=1#h` }, history: { state: null, replaceState } };
    expect(captureNotificationFromLocation(win)).toBe(ID);
    expect(getPendingNotification()).toBe(ID);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?x=1#h");
  });

  it("cold start without / with a forged id does nothing", () => {
    expect(captureNotificationFromLocation({ location: { search: "" } })).toBeNull();
    expect(captureNotificationFromLocation({ location: { search: "?n=javascript:alert(1)" } })).toBeNull();
    expect(getPendingNotification()).toBeNull();
    expect(notificationIdFromSearch(`?n=${ID}`)).toBe(ID);
  });

  it("warm start: the service worker's click message sets the pending id and notifies subscribers; a push message goes to onPush", () => {
    let handler;
    const nav = { serviceWorker: { addEventListener: (_t, h) => { handler = h; }, removeEventListener: vi.fn() } };
    const onPush = vi.fn();
    const seen = vi.fn();
    subscribePendingNotification(seen);
    const stop = listenForServiceWorkerMessages({ nav, onPush });
    handler({ data: { type: "HIIL_NOTIFICATION_CLICK", notificationId: ID } });
    expect(getPendingNotification()).toBe(ID);
    expect(seen).toHaveBeenCalledWith(ID);
    handler({ data: { type: "HIIL_PUSH_RECEIVED", body: "hi" } });
    expect(onPush).toHaveBeenCalledWith({ type: "HIIL_PUSH_RECEIVED", body: "hi" });
    handler({ data: { type: "HIIL_NOTIFICATION_CLICK", notificationId: "forged" } }); // ignored
    handler({ data: null });
    expect(getPendingNotification()).toBe(ID);
    stop();
    expect(nav.serviceWorker.removeEventListener).toHaveBeenCalled();
  });

  it("no service worker support: listening is a harmless no-op", () => {
    expect(() => listenForServiceWorkerMessages({ nav: {} })()).not.toThrow();
  });
});
