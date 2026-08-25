import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import { useData } from "../context/DataContext";
import { ROLES, ROLE_LABEL } from "../utils/constants";
import { usePresenceHeartbeat } from "../utils/presence";

const AuthCtx = createContext(null);
function useAuth() { return useContext(AuthCtx); }

// Persists only the logged-in user's id (never the password) so a page refresh can restore the
// session — see the lazy useState initializer below, which reads this back before first render.
const SESSION_STORAGE_KEY = "tma_auth_session_v1";

function readStoredUserId() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw).userId || null : null;
  } catch { return null; }
}
function writeStoredUserId(id) {
  try {
    if (id) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ userId: id }));
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch { /* storage unavailable (private mode, quota) — session just won't persist */ }
}

function AuthProvider({ children }) {
  const data = useData();
  // Lazy-initialized so a persisted session is restored synchronously on the very first render —
  // AuthProvider only ever mounts once DataProvider has finished loading `data.db` (see
  // DataContext's `!ready || !db` guard), so `data.db.users` is already available here, and
  // protected pages never briefly render with a stale/undefined auth state during startup.
  const [userId, setUserId] = useState(() => {
    const storedId = readStoredUserId();
    if (!storedId) return null;
    const user = data.db.users.find((u) => u.id === storedId);
    // Same validity check as login() below: usable unless explicitly disabled/suspended.
    if (user && user.status !== "DISABLED" && user.status !== "SUSPENDED") return storedId;
    writeStoredUserId(null);
    return null;
  });
  // Impersonation ("View as"): kept purely in memory, never persisted to the db. `userId` (the
  // real, logged-in account) never changes while viewing as someone else — only `viewingAsId` does.
  const [viewingAsId, setViewingAsId] = useState(null);
  // Set when a session is force-ended because the account was disabled/suspended mid-session
  // (see the effect below) — the login screen surfaces this once, then it's cleared.
  const [sessionEndedMessage, setSessionEndedMessage] = useState(null);

  const disabledMessage = "Your account has been disabled. Please contact the school administration if you believe this is an error.";
  const suspendedMessage = "Your account is temporarily suspended. Please contact the school administrator.";

  const login = useCallback((email, password) => {
    const user = data.db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password);
    if (!user) return { ok: false, message: "Incorrect email or password." };
    if (user.status === "DISABLED") return { ok: false, message: disabledMessage };
    if (user.status === "SUSPENDED") return { ok: false, message: suspendedMessage };
    setUserId(user.id);
    writeStoredUserId(user.id);
    return { ok: true };
  }, [data]);
  const logout = useCallback(() => { setUserId(null); setViewingAsId(null); writeStoredUserId(null); }, []);
  const clearSessionEndedMessage = useCallback(() => setSessionEndedMessage(null), []);

  const realUser = userId ? data.db.users.find((u) => u.id === userId) : null;
  const viewingAsUser = viewingAsId ? data.db.users.find((u) => u.id === viewingAsId) : null;
  const currentUser = viewingAsUser || realUser;

  // Keyed on the real account, not an impersonated one, so an Owner viewing-as a Teacher
  // doesn't fake that Teacher's own online status.
  usePresenceHeartbeat(realUser?.id || null);

  // If the Owner disables/suspends this account while it's logged in — in this tab, or in
  // another one, since db.users is already kept in sync by DataContext's cross-tab poll — end
  // the session immediately instead of waiting for the next login attempt.
  useEffect(() => {
    if (!realUser || realUser.status === "ACTIVE") return;
    setSessionEndedMessage(realUser.status === "DISABLED" ? disabledMessage : suspendedMessage);
    setUserId(null);
    setViewingAsId(null);
    writeStoredUserId(null);
  }, [realUser?.status]);

  const viewAs = useCallback((targetUserId) => {
    if (!realUser || realUser.role !== ROLES.OWNER) return;
    const target = data.db.users.find((u) => u.id === targetUserId);
    if (!target) return;
    // Owner impersonation is limited to internal staff accounts — parents are never enterable this way.
    if (target.role === ROLES.PARENT) return;
    data.logActivity(`${realUser.name} (Owner) started viewing the account of ${target.name} (${ROLE_LABEL[target.role] || target.role}).`);
    setViewingAsId(targetUserId);
  }, [data, realUser]);

  const returnToSelf = useCallback(() => {
    if (viewingAsUser && realUser) data.logActivity(`${realUser.name} (Owner) returned from viewing ${viewingAsUser.name}'s account.`);
    setViewingAsId(null);
  }, [data, realUser, viewingAsUser]);

  return (
    <AuthCtx.Provider value={{ currentUser, realUser, viewingAsUser, login, logout, viewAs, returnToSelf, sessionEndedMessage, clearSessionEndedMessage }}>
      {children}
    </AuthCtx.Provider>
  );
}

export { AuthProvider, useAuth };
