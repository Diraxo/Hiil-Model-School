// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncAppBadge } from "../src/utils/appBadge";

afterEach(() => {
  delete navigator.setAppBadge;
  delete navigator.clearAppBadge;
});

describe("syncAppBadge (keeps the installed PWA's app-icon badge honest)", () => {
  it("a positive count sets the badge to that exact number", async () => {
    navigator.setAppBadge = vi.fn(async () => {});
    navigator.clearAppBadge = vi.fn(async () => {});
    await syncAppBadge(7);
    expect(navigator.setAppBadge).toHaveBeenCalledWith(7);
    expect(navigator.clearAppBadge).not.toHaveBeenCalled();
  });

  it("zero clears the badge instead of setting it to 0", async () => {
    navigator.setAppBadge = vi.fn(async () => {});
    navigator.clearAppBadge = vi.fn(async () => {});
    await syncAppBadge(0);
    expect(navigator.clearAppBadge).toHaveBeenCalled();
    expect(navigator.setAppBadge).not.toHaveBeenCalled();
  });

  it("never increments blindly -- always reflects the exact count it was given", async () => {
    navigator.setAppBadge = vi.fn(async () => {});
    navigator.clearAppBadge = vi.fn(async () => {});
    await syncAppBadge(6);
    await syncAppBadge(7); // a new notification arriving on top of 6 unread
    expect(navigator.setAppBadge).toHaveBeenNthCalledWith(1, 6);
    expect(navigator.setAppBadge).toHaveBeenNthCalledWith(2, 7);
  });

  it("unsupported browsers (no Badging API, e.g. iOS Safari) never throw", async () => {
    await expect(syncAppBadge(3)).resolves.toBeUndefined();
  });

  it("ignores non-numeric input rather than calling the API with garbage", async () => {
    navigator.setAppBadge = vi.fn(async () => {});
    navigator.clearAppBadge = vi.fn(async () => {});
    await syncAppBadge(NaN);
    await syncAppBadge(undefined);
    await syncAppBadge(null);
    expect(navigator.setAppBadge).not.toHaveBeenCalled();
    expect(navigator.clearAppBadge).not.toHaveBeenCalled();
  });
});
