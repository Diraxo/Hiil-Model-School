import { useCallback, useEffect, useMemo, useState } from "react";
import { getPushService } from "../services/pushService";
import { useToast } from "../context/ToastContext";

// Human copy for every way enabling can fail (shown through the app's toast system, not a native dialog).
export const PUSH_MESSAGES = {
  enabled: "Notifications are on for this device.",
  disabled: "Notifications are off for this device.",
  denied: "Notifications are blocked. Allow them for Hiil Model School in your browser or phone settings, then try again.",
  dismissed: "Notifications were not enabled. You can turn them on any time from Notifications.",
  "service-worker-failed": "Couldn't start the notification service on this device. Please reload and try again.",
  "token-failed": "Couldn't connect to the notification service. Check your connection and try again.",
  "registration-failed": "Couldn't register this device. Please try again.",
  unsupported: "This browser can't receive push notifications.",
};

export const UNSUPPORTED_MESSAGES = {
  "ios-needs-install": "On iPhone, add Hiil Model School to your Home Screen (Share → Add to Home Screen), open it from there, then turn on notifications.",
  "no-notifications": "This browser doesn't support notifications.",
  "no-service-worker": "This browser doesn't support the background service needed for notifications.",
  "no-push": "This browser doesn't support push notifications.",
  "not-configured": "Push notifications aren't set up yet.",
};

/**
 * Permission + registration state for the signed-in user on THIS device. Browser permission and actual
 * server registration are two different facts (see docs/PUSH_NOTIFICATIONS.md "Phase 3/4"), so a granted
 * permission is never itself reported as "enabled" -- only a successful register_device_token is.
 * status: 'unsupported' | 'default' | 'denied'
 *       | 'granted'            (browser allowed, never registered on this device yet)
 *       | 'registration-error' (browser allowed, the last enable/refresh attempt failed -- retry, not "off")
 *       | 'enabled'.
 */
export function usePushNotifications(userId, { service = getPushService(), autoRefresh = false } = {}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [lastErrorCode, setLastErrorCode] = useState(null);
  const bump = () => setTick((t) => t + 1);

  const support = useMemo(() => service.support(), [service, tick]);
  const permission = service.permission();
  const optedIn = service.isOptedIn(userId);
  // A registration failure (enable() or a silent refresh()) always wins over a stale "opted in" flag from
  // an earlier, different success: never report "enabled" for a device that just failed to register.
  const status = !support.supported ? "unsupported"
    : permission === "denied" ? "denied"
    : permission !== "granted" ? "default"
    : lastErrorCode ? "registration-error"
    : optedIn ? "enabled"
    : "granted";

  // Every hook instance (banner + Notifications page) re-renders when any of them changes the state.
  useEffect(() => service.subscribe(bump), [service]);

  // Re-register silently after sign-in (FCM tokens rotate; a previous sign-out removed this device's row).
  // One call per sign-in from ONE mounted instance (autoRefresh), never a timer; never prompts. A failure
  // here is just as real as a failed Enable click, so it surfaces the same way (registration-error).
  useEffect(() => {
    if (!userId || !autoRefresh) return;
    let cancelled = false;
    service.refresh(userId).then((r) => {
      if (cancelled) return;
      if (r.ok) setLastErrorCode(null);
      else if (r.code && r.code !== "skipped") setLastErrorCode(r.code);
      bump();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, service, autoRefresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const r = await service.enable(userId);
      if (r.ok) { setLastErrorCode(null); toast(PUSH_MESSAGES.enabled, "success"); }
      else if (r.code === "unsupported") toast(UNSUPPORTED_MESSAGES[r.reason] || PUSH_MESSAGES.unsupported, "error");
      else {
        // denied/dismissed are permission-level facts the status already reads straight from the browser;
        // only the three registration-path failures need remembering as "granted but not connected".
        if (r.code === "service-worker-failed" || r.code === "token-failed" || r.code === "registration-failed") setLastErrorCode(r.code);
        toast(PUSH_MESSAGES[r.code] || PUSH_MESSAGES["registration-failed"], r.code === "dismissed" ? "info" : "error");
      }
      return r;
    } finally {
      setBusy(false);
      bump();
    }
  }, [service, userId, toast]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await service.disable(userId);
      setLastErrorCode(null);
      toast(PUSH_MESSAGES.disabled, "info");
    } finally {
      setBusy(false);
      bump();
    }
  }, [service, userId, toast]);

  const dismiss = useCallback(() => { service.dismiss(userId); bump(); }, [service, userId]);

  return { status, support, busy, lastErrorCode, dismissed: service.isDismissed(userId), enable, disable, dismiss };
}
