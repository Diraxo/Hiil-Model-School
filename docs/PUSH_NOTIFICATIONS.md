# Push notifications (FCM Web Push) — architecture and owner runbook

Supabase's `notifications` table is the source of truth. Firebase Cloud Messaging is only the delivery layer.

```
authorised action ─► notify_* RPC (SECURITY DEFINER, checks the caller, resolves recipients)
                  ─► INSERT public.notifications  (actor_user_id stamped from auth.uid())
                  ─► Database Webhook ─► Edge Function `push-fanout`
                        re-reads the row with the service role (recipient/type/actor come from the DB,
                        never from the request) ─► enabled device_tokens of that user
                        ─► FCM HTTP v1 (service-account OAuth) ─► device
                  ─► push_deliveries ledger (a redelivered webhook never double-sends)
device: public/firebase-messaging-sw.js shows it (app open / background / closed)
tap  : opens /?n=<notification id> ─► app resolves the id against the signed-in user's own rows (RLS)
```

Nothing polls. The in-app list refreshes through the existing Supabase Realtime channel.

## What ships in this change

| Piece | Where |
|---|---|
| Migration (device_tokens + RPCs, `notifications.actor_user_id`, `push_deliveries`) | `supabase/migrations/20260927000000_push_devices_actor_delivery.sql` (rollback in `supabase/rollbacks/`) |
| Sender | `supabase/functions/push-fanout/` |
| Service worker | `public/firebase-messaging-sw.js` (+ headers in `vercel.json`) |
| Registration / permission | `src/services/pushService.js`, `src/hooks/usePushNotifications.js`, `src/components/PushOptIn.jsx` |
| Tap routing | `src/utils/pushNavigation.js`, `NotificationsPage`, `AppShell` |

Lock-screen text is deliberately safe: payments, results, attendance, leave, behaviour and payroll are generic
("You have a payment update"); a person's name appears only for announcements, homework, messages and exams.
Full detail is shown only inside the app after sign-in.

## Deployment status

Done on 2026-09-27 via the CLI: migration applied (and recorded in history), secrets `FCM_SERVICE_ACCOUNT` + `PUSH_WEBHOOK_SECRET` set, `push-fanout` deployed with `--no-verify-jwt` (the shared-secret header is the gate), and an `AFTER INSERT` pg_net trigger on `notifications` (`supabase/manual/create_push_webhook.sql.template`). A synthetic notification with a fake token was sent through the whole server path: Google OAuth + FCM HTTP v1 answered and the dead token was pruned. **Still to do:** Vercel env vars + redeploy, then device tests. The steps below are the original runbook.

## Deploy runbook

The Supabase CLI on the coding machine is signed in to a different account and cannot see project
`qdasxuwewtbzjbhiulja`, so these need to be run by you.

1. **Migration.** `supabase db push` also applies the other *untracked* migrations in this folder
   (`20260920030000`, `20260920050000`, `20260920055000`). Review those first; if you only want push, apply
   `20260927000000_push_devices_actor_delivery.sql` on its own in the SQL editor. It supersedes the unapplied
   `hiil-mobile/backend/migrations/20260920060000_mobile_device_tokens.sql` — apply one, not both.
2. **Secrets** (the JSON never enters Git; the file is git-ignored):
   ```powershell
   supabase secrets set --project-ref qdasxuwewtbzjbhiulja FCM_SERVICE_ACCOUNT="$(Get-Content -Raw .\hiil-model-school-firebase-adminsdk-fbsvc-be5eb736db.json)"
   supabase secrets set --project-ref qdasxuwewtbzjbhiulja PUSH_WEBHOOK_SECRET="<32+ random chars, e.g. from `openssl rand -hex 32`>"
   ```
   Afterwards move the JSON out of the project folder (or delete it) and consider rotating the key
   (Firebase console → Project settings → Service accounts) since it sat in a synced OneDrive folder.
3. **Deploy the function:** `supabase functions deploy push-fanout --project-ref qdasxuwewtbzjbhiulja`
   (add `--no-verify-jwt` if the project uses the new `sb_secret_*` keys; the secret header is then the gate).
4. **Webhook.** Dashboard → Database → Webhooks → *Create*: table `public.notifications`, event **Insert**,
   type *Supabase Edge Function* → `push-fanout`, HTTP headers `x-webhook-secret: <the same secret>`.
   (Or run `supabase/manual/create_push_webhook.sql.template` with the placeholders filled in.)
5. **Vercel env vars** (Production + Preview), then redeploy — public values only:
   `VITE_FIREBASE_API_KEY` (Firebase console → Project settings → General → Web app), `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY` (values are in `.env.example`; the API key is the only
   one not supplied). Until all are set the app hides the push UI.
6. In Google Cloud, make sure the web API key allows the *Firebase Installations API* and *FCM Registration API*.

## Owner device tests (NOT PHYSICALLY VERIFIED — OWNER DEVICE TEST REQUIRED)

Android (Chrome, installed PWA) and iPhone (Safari → Add to Home Screen → open from the icon), each:
1. Sign in → tap **Enable Notifications** → Allow.
2. Foreground: from another account publish an announcement → in-app toast, badge, no OS banner (iPhone still shows one).
3. Background / minimised: same → OS notification "Hiil Model School / <Name>: <headline>".
4. Closed (swipe the app away): same → notification appears.
5. Tap it → the app opens on Notifications and shows the announcement.
6. Firebase console → Messaging → *Send test message* with the device's FCM token (copy it from the
   `device_tokens` row) → the worker renders it too.
7. Sign out → publish again → nothing arrives on this device. Sign in → Enable is silent (no prompt).

## Known limits

- iPhone only receives Web Push from the Home Screen app (iOS 16.4+), never from a Safari tab; the UI says so.
- Automatic retry is bounded inside one invocation (3 attempts, backoff). If FCM is down longer, the failed
  devices stay `failed` in `push_deliveries` and the in-app notification is unaffected; there is no scheduled
  sweep (that would need a server timer). Re-sending the same webhook payload retries only the failed devices.
- Pushes older than 15 minutes are dropped by the sender (a school alert is stale by then).
- A very large announcement (hundreds of recipients) causes one webhook call per row; each is independent.
