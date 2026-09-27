import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The banner/status card are driven through the real hook against a fake push service, so this proves
// the UX contract: nothing is requested on load, permission is requested only from the button, and every
// failure is shown through the app's toast system (never alert()).
const toastSpy = vi.fn();
const fake = { state: {}, listeners: new Set() };
vi.mock("../src/context/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../src/context/AuthContext", () => ({ useAuth: () => ({ currentUser: { id: "u1" }, realUser: { id: "u1" } }) }));
vi.mock("../src/services/pushService", () => ({ getPushService: () => fake.service }));

import { PushOptInBanner, PushStatusCard } from "../src/components/PushOptIn";

function makeService(over = {}) {
  const s = {
    support: vi.fn(() => over.support ?? { supported: true, reason: null }),
    permission: vi.fn(() => over.permission ?? "default"),
    isOptedIn: vi.fn(() => over.optedIn ?? false),
    isDismissed: vi.fn(() => over.dismissed ?? false),
    subscribe: vi.fn(() => () => {}),
    refresh: vi.fn(async () => over.refreshResult ?? { ok: false, code: "skipped" }),
    enable: vi.fn(async () => over.enableResult ?? { ok: true }),
    disable: vi.fn(async () => ({ ok: true })),
    dismiss: vi.fn(),
  };
  fake.service = s;
  return s;
}

beforeEach(() => { toastSpy.mockClear(); vi.spyOn(window, "alert").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PushOptInBanner", () => {
  it("shows the opt-in copy with both buttons and asks for NOTHING on load", () => {
    const s = makeService();
    render(<PushOptInBanner />);
    expect(screen.getByText("Turn on notifications")).toBeTruthy();
    expect(screen.getByText(/Stay updated with attendance, announcements, payments, homework, results and important school activity/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Enable Notifications/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Not now/ })).toBeTruthy();
    expect(s.enable).not.toHaveBeenCalled();
  });

  it("silently refreshes an existing registration once on mount (no prompt, no timer)", () => {
    const s = makeService({ permission: "granted", optedIn: true });
    render(<PushOptInBanner />);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.enable).not.toHaveBeenCalled();
  });

  it("Enable Notifications requests permission only on click and confirms via toast", async () => {
    const s = makeService();
    render(<PushOptInBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Enable Notifications/ }));
    await waitFor(() => expect(s.enable).toHaveBeenCalledWith("u1"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/on for this device/), "success"));
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("failures use toasts with clear guidance, never alert()", async () => {
    for (const [code, re, kind] of [["denied", /blocked/, "error"], ["token-failed", /Couldn't connect/, "error"], ["registration-failed", /Couldn't register/, "error"], ["service-worker-failed", /notification service/, "error"], ["dismissed", /not enabled/, "info"]]) {
      toastSpy.mockClear();
      makeService({ enableResult: { ok: false, code } });
      const { unmount } = render(<PushOptInBanner />);
      fireEvent.click(screen.getByRole("button", { name: /Enable Notifications/ }));
      await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(re), kind));
      unmount();
    }
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("'Not now' dismisses without prompting", () => {
    const s = makeService();
    render(<PushOptInBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    expect(s.dismiss).toHaveBeenCalledWith("u1");
    expect(s.enable).not.toHaveBeenCalled();
  });

  it("is hidden when already enabled, blocked, unsupported or dismissed", () => {
    for (const over of [{ permission: "granted", optedIn: true }, { permission: "denied" }, { support: { supported: false, reason: "no-push" } }, { dismissed: true }]) {
      makeService(over);
      const { container, unmount } = render(<PushOptInBanner />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});

describe("PushStatusCard (Notifications page)", () => {
  it("off: offers Enable; on: offers Turn off; blocked / unsupported: explain instead of offering a dead button", () => {
    makeService();
    let r = render(<PushStatusCard />);
    expect(screen.getByRole("button", { name: /Enable Notifications/ })).toBeTruthy();
    r.unmount();

    const s = makeService({ permission: "granted", optedIn: true });
    r = render(<PushStatusCard />);
    expect(screen.getByText(/on for this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Turn off/ }));
    expect(s.disable).toHaveBeenCalledWith("u1");
    r.unmount();

    makeService({ permission: "denied" });
    r = render(<PushStatusCard />);
    expect(screen.getByText(/blocked/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enable/ })).toBeNull();
    r.unmount();

    makeService({ support: { supported: false, reason: "ios-needs-install" } });
    r = render(<PushStatusCard />);
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // State C (docs/PUSH_NOTIFICATIONS.md "Phase 3"): browser permission Allowed but the device failed to
  // register must NEVER read as "blocked" or as plain "off" -- it needs its own explanation + Retry.
  it("permission granted but registration fails: 'isn't connected yet' + Retry, never 'blocked' or silently 'off'", async () => {
    makeService({ permission: "granted", enableResult: { ok: false, code: "token-failed" } });
    const r = render(<PushStatusCard />);
    // Before any attempt: permission granted, never registered -> the plain "off/Enable" copy is correct.
    expect(screen.getByText(/off on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Enable Notifications/ }));
    await waitFor(() => expect(screen.getByText(/isn't connected yet/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /^Retry$/ })).toBeTruthy();
    expect(screen.queryByText(/blocked/i)).toBeNull();
    expect(screen.queryByText(/off on this device/)).toBeNull();
    r.unmount();
  });

});

describe("PushOptInBanner — registration-error (State C)", () => {
  it("stays visible with Retry copy after a failed attempt, instead of disappearing or looking like 'off'", async () => {
    makeService({ permission: "granted", enableResult: { ok: false, code: "token-failed" } });
    render(<PushOptInBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Enable Notifications/ }));
    await waitFor(() => expect(screen.getByText(/Finish turning on notifications/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /^Retry$/ })).toBeTruthy();
  });

  // Absolute Rule 24 ("do not report registration failure if the device was successfully registered" cuts
  // both ways): a stale local "opted in" flag from an EARLIER success must not keep reading as "enabled"
  // once the silent sign-in refresh (a real live registration attempt) actually fails.
  it("a stale 'opted in' flag from an earlier success is overridden the moment a live refresh attempt fails", async () => {
    makeService({ permission: "granted", optedIn: true, refreshResult: { ok: false, code: "token-failed" } });
    render(<PushOptInBanner />); // autoRefresh: true -- runs the (failing) silent refresh on mount
    await waitFor(() => expect(screen.getByText(/Finish turning on notifications/)).toBeTruthy());
    expect(screen.queryByText(/Turn on notifications/)).toBeNull();
  });
});
