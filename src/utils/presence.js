import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// Presence + typing for the Messages page, backed by Supabase Realtime (not the browser).
//   - "online now"  -> Realtime Presence on a single app-wide channel ("presence:app"). Every
//     authenticated tab tracks { user_id } while mounted; peers read the union of tracked ids.
//   - "last seen X"  -> profiles.last_seen_at, stamped by the touch_presence() RPC on connect and
//     on a heartbeat (migration 20260906000000). Survives the user disconnecting, which Realtime
//     Presence alone cannot.
//   - "… is typing"  -> Realtime Broadcast on a per-conversation channel ("typing:<id>").
// None of this touches the persisted app db or localStorage, so a 25s heartbeat / per-keystroke
// typing ping never re-serializes app state.

const ONLINE_THRESHOLD_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 25000;
const LAST_SEEN_REFRESH_MS = 60000;
const PRESENCE_TICK_MS = 20000;
const TYPING_STOP_DELAY_MS = 3000;
const TYPING_BROADCAST_THROTTLE_MS = 500;

// ---- online-now store: written by the single heartbeat hook, read by any number of consumers ----
const presenceStore = {
  onlineIds: new Set(),
  listeners: new Set(),
  set(ids) {
    this.onlineIds = ids;
    this.listeners.forEach((fn) => fn(ids));
  },
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.onlineIds);
    return () => this.listeners.delete(fn);
  },
};

function readOnlineIds(channel) {
  const ids = new Set();
  const state = channel.presenceState();
  Object.keys(state).forEach((key) => {
    (state[key] || []).forEach((meta) => {
      if (meta && meta.user_id) ids.add(meta.user_id);
    });
  });
  return ids;
}

function isOnline(lastActive, now = Date.now()) {
  return typeof lastActive === "number" && now - lastActive < ONLINE_THRESHOLD_MS;
}

// Writer side: call once per authenticated session, keyed on the real logged-in user (not an
// impersonated identity), so an Owner viewing-as a Teacher still shows the Owner as online.
// Tracks Realtime Presence for the whole app and stamps profiles.last_seen_at on a heartbeat so
// presence self-heals to "offline" once ONLINE_THRESHOLD_MS elapses after a crashed/closed tab.
function usePresenceHeartbeat(userId) {
  useEffect(() => {
    if (!userId) {
      presenceStore.set(new Set());
      return undefined;
    }
    const channel = supabase.channel("presence:app", { config: { presence: { key: userId } } });
    const sync = () => presenceStore.set(readOnlineIds(channel));
    const stamp = () => { supabase.rpc("touch_presence").catch(() => {}); };
    const assert = () => {
      channel.track({ user_id: userId, online_at: new Date().toISOString() }).catch(() => {});
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { assert(); stamp(); }
      });

    const hb = setInterval(() => { stamp(); assert(); }, HEARTBEAT_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { stamp(); assert(); } };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(hb);
      document.removeEventListener("visibilitychange", onVisible);
      presenceStore.set(new Set());
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

// Reader side for MessagesPage: returns the same `{ [userId]: lastActiveMs }` shape the old
// localStorage map exposed, so `isOnline(map[id])` and `map[id] ? "Last seen …" ` are unchanged.
// Online users report `now`; everyone else reports their persisted last_seen_at.
function usePresenceMap() {
  const [online, setOnline] = useState(() => presenceStore.onlineIds);
  const [lastSeen, setLastSeen] = useState(() => new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => presenceStore.subscribe(setOnline), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.from("profiles").select("id, last_seen_at");
      if (!alive || error || !data) return;
      const map = new Map();
      data.forEach((row) => {
        if (row.last_seen_at) map.set(row.id, new Date(row.last_seen_at).getTime());
      });
      setLastSeen(map);
    };
    load();
    const iv = setInterval(load, LAST_SEEN_REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Re-derive the map on a timer too, so an online user's `now` timestamp never ages past
  // ONLINE_THRESHOLD_MS just because no presence join/leave happened to fire in that window.
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), PRESENCE_TICK_MS);
    return () => clearInterval(iv);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    const out = {};
    lastSeen.forEach((ms, id) => { out[id] = ms; });
    online.forEach((id) => { out[id] = now; });
    return out;
    // `tick` is an intentional recompute trigger; `now` is read fresh above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, lastSeen, tick]);
}

// ---- typing: one Realtime Broadcast channel per conversation ----
// A single websocket can join a given topic only once, so send + receive share ONE channel
// (hence one hook) rather than the two the localStorage version could afford. Incoming pings are
// filtered to the other participant and auto-expire after TYPING_STOP_DELAY_MS as a safety net for
// a sender whose tab closes mid-type; outgoing pings are throttled and always followed by a
// deferred "typing-stop".
function useConversationTyping(conversationId, myId) {
  const [typingUserId, setTypingUserId] = useState(null);
  const channelRef = useRef(null);
  const lastSentRef = useRef(0);
  const stopTimeoutRef = useRef(null);
  const expireRef = useRef(null);

  useEffect(() => {
    setTypingUserId(null);
    if (!conversationId) return undefined;

    const channel = supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } });
    const clearExpire = () => { if (expireRef.current) clearTimeout(expireRef.current); };

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.userId === myId) return;
        setTypingUserId(payload.userId);
        clearExpire();
        expireRef.current = setTimeout(() => setTypingUserId(null), TYPING_STOP_DELAY_MS);
      })
      .on("broadcast", { event: "typing-stop" }, ({ payload }) => {
        if (!payload || payload.userId === myId) return;
        clearExpire();
        setTypingUserId(null);
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      clearExpire();
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId, myId]);

  const emit = useCallback((event) => {
    const channel = channelRef.current;
    if (!channel || !conversationId || !myId) return;
    channel.send({ type: "broadcast", event, payload: { userId: myId } }).catch(() => {});
  }, [conversationId, myId]);

  // Call on every keystroke (throttled internally).
  const notifyTyping = useCallback(() => {
    if (!conversationId || !myId) return;
    const now = Date.now();
    if (now - lastSentRef.current >= TYPING_BROADCAST_THROTTLE_MS) {
      lastSentRef.current = now;
      emit("typing");
    }
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = setTimeout(() => emit("typing-stop"), TYPING_STOP_DELAY_MS);
  }, [conversationId, myId, emit]);

  // Call on send / when the input clears.
  const notifyStopTyping = useCallback(() => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    emit("typing-stop");
  }, [emit]);

  return { typingUserId, notifyTyping, notifyStopTyping };
}

export { usePresenceHeartbeat, usePresenceMap, isOnline, useConversationTyping, ONLINE_THRESHOLD_MS };
