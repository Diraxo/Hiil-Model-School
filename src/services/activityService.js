// Phase 6: real Supabase-backed global activity feed (activities).
//
// RLS: activities_select = any authenticated ACTIVE account with a role (so every staff
// dashboard reads it; a Parent session gets an empty list, which matches the mock -- the feed
// widget is only rendered on Owner/Educational-Director/Finance/Teacher dashboards).
//
// The table has NO client INSERT (no policy + grant revoked in 20260903010000). log_activity()
// is the only write path -- SECURITY DEFINER, gated to staff, `text` is descriptive display copy
// built in the JS layer immediately after an already-RLS-gated domain write.
//
// Mock shape preserved: { id, text, navigation, createdAt }.
import { supabase } from "../lib/supabaseClient";

const DEFAULT_LIMIT = 80;

function mapActivity(row) {
  return {
    id: row.id,
    text: row.text,
    navigation: row.navigation || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createActivityService() {
  return {
    async list(limit = DEFAULT_LIMIT) {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      // A Parent session is not entitled to the feed -- treat any RLS/permission noise as "empty"
      // rather than surfacing an error on their dashboard.
      if (error) {
        console.warn("activities.list", error.message);
        return [];
      }
      return (data || []).map(mapActivity);
    },

    // log_activity(p_text, p_navigation) -> activities row. Best-effort: a failed feed write must
    // never fail the domain action that triggered it.
    async log(text, navigation = null) {
      try {
        const { data, error } = await supabase.rpc("log_activity", {
          p_text: text,
          p_navigation: navigation,
        });
        if (error) throw error;
        return data ? mapActivity(data) : null;
      } catch (e) {
        console.warn("log_activity", e && e.message ? e.message : e);
        return null;
      }
    },
  };
}
