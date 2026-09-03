// Supabase-backed global activity feed (activities).
//
// RLS: activities_select = any authenticated ACTIVE account with a role (so every staff
// dashboard reads it; a Parent session gets an empty list -- the feed widget is only rendered on
// Owner/Educational-Director/Finance/Teacher dashboards anyway).
//
// The table has NO client INSERT (no policy + grant revoked in 20260903010000). log_activity()
// is the only write path -- SECURITY DEFINER, gated to staff, `text` is descriptive display copy
// built in the JS layer immediately after an already-RLS-gated domain write.
//
// Rows are returned in the shape consumers expect: { id, text, navigation, createdAt }.
import { supabase } from "../lib/supabaseClient";

const DEFAULT_LIMIT = 80;

function mapActivity(row) {
  return {
    id: row.id,
    text: row.text,
    navigation: row.navigation || null,
    visibility: row.visibility || "STAFF",
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

    // log_activity(p_text, p_navigation, p_visibility) -> activities row. `visibility` 'FINANCE'
    // restricts the row to Owner/Finance (used for lines quoting personal salary figures);
    // anything else defaults to 'STAFF'. Best-effort: a failed feed write must never fail the
    // domain action that triggered it.
    async log(text, navigation = null, visibility = "STAFF") {
      try {
        const { data, error } = await supabase.rpc("log_activity", {
          p_text: text,
          p_navigation: navigation,
          p_visibility: visibility,
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
