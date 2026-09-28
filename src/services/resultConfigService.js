// Supabase-backed Results configuration service (assessment structure per academic year +
// semester + grade). Same pattern as every other domain: this file only talks to the
// `result_configurations` / `result_assessment_components` / `result_configuration_audit` tables
// and the save_result_configuration RPC; DataContext owns the read-side state + refetch.
//
// RLS is the real boundary (supabase/migrations/20260920000000_results_configuration.sql):
//   - SELECT: Owner/Educational Director all; a teacher only for grades they teach; a parent only
//     for their child's grade/year. Finance: nothing.
//   - There is NO client write path. save_result_configuration() is a SECURITY DEFINER RPC that
//     checks the caller is Owner/Educational Director, enforces "weights total exactly 100",
//     de-duplicates the active structure per year+semester+grade, versions a structure that
//     already has results, and stamps the acting user from auth.uid().
import { supabase } from "../lib/supabaseClient";

const ts = (v) => (v ? new Date(v).getTime() : null);

function mapAssessment(row) {
  return {
    id: row.id,
    configurationId: row.configuration_id,
    name: row.name,
    weight: Number(row.weight),
    kind: row.kind,
    order: row.sort_order,
    active: !!row.active,
  };
}

function mapConfig(row) {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    semester: row.semester,
    grade: row.grade,
    version: row.version,
    status: row.status,
    createdBy: row.created_by || null,
    createdAt: ts(row.created_at),
    updatedBy: row.updated_by || null,
    updatedAt: ts(row.updated_at),
    components: (row.result_assessment_components || []).map(mapAssessment).sort((a, b) => a.order - b.order),
  };
}

function mapAudit(row) {
  return {
    id: row.id,
    configurationId: row.configuration_id || null,
    academicYearId: row.academic_year_id,
    semester: row.semester,
    grade: row.grade,
    version: row.version,
    action: row.action,
    actorId: row.actor_id || null,
    actorRole: row.actor_role || null,
    actorName: row.actor_name || null,
    diff: row.diff || null,
    at: ts(row.at),
  };
}

export function createResultConfigService() {
  return {
    // Every configuration version the session may see, each with its assessments. A handful of
    // rows per year (grades x semesters x versions), so one embedded select is enough — no N+1.
    async list() {
      const { data, error } = await supabase
        .from("result_configurations")
        .select("*, result_assessment_components(*)")
        .order("created_at");
      if (error) throw error;
      return (data || []).map(mapConfig);
    },

    // Owner/Educational Director only (RLS returns nothing for anyone else).
    async listAudit() {
      const { data, error } = await supabase
        .from("result_configuration_audit")
        .select("*")
        .order("at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapAudit);
    },

    // Deletes the structure for one year + semester + grade. The server picks the safe outcome:
    // DELETED when no result is recorded under it, ARCHIVED (kept for the recorded results, closed to
    // new entries) when some are. Returns { grade, semester, version, outcome }.
    async remove({ academicYearId, semester, grade }) {
      const { data, error } = await supabase.rpc("delete_result_configuration", {
        p_academic_year_id: academicYearId,
        p_semester: semester,
        p_grade: grade,
      });
      if (error) throw error;
      return data;
    },

    // Applies ONE structure to every selected grade x semester in a single all-or-nothing call
    // (save_result_configuration_bulk). components: [{ name, weight, kind }] in display order.
    // Returns one entry per combination: { grade, semester, configurationId, version,
    // action: "CREATED" | "UPDATED" | "NEW_VERSION" | "UNCHANGED" }.
    async saveBulk({ academicYearId, semesters, grades, components }) {
      const { data, error } = await supabase.rpc("save_result_configuration_bulk", {
        p_academic_year_id: academicYearId,
        p_semesters: semesters,
        p_grades: grades,
        p_components: components.map((c) => ({ name: c.name, weight: Number(c.weight), kind: c.kind })),
      });
      if (error) throw error;
      return data || [];
    },
  };
}
