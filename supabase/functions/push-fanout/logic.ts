// Pure, dependency-free logic for the push-fanout Edge Function (unit-tested with vitest from
// tests/pushFanoutLogic.test.js; no Deno / Supabase / network APIs in here).

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string | null;
  title?: string | null;
  navigation: Record<string, unknown> | null;
  actor_user_id?: string | null;
  created_at?: string | null;
};

export type DevicePlatform = "web" | "android" | "ios";
export type DeviceRow = { id: string; token: string; platform: DevicePlatform };

// PRIVACY: lock-screen text is deliberately generic. Payment amounts, scores, student names, leave
// reasons and message bodies are NOT sent through Google's servers; the app shows them after the
// user authenticates. Keyed by the notification_type enum (20260825181253_comms.sql).
export const GENERIC_BODY: Record<string, string> = {
  ANNOUNCEMENT: "New announcement from the school",
  PAYMENT: "You have a payment update",
  HOMEWORK: "New homework update",
  BEHAVIOR: "Important update about your child",
  MESSAGE: "You have a new message",
  RESULT: "New results are available",
  ATTENDANCE: "Attendance update",
  LEAVE: "Leave request update",
  EXAM: "New exam update",
  SCHEDULE: "Timetable update",
  PAYROLL: "You have a payroll update",
};
export const FALLBACK_BODY = "You have a new notification";
export const PUSH_TITLE = "Hiil Model School";

// Types where naming the person who caused it is useful and not sensitive. Payments, payroll,
// attendance, behaviour, leave and results never carry a name on the lock screen.
const ACTOR_TYPES = new Set(["ANNOUNCEMENT", "HOMEWORK", "MESSAGE", "EXAM"]);
const MAX_ANNOUNCEMENT_TITLE = 80;

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Lock-screen text for a notification. Pure; `actorName` comes from the authoritative profiles row. */
export function buildBody(row: Pick<NotificationRow, "type" | "title">, actorName?: string | null): string {
  const type = row.type ?? "";
  const generic = Object.prototype.hasOwnProperty.call(GENERIC_BODY, type) ? GENERIC_BODY[type] : FALLBACK_BODY;
  const who = ACTOR_TYPES.has(type) && actorName ? clean(actorName) : "";
  if (type === "MESSAGE") return who ? `New message from ${who}` : generic;
  if (type === "ANNOUNCEMENT") {
    // A school-wide announcement's headline is public by nature; everything else stays generic.
    const headline = row.title ? clean(row.title).slice(0, MAX_ANNOUNCEMENT_TITLE) : "";
    const text = headline || generic;
    return who ? `${who}: ${text}` : text;
  }
  return who ? `${who}: ${generic}` : generic;
}

/** Same-origin, relative click target: only the notification id travels; the app re-checks access. */
export function clickUrl(notificationId: string): string {
  return `/?n=${encodeURIComponent(notificationId)}`;
}

/**
 * FCM HTTP v1 message for ONE device.
 *  web            data-only, rendered by public/firebase-messaging-sw.js (so foreground suppression and
 *                 click routing are ours, not the SDK's). All values are strings.
 *  android / ios  a `notification` block the OS renders itself (mobile app), same safe text.
 * `tag` = notification id: a redelivered push replaces the first one in the tray instead of stacking.
 */
export function buildMessage(row: NotificationRow, device: Pick<DeviceRow, "token" | "platform">, actorName?: string | null) {
  const page = (row.navigation as { page?: unknown } | null)?.page;
  const body = buildBody(row, actorName);
  const data = {
    notificationId: row.id,
    type: row.type ?? "",
    navigation: JSON.stringify({ page: typeof page === "string" ? page : null }),
  };
  if (device.platform === "web") {
    return {
      message: {
        token: device.token,
        data: { ...data, title: PUSH_TITLE, body, url: clickUrl(row.id), tag: row.id },
        webpush: { headers: { TTL: "86400", Urgency: "high" } },
      },
    };
  }
  return {
    message: {
      token: device.token,
      notification: { title: PUSH_TITLE, body },
      data,
      android: { priority: "HIGH", ttl: "86400s", notification: { channel_id: "default", tag: row.id } },
    },
  };
}

/** Webhook deliveries older than this are ignored (replay / long-outage protection). */
export const MAX_NOTIFICATION_AGE_MS = 15 * 60 * 1000;

/** True when the notification is recent enough to push. A missing/unparseable timestamp is treated as fresh. */
export function isFresh(createdAt: string | null | undefined, now: number, maxAgeMs: number = MAX_NOTIFICATION_AGE_MS): boolean {
  if (!createdAt) return true;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? true : now - t <= maxAgeMs;
}

export type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Parses the FCM_SERVICE_ACCOUNT secret. On failure it returns a FIXED reason and never the parser's own
 * message: V8's JSON errors quote a fragment of the input, which here would be the private key.
 */
export function parseServiceAccount(raw: string | undefined): { ok: true; sa: ServiceAccount } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: "FCM_SERVICE_ACCOUNT is not set" };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, reason: "FCM_SERVICE_ACCOUNT is not valid JSON" }; }
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  for (const k of ["project_id", "client_email", "private_key"]) {
    if (typeof o[k] !== "string" || !o[k]) return { ok: false, reason: `FCM_SERVICE_ACCOUNT is missing ${k}` };
  }
  // The OAuth token endpoint is fixed: a service-account file must never redirect the signed assertion elsewhere.
  if (o.token_uri !== undefined && o.token_uri !== GOOGLE_TOKEN_URI) return { ok: false, reason: "FCM_SERVICE_ACCOUNT has an unexpected token_uri" };
  return { ok: true, sa: { project_id: o.project_id as string, client_email: o.client_email as string, private_key: o.private_key as string } };
}

export type FcmOutcome = "sent" | "dead" | "retry" | "failed";

/**
 * How to treat one FCM HTTP v1 response.
 *  sent   2xx
 *  dead   the registration token is gone -> delete that device row
 *  retry  transient (429 / 5xx / network) -> try again a couple of times
 *  failed anything else (bad payload, auth/config, quota): keep the token, report, never delete
 */
export function classifyFcmResponse(status: number, body: unknown): FcmOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (isDeadTokenResponse(status, body)) return "dead";
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

/** Returned alongside the outcome so the ledger can record WHY a delivery failed (never a token or message text). */
export function errorCodeOf(status: number, body: unknown): string {
  const err = (body as { error?: { status?: string } } | null)?.error;
  return err?.status ? `${status}:${err.status}` : String(status);
}

/**
 * Sends with a small bounded retry for transient failures. `send` and `sleep` are injected so this is
 * unit-testable without a network. Never throws: a thrown send (network error) counts as transient.
 */
export async function sendWithRetry(
  send: () => Promise<{ status: number; body: unknown }>,
  sleep: (ms: number) => Promise<void>,
  attempts = 3,
  baseDelayMs = 400,
): Promise<{ outcome: FcmOutcome; attempts: number; errorCode: string | null }> {
  let last: FcmOutcome = "retry";
  let errorCode: string | null = null;
  let used = 0;
  for (let i = 0; i < attempts; i++) {
    used = i + 1;
    try {
      const r = await send();
      last = classifyFcmResponse(r.status, r.body);
      errorCode = last === "sent" ? null : errorCodeOf(r.status, r.body);
    } catch {
      last = "retry";
      errorCode = "network";
    }
    if (last !== "retry") return { outcome: last, attempts: used, errorCode };
    if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
  }
  return { outcome: "failed", attempts: used, errorCode }; // still transient after every attempt
}

/**
 * Accepts only a Supabase Database Webhook INSERT on public.notifications and returns the notification
 * id. The function then RE-READS the row from the database with the service role and never trusts the
 * rest of the payload (recipient, type, navigation): a leaked webhook secret alone cannot choose who
 * receives a push or what it says.
 */
export function parseWebhook(payload: unknown): { ok: true; id: string } | { ok: false; reason: string } {
  const p = payload as { type?: unknown; table?: unknown; schema?: unknown; record?: { id?: unknown } } | null;
  if (!p || typeof p !== "object") return { ok: false, reason: "no payload" };
  if (p.type !== "INSERT") return { ok: false, reason: "not an insert" };
  if (p.schema !== "public" || p.table !== "notifications") return { ok: false, reason: "unexpected source table" };
  const id = p.record?.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, reason: "bad record id" };
  return { ok: true, id };
}

/** Constant-time comparison so the shared secret can't be probed by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Stale-token detection. FCM v1 reports a dead registration as HTTP 404 (UNREGISTERED). HTTP 400 is
 * ONLY treated as a dead token when the error says the *registration token* is invalid: a 400 caused
 * by a bad payload/config must never delete working tokens.
 */
export function isDeadTokenResponse(status: number, body: unknown): boolean {
  const err = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null)?.error;
  const codes = (err?.details ?? []).map((d) => d.errorCode);
  if (codes.includes("UNREGISTERED")) return true;
  if (status === 404) return true;
  if (status === 400 && err?.status === "INVALID_ARGUMENT" && /registration token/i.test(err.message ?? "")) return true;
  return false;
}
