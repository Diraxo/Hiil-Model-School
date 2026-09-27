import React from "react";
import { BellRing, BellOff, Info } from "lucide-react";
import { Card, PrimaryButton, GhostButton } from "./ui";
import { useAuth } from "../context/AuthContext";
import { usePushNotifications, UNSUPPORTED_MESSAGES, PUSH_MESSAGES } from "../hooks/usePushNotifications";

// Opt-in banner shown at the top of the signed-in app. Permission is requested ONLY when the user taps
// "Enable Notifications"; "Not now" hides it for this user on this device until they enable from the
// Notifications page. Hidden entirely once enabled, when blocked, or when push isn't available (the
// Notifications page explains those states). A device the browser allowed but that failed to register
// (registration-error) stays visible too, as a retry -- it must never look like "off"/never-tried.
export function PushOptInBanner() {
  const auth = useAuth();
  const push = usePushNotifications(auth.realUser?.id ?? auth.currentUser?.id, { autoRefresh: true });
  if (!auth.currentUser) return null;
  if (push.dismissed) return null;
  if (!["default", "granted", "registration-error"].includes(push.status)) return null;
  const isRetry = push.status === "registration-error";

  return (
    <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4 flex flex-col sm:flex-row sm:items-center gap-3" role="region" aria-label="Turn on notifications">
      <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center shrink-0"><BellRing size={20} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{isRetry ? "Finish turning on notifications" : "Turn on notifications"}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {isRetry
            ? (PUSH_MESSAGES[push.lastErrorCode] || "This device is allowed to get notifications but isn't connected yet.")
            : "Stay updated with attendance, announcements, payments, homework, results and important school activity."}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <PrimaryButton icon={BellRing} onClick={push.enable} loading={push.busy} loadingText={isRetry ? "Retrying…" : "Enabling…"}>{isRetry ? "Retry" : "Enable Notifications"}</PrimaryButton>
        <GhostButton onClick={push.dismiss} disabled={push.busy}>Not now</GhostButton>
      </div>
    </div>
  );
}

// Compact control on the Notifications page: shows the device's push state and lets the user turn it
// on/off, including the "blocked" and "unsupported" explanations.
export function PushStatusCard() {
  const auth = useAuth();
  const push = usePushNotifications(auth.realUser?.id ?? auth.currentUser?.id);
  const uid = auth.realUser?.id ?? auth.currentUser?.id;
  if (!uid) return null;

  let icon = BellRing;
  let title = "Push notifications are off on this device";
  let detail = "Get attendance, announcements, payments, homework and results the moment they happen.";
  let action = <PrimaryButton icon={BellRing} onClick={push.enable} loading={push.busy} loadingText="Enabling…">Enable Notifications</PrimaryButton>;

  if (push.status === "enabled") {
    title = "Push notifications are on for this device";
    detail = "You'll be alerted even when Hiil Model School is closed.";
    action = <GhostButton onClick={push.disable} loading={push.busy}>Turn off</GhostButton>;
  } else if (push.status === "registration-error") {
    // Browser permission is Allowed -- this is NOT "blocked" and must never be shown as such (Phase 3/22).
    title = "Notifications are allowed, but this device isn't connected yet";
    detail = PUSH_MESSAGES[push.lastErrorCode] || "Something went wrong finishing setup on this device. You can try again.";
    action = <PrimaryButton icon={BellRing} onClick={push.enable} loading={push.busy} loadingText="Retrying…">Retry</PrimaryButton>;
  } else if (push.status === "denied") {
    icon = BellOff;
    title = "Notifications are blocked";
    detail = "Allow notifications for Hiil Model School in your browser or phone settings, then come back and enable them here.";
    action = null;
  } else if (push.status === "unsupported") {
    icon = Info;
    title = "Push notifications aren't available here";
    detail = UNSUPPORTED_MESSAGES[push.support.reason] || UNSUPPORTED_MESSAGES["no-push"];
    action = null;
  }
  const Icon = icon;

  return (
    <Card className="mb-4 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><Icon size={18} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5">{detail}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </Card>
  );
}
