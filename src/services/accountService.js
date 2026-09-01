// Thin wrapper around the `manage-staff-account` Supabase Edge Function -- the only place in the
// app that can create/delete/reset-password a real Supabase Auth account for a Teacher/Admin/
// Finance/Parent. That function runs with the service-role key server-side (auth.admin.* is
// never available to the browser); this client just invokes it over HTTPS with the caller's own
// session attached, and the function re-checks that session against is_owner_or_admin() before
// doing anything. See supabase/functions/manage-staff-account/index.ts.
import { supabase } from "../lib/supabaseClient";

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke("manage-staff-account", { body });
  if (error) {
    const message = (data && data.message) || error.message || "The request failed.";
    return { ok: false, message };
  }
  return data;
}

export function createAccountService() {
  return {
    // role must be one of ADMIN / FINANCE / TEACHER / PARENT.
    create: ({ email, password, fullName, role, phone }) => invoke({ action: "create", email, password, fullName, role, phone }),
    remove: (userId) => invoke({ action: "delete", userId }),
    resetPassword: (userId, password) => invoke({ action: "reset_password", userId, password }),
  };
}
