import { useEffect, useRef, useState } from "react";

// Presence/typing live entirely outside the persisted `db` blob (see DataContext's
// commit()/saveDB()) so a 25s heartbeat or a per-keystroke typing signal never re-serializes
// the whole app state (including every base64 exam-photo already stored in results).
const PRESENCE_KEY = "tma_presence_v1";
const TYPING_CHANNEL_NAME = "tma-typing-v1";
const TYPING_FALLBACK_KEY = "tma_typing_signal_v1";

const ONLINE_THRESHOLD_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 25000;
const PRESENCE_POLL_MS = 3000;
const TYPING_STOP_DELAY_MS = 3000;
const TYPING_BROADCAST_THROTTLE_MS = 500;

function readPresenceMap() {
  try {
    const raw = window.localStorage.getItem(PRESENCE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function touchPresence(userId) {
  if (!userId) return;
  try {
    const map = readPresenceMap();
    map[userId] = Date.now();
    window.localStorage.setItem(PRESENCE_KEY, JSON.stringify(map));
  } catch (e) {}
}

function isOnline(lastActive, now = Date.now()) {
  return typeof lastActive === "number" && now - lastActive < ONLINE_THRESHOLD_MS;
}

// Writer side: call once per authenticated session (keyed on the real logged-in user, not an
// impersonated identity) so presence self-heals to "offline" once the threshold elapses instead
// of getting stuck "online" after a crashed/closed tab.
function usePresenceHeartbeat(userId) {
  useEffect(() => {
    if (!userId) return;
    touchPresence(userId);
    const iv = setInterval(() => touchPresence(userId), HEARTBEAT_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") touchPresence(userId); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
}

// Reader side: poll the small presence map (not the whole db) for consumers like MessagesPage.
function usePresenceMap() {
  const [map, setMap] = useState(() => readPresenceMap());
  useEffect(() => {
    const iv = setInterval(() => setMap(readPresenceMap()), PRESENCE_POLL_MS);
    return () => clearInterval(iv);
  }, []);
  return map;
}

let typingChannel = null;
let typingChannelInitialized = false;
function getTypingChannel() {
  if (!typingChannelInitialized) {
    typingChannelInitialized = true;
    if (typeof BroadcastChannel !== "undefined") {
      try { typingChannel = new BroadcastChannel(TYPING_CHANNEL_NAME); } catch (e) { typingChannel = null; }
    }
  }
  return typingChannel;
}

function postTyping(payload) {
  const channel = getTypingChannel();
  if (channel) {
    channel.postMessage(payload);
    return;
  }
  // Fallback for browsers without BroadcastChannel: the native `storage` event fires in every
  // OTHER tab (never the writer's own), which is exactly the semantics we want here.
  try {
    window.localStorage.setItem(TYPING_FALLBACK_KEY, JSON.stringify({ ...payload, nonce: Math.random() }));
  } catch (e) {}
}

function broadcastTyping(conversationId, userId) {
  postTyping({ kind: "typing", conversationId, userId, ts: Date.now() });
}

function broadcastStopTyping(conversationId, userId) {
  postTyping({ kind: "typing-stop", conversationId, userId, ts: Date.now() });
}

// handler receives { kind: "typing" | "typing-stop", conversationId, userId, ts }
function subscribeTyping(handler) {
  const channel = getTypingChannel();
  if (channel) {
    const onMessage = (e) => handler(e.data);
    channel.addEventListener("message", onMessage);
    return () => channel.removeEventListener("message", onMessage);
  }
  const onStorage = (e) => {
    if (e.key !== TYPING_FALLBACK_KEY || !e.newValue) return;
    try { handler(JSON.parse(e.newValue)); } catch (err) {}
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

// Convenience hook: tracks whether the OTHER participant in `conversationId` is currently typing,
// filtering out this user's own broadcasts and auto-expiring after TYPING_STOP_DELAY_MS as a
// safety net independent of receiving an explicit stop signal (e.g. sender's tab closes mid-type).
function useOtherTyping(conversationId, myId) {
  const [typingUserId, setTypingUserId] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    setTypingUserId(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!conversationId) return;

    const unsubscribe = subscribeTyping((evt) => {
      if (!evt || evt.conversationId !== conversationId || evt.userId === myId) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (evt.kind === "typing") {
        setTypingUserId(evt.userId);
        timeoutRef.current = setTimeout(() => setTypingUserId(null), TYPING_STOP_DELAY_MS);
      } else if (evt.kind === "typing-stop") {
        setTypingUserId(null);
      }
    });
    return () => {
      unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [conversationId, myId]);

  return typingUserId;
}

// Convenience hook for the input side: call the returned `notifyTyping()` on every keystroke
// (throttled internally) and `notifyStopTyping()` on send/unmount.
function useTypingBroadcaster(conversationId, myId) {
  const lastSentRef = useRef(0);
  const stopTimeoutRef = useRef(null);

  const notifyTyping = () => {
    if (!conversationId || !myId) return;
    const now = Date.now();
    if (now - lastSentRef.current >= TYPING_BROADCAST_THROTTLE_MS) {
      lastSentRef.current = now;
      broadcastTyping(conversationId, myId);
    }
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = setTimeout(() => broadcastStopTyping(conversationId, myId), TYPING_STOP_DELAY_MS);
  };

  const notifyStopTyping = () => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    if (conversationId && myId) broadcastStopTyping(conversationId, myId);
  };

  useEffect(() => () => { if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current); }, []);

  return { notifyTyping, notifyStopTyping };
}

export { usePresenceHeartbeat, usePresenceMap, isOnline, useOtherTyping, useTypingBroadcaster, ONLINE_THRESHOLD_MS };
