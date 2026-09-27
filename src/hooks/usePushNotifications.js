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
 * Permission + registration state for the signed-in user on THIS device.
 * status: 'unsupported' | 'default' | 'denied' | 'granted' (browser allowed, this user not registered) | 'enabled'.
 */
export function usePushNotifications(userId, { service = getPushService(), autoRefresh = false } = {}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const support = useMemo(() => service.support(), [service, tick]);
  const permission = service.permission();
  const optedIn = service.isOptedIn(userId);
  const status = !support.supported ? "unsupported"
    : permission === "denied" ? "denied"
    : permission === "granted" && optedIn ? "enabled"
    : permission === "granted" ? "granted"
    : "default";

  // Every hook instance (banner + Notifications page) re-renders when any of them changes the state.
  useEffect(() => service.subscribe(bump), [service]);

  // Re-register silently after sign-in (FCM tokens rotate; a previous sign-out removed this device's row).
  // One call per sign-in from ONE mounted instance (autoRefresh), never a timer; never prompts.
  useEffect(() => {
    if (!userId || !autoRefresh) return;
    let cancelled = false;
    service.refresh(userId).then(() => { if (!cancelled) bump(); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, service, autoRefresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const r = await service.enable(userId);
      if (r.ok) toast(PUSH_MESSAGES.enabled, "success");
      else if (r.code === "unsupported") toast(UNSUPPORTED_MESSAGES[r.reason] || PUSH_MESSAGES.unsupported, "error");
      else toast(PUSH_MESSAGES[r.code] || PUSH_MESSAGES["registration-failed"], r.code === "dismissed" ? "info" : "error");
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
      toast(PUSH_MESSAGES.disabled, "info");
    } finally {
      setBusy(false);
      bump();
    }
  }, [service, userId, toast]);

  const dismiss = useCallback(() => { service.dismiss(userId); bump(); }, [service, userId]);

  return { status, support, busy, dismissed: service.isDismissed(userId), enable, disable, dismiss };
}
