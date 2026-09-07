import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import { supabase } from "../lib/supabaseClient";
import { useData } from "../context/DataContext";
import { ROLES, ROLE_LABEL } from "../utils/constants";
import { usePresenceHeartbeat } from "../utils/presence";
import { createProfilePhotoService } from "../services/profilePhotoService";
import { isStoragePath, signPaths } from "../lib/storageMedia";
import { profileSyncStore } from "../utils/profileSync";

const profilePhotoService = createProfilePhotoService();

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
    // `photoPath` is the raw `profile-photos` object key (or a legacy data URI); `photo` is what
    // the UI renders and is filled with a short-lived signed URL by `resolveProfilePhoto`.
    photoPath: row.photo_url || null,
    photo: row.photo_url || null,
    mustChangePassword: !!row.must_change_password,
  };
}

// Swap a stored `profile-photos` object path for a signed URL so `currentUser.photo` is directly
// renderable. Legacy inline data URIs (pre-Storage) and nulls pass straight through.
async function resolveProfilePhoto(mapped) {
  if (!mapped || !isStoragePath(mapped.photoPath)) return mapped;
  try {
    const urls = await signPaths("profile-photos", [mapped.photoPath]);
    return { ...mapped, photo: urls.get(mapped.photoPath) || null };
  } catch {
    return { ...mapped, photo: null };
  }
}

// Calls self_register_link_children (20260907000000_parent_self_registration.sql) and turns its
// all-or-nothing INVALID_STUDENT_IDS:.../ALREADY_LINKED_STUDENT_IDS:... exception into per-child
// field errors the registration form can show inline, matching the "Student ID not found" /
// "already linked" copy from the product spec.
async function linkChildrenOrExplain(studentIds) {
  const { error } = await supabase.rpc("self_register_link_children", { p_student_ids: studentIds });
  if (!error) return { ok: true };
  const msg = error.message || "";
  const invalid = msg.match(/^INVALID_STUDENT_IDS:(.+)$/);
  const taken = msg.match(/^ALREADY_LINKED_STUDENT_IDS:(.+)$/);
  if (invalid) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(invalid[1].split(",").map((id) => [id, "Student ID not found."])),
      message: "We couldn't find one or more of the Student IDs you entered.",
    };
  }
  if (taken) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(taken[1].split(",").map((id) => [id, "This student is already linked to a parent account."])),
      message: "One or more children are already connected to a parent account.",
    };
  }
  return { ok: false, message: "Your account was created, but connecting your child(ren) failed. Please sign in and try again, or contact the school office." };
}

function AuthProvider({ children }) {
  const data = useData();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  // Impersonation ("View as") picks a target from `db.users` (the real `profiles` directory) by
  // id. `realUser` (the actual logged-in account) never changes while viewing as someone else,
  // only `viewingAsId` does; the Supabase session and RLS still act as the real logged-in user.
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
    return { profile: await resolveProfilePhoto(mapProfile(row)), message: null };
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

  // Real-time sync of the signed-in user's OWN account. DataContext owns the single authenticated
  // Realtime channel; when it sees this user's `profiles` row change from another session (an
  // Owner/Director editing their photo, name or status) it calls `profileSyncStore.bump()`. Reload
  // so the top-bar avatar / own profile page reflect it without a browser refresh. Only fields that
  // actually changed are adopted, and an unchanged photo path is left alone so we don't re-sign a
  // URL we already hold.
  useEffect(() => {
    const reload = async () => {
      try {
        const { profile: fresh } = await loadProfile();
        if (!fresh) return;
        setProfile((p) => {
          if (!p || p.id !== fresh.id) return p;
          const photoChanged = fresh.photoPath !== p.photoPath;
          return {
            ...p,
            name: fresh.name,
            phone: fresh.phone,
            mustChangePassword: fresh.mustChangePassword,
            ...(photoChanged ? { photo: fresh.photo, photoPath: fresh.photoPath } : {}),
          };
        });
      } catch { /* a failed refresh just leaves the current value in place */ }
    };
    return profileSyncStore.subscribe(reload);
  }, [loadProfile]);

  const login = useCallback(async (email, password) => {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) return { ok: false, message: "Incorrect email or password." };
    const { profile: mapped, message } = await loadProfile();
    if (!mapped) {
      await supabase.auth.signOut();
      setProfile(null);
      return { ok: false, message: message || "Unable to sign in." };
    }
    setProfile(mapped);
    // Finishes a self-registration that couldn't link its children at signup time because this
    // project has Supabase email confirmation enabled (no session existed yet -- see
    // AuthContext.signUp). Best-effort: no field-level UI to show a mistyped/reused id against on
    // the login screen itself, but the ids came straight from check_student_ids-validated
    // registration input, so this only fails if something changed in between (e.g. another parent
    // claimed the same child first).
    if (mapped.role === ROLES.PARENT && Array.isArray(signInData?.user?.user_metadata?.pending_student_ids) && signInData.user.user_metadata.pending_student_ids.length > 0) {
      await linkChildrenOrExplain(signInData.user.user_metadata.pending_student_ids).catch(() => {});
      await supabase.auth.updateUser({ data: { pending_student_ids: null } }).catch(() => {});
    }
    return { ok: true };
  }, [loadProfile]);

  const logout = useCallback(async () => {
    setViewingAsId(null);
    await supabase.auth.signOut();
  }, []);

  // Real parent self-registration (20260907000000_parent_self_registration.sql). Field validation
  // (required fields, min password length) mirrors login()/changePassword()'s inline style; the
  // Student ID linking step is atomic server-side (self_register_link_children), so a rejected
  // call here never leaves a half-connected account -- but the Auth account + profile themselves
  // can't be part of that same transaction (GoTrue and Postgres are separate systems), so a link
  // failure after a successful signUp is reported as "account created, but..." rather than undone.
  const signUp = useCallback(async ({ fullName, email, password, phone, studentIds }) => {
    const trimmedName = (fullName || "").trim();
    const trimmedEmail = (email || "").trim();
    const trimmedPhone = (phone || "").trim();
    const ids = [...new Set((studentIds || []).map((s) => (s || "").trim()).filter(Boolean))];

    if (!trimmedName) return { ok: false, message: "Full name is required." };
    if (!trimmedEmail) return { ok: false, message: "Email is required." };
    if (!password || password.length < 6) return { ok: false, message: "Password must be at least 6 characters." };
    if (!trimmedPhone) return { ok: false, message: "Phone number is required." };
    if (ids.length === 0) return { ok: false, message: "Add at least one child's Student ID." };

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: { full_name: trimmedName, phone: trimmedPhone, self_registration: true, pending_student_ids: ids } },
    });
    const alreadyRegisteredMessage = "An account with this email already exists. Please sign in, or use \"Forgot password?\" instead.";
    if (signUpError) {
      const already = /already registered|already exists/i.test(signUpError.message || "");
      return { ok: false, message: already ? alreadyRegisteredMessage : (signUpError.message || "Couldn't create your account.") };
    }
    // Supabase's anti-enumeration behavior: signing up with an email that already has a confirmed
    // account returns success with an empty `identities` array instead of an error.
    if (signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      return { ok: false, message: alreadyRegisteredMessage };
    }

    if (!signUpData.session) {
      // Email confirmation is enabled on this project -- no session yet, so the authenticated
      // link RPC can't run now. AuthContext.login finishes the job (linking these same ids) the
      // first time this parent actually signs in, once their email is confirmed.
      return { ok: true, pendingConfirmation: true, message: "Account created. Check your email to confirm it, then sign in to finish connecting your child(ren)." };
    }

    const linkResult = await linkChildrenOrExplain(ids);
    if (!linkResult.ok) return { ok: true, accountCreated: true, ...linkResult };

    const { profile: mapped } = await loadProfile();
    if (mapped) setProfile(mapped);
    return { ok: true, message: "Account created." };
  }, [loadProfile]);

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
  // school-controlled. A `photo` value is a File (new upload), null (remove), or an unchanged
  // string; `profilePhotoService.applyChange` uploads/deletes the private `profile-photos` object
  // and returns the path to persist. A Teacher editing their OWN photo here also updates the
  // linked `staff.photo_url` below so the two never drift.
  const updateOwnProfile = useCallback(async (patch) => {
    if (!profile) return { ok: false, message: "Account not found." };
    const update = {};
    if (patch.name !== undefined) {
      const trimmed = (patch.name || "").trim();
      if (!trimmed) return { ok: false, message: "Name cannot be empty." };
      update.full_name = trimmed;
    }
    if (patch.phone !== undefined) update.phone = (patch.phone || "").trim();

    let newPhotoPath;
    if (patch.photo !== undefined) {
      try {
        newPhotoPath = await profilePhotoService.applyChange(profile.id, patch.photo, profile.photoPath);
      } catch (e) {
        return { ok: false, message: e.message || "Couldn't upload that photo." };
      }
      update.photo_url = newPhotoPath;
    }

    const { error } = await supabase.from("profiles").update(update).eq("id", profile.id);
    if (error) {
      // The new object is already uploaded; roll it back so a failed DB write leaves nothing behind.
      if (patch.photo instanceof File && isStoragePath(newPhotoPath)) {
        await profilePhotoService.rollback(newPhotoPath).catch(() => {});
      }
      return { ok: false, message: error.message || "Couldn't update your profile." };
    }
    // Keep a linked staff record's photo in step (Teacher editing their own photo).
    if (update.photo_url !== undefined) {
      await supabase.from("staff").update({ photo_url: update.photo_url || null }).eq("user_id", profile.id);
    }

    let signedPhoto = profile.photo;
    if (update.photo_url !== undefined) {
      signedPhoto = null;
      if (isStoragePath(update.photo_url)) {
        try {
          const urls = await signPaths("profile-photos", [update.photo_url]);
          signedPhoto = urls.get(update.photo_url) || null;
        } catch { signedPhoto = null; }
      }
    }
    setProfile((p) => (p ? {
      ...p,
      ...(update.full_name !== undefined ? { name: update.full_name } : {}),
      ...(update.phone !== undefined ? { phone: update.phone } : {}),
      ...(update.photo_url !== undefined ? { photo: signedPhoto, photoPath: update.photo_url } : {}),
    } : p));
    return { ok: true, message: "Profile updated." };
  }, [profile]);

  // Forgot-password, step 1: a real email, sent by Supabase Auth, containing a link back into
  // this app. Deliberately reports success either way -- Supabase itself never reveals whether
  // the address has an account, to avoid leaking which emails are registered.
  const requestPasswordReset = useCallback(async (email) => {
    // The emailed recovery link must return the user to whatever origin they started from:
    // the deployed site in production, or the local dev server when developing. VITE_SITE_URL
    // (set only in the production host's env) pins production regardless of the request origin;
    // everywhere else we fall back to the live browser origin. Whichever value is used must also
    // be present in the Supabase project's Auth "Redirect URLs" allow-list, or Supabase ignores
    // it and falls back to the project's Site URL.
    const redirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
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
      loading, currentUser, realUser, viewingAsUser, login, logout, signUp, viewAs, returnToSelf,
      sessionEndedMessage, clearSessionEndedMessage, changePassword, updateOwnProfile,
      requestPasswordReset, passwordRecovery, completePasswordRecovery, cancelPasswordRecovery,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export { AuthProvider, useAuth };
