// Creates/deletes/resets the password for a real Supabase Auth account + profiles row for
// Teacher/Admin/Finance/Parent staff. This is the ONLY place in the app allowed to touch
// auth.admin.* -- those calls require the service-role key, which must never reach the browser.
//
// Because this function runs with the service-role key (which bypasses RLS entirely), it does its
// OWN authorization checks first, against the CALLER's own JWT -- reusing the exact same
// is_owner_or_admin()/is_owner() Postgres functions every other privileged write in this schema is
// gated by (see supabase/migrations/20260825190000_rls_policies.sql), so there is only one place
// each rule can ever drift.
//
// Director-group accounts (ADMIN/FINANCE) are Owner-only to create/delete/reset-password for --
// mirrors canManageDirectors (src/utils/staffPermissions.js): an Educational Director manages
// Teachers, never another Director's account, even though they pass is_owner_or_admin() same as
// Owner does. is_owner_or_admin() alone is only sufficient for TEACHER/PARENT, which an
// Educational Director IS allowed to manage. delete/reset_password don't get a role in the
// request body -- the target's role is looked up first (via the service-role client, before any
// destructive call) so this can't be bypassed by simply omitting it.
//
// Deploy:   supabase functions deploy manage-staff-account
// Call from the app via src/services/accountService.js, which wraps
// supabase.functions.invoke("manage-staff-account", { body: {...} }).
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically into
// every Edge Function's environment -- no manual secret configuration needed for these three.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// OWNER is deliberately excluded -- there is exactly one Owner account, created once via
// supabase/seed_owner.sql, never through this endpoint.
const CREATABLE_ROLES = ["ADMIN", "FINANCE", "TEACHER", "PARENT"];
const DIRECTOR_ROLES = ["ADMIN", "FINANCE"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json({ ok: false, message: "Missing authorization." }, 401);

  // Scoped to the caller's own JWT (not the service role) -- these run as that caller, so a
  // SUSPENDED/DISABLED/non-admin account is rejected exactly as RLS would reject it anywhere else
  // in the app.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const [{ data: isOwnerOrAdmin, error: roleError }, { data: isOwner, error: ownerError }] = await Promise.all([
    callerClient.rpc("is_owner_or_admin"),
    callerClient.rpc("is_owner"),
  ]);
  if (roleError || ownerError || !isOwnerOrAdmin) {
    return json({ ok: false, message: "You don't have permission to manage staff accounts." }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, message: "Invalid request body." }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (body.action === "create") {
    const { email, password, fullName, role, phone } = body;
    if (!email || !password || !fullName || !role) return json({ ok: false, message: "Missing required fields." }, 400);
    if (!CREATABLE_ROLES.includes(role)) return json({ ok: false, message: "Invalid role." }, 400);
    if (DIRECTOR_ROLES.includes(role) && !isOwner) {
      return json({ ok: false, message: "Only the Owner may create a Director account." }, 403);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createError) return json({ ok: false, message: createError.message || "Couldn't create the account." }, 400);

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id, role, full_name: fullName, email, phone: phone || null,
      status: "ACTIVE", must_change_password: true,
    });
    if (profileError) {
      // Don't leave an orphaned auth-only account behind if the profile insert fails.
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ ok: false, message: profileError.message || "Couldn't create the profile." }, 400);
    }

    return json({ ok: true, userId: created.user.id });
  }

  if (body.action === "delete" || body.action === "reset_password") {
    const { userId } = body;
    if (!userId) return json({ ok: false, message: "Missing userId." }, 400);
    if (body.action === "reset_password" && !body.password) return json({ ok: false, message: "Missing password." }, 400);

    const { data: target, error: targetError } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (targetError) return json({ ok: false, message: targetError.message || "Couldn't look up this account." }, 400);
    if (!target) return json({ ok: false, message: "Account not found." }, 404);
    if (DIRECTOR_ROLES.includes(target.role) && !isOwner) {
      return json({ ok: false, message: "Only the Owner may manage a Director account." }, 403);
    }

    if (body.action === "delete") {
      // profiles.id references auth.users(id) on delete cascade -- deleting the auth user cleans
      // up the profile row (and anything FK'd to it) automatically.
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ ok: false, message: error.message || "Couldn't delete the account." }, 400);
      return json({ ok: true });
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password });
    if (error) return json({ ok: false, message: error.message || "Couldn't reset the password." }, 400);
    await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
    return json({ ok: true });
  }

  return json({ ok: false, message: "Unknown action." }, 400);
});
