import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Info, Lock, Save, Pencil, Loader2 } from "lucide-react";
import { SEMESTERS, SEMESTER_LABEL, ASSESSMENT_KIND, ASSESSMENT_KIND_LABEL, RESULT_TOTAL_WEIGHT, ROLES } from "../../utils/constants";
import { uid, timeAgo, fmtDate, fmtTime } from "../../utils/helpers";
import { currentAcademicYear, formatAcademicYearLabel } from "../../utils/academicCalendar";
import {
  activeAssessments, activeConfigFor, gradesFromClasses, validateConfigDraft, resultHasRecordedData,
  FILTER_ALL, gradesInView, semestersInView, expandTargets, planApplyTargets,
} from "../../utils/resultConfig";
import { displayActorLabel } from "../../utils/resultAudit";
import { Card, Badge, EmptyState, PrimaryButton, GhostButton, ConfirmDialog, Modal, inputCls, semesterPhaseChip } from "../../components/ui";
import { useData } from "../../context/DataContext";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMutationGuard } from "../../hooks/useMutationGuard";

// Results Settings — where the Owner / Educational Director defines, per academic year + semester +
// grade, which assessments make up the 100-point result (name, weight, Test / Non-test). Nothing
// here is a default the school did not choose: an unconfigured grade simply has no structure, and
// teachers see "please contact the Educational Director" until one is saved. The server
// (save_result_configuration) re-validates everything; this screen mirrors its rules only to show
// Configured / Remaining live and explain a rejected value before Save.
//
// TWO KINDS OF SCOPE, NEVER MIXED:
//   * the VIEW filters at the top (Academic year, Semester, Grade — Semester and Grade default to All)
//     only decide what the Overview and history below show. They never decide what Save changes.
//   * "Apply this structure to" is the one place that decides where a structure is created or replaced:
//     an explicit list of grades x semesters (All, one, or several), previewed combination by
//     combination before anything is saved. The explicit apply target always wins over the view filters.

function draftFromConfig(config) {
  return activeAssessments(config).map((a) => ({ key: a.id, name: a.name, weight: String(a.weight), kind: a.kind }));
}
const normalize = (rows) => rows.map((r) => ({ name: r.name.trim(), weight: Number(r.weight), kind: r.kind }));
const semLabel = (s) => SEMESTER_LABEL[s];
const comboLabel = (t) => `${t.grade} — ${semLabel(t.semester)}`;
const SAVED_STATUS_LABEL = { DRAFT: "draft with scores", PUBLISHED: "published", LOCKED: "locked" };

// "All" + one checkbox per option. "All" is ticked exactly when every option is; ticking it selects
// every option, unticking it clears them.
function TargetPicker({ label, allLabel, options, selected, onChange, optionLabel = (o) => o }) {
  const all = options.length > 0 && options.every((o) => selected.includes(o));
  const chip = (on) => `inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer select-none ${on ? "border-brand-400 bg-brand-50 text-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`;
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1.5">{label}</span>
      <div className="flex gap-2 flex-wrap" role="group" aria-label={label}>
        <label className={chip(all)}>
          <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : [...options])} aria-label={allLabel} />
          <span className="font-medium">All</span>
        </label>
        {options.map((o) => (
          <label key={o} className={chip(selected.includes(o))}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(selected.includes(o) ? selected.filter((v) => v !== o) : [...selected, o])} aria-label={optionLabel(o)} />
            {optionLabel(o)}
          </label>
        ))}
      </div>
    </div>
  );
}

function ResultsSettingsPage({ onBack, onViewResults }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const { isBusy, run } = useMutationGuard();
  const role = auth.currentUser?.role;

  const years = db.academicYears;
  const [yearId, setYearId] = useState((data.db.workspaceYear || currentAcademicYear(years) || {}).id || "");
  // VIEW filters — narrow what is displayed, nothing else.
  const [semFilter, setSemFilter] = useState(FILTER_ALL);
  const [gradeFilter, setGradeFilter] = useState(FILTER_ALL);
  const grades = useMemo(() => gradesFromClasses(db.classes), [db.classes]);

  // The structure being edited: a concrete grade + semester loaded from the Overview (or null for a brand-new one).
  const [source, setSource] = useState(null); // { grade, semester } | null
  const sourceConfig = source ? activeConfigFor(db.resultConfigs, yearId, source.semester, source.grade) : null;
  const [rows, setRows] = useState([]);
  // APPLY target — explicit. Until the user touches it, it simply mirrors a concrete view filter.
  const [targetGrades, setTargetGrades] = useState([]);
  const [targetSems, setTargetSems] = useState([]);
  const [targetTouched, setTargetTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteFlow, setDeleteFlow] = useState(null); // { grade, semester, phase: checking|confirm|blocked|error, impact, message }

  useEffect(() => { // structures belong to one academic year: switching year starts clean
    setSource(null); setRows([]); setTargetTouched(false); setDeleteFlow(null);
  }, [yearId]);
  useEffect(() => { // a concrete filter pre-fills (only) an untouched apply target; "All" never picks anything
    if (source || targetTouched) return;
    setTargetGrades(gradeFilter !== FILTER_ALL ? [gradeFilter] : []);
    setTargetSems(semFilter !== FILTER_ALL ? [semFilter] : []);
  }, [gradeFilter, semFilter, source, targetTouched]);
  // A background refresh of the same structure (or a new version after saving) reloads the draft — but
  // only when the structure itself changed, so it never wipes what is being typed.
  useEffect(() => { if (source) setRows(draftFromConfig(sourceConfig)); }, [sourceConfig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (role !== ROLES.OWNER && role !== ROLES.ADMIN) {
    return <EmptyState title="Not available" description="Only the Owner and the Educational Director can configure results." />;
  }

  const validation = validateConfigDraft(rows);
  const { totals } = validation;
  const savedRows = draftFromConfig(sourceConfig);
  const dirty = source ? JSON.stringify(normalize(rows)) !== JSON.stringify(normalize(savedRows)) : rows.length > 0;
  const year = years.find((y) => y.id === yearId);
  const yearLabel = year ? formatAcademicYearLabel(year) : "";
  const recordedCount = sourceConfig ? db.results.filter((r) => r.configurationId === sourceConfig.id && resultHasRecordedData(r, db.resultEvidence)).length : 0;
  const lockInfo = source ? data.semesterResultLockInfo(source.semester, yearId) : null;
  const versions = source ? data.resultConfigVersions(yearId, source.semester, source.grade) : [];
  const shownGrades = gradesInView(grades, gradeFilter);
  const shownSems = semestersInView(semFilter);
  const history = (db.resultConfigAudit || []).filter((e) => e.academicYearId === yearId && shownSems.includes(e.semester) && shownGrades.includes(e.grade));
  const saveKey = `save-result-config:${yearId}`;

  function updateRow(key, patch) { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); }
  function removeRow(key) { setRows((rs) => rs.filter((r) => r.key !== key)); }
  function moveRow(key, dir) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function addRow() {
    // Pre-fill the points that are still unassigned, so completing a structure is one field per row.
    setRows((rs) => {
      const remaining = validateConfigDraft(rs).totals.remaining;
      return [...rs, { key: uid("row"), name: "", weight: remaining > 0 ? String(remaining) : "", kind: ASSESSMENT_KIND.TEST }];
    });
  }

  // Load one grade + semester's structure (or an empty form for an unconfigured one) into the editor,
  // and point Apply at exactly that combination — the user can widen it explicitly below.
  function loadStructure(g, s) {
    setSource({ grade: g, semester: s });
    setRows(draftFromConfig(activeConfigFor(db.resultConfigs, yearId, s, g)));
    setTargetGrades([g]); setTargetSems([s]); setTargetTouched(true);
    if (typeof window !== "undefined" && window.scrollTo) window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function startNew() { setSource(null); setRows([]); setTargetTouched(false); }
  const setGradesTarget = (v) => { setTargetGrades(v); setTargetTouched(true); };
  const setSemsTarget = (v) => { setTargetSems(v); setTargetTouched(true); };

  // Every selected grade x semester, and what saving would do to each: create it, replace a different
  // structure, or nothing (already identical).
  const targets = expandTargets(targetGrades, targetSems);
  const plan = planApplyTargets({ targets, configs: db.resultConfigs, results: db.results, evidence: db.resultEvidence, academicYearId: yearId, draftRows: normalize(rows) });
  const willCreate = plan.filter((t) => t.status === "create");
  const willReplace = plan.filter((t) => t.status === "replace");
  const identical = plan.filter((t) => t.status === "same");
  const willVersion = willReplace.filter((t) => t.hasResults);
  const isSource = (t) => !!source && t.grade === source.grade && t.semester === source.semester;
  const replacedElsewhere = willReplace.filter((t) => !isSource(t));
  const changesNeeded = willCreate.length + willReplace.length;
  const canSaveNow = validation.canSave && plan.length > 0 && changesNeeded > 0;
  // Asking twice is only worth it when the save reaches beyond one new/edited structure.
  const needsConfirm = replacedElsewhere.length > 0 || changesNeeded > 1;
  const filterNote = `${semFilter === FILTER_ALL ? "All semesters" : semLabel(semFilter)} · ${gradeFilter === FILTER_ALL ? "All grades" : gradeFilter}`;

  function requestSave() {
    if (!canSaveNow) return;
    if (needsConfirm) setConfirmOpen(true); else save();
  }
  async function save() {
    await run(async () => {
      const res = await data.saveResultConfiguration({ academicYearId: yearId, semesters: targetSems, grades: targetGrades, components: normalize(rows) });
      if (!res.ok) { toast(res.message, "error"); return; }
      const made = res.results.filter((r) => r.action === "CREATED").length;
      const updated = res.results.filter((r) => r.action === "UPDATED").length;
      const versioned = res.results.filter((r) => r.action === "NEW_VERSION").length;
      const parts = [];
      if (made) parts.push(`${made} created`);
      if (updated) parts.push(`${updated} updated`);
      if (versioned) parts.push(`${versioned} saved as a new version (results already recorded keep their earlier structure)`);
      toast(parts.length ? `Result structure saved — ${parts.join(", ")}.` : "No changes to save.", "success");
    }, { key: saveKey });
  }

  // Delete ONE grade + semester's structure. The database decides: while any student has SAVED results
  // under it the delete is refused (never archived, never erased) and the exact affected students are
  // listed. We ask the database first so the dialog shows the truth; delete_result_configuration
  // checks again itself, so a score saved a moment ago still blocks it.
  async function startDelete(g, s) {
    setDeleteFlow({ grade: g, semester: s, phase: "checking" });
    const res = await data.resultConfigDeleteImpact({ academicYearId: yearId, semester: s, grade: g });
    if (!res.ok) { setDeleteFlow({ grade: g, semester: s, phase: "error", message: res.message }); return; }
    setDeleteFlow({ grade: g, semester: s, phase: res.impact.canDelete ? "confirm" : "blocked", impact: res.impact });
  }
  async function confirmDelete() {
    const f = deleteFlow;
    if (!f) return;
    await run(async () => {
      const res = await data.deleteResultConfiguration({ academicYearId: yearId, semester: f.semester, grade: f.grade });
      if (!res.ok) {
        setDeleteFlow({ ...f, phase: res.impact ? "blocked" : "error", impact: res.impact || f.impact, message: res.message });
        return;
      }
      setDeleteFlow(null);
      if (source && source.grade === f.grade && source.semester === f.semester) { setRows([]); }
      toast(`Structure for ${f.grade} · ${semLabel(f.semester)} deleted.`, "success");
    }, { key: `delete-result-config:${yearId}:${f.grade}:${f.semester}` });
  }
  function viewAffected(f) {
    setDeleteFlow(null);
    if (onViewResults) onViewResults({ grade: f.grade, semester: f.semester, academicYearId: yearId });
  }

  const barTone = totals.over ? "bg-red-500" : totals.complete ? "bg-emerald-500" : "bg-amber-400";
  const totalTone = totals.over ? "text-red-600" : totals.complete ? "text-emerald-600" : "text-amber-600";
  const editing = !!source;
  const flowImpact = deleteFlow && deleteFlow.impact;
  const flowStudents = flowImpact ? flowImpact.students || [] : [];
  const flowNames = [...new Set(flowStudents.map((x) => x.name))];

  return (
    <div className="pb-24 sm:pb-0">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to Results</button>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Results Settings</h1>
      <p className="text-sm text-slate-400 mb-4">Choose which assessments make up the 100-point result for each grade and semester. Teachers see exactly the structure you save here.</p>

      <Card className="p-4 mb-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">Viewing</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Academic year</span>
            <select aria-label="Academic year" value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputCls}>
              {years.map((y) => <option key={y.id} value={y.id}>{formatAcademicYearLabel(y)}{y.isCurrent ? " (current)" : ""}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Semester</span>
            <select aria-label="Semester" value={semFilter} onChange={(e) => setSemFilter(e.target.value)} className={inputCls}>
              <option value={FILTER_ALL}>All</option>
              {SEMESTERS.map((s) => <option key={s} value={s}>{semLabel(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Grade</span>
            <select aria-label="Grade" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className={inputCls}>
              <option value={FILTER_ALL}>All</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-slate-400 mt-2.5">These choose what you see in the Overview below. They do not decide where a structure is saved — that is set under “Apply this structure to”.</p>
      </Card>

      {grades.length === 0 ? (
        <EmptyState title="No grades yet" description="Add a class first — grades come from the classes the school has created." />
      ) : (
        <>
          <div className={`rounded-lg border px-4 py-3 mb-4 flex items-start gap-2.5 ${sourceConfig ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
            <Info size={17} className={`shrink-0 mt-0.5 ${sourceConfig ? "text-sky-500" : "text-slate-400"}`} />
            <div className="text-xs leading-relaxed">
              {sourceConfig ? (
                <>
                  <p className="font-semibold text-sky-800">A structure already exists for {source.grade} · {semLabel(source.semester)} · {yearLabel}.</p>
                  <p className="text-sky-700 mt-0.5">You are editing version {sourceConfig.version}{sourceConfig.updatedAt ? `, last saved ${timeAgo(sourceConfig.updatedAt)}` : ""}.
                    {recordedCount > 0 ? ` ${recordedCount} result${recordedCount === 1 ? " is" : "s are"} already recorded under it — saving a different structure creates version ${sourceConfig.version + 1} for future entries; results already recorded keep the structure they were entered under.` : " No results are recorded under it yet, so changes apply straight away."}</p>
                </>
              ) : editing ? (
                <>
                  <p className="font-semibold text-slate-700">No structure configured yet for {source.grade} · {semLabel(source.semester)} · {yearLabel}.</p>
                  <p className="text-slate-500 mt-0.5">Until you save one, teachers of this grade can't enter results for this semester.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-slate-700">New assessment structure · {yearLabel}</p>
                  <p className="text-slate-500 mt-0.5">Add the assessments, then choose the grades and semesters to apply them to. To change an existing structure, pick it in the Overview below.</p>
                </>
              )}
              {lockInfo && lockInfo.phase !== "active" && lockInfo.phase !== "before_semester" && (
                <p className="mt-1 flex items-center gap-1 text-amber-700"><Lock size={12} /> {semLabel(source.semester)} {lockInfo.phase === "grace_period" ? "has ended and is in its correction window" : "is locked"}.</p>
              )}
            </div>
          </div>

          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-slate-700">{editing ? `${sourceConfig ? "Edit" : "Create"} assessments — ${source.grade} · ${semLabel(source.semester)}` : "Create assessments"}</h2>
              <div className="flex items-center gap-2">
                {editing && <GhostButton onClick={startNew}>Start a new structure</GhostButton>}
                {sourceConfig && <GhostButton danger icon={Trash2} onClick={() => startDelete(source.grade, source.semester)}>Delete structure</GhostButton>}
                <GhostButton icon={Plus} onClick={addRow}>Add assessment</GhostButton>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No assessments yet. Add the first one — for example "Midterm", 20 points, Test.</p>
            ) : (
              <div className="space-y-3">
                {rows.map((r, i) => {
                  const err = validation.rowErrors[r.key];
                  return (
                    <div key={r.key} className={`rounded-lg border p-3 ${err ? "border-red-300 bg-red-50/40" : "border-slate-200"}`}>
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <span className="w-6 text-xs text-slate-400 shrink-0">{i + 1}.</span>
                        <input value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} placeholder="Assessment name (e.g. Midterm 1)" aria-label={`Assessment ${i + 1} name`} className={`${inputCls} flex-1 min-w-[10rem]`} />
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input type="number" inputMode="decimal" min={0} max={RESULT_TOTAL_WEIGHT} step="0.5" value={r.weight} onChange={(e) => updateRow(r.key, { weight: e.target.value })} placeholder="0" aria-label={`Assessment ${i + 1} weight`} className={`${inputCls} w-20 text-center`} />
                          <span className="text-xs text-slate-400">pts</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2.5 pl-8 flex-wrap">
                        <div className="flex items-center gap-4" role="radiogroup" aria-label={`Assessment ${i + 1} type`}>
                          {[ASSESSMENT_KIND.TEST, ASSESSMENT_KIND.NON_TEST].map((k) => (
                            <label key={k} className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                              <input type="radio" name={`kind-${r.key}`} checked={r.kind === k} onChange={() => updateRow(r.key, { kind: k })} />
                              {ASSESSMENT_KIND_LABEL[k]}
                            </label>
                          ))}
                          <span className="text-[11px] text-slate-400 hidden sm:inline">{r.kind === ASSESSMENT_KIND.TEST ? "Teachers attach test evidence" : "No test evidence needed"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" disabled={i === 0} onClick={() => moveRow(r.key, -1)} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25" aria-label="Move up"><ArrowUp size={15} /></button>
                          <button type="button" disabled={i === rows.length - 1} onClick={() => moveRow(r.key, 1)} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25" aria-label="Move down"><ArrowDown size={15} /></button>
                          <button type="button" onClick={() => removeRow(r.key)} className="p-1.5 rounded text-red-500 hover:bg-red-50" aria-label="Remove assessment"><Trash2 size={15} /></button>
                        </div>
                      </div>
                      {err && <p className="text-xs text-red-600 mt-2 pl-8">{err}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-slate-500">Configured</span>
                <span className={`font-semibold ${totalTone}`}>{totals.total} / {RESULT_TOTAL_WEIGHT}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${barTone} transition-all`} style={{ width: `${Math.min(100, (totals.total / RESULT_TOTAL_WEIGHT) * 100)}%` }} /></div>
              <div className="flex items-center justify-between text-sm mt-1.5">
                <span className="text-slate-500">Remaining</span>
                <span className={`font-semibold ${totalTone}`}>{totals.remaining < 0 ? `${Math.abs(totals.remaining)} over` : totals.remaining}</span>
              </div>
              {validation.errors.map((m) => <p key={m} className="text-xs text-red-600 mt-2">{m}</p>)}
            </div>
          </Card>

          <Card className="p-4 mb-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Apply this structure to</h2>
            <p className="text-xs text-slate-400 mb-3">This is where the structure is created or replaced — independent of the view filters at the top. Choose All, one, or several grades and semesters; you only fill the assessments in once.</p>
            <TargetPicker label="Semesters" allLabel="All semesters" options={SEMESTERS} selected={targetSems} onChange={setSemsTarget} optionLabel={semLabel} />
            <TargetPicker label="Grades" allLabel="All grades" options={grades} selected={targetGrades} onChange={setGradesTarget} />

            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500 space-y-0.5" data-testid="scope-note">
              <p>Page filter: <span className="font-medium text-slate-600">{filterNote}</span></p>
              <p>Apply target: <span className="font-medium text-slate-600">{targetSems.length === SEMESTERS.length ? "All semesters" : targetSems.length ? targetSems.map(semLabel).join(", ") : "no semester chosen"} · {targetGrades.length === grades.length && grades.length > 0 ? "All grades" : targetGrades.length ? targetGrades.join(", ") : "no grade chosen"}</span></p>
              <p>The page filter controls what you are viewing. The Apply target controls where this structure will be created — it is never narrowed by the filter.</p>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 text-xs space-y-2">
              {plan.length === 0 ? (
                <p className="text-red-600">Choose at least one grade and one semester.</p>
              ) : (
                <>
                  <p className="text-slate-700 font-medium">This will affect {plan.length} combination{plan.length === 1 ? "" : "s"}:</p>
                  <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 max-h-56 overflow-y-auto" aria-label="Affected combinations">
                    {plan.map((t) => (
                      <li key={`${t.grade}|${t.semester}`} className="flex items-baseline justify-between gap-2 text-slate-600">
                        <span>{comboLabel(t)}</span>
                        <span className={t.status === "create" ? "text-emerald-700" : t.status === "replace" ? "text-amber-700" : "text-slate-400"}>
                          {t.status === "create" ? "new" : t.status === "same" ? "already identical" : t.hasResults ? "replaces — new version" : "replaces existing"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-slate-500">{willCreate.length} new · {willReplace.length} replaced · {identical.length} already identical (unchanged)</p>
                  {replacedElsewhere.length > 0 && (
                    <p className="text-amber-700">Replaces the existing structure for: {replacedElsewhere.map(comboLabel).join("; ")}.</p>
                  )}
                  {willVersion.length > 0 && (
                    <p className="text-amber-700">Results are already recorded for {willVersion.map(comboLabel).join("; ")} — those become a new version; recorded results keep their earlier structure.</p>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Sticky on phones so Save is always in reach while scrolling a long structure. */}
          <div className="fixed sm:static bottom-0 inset-x-0 z-20 bg-white sm:bg-transparent border-t sm:border-0 border-slate-200 px-4 py-3 sm:p-0 flex items-center justify-end gap-2 mb-4">
            {dirty && <GhostButton onClick={() => setRows(source ? draftFromConfig(sourceConfig) : [])}>Discard changes</GhostButton>}
            <PrimaryButton icon={Save} onClick={requestSave} disabled={!canSaveNow} loading={isBusy(saveKey)} loadingText="Saving…">{plan.length > 1 ? `Save for ${plan.length} combinations` : "Save Configuration"}</PrimaryButton>
          </div>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={save}
            title={replacedElsewhere.length > 0 ? "Apply to these grades and replace existing structures?" : `Apply this structure to ${changesNeeded} combinations?`}
            description={`This will set this structure for ${[...willCreate, ...willReplace].map(comboLabel).join("; ")}.${replacedElsewhere.length ? ` It replaces the structure already set for ${replacedElsewhere.map(comboLabel).join("; ")}.` : ""}${willVersion.length ? " Where results are already recorded, they keep the structure they were entered under and the new one applies to future entries." : ""}`}
            confirmLabel="Apply and save"
            danger
          />

          <Modal
            open={!!deleteFlow}
            onClose={() => { if (!isBusy(`delete-result-config:${yearId}:${deleteFlow?.grade}:${deleteFlow?.semester}`)) setDeleteFlow(null); }}
            title={!deleteFlow ? "" : deleteFlow.phase === "blocked" ? "Cannot delete this assessment structure" : `Delete structure — ${deleteFlow.grade} · ${semLabel(deleteFlow.semester)}?`}
          >
            {deleteFlow && deleteFlow.phase === "checking" && (
              <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Checking for saved results…</p>
            )}
            {deleteFlow && deleteFlow.phase === "error" && (
              <>
                <p className="text-sm text-red-600 mb-4">{deleteFlow.message || "Couldn't check this structure."}</p>
                <div className="flex justify-end"><GhostButton onClick={() => setDeleteFlow(null)}>Close</GhostButton></div>
              </>
            )}
            {deleteFlow && deleteFlow.phase === "confirm" && (
              <>
                <p className="text-sm text-slate-600 mb-2">No results have been saved under this structure, so it will be removed completely. No student, enrolment or score is affected.</p>
                {flowImpact && flowImpact.emptyDraftCount > 0 && (
                  <p className="text-sm text-slate-600 mb-2">{flowImpact.emptyDraftCount} empty draft{flowImpact.emptyDraftCount === 1 ? "" : "s"} (opened but with no score) will simply be detached from it.</p>
                )}
                <p className="text-sm text-slate-600 mb-5">Teachers of this grade will see "No Results Structure Configured" until you set a new one.</p>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                  <button type="button" onClick={() => setDeleteFlow(null)} disabled={isBusy(`delete-result-config:${yearId}:${deleteFlow.grade}:${deleteFlow.semester}`)} className="px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
                  <button type="button" onClick={confirmDelete} disabled={isBusy(`delete-result-config:${yearId}:${deleteFlow.grade}:${deleteFlow.semester}`)} className="px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">
                    {isBusy(`delete-result-config:${yearId}:${deleteFlow.grade}:${deleteFlow.semester}`) ? "Working…" : "Delete structure"}
                  </button>
                </div>
              </>
            )}
            {deleteFlow && deleteFlow.phase === "blocked" && (
              <>
                <p className="text-sm font-medium text-slate-800">{deleteFlow.grade} — {semLabel(deleteFlow.semester)} · {yearLabel}</p>
                {flowImpact ? (
                  <>
                    <p className="text-sm text-slate-700 mt-2">
                      {flowImpact.savedStudentCount === 1 ? "1 student has" : `${flowImpact.savedStudentCount} students have`} saved results under this structure.
                    </p>
                    {flowStudents.length > 0 && (
                      <ul className="mt-2 mb-1 text-sm text-slate-600 space-y-0.5 max-h-48 overflow-y-auto">
                        {flowStudents.slice(0, 10).map((x, i) => (
                          <li key={`${x.studentId}-${i}`}>{x.name}{x.subject ? ` — ${x.subject}` : ""} <span className="text-slate-400">({SAVED_STATUS_LABEL[x.status] || x.status.toLowerCase()})</span></li>
                        ))}
                        {flowStudents.length > 10 && <li className="text-slate-400">…and {flowStudents.length - 10} more</li>}
                      </ul>
                    )}
                    <p className="text-sm text-slate-600 mt-2">
                      {flowNames.length === 1 ? "Remove or move that student's saved results before deleting the structure." : "Review the saved results before deleting the structure."} The structure and every saved result have been left exactly as they were.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-700 mt-2">{deleteFlow.message}</p>
                )}
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setDeleteFlow(null)} className="px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
                  {onViewResults && <PrimaryButton icon={Pencil} onClick={() => viewAffected(deleteFlow)}>View affected results</PrimaryButton>}
                </div>
              </>
            )}
          </Modal>

          <Card className="p-4 mb-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Overview — {yearLabel}</h2>
            <p className="text-[11px] text-slate-400 mb-3">Showing {filterNote}. Pick a structure to edit it, or “Not configured” to create one.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400"><tr><th className="text-left font-medium py-1.5 pr-3">Grade</th>{shownSems.map((s) => <th key={s} className="text-left font-medium py-1.5 px-2">{semLabel(s)}</th>)}</tr></thead>
                <tbody>
                  {shownGrades.map((g) => (
                    <tr key={g} className="border-t border-slate-100">
                      <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{g}</td>
                      {shownSems.map((s) => {
                        const c = activeConfigFor(db.resultConfigs, yearId, s, g);
                        const chip = semesterPhaseChip(data.semesterResultLockInfo(s, yearId));
                        const selected = !!source && source.grade === g && source.semester === s;
                        return (
                          <td key={s} className="py-1.5 px-2">
                            <div className="flex items-stretch gap-1">
                            <button type="button" onClick={() => loadStructure(g, s)} className={`text-left rounded-lg border px-2.5 py-1.5 text-xs w-full ${selected ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
                              {c ? (
                                <span className="block text-slate-700">
                                  {activeAssessments(c).map((a) => (
                                    <span key={a.id} className="block">{a.name} {a.weight} <span className="block sm:inline text-slate-400"><span className="hidden sm:inline">· </span>{ASSESSMENT_KIND_LABEL[a.kind]}</span></span>
                                  ))}
                                </span>
                              ) : <span className="text-slate-400">Not configured</span>}
                              {c && <span className="text-slate-400">v{c.version}</span>}
                              {chip && <Badge tone={chip.tone}>{chip.label}</Badge>}
                            </button>
                            {c && (
                              <>
                                <button type="button" onClick={() => loadStructure(g, s)} className="px-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-brand-600" title={`Edit ${g} · ${semLabel(s)}`} aria-label={`Edit structure for ${g} ${semLabel(s)}`}><Pencil size={14} /></button>
                                <button type="button" onClick={() => startDelete(g, s)} className="px-2 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50" title={`Delete ${g} · ${semLabel(s)}`} aria-label={`Delete structure for ${g} ${semLabel(s)}`}><Trash2 size={14} /></button>
                              </>
                            )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {(versions.length > 0 || history.length > 0) && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Who configured this</h2>
              {versions.length > 1 && <p className="text-xs text-slate-400 mb-2">Versions of {source.grade} · {semLabel(source.semester)}: {versions.map((v) => `v${v.version}${v.status === "ACTIVE" ? " (current)" : ""}`).join(", ")}</p>}
              {history.length === 0 ? (
                <p className="text-xs text-slate-400">No configuration changes recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((e) => (
                    <div key={e.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-600">{displayActorLabel(e, role)} <span className="font-normal text-slate-400">· {e.grade} · {semLabel(e.semester)}</span></span>
                        <span className="text-slate-400 shrink-0" title={`${fmtDate(e.at)} ${fmtTime(e.at)}`}>{timeAgo(e.at)}</span>
                      </div>
                      <p className="text-slate-500 mt-0.5">
                        {e.action === "CREATED" ? "Created" : e.action === "NEW_VERSION" ? "Changed (new version)" : e.action === "DELETED" ? (e.diff && e.diff.outcome === "ARCHIVED" ? "Deleted (kept for recorded results)" : "Deleted") : "Updated"} — version {e.version}:{" "}
                        {(((e.diff && (e.diff.after || e.diff.before)) || [])).map((a) => `${a.name} ${a.weight} (${ASSESSMENT_KIND_LABEL[a.kind] || a.kind})`).join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export { ResultsSettingsPage };
