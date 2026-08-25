import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import { supabase } from "../lib/supabaseClient";
import { useData } from "../context/DataContext";
import { ROLES, ROLE_LABEL } from "../utils/constants";
import { usePresenceHeartbeat } from "../utils/presence";

const AuthCtx = createContext(null);
function useAuth() { return useContext(AuthCtx); }

const disabledMessage = "Your account has been disabled. Please contact the school administration if you believe this is an error.";
const suspendedMessage = "Your account is temporarily suspended. Please contact the school administrator.";
const noProfileMessage = "Your account isn't fully set up yet. Please contact the school administration.";

// Maps a `profiles` row (snake_case Postgres columns) onto the flat shape the rest of the app
// already reads off `currentUser`/`realUser` (id, name, email, role, phone, photo,
// mustChangePassword) so every existing page keeps working unchanged.
function mapProfile(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.role,
    phone: row.phone || "",
    photo: row.photo_url || null,
    mustChangePassword: !!row.must_change_password,
  };
}

function AuthProvider({ children }) {
  const data = useData();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  // Impersonation ("View as") still targets DataContext's mock user directory -- real accounts
  // for Teacher/Admin/Finance/Parent don't exist yet outside of Owner, and `realUser` (the actual
  // logged-in account) never changes while viewing as someone else, only `viewingAsId` does.
  const [viewingAsId, setViewingAsId] = useState(null);
  const [sessionEndedMessage, setSessionEndedMessage] = useState(null);
  // Set while the app is showing the "choose a new password" screen reached via a Supabase Auth
  // password-recovery email link (detectSessionInUrl parses it into a real, if narrowly-scoped,
  // session -- see supabaseClient.js).
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  // Fetches the caller's own profiles row via a SECURITY DEFINER RPC that bypasses RLS (see
  // migration 20260825200000_auth_self_service.sql) -- ordinary RLS hides a SUSPENDED/DISABLED
  // profile even from its own owner, which is exactly the state we need to detect here in order
  // to show the right message instead of a silent, unexplained sign-out.
  const loadProfile = useCallback(async () => {
    const { data: row, error } = await supabase.rpc("my_profile");
    if (error) return { profile: null, message: "Couldn't load your account. Please try again." };
    if (!row) return { profile: null, message: noProfileMessage };
    if (row.status !== "ACTIVE") {
      return { profile: null, message: row.status === "SUSPENDED" ? suspendedMessage : disabledMessage };
    }
    return { profile: mapProfile(row), message: null };
  }, []);

  useEffect(() => {
    let active = true;
    let firstEventHandled = false;
    const finishLoading = () => { if (!firstEventHandled) { firstEventHandled = true; setLoading(false); } };

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") { setPasswordRecovery(true); finishLoading(); return; }
      if (event === "SIGNED_OUT" || !newSession) {
        setProfile(null);
        setViewingAsId(null);
        finishLoading();
        return;
      }
      const { profile: mapped, message } = await loadProfile();
      if (!active) return;
      if (!mapped) {
        if (message) setSessionEndedMessage(message);
        await supabase.auth.signOut();
        setProfile(null);
      } else {
        setProfile(mapped);
      }
      finishLoading();
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const login = useCallback(async (email, password) => {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) return { ok: false, message: "Incorrect email or password." };
    const { profile: mapped, message } = await loadProfile();
    if (!mapped) {
      await supabase.auth.signOut();
      setProfile(null);
      return { ok: false, message: message || "Unable to sign in." };
    }
    setProfile(mapped);
    return { ok: true };
  }, [loadProfile]);

  const logout = useCallback(async () => {
    setViewingAsId(null);
    await supabase.auth.signOut();
  }, []);

  const clearSessionEndedMessage = useCallback(() => setSessionEndedMessage(null), []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!profile) return { ok: false, message: "Account not found." };
    if (!newPassword || newPassword.length < 6) return { ok: false, message: "New password must be at least 6 characters." };
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: profile.email, password: currentPassword });
    if (reauthError) return { ok: false, message: "Your current password doesn't match." };
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) return { ok: false, message: updateError.message || "Couldn't update your password." };
    await supabase.from("profiles").update({ must_change_password: false }).eq("id", profile.id);
    setProfile((p) => (p ? { ...p, mustChangePassword: false } : p));
    data.logActivity(`${profile.name} changed their password.`);
    return { ok: true, message: "" };
  }, [profile, data]);

  // Self-service profile edits (name/phone/photo) -- deliberately excludes email/role, which are
  // school-controlled. `photo` stays a data URL directly in profiles.photo_url for now (Storage
  // migration is a later phase); mirroring onto a linked `staff` row is deferred to the Staff
  // domain conversion, which hasn't happened yet.
  const updateOwnProfile = useCallback(async (patch) => {
    if (!profile) return { ok: false, message: "Account not found." };
    const update = {};
    if (patch.name !== undefined) {
      const trimmed = (patch.name || "").trim();
      if (!trimmed) return { ok: false, message: "Name cannot be empty." };
      update.full_name = trimmed;
    }
    if (patch.phone !== undefined) update.phone = (patch.phone || "").trim();
    if (patch.photo !== undefined) update.photo_url = patch.photo || null;
    const { error } = await supabase.from("profiles").update(update).eq("id", profile.id);
    if (error) return { ok: false, message: error.message || "Couldn't update your profile." };
    setProfile((p) => (p ? {
      ...p,
      ...(update.full_name !== undefined ? { name: update.full_name } : {}),
      ...(update.phone !== undefined ? { phone: update.phone } : {}),
      ...(update.photo_url !== undefined ? { photo: update.photo_url } : {}),
    } : p));
    return { ok: true, message: "Profile updated." };
  }, [profile]);

  // Forgot-password, step 1: a real email, sent by Supabase Auth, containing a link back into
  // this app. Deliberately reports success either way -- Supabase itself never reveals whether
  // the address has an account, to avoid leaking which emails are registered.
  const requestPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) return { ok: false, message: error.message || "Couldn't send a reset email." };
    return { ok: true, message: "If an account exists for that email, a password reset link has been sent." };
  }, []);

  // Forgot-password, step 2: reached via the emailed link, which Supabase's client already turned
  // into a real (recovery-scoped) session -- see the PASSWORD_RECOVERY event above.
  const completePasswordRecovery = useCallback(async (newPassword) => {
    if (!newPassword || newPassword.length < 6) return { ok: false, message: "New password must be at least 6 characters." };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, message: error.message || "Couldn't reset your password." };
    setPasswordRecovery(false);
    return { ok: true, message: "" };
  }, []);

  const cancelPasswordRecovery = useCallback(async () => {
    setPasswordRecovery(false);
    await supabase.auth.signOut();
  }, []);

  const realUser = profile;
  const viewingAsUser = viewingAsId ? data.db.users.find((u) => u.id === viewingAsId) : null;
  const currentUser = viewingAsUser || realUser;

  // Keyed on the real account, not an impersonated one, so an Owner viewing-as a Teacher doesn't
  // fake that Teacher's own online status.
  usePresenceHeartbeat(realUser?.id || null);

  const viewAs = useCallback((targetUserId) => {
    if (!realUser || realUser.role !== ROLES.OWNER) return;
    const target = data.db.users.find((u) => u.id === targetUserId);
    if (!target) return;
    // Owner impersonation is limited to internal staff accounts -- parents are never enterable this way.
    if (target.role === ROLES.PARENT) return;
    data.logActivity(`${realUser.name} (Owner) started viewing the account of ${target.name} (${ROLE_LABEL[target.role] || target.role}).`);
    setViewingAsId(targetUserId);
  }, [data, realUser]);

  const returnToSelf = useCallback(() => {
    if (viewingAsUser && realUser) data.logActivity(`${realUser.name} (Owner) returned from viewing ${viewingAsUser.name}'s account.`);
    setViewingAsId(null);
  }, [data, realUser, viewingAsUser]);

  return (
    <AuthCtx.Provider value={{
      loading, currentUser, realUser, viewingAsUser, login, logout, viewAs, returnToSelf,
      sessionEndedMessage, clearSessionEndedMessage, changePassword, updateOwnProfile,
      requestPasswordReset, passwordRecovery, completePasswordRecovery, cancelPasswordRecovery,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export { AuthProvider, useAuth };
