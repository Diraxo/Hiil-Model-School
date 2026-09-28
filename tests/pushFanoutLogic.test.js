import { describe, expect, it, vi } from "vitest";
import {
  buildBody, buildMessage, clickUrl, classifyFcmResponse, errorCodeOf, isDeadTokenResponse, isFresh, parseServiceAccount,
  parseWebhook, safeEqual, sendWithRetry, GENERIC_BODY, PUSH_TITLE, TITLE_BY_TYPE, titleFor,
} from "../supabase/functions/push-fanout/logic.ts";
import { notificationPageKey } from "../src/utils/notifications";
import { notificationIdFromSearch } from "../src/utils/pushNavigation";

const ID = "11111111-2222-4333-8444-555555555555";
const row = (o = {}) => ({ id: ID, user_id: "u", type: "ANNOUNCEMENT", title: "Sports day", navigation: { page: "announcements" }, ...o });
const sleep = vi.fn(async () => {});
const ok = { status: 200, body: { name: "projects/x/messages/1" } };
const dead = { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } };

describe("notification text (privacy-safe, actor-aware)", () => {
  it("announcement: names the actor from the authoritative profile and shows the public headline", () => {
    expect(buildBody(row(), "Amina Hassan")).toBe("Amina Hassan: Sports day");
    expect(buildBody(row({ title: "" }), "Amina Hassan")).toBe("Amina Hassan: New announcement from the school");
    expect(buildBody(row(), null)).toBe("Sports day");
  });
  it("sensitive types stay generic and never carry an actor name, amount or title", () => {
    for (const type of ["PAYMENT", "PAYROLL", "RESULT", "ATTENDANCE", "LEAVE", "BEHAVIOR", "SCHEDULE"]) {
      const body = buildBody(row({ type, title: "Paid 4,500 Birr for Ahmed Yusuf" }), "Finance Person");
      expect(body).toBe(GENERIC_BODY[type]);
      expect(body).not.toMatch(/4,500|Ahmed|Finance Person/);
    }
  });
  it("homework and messages may name the person but never expose content", () => {
    expect(buildBody(row({ type: "HOMEWORK", title: "Q3 fractions" }), "Mr Ali")).toBe("Mr Ali posted new homework.");
    expect(buildBody(row({ type: "HOMEWORK" }), null)).toBe(GENERIC_BODY.HOMEWORK);
    expect(buildBody(row({ type: "MESSAGE", title: "secret text" }), "Mr Ali")).toBe("Mr Ali sent you a message.");
    expect(buildBody(row({ type: "MESSAGE" }), null)).toBe(GENERIC_BODY.MESSAGE);
  });
  it("unknown types fall back safely; newlines and long headlines are neutralised", () => {
    expect(buildBody(row({ type: "SOMETHING_NEW" }), "X")).toBe("You have a new notification");
    expect(buildBody(row({ type: null }), null)).toBe("You have a new notification");
    const long = buildBody(row({ title: `a\nb${"z".repeat(200)}` }), null);
    expect(long).not.toMatch(/\n/);
    expect(long.length).toBeLessThanOrEqual(80);
  });
});

describe("notification titles (say WHAT happened; body carries the safe detail)", () => {
  it("every type in GENERIC_BODY has a matching title, distinct from the generic app-identity fallback", () => {
    for (const type of Object.keys(GENERIC_BODY)) {
      expect(TITLE_BY_TYPE[type]).toBeTruthy();
      expect(titleFor(type)).toBe(TITLE_BY_TYPE[type]);
    }
  });
  it("unknown/missing types fall back to the app identity", () => {
    expect(titleFor("SOMETHING_NEW")).toBe(PUSH_TITLE);
    expect(titleFor(null)).toBe(PUSH_TITLE);
    expect(titleFor(undefined)).toBe(PUSH_TITLE);
  });
});

describe("FCM HTTP v1 message construction", () => {
  it("web: DATA-ONLY (rendered by our worker), all values strings, per-type title, click url carries only the id", () => {
    const { message } = buildMessage(row(), { token: "tok", platform: "web" }, "Amina Hassan", 7);
    expect(message.token).toBe("tok");
    expect(message.notification).toBeUndefined();
    expect(message.data).toMatchObject({ title: "New announcement", body: "Amina Hassan: Sports day", notificationId: ID, tag: ID, type: "ANNOUNCEMENT", url: `/?n=${ID}`, badge: "7" });
    for (const v of Object.values(message.data)) expect(typeof v).toBe("string");
    expect(JSON.parse(message.data.navigation)).toEqual({ page: "announcements" });
    expect(message.webpush.headers).toMatchObject({ TTL: "86400", Urgency: "high" });
    expect(JSON.stringify(message)).not.toMatch(/user_id|"u"/); // recipient id never leaves for Google
  });
  it("web: badge defaults to \"0\" when no unread count is supplied", () => {
    const { message } = buildMessage(row(), { token: "tok", platform: "web" }, null);
    expect(message.data.badge).toBe("0");
  });
  it("android/ios keep a native notification block with the same safe text and per-type title", () => {
    const { message } = buildMessage(row({ type: "PAYMENT" }), { token: "t", platform: "android" }, "Finance");
    expect(message.notification).toEqual({ title: TITLE_BY_TYPE.PAYMENT, body: GENERIC_BODY.PAYMENT });
    expect(message.android.notification.tag).toBe(ID);
    expect(message.data.badge).toBeUndefined(); // badge only ever travels on the web data payload
  });
  it("click routing metadata for every event type (badge page + destination)", () => {
    const cases = { ANNOUNCEMENT: "announcements", ATTENDANCE: null, PAYMENT: "payments", RESULT: "exams", LEAVE: "leaveRequests", HOMEWORK: "homework" };
    for (const [type, page] of Object.entries(cases)) {
      expect(notificationPageKey({ type, navigation: null }), type).toBe(page);
      const nav = page ? { page } : null;
      expect(JSON.parse(buildMessage(row({ type, navigation: nav }), { token: "t", platform: "web" }).message.data.navigation).page).toBe(page);
    }
    expect(clickUrl(ID)).toBe(`/?n=${ID}`);
    expect(notificationIdFromSearch(`?n=${ID}`)).toBe(ID);
    expect(notificationIdFromSearch("?n=../../etc")).toBeNull();
  });
});

describe("delivery outcomes, retry and failure handling", () => {
  it("classifies sent / dead token / transient / permanent", () => {
    expect(classifyFcmResponse(200, {})).toBe("sent");
    expect(classifyFcmResponse(404, {})).toBe("dead");
    expect(classifyFcmResponse(400, { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } })).toBe("dead");
    expect(classifyFcmResponse(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } })).toBe("failed"); // bad payload must NOT delete tokens
    expect(classifyFcmResponse(401, { error: { status: "UNAUTHENTICATED" } })).toBe("failed"); // expired/invalid credentials: keep tokens
    expect(classifyFcmResponse(403, {})).toBe("failed");
    expect(classifyFcmResponse(429, {})).toBe("retry");
    expect(classifyFcmResponse(503, {})).toBe("retry");
    expect(isDeadTokenResponse(200, null)).toBe(false);
    expect(errorCodeOf(401, { error: { status: "UNAUTHENTICATED" } })).toBe("401:UNAUTHENTICATED");
  });

  it("successful send: one attempt", async () => {
    const send = vi.fn(async () => ok);
    expect(await sendWithRetry(send, sleep)).toEqual({ outcome: "sent", attempts: 1, errorCode: null });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("temporary FCM failure is retried with backoff and then succeeds", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 503, body: {} }).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(ok);
    const wait = vi.fn(async () => {});
    expect(await sendWithRetry(send, wait)).toEqual({ outcome: "sent", attempts: 3, errorCode: null });
    expect(wait.mock.calls.map((c) => c[0])).toEqual([400, 800]);
  });
  it("persistent server error stops after the bounded attempts and is reported failed (kept for a later re-drive)", async () => {
    const send = vi.fn(async () => ({ status: 500, body: { error: { status: "INTERNAL" } } }));
    expect(await sendWithRetry(send, sleep)).toEqual({ outcome: "failed", attempts: 3, errorCode: "500:INTERNAL" });
  });
  it("network errors are treated as transient, never thrown", async () => {
    const send = vi.fn(async () => { throw new Error("boom"); });
    expect(await sendWithRetry(send, sleep)).toEqual({ outcome: "failed", attempts: 3, errorCode: "network" });
  });
  it("invalid / unregistered token is NOT retried (no indefinite retry of a permanent failure)", async () => {
    const send = vi.fn(async () => dead);
    expect((await sendWithRetry(send, sleep)).outcome).toBe("dead");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("invalid credentials (401) are not retried and never treated as a dead token", async () => {
    const send = vi.fn(async () => ({ status: 401, body: { error: { status: "UNAUTHENTICATED" } } }));
    expect((await sendWithRetry(send, sleep)).outcome).toBe("failed");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("partial multi-device delivery: each device is judged independently", async () => {
    const responses = { good: ok, gone: dead, flaky: { status: 503, body: {} } };
    const results = await Promise.all(Object.keys(responses).map((d) => sendWithRetry(async () => responses[d], sleep)));
    expect(results.map((r) => r.outcome)).toEqual(["sent", "dead", "failed"]);
  });
});

describe("webhook + secret handling", () => {
  it("accepts only a notifications INSERT and only trusts the row id (never a recipient in the payload)", () => {
    expect(parseWebhook({ type: "INSERT", schema: "public", table: "notifications", record: { id: ID, user_id: "attacker" } })).toEqual({ ok: true, id: ID });
    expect(parseWebhook({ type: "UPDATE", schema: "public", table: "notifications", record: { id: ID } }).ok).toBe(false);
    expect(parseWebhook({ type: "INSERT", schema: "public", table: "profiles", record: { id: ID } }).ok).toBe(false);
    expect(parseWebhook({ type: "INSERT", schema: "public", table: "notifications", record: { id: "x'; drop" } }).ok).toBe(false);
    expect(parseWebhook(null).ok).toBe(false);
  });
  it("constant-time secret comparison", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("stale webhook deliveries are dropped", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(isFresh("2026-09-27T11:55:00Z", now)).toBe(true);
    expect(isFresh("2026-09-27T11:00:00Z", now)).toBe(false);
    expect(isFresh(null, now)).toBe(true);
  });
  it("service account parsing: fixed reasons only, private key never echoed, token endpoint pinned", () => {
    expect(parseServiceAccount(undefined)).toEqual({ ok: false, reason: "FCM_SERVICE_ACCOUNT is not set" });
    const bad = parseServiceAccount('{"private_key": "SECRET-KEY-MATERIAL" oops');
    expect(bad).toEqual({ ok: false, reason: "FCM_SERVICE_ACCOUNT is not valid JSON" });
    expect(JSON.stringify(bad)).not.toMatch(/SECRET-KEY-MATERIAL/);
    expect(parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "e" })).reason).toMatch(/missing private_key/);
    expect(parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "e", private_key: "k", token_uri: "https://evil.example/token" })).reason).toMatch(/token_uri/);
    expect(parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "e", private_key: "k" })).ok).toBe(true);
  });
});
