// Pure helpers for the configurable Results structure (see supabase/migrations/
// 20260920000000_results_configuration.sql). No React, no `db` — DataContext supplies plain arrays.
// The server (save_result_configuration + a deferred constraint trigger) is authoritative for the
// "weights total exactly 100" rule; validateConfigDraft only mirrors it so the Results Settings
// form can show Configured / Remaining live and explain what is wrong before Save.
import { GRADES, RESULT_TOTAL_WEIGHT, round2 } from "./constants";

// The assessments a configuration actually scores, in display order.
function activeAssessments(config) {
  if (!config) return [];
  return config.components.filter((a) => a.active).sort((a, b) => a.order - b.order);
}

// A weight is valid when it is a positive number up to 100 with at most 2 decimals — the same
// rule numeric(5,2) + save_result_configuration enforce.
function parseWeight(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > RESULT_TOTAL_WEIGHT) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
  return n;
}

// rows: [{ key, name, weight, kind }] as edited in the form (weight may still be a string).
function configTotals(rows) {
  const total = round2(rows.reduce((sum, r) => sum + (parseWeight(r.weight) ?? 0), 0));
  return { total, remaining: round2(RESULT_TOTAL_WEIGHT - total), over: total > RESULT_TOTAL_WEIGHT, complete: total === RESULT_TOTAL_WEIGHT };
}

// Returns { totals, rowErrors: { [key]: string }, errors: string[], canSave }. rowErrors are shown
// next to the offending row; errors are the form-level summary. A row that would push the running
// total past 100 says how many points were actually left ("Remaining points: 60").
function validateConfigDraft(rows) {
  const totals = configTotals(rows);
  const rowErrors = {};
  const seen = new Set();
  let running = 0;

  for (const r of rows) {
    const name = (r.name || "").trim();
    const weight = parseWeight(r.weight);
    if (!name) rowErrors[r.key] = "Give this assessment a name.";
    else if (seen.has(name.toLowerCase())) rowErrors[r.key] = `Another assessment is already named "${name}".`;
    else if (weight === null) rowErrors[r.key] = "Enter a weight above 0 (up to 2 decimals).";
    else if (r.kind !== "TEST" && r.kind !== "NON_TEST") rowErrors[r.key] = "Choose Test or Non-test.";
    else if (running + weight > RESULT_TOTAL_WEIGHT) {
      rowErrors[r.key] = `Cannot add this component. Remaining points: ${round2(Math.max(0, RESULT_TOTAL_WEIGHT - running))}.`;
    }
    if (name) seen.add(name.toLowerCase());
    if (weight !== null) running = round2(running + weight);
  }

  const errors = [];
  if (rows.length === 0) errors.push("Add at least one assessment.");
  else if (totals.over) errors.push(`Weights add up to ${totals.total} — they must total exactly ${RESULT_TOTAL_WEIGHT}.`);
  else if (!totals.complete && Object.keys(rowErrors).length === 0) errors.push(`${totals.remaining} points are still unassigned — weights must total exactly ${RESULT_TOTAL_WEIGHT}.`);

  return { totals, rowErrors, errors, canSave: rows.length > 0 && totals.complete && Object.keys(rowErrors).length === 0 };
}

// Distinct grades that have at least one class, in the school's own grade order (GRADES is only
// an ordering hint here — a grade not listed in it still appears, after the known ones).
function gradesFromClasses(classes) {
  const found = [...new Set((classes || []).map((c) => c.grade).filter(Boolean))];
  const rank = (g) => { const i = GRADES.indexOf(g); return i === -1 ? GRADES.length : i; };
  return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
}

// The ACTIVE configuration for one academic year + semester + grade (there is at most one).
function activeConfigFor(configs, academicYearId, semester, grade) {
  return (configs || []).find((c) => c.status === "ACTIVE" && c.academicYearId === academicYearId && c.semester === semester && c.grade === grade) || null;
}

// The ONE structure a result workflow (gradebook, save score, add evidence) works against: the
// structure the student's existing result was recorded under when it resolves, otherwise the ACTIVE
// structure for the grade + semester + year. A result row that exists but whose pinned structure is
// not resolvable client-side (no result yet recorded, not loaded) must never make a configured grade
// look unconfigured — that is exactly what the gradebook page already did.
function effectiveConfigFor(record, configs, academicYearId, semester, grade) {
  return (record && record.configuration) || activeConfigFor(configs, academicYearId, semester, grade);
}

export { activeAssessments, parseWeight, configTotals, validateConfigDraft, gradesFromClasses, activeConfigFor, effectiveConfigFor };
