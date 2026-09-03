import { supabase } from "../lib/supabaseClient";

// Phase 7 F1: profiles.email / profiles.phone are column-revoked from ordinary authenticated
// reads (migration 20260904010000). The `directory_contacts` SECURITY DEFINER RPC returns those
// two fields only for the accounts the caller administers (Owner -> all; Educational Director ->
// Teachers + Parents; Finance -> Other Staff) plus the caller's own row. The account-list
// services (parent / teacher / director) call this and merge it back in, so an Owner/Director
// still sees contact details in the management UIs while a Parent or Teacher session gets blanks
// for everyone but themselves.
export async function directoryContactsMap() {
  const { data, error } = await supabase.rpc("directory_contacts");
  if (error) {
    console.error("directory_contacts", error);
    return new Map();
  }
  return new Map((data || []).map((r) => [r.id, { email: r.email || "", phone: r.phone || "" }]));
}
