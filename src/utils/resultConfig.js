// Pure helpers for the configurable Results structure (see supabase/migrations/
// 20260920000000_results_configuration.sql). No React, no `db` — DataContext supplies plain arrays.
// The server (save_result_configuration + a deferred constraint trigger) is authoritative for the
// "weights total exactly 100" rule; validateConfigDraft only mirrors it so the Results Settings
// form can show Configured / Remaining live and explain what is wrong before Save.
import { SEMESTERS, RESULT_TOTAL_WEIGHT, round2, sortGrades } from "./constants";

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

// Distinct grades that have at least one class, in the school's one canonical grade order
// (constants.sortGrades). This is the authoritative grade list for Results — the server rejects a save
// for a grade that has no class — so selectors use it rather than a list of their own.
function gradesFromClasses(classes) {
  return sortGrades([...new Set((classes || []).map((c) => c.grade).filter(Boolean))]);
}

// The ACTIVE configuration for one academic year + semester + grade (there is at most one).
function activeConfigFor(configs, academicYearId, semester, grade) {
  return (configs || []).find((c) => c.status === "ACTIVE" && c.academicYearId === academicYearId && c.semester === semester && c.grade === grade) || null;
}

// ---------------------------------------------------------------------------------------------
// What is "recorded"? A result ROW exists as soon as a teacher opens a student (an empty draft), so the
// row alone says nothing. A result holds RECORDED DATA when it is published/locked, has any scored
// component, or has any evidence page — the same rule as public.result_has_recorded_data(). Only
// recorded data protects a structure from deletion, and only recorded data is ever "a result".
// ---------------------------------------------------------------------------------------------

// evidence: the db.resultEvidence rows (any array of { resultId }).
function resultHasRecordedData(record, evidence) {
  if (!record) return false;
  if (record.publishStatus && record.publishStatus !== "DRAFT") return true;
  const rows = record.componentRows || Object.values(record.components || {});
  if (rows.some((c) => c && c.score != null)) return true;
  return (evidence || []).some((e) => e.resultId === record.id);
}

// Not started / Draft / Saved / Locked — the state a recording row is shown in.
function resultStateOf(record, evidence) {
  if (!resultHasRecordedData(record, evidence)) return "NOT_STARTED";
  if (record.publishStatus === "LOCKED") return "LOCKED";
  if (record.publishStatus === "PUBLISHED") return "SAVED";
  return "DRAFT";
}
const RESULT_STATE_LABEL = { NOT_STARTED: "Not started", DRAFT: "Draft", SAVED: "Saved", LOCKED: "Locked" };

// The ONE structure a result workflow (gradebook, save score, add evidence) works against: the
// structure the student's existing result was recorded under when it resolves, otherwise the ACTIVE
// structure for the grade + semester + year. A result row that exists but whose pinned structure is
// not resolvable client-side (no result yet recorded, not loaded) must never make a configured grade
// look unconfigured — that is exactly what the gradebook page already did.
//
// An EMPTY draft (nothing recorded) never keeps an old structure: it is not started, so it follows the
// active one (the database re-pins it on its first score). `evidence` is db.resultEvidence.
function effectiveConfigFor(record, configs, academicYearId, semester, grade, evidence) {
  const active = activeConfigFor(configs, academicYearId, semester, grade);
  if (record && record.configuration && record.configuration.status !== "ACTIVE" && !resultHasRecordedData(record, evidence)) return active;
  return (record && record.configuration) || active;
}

// Where one student's result sits on a recording screen.
//   NOT_STARTED       nothing recorded (no row, or an empty draft): records against the active structure
//   CURRENT           recorded under the active structure
//   EARLIER_VERSION   recorded under an earlier VERSION while a newer one is active: still the student's
//                     result for this semester (one row per student/subject/semester/year), editable as before
//   HISTORICAL        recorded under a structure that is closed with NO active successor: read-only history,
//                     never presented as a current, editable result
function classifyRecordedResult(record, activeConfig, evidence) {
  if (!resultHasRecordedData(record, evidence)) return { kind: "NOT_STARTED", config: activeConfig || null };
  const pinned = record.configuration || null;
  if (pinned && pinned.status === "ACTIVE") return { kind: "CURRENT", config: pinned };
  if (!pinned && activeConfig) return { kind: "CURRENT", config: activeConfig };
  if (pinned && activeConfig) return { kind: "EARLIER_VERSION", config: pinned };
  return { kind: "HISTORICAL", config: pinned };
}

// The roster for one class + subject + semester + year, sorted into what the recording screen shows.
//   students       the enrolled roster (already scoped to the academic year by the caller)
//   recordFor(id)  the student's result row or null
//   activeConfig   the active structure for this grade + semester + year, or null
//   evidence       db.resultEvidence
// Returns:
//   state          A_CONFIGURED_EMPTY | B_CONFIGURED_RESULTS | C_NO_STRUCTURE | D_HISTORY_ONLY | E_NO_STUDENTS
//   groups         editable tables, one per structure: [{ config, students }] (active first, then newest earlier version)
//   unrecordable   students with nothing recorded and no active structure to record against
//   historical     [{ student, record, config }] read-only history under a closed structure
//   counts         { notStarted, draft, saved, locked, historical }
function planRecordingScreen({ students, recordFor, activeConfig, evidence }) {
  const groupMap = new Map();
  const unrecordable = [];
  const historical = [];
  const counts = { notStarted: 0, draft: 0, saved: 0, locked: 0, historical: 0 };
  for (const s of students) {
    const record = recordFor(s.id);
    const { kind, config } = classifyRecordedResult(record, activeConfig, evidence);
    if (kind === "HISTORICAL") { historical.push({ student: s, record, config }); counts.historical += 1; continue; }
    if (!config) { unrecordable.push(s); counts.notStarted += 1; continue; }
    const st = resultStateOf(record, evidence);
    if (st === "NOT_STARTED") counts.notStarted += 1;
    else if (st === "DRAFT") counts.draft += 1;
    else if (st === "LOCKED") counts.locked += 1;
    else counts.saved += 1;
    if (!groupMap.has(config.id)) groupMap.set(config.id, { config, students: [] });
    groupMap.get(config.id).students.push(s);
  }
  if (activeConfig && !groupMap.has(activeConfig.id)) groupMap.set(activeConfig.id, { config: activeConfig, students: [] });
  const groups = [...groupMap.values()].sort((a, b) => (b.config.status === "ACTIVE") - (a.config.status === "ACTIVE") || b.config.version - a.config.version);

  const recordedRows = counts.draft + counts.saved + counts.locked;
  let state;
  if (students.length === 0) state = "E_NO_STUDENTS";
  else if (activeConfig) state = recordedRows > 0 ? "B_CONFIGURED_RESULTS" : "A_CONFIGURED_EMPTY";
  else state = groups.length > 0 ? "B_CONFIGURED_RESULTS" : historical.length > 0 ? "D_HISTORY_ONLY" : "C_NO_STRUCTURE";
  return { state, groups, unrecordable, historical, counts };
}

// ---------------------------------------------------------------------------------------------
// Results Settings: what is being VIEWED (filters) vs where a structure is APPLIED (targets). They never
// share state: the filters only narrow the overview, the apply target is always explicit.
// ---------------------------------------------------------------------------------------------

const FILTER_ALL = "ALL";

// grades: the canonical grade list. filter: FILTER_ALL or one grade / semester.
function gradesInView(grades, filter) { return !filter || filter === FILTER_ALL ? grades : grades.filter((g) => g === filter); }
function semestersInView(filter) { return !filter || filter === FILTER_ALL ? SEMESTERS : SEMESTERS.filter((s) => s === filter); }

// Every grade x semester an apply covers, once each, in canonical order (grade order, then S1, S2).
// Duplicate or unknown input never produces a duplicate or an unexpected combination.
function expandTargets(grades, semesters) {
  const gs = sortGrades([...new Set(grades || [])]);
  const ss = SEMESTERS.filter((s) => (semesters || []).includes(s));
  return gs.flatMap((grade) => ss.map((semester) => ({ grade, semester })));
}

// What saving `draftRows` ([{ name, weight, kind }], trimmed) would do to each target: create it,
// replace a different structure, or nothing (already identical). `hasResults` is true when RECORDED data
// sits under the existing structure (a replacement then becomes a new version; recorded results keep theirs).
function planApplyTargets({ targets, configs, results, evidence, academicYearId, draftRows }) {
  const draftJson = JSON.stringify(draftRows);
  const norm = (c) => JSON.stringify(activeAssessments(c).map((a) => ({ name: a.name.trim(), weight: Number(a.weight), kind: a.kind })));
  return targets.map(({ grade, semester }) => {
    const c = activeConfigFor(configs, academicYearId, semester, grade);
    const status = !c ? "create" : norm(c) === draftJson ? "same" : "replace";
    const hasResults = !!c && (results || []).some((r) => r.configurationId === c.id && resultHasRecordedData(r, evidence));
    return { grade, semester, status, hasResults };
  });
}

export {
  activeAssessments, parseWeight, configTotals, validateConfigDraft, gradesFromClasses, activeConfigFor, effectiveConfigFor,
  resultHasRecordedData, resultStateOf, RESULT_STATE_LABEL, classifyRecordedResult, planRecordingScreen,
  FILTER_ALL, gradesInView, semestersInView, expandTargets, planApplyTargets,
};
