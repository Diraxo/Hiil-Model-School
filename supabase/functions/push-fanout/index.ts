// Supabase Database Webhook (INSERT on public.notifications) -> this function -> FCM HTTP v1 -> devices.
// Supabase remains the source of truth; FCM is only the delivery layer. Secrets live in the Edge
// Function's environment (`supabase secrets set ...`), never in the browser or the repository:
//   PUSH_WEBHOOK_SECRET   shared secret the webhook sends in the `x-webhook-secret` header
//   FCM_SERVICE_ACCOUNT   Firebase service-account JSON (single line)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   injected automatically by Supabase
// Deployed with --no-verify-jwt (the project may use non-JWT API keys): the shared
// secret in `x-webhook-secret` is therefore the ONLY gate and must stay long and random. (Keys are
// rotated with `supabase secrets set` + re-running the webhook SQL template.)
//
// Authorization model: the recipient is NEVER taken from the request. The webhook only names a
// notification id; the row (recipient, type, navigation, actor) is re-read with the service role, and
// that row was created by an authorization-checked notify_* RPC. Only the recipient's own enabled
// device rows are used, and only while the recipient's account is ACTIVE.
//
// Idempotency: push_deliveries records each (notification, device) result. A redelivered webhook
// skips devices already 'sent', so retries never produce duplicate pushes.
//
// Logging policy: only fixed strings, notification ids and counters. Never a token, the service
// account, the webhook secret, notification text, or a raw error message (they can quote secrets).
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  GOOGLE_TOKEN_URI,
  buildMessage,
  isFresh,
  parseServiceAccount,
  parseWebhook,
  safeEqual,
  sendWithRetry,
  type DeviceRow,
  type NotificationRow,
  type ServiceAccount,
} from "./logic.ts";

const HTTP_TIMEOUT_MS = 8000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- Google OAuth for FCM v1 (service account -> short-lived access token) --------------------
const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
let cached: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: GOOGLE_TOKEN_URI,
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch(GOOGLE_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const json = await res.json();
  if (typeof json?.access_token !== "string") throw new Error("oauth: no access_token");
  cached = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cached.token;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("x-webhook-secret") ?? "", secret)) {
    return new Response("unauthorized", { status: 401 });
  }

  // Only a Database Webhook INSERT on public.notifications is accepted; only the row id is taken from it.
  const parsed = parseWebhook(await req.json().catch(() => null));
  if (!parsed.ok) return new Response(`ignored: ${parsed.reason}`, { status: 200 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Re-read the notification: recipient, type, navigation and actor come from the source of truth.
  const { data: row, error: rowErr } = await admin
    .from("notifications")
    .select("id, user_id, type, title, navigation, actor_user_id, created_at")
    .eq("id", parsed.id)
    .maybeSingle();
  if (rowErr) return new Response("db error", { status: 500 });
  if (!row) return new Response("notification not found", { status: 200 });
  const n = row as NotificationRow;
  if (!isFresh(n.created_at, Date.now())) return new Response("stale notification ignored", { status: 200 });

  // A suspended / disabled / removed account must not keep receiving pushes on a device it once used.
  const { data: profile, error: profErr } = await admin.from("profiles").select("status").eq("id", n.user_id).maybeSingle();
  if (profErr) return new Response("db error", { status: 500 });
  if (!profile || (profile as { status: string }).status !== "ACTIVE") return new Response("recipient not active", { status: 200 });

  const { data: devices, error } = await admin
    .from("device_tokens")
    .select("id, token, platform")
    .eq("user_id", n.user_id)
    .eq("enabled", true);
  if (error) return new Response("db error", { status: 500 });
  if (!devices?.length) return new Response("no devices", { status: 200 });

  // Idempotency: skip devices this notification already reached.
  const { data: ledger, error: ledgerErr } = await admin.from("push_deliveries").select("device_row_id, status").eq("notification_id", n.id);
  if (ledgerErr) return new Response("db error", { status: 500 });
  const already = new Set((ledger ?? []).filter((l: { status: string }) => l.status === "sent").map((l: { device_row_id: string }) => l.device_row_id));
  const todo = (devices as DeviceRow[]).filter((d) => !already.has(d.id));
  if (!todo.length) return new Response(JSON.stringify({ sent: 0, skipped: devices.length }), { status: 200 });

  let actorName: string | null = null;
  if (n.actor_user_id) {
    const { data: actor } = await admin.from("profiles").select("full_name").eq("id", n.actor_user_id).maybeSingle();
    actorName = (actor as { full_name?: string } | null)?.full_name ?? null;
  }

  // Authoritative unread count for the app-icon badge (web only, see buildMessage). Read fresh here
  // rather than trusting anything client-supplied; the (user_id, read) index makes this a cheap count.
  const { count: unreadCount, error: unreadErr } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", n.user_id)
    .eq("read", false);
  if (unreadErr) return new Response("db error", { status: 500 });

  const parsedSa = parseServiceAccount(Deno.env.get("FCM_SERVICE_ACCOUNT"));
  if (!parsedSa.ok) {
    console.error(`push-fanout: ${parsedSa.reason}`); // fixed strings only, never the secret's content
    return new Response("fcm not configured", { status: 500 });
  }
  const sa = parsedSa.sa;
  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (e) {
    console.error("push-fanout: google oauth token exchange failed", e instanceof Error ? e.name : "unknown");
    return new Response("fcm auth failed", { status: 502 });
  }

  const dead: string[] = [];
  const ledgerRows: { notification_id: string; device_row_id: string; status: "sent" | "failed"; attempts: number; error_code: string | null; updated_at: string }[] = [];
  let sent = 0;
  let failed = 0;
  await Promise.all(todo.map(async (d) => {
    const r = await sendWithRetry(async () => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(buildMessage(n, d, actorName, unreadCount ?? 0)),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, sleep);
    if (r.outcome === "sent") sent++;
    else if (r.outcome === "dead") dead.push(d.id);
    else failed++;
    if (r.outcome !== "dead") {
      ledgerRows.push({ notification_id: n.id, device_row_id: d.id, status: r.outcome === "sent" ? "sent" : "failed", attempts: r.attempts, error_code: r.errorCode, updated_at: new Date().toISOString() });
    }
  }));
  if (dead.length) await admin.from("device_tokens").delete().in("id", dead);
  if (ledgerRows.length) await admin.from("push_deliveries").upsert(ledgerRows, { onConflict: "notification_id,device_row_id" });

  console.log(JSON.stringify({ notification: n.id, sent, pruned: dead.length, failed }));
  // Every device failed for a non-token reason (auth/config/quota/outage): surface it in the webhook log;
  // re-driving the same webhook later retries only the failed devices.
  return new Response(JSON.stringify({ sent, pruned: dead.length, failed }), { status: sent === 0 && failed > 0 ? 502 : 200 });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("push-fanout: unexpected error", e instanceof Error ? e.name : "unknown");
    return new Response("error", { status: 500 });
  }
});
