import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Info, Lock, Save, Pencil } from "lucide-react";
import { SEMESTERS, SEMESTER_LABEL, ASSESSMENT_KIND, ASSESSMENT_KIND_LABEL, RESULT_TOTAL_WEIGHT, ROLES } from "../../utils/constants";
import { uid, timeAgo, fmtDate, fmtTime } from "../../utils/helpers";
import { currentAcademicYear, formatAcademicYearLabel } from "../../utils/academicCalendar";
import { activeAssessments, activeConfigFor, gradesFromClasses, validateConfigDraft } from "../../utils/resultConfig";
import { displayActorLabel } from "../../utils/resultAudit";
import { Card, Badge, EmptyState, PrimaryButton, GhostButton, ConfirmDialog, inputCls, semesterPhaseChip } from "../../components/ui";
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

function draftFromConfig(config) {
  return activeAssessments(config).map((a) => ({ key: a.id, name: a.name, weight: String(a.weight), kind: a.kind }));
}
const normalize = (rows) => rows.map((r) => ({ name: r.name.trim(), weight: Number(r.weight), kind: r.kind }));

function ResultsSettingsPage({ onBack }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const { isBusy, run } = useMutationGuard();
  const role = auth.currentUser?.role;

  const years = db.academicYears;
  const [yearId, setYearId] = useState((currentAcademicYear(years) || {}).id || "");
  const [semester, setSemester] = useState(() => data.currentResultSemester((currentAcademicYear(years) || {}).id));
  const grades = useMemo(() => gradesFromClasses(db.classes), [db.classes]);
  const [grade, setGrade] = useState(grades[0] || "");

  const config = activeConfigFor(db.resultConfigs, yearId, semester, grade);
  const [rows, setRows] = useState(() => draftFromConfig(config));
  // "Apply to": which grades and semesters this structure is saved for. Starts as just the one being
  // viewed; tick more to configure several at once instead of repeating the same structure per class.
  const [targetGrades, setTargetGrades] = useState(() => (grades[0] ? [grades[0]] : []));
  const [targetSems, setTargetSems] = useState(() => [semester]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { grade, semester } | null
  // Reload the draft only when the selection (or the saved structure itself) changes — a background
  // refresh of the same structure must not wipe what is being typed.
  useEffect(() => { setRows(draftFromConfig(config)); }, [config?.id, yearId, semester, grade]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTargetGrades(grade ? [grade] : []); setTargetSems([semester]); }, [yearId, semester, grade]);

  if (role !== ROLES.OWNER && role !== ROLES.ADMIN) {
    return <EmptyState title="Not available" description="Only the Owner and the Educational Director can configure results." />;
  }

  const validation = validateConfigDraft(rows);
  const { totals } = validation;
  const savedRows = draftFromConfig(config);
  const dirty = JSON.stringify(normalize(rows)) !== JSON.stringify(normalize(savedRows));
  const year = years.find((y) => y.id === yearId);
  const yearLabel = year ? formatAcademicYearLabel(year) : "";
  const recordedCount = config ? db.results.filter((r) => r.configurationId === config.id).length : 0;
  const lockInfo = data.semesterResultLockInfo(semester, yearId);
  const versions = data.resultConfigVersions(yearId, semester, grade);
  const history = (db.resultConfigAudit || []).filter((e) => e.academicYearId === yearId && e.semester === semester && e.grade === grade);
  const saveKey = `save-result-config:${yearId}:${semester}:${grade}`;

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
  // Every selected grade x semester, and what saving would do to each: create it, replace a different
  // structure, or nothing (already identical). The one being viewed is edited in place, so it never
  // counts as "replacing another structure".
  const draftJson = JSON.stringify(normalize(rows));
  const targets = targetGrades.flatMap((g) => targetSems.map((s) => {
    const c = activeConfigFor(db.resultConfigs, yearId, s, g);
    const status = !c ? "create" : JSON.stringify(normalize(draftFromConfig(c))) === draftJson ? "same" : "replace";
    const hasResults = !!c && db.results.some((r) => r.configurationId === c.id);
    return { grade: g, semester: s, status, hasResults, isViewed: g === grade && s === semester };
  }));
  const willCreate = targets.filter((t) => t.status === "create");
  const willReplace = targets.filter((t) => t.status === "replace");
  const otherReplaced = willReplace.filter((t) => !t.isViewed);
  const willVersion = willReplace.filter((t) => t.hasResults);
  const changesNeeded = willCreate.length + willReplace.length;
  const canSaveNow = validation.canSave && targets.length > 0 && changesNeeded > 0;
  const labelOf = (t) => `${t.grade} · ${SEMESTER_LABEL[t.semester]}`;

  function toggleIn(list, setList, value) { setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]); }

  function requestSave() {
    if (!canSaveNow) return;
    if (otherReplaced.length > 0) setConfirmOpen(true); else save();
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

  // Delete one grade + semester's structure. Recorded results are never destroyed: with results the
  // server archives it instead (closed to new entries), and says which happened.
  const deleteConfig = deleteTarget ? activeConfigFor(db.resultConfigs, yearId, deleteTarget.semester, deleteTarget.grade) : null;
  const deleteHasResults = !!deleteConfig && db.results.some((r) => r.configurationId === deleteConfig.id);
  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const res = await data.deleteResultConfiguration({ academicYearId: yearId, semester: target.semester, grade: target.grade });
    if (!res.ok) { toast(res.message, "error"); return; }
    toast(res.result.outcome === "ARCHIVED"
      ? `Structure for ${target.grade} · ${SEMESTER_LABEL[target.semester]} closed — recorded results keep it, but no new results can be entered.`
      : `Structure for ${target.grade} · ${SEMESTER_LABEL[target.semester]} deleted.`, "success");
  }

  const barTone = totals.over ? "bg-red-500" : totals.complete ? "bg-emerald-500" : "bg-amber-400";
  const totalTone = totals.over ? "text-red-600" : totals.complete ? "text-emerald-600" : "text-amber-600";

  return (
    <div className="pb-24 sm:pb-0">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to Results</button>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Results Settings</h1>
      <p className="text-sm text-slate-400 mb-4">Choose which assessments make up the 100-point result for each grade and semester. Teachers see exactly the structure you save here.</p>

      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Academic year</span>
            <select value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputCls}>
              {years.map((y) => <option key={y.id} value={y.id}>{formatAcademicYearLabel(y)}{y.isCurrent ? " (current)" : ""}</option>)}
            </select>
          </label>
          <div>
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Semester</span>
            <div className="flex gap-1.5">
              {SEMESTERS.map((s) => (
                <button key={s} type="button" onClick={() => setSemester(s)} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border ${semester === s ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>{SEMESTER_LABEL[s]}</button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Grade</span>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} className={inputCls}>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {grades.length === 0 ? (
        <EmptyState title="No grades yet" description="Add a class first — grades come from the classes the school has created." />
      ) : (
        <>
          <div className={`rounded-lg border px-4 py-3 mb-4 flex items-start gap-2.5 ${config ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
            <Info size={17} className={`shrink-0 mt-0.5 ${config ? "text-sky-500" : "text-slate-400"}`} />
            <div className="text-xs leading-relaxed">
              {config ? (
                <>
                  <p className="font-semibold text-sky-800">A structure already exists for {grade} · {SEMESTER_LABEL[semester]} · {yearLabel}.</p>
                  <p className="text-sky-700 mt-0.5">You are editing version {config.version}{config.updatedAt ? `, last saved ${timeAgo(config.updatedAt)}` : ""}.
                    {recordedCount > 0 ? ` ${recordedCount} result${recordedCount === 1 ? " is" : "s are"} already recorded under it — saving a different structure creates version ${config.version + 1} for future entries; results already recorded keep the structure they were entered under.` : " No results are recorded under it yet, so changes apply straight away."}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-slate-700">No structure configured yet for {grade} · {SEMESTER_LABEL[semester]} · {yearLabel}.</p>
                  <p className="text-slate-500 mt-0.5">Until you save one, teachers of this grade can't enter results for this semester.</p>
                </>
              )}
              {lockInfo && lockInfo.phase !== "active" && lockInfo.phase !== "before_semester" && (
                <p className="mt-1 flex items-center gap-1 text-amber-700"><Lock size={12} /> {SEMESTER_LABEL[semester]} {lockInfo.phase === "grace_period" ? "has ended and is in its correction window" : "is locked"}.</p>
              )}
            </div>
          </div>

          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-slate-700">{config ? "Edit" : "Create"} assessments — {grade} · {SEMESTER_LABEL[semester]}</h2>
              <div className="flex items-center gap-2">
                {config && <GhostButton danger icon={Trash2} onClick={() => setDeleteTarget({ grade, semester })}>Delete structure</GhostButton>}
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
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Apply this structure to</h2>
              <div className="flex items-center gap-2">
                <GhostButton onClick={() => setTargetGrades(grades)}>All grades</GhostButton>
                <GhostButton onClick={() => setTargetGrades(grade ? [grade] : [])}>Only {grade || "this grade"}</GhostButton>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-3">Tick every grade and semester that should use these assessments — you only fill them in once.</p>
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Semesters</span>
            <div className="flex gap-2 flex-wrap mb-3">
              {SEMESTERS.map((s) => (
                <label key={s} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer select-none ${targetSems.includes(s) ? "border-brand-400 bg-brand-50 text-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={targetSems.includes(s)} onChange={() => toggleIn(targetSems, setTargetSems, s)} />
                  {SEMESTER_LABEL[s]}
                </label>
              ))}
            </div>
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Grades</span>
            <div className="flex gap-2 flex-wrap">
              {grades.map((g) => (
                <label key={g} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer select-none ${targetGrades.includes(g) ? "border-brand-400 bg-brand-50 text-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={targetGrades.includes(g)} onChange={() => toggleIn(targetGrades, setTargetGrades, g)} />
                  {g}
                </label>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs space-y-1">
              {targets.length === 0 ? (
                <p className="text-red-600">Choose at least one grade and one semester.</p>
              ) : (
                <>
                  <p className="text-slate-600">
                    Saving will set {targets.length} combination{targets.length === 1 ? "" : "s"}: {willCreate.length} new, {willReplace.length} changed, {targets.length - willCreate.length - willReplace.length} already identical.
                  </p>
                  {otherReplaced.length > 0 && (
                    <p className="text-amber-700">Replaces the existing structure for: {otherReplaced.map(labelOf).join("; ")}.</p>
                  )}
                  {willVersion.length > 0 && (
                    <p className="text-amber-700">Results are already recorded for {willVersion.map(labelOf).join("; ")} — those become a new version; recorded results keep their earlier structure.</p>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Sticky on phones so Save is always in reach while scrolling a long structure. */}
          <div className="fixed sm:static bottom-0 inset-x-0 z-20 bg-white sm:bg-transparent border-t sm:border-0 border-slate-200 px-4 py-3 sm:p-0 flex items-center justify-end gap-2 mb-4">
            {dirty && <GhostButton onClick={() => setRows(draftFromConfig(config))}>Discard changes</GhostButton>}
            <PrimaryButton icon={Save} onClick={requestSave} disabled={!canSaveNow} loading={isBusy(saveKey)} loadingText="Saving…">{targets.length > 1 ? `Save for ${targets.length} combinations` : "Save Configuration"}</PrimaryButton>
          </div>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={save}
            title="Replace existing structures?"
            description={`This will replace the assessment structure already set for ${otherReplaced.map(labelOf).join("; ")}.${willVersion.length ? " Where results are already recorded, they keep the structure they were entered under and the new one applies to future entries." : ""}`}
            confirmLabel="Replace and save"
            danger
          />
          <ConfirmDialog
            open={!!deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={confirmDelete}
            title={deleteTarget ? `Delete structure — ${deleteTarget.grade} · ${SEMESTER_LABEL[deleteTarget.semester]}?` : "Delete structure?"}
            description={deleteHasResults
              ? "Results are already recorded under this structure, so it will be closed instead of erased: teachers can no longer enter new results for this grade and semester, and every recorded result keeps its scores and assessments. You can set up a new structure afterwards."
              : "No results are recorded under this structure, so it will be removed completely. Teachers of this grade will see \"No Results Configuration\" until you set a new one."}
            confirmLabel={deleteHasResults ? "Close structure" : "Delete structure"}
            danger
          />

          <Card className="p-4 mb-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Overview — {yearLabel}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400"><tr><th className="text-left font-medium py-1.5 pr-3">Grade</th>{SEMESTERS.map((s) => <th key={s} className="text-left font-medium py-1.5 px-2">{SEMESTER_LABEL[s]}</th>)}</tr></thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g} className="border-t border-slate-100">
                      <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{g}</td>
                      {SEMESTERS.map((s) => {
                        const c = activeConfigFor(db.resultConfigs, yearId, s, g);
                        const chip = semesterPhaseChip(data.semesterResultLockInfo(s, yearId));
                        return (
                          <td key={s} className="py-1.5 px-2">
                            <div className="flex items-stretch gap-1">
                            <button type="button" onClick={() => { setGrade(g); setSemester(s); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`text-left rounded-lg border px-2.5 py-1.5 text-xs w-full ${g === grade && s === semester ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
                              {c ? <span className="text-slate-700">{activeAssessments(c).map((a) => `${a.name} ${a.weight}`).join(" · ")}</span> : <span className="text-slate-400">Not configured</span>}
                              {c && <span className="ml-1.5 text-slate-400">v{c.version}</span>}
                              {chip && <Badge tone={chip.tone}>{chip.label}</Badge>}
                            </button>
                            {c && (
                              <>
                                <button type="button" onClick={() => { setGrade(g); setSemester(s); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="px-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-brand-600" title={`Edit ${g} · ${SEMESTER_LABEL[s]}`} aria-label={`Edit structure for ${g} ${SEMESTER_LABEL[s]}`}><Pencil size={14} /></button>
                                <button type="button" onClick={() => setDeleteTarget({ grade: g, semester: s })} className="px-2 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50" title={`Delete ${g} · ${SEMESTER_LABEL[s]}`} aria-label={`Delete structure for ${g} ${SEMESTER_LABEL[s]}`}><Trash2 size={14} /></button>
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
              {versions.length > 1 && <p className="text-xs text-slate-400 mb-2">Versions: {versions.map((v) => `v${v.version}${v.status === "ACTIVE" ? " (current)" : ""}`).join(", ")}</p>}
              {history.length === 0 ? (
                <p className="text-xs text-slate-400">No configuration changes recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((e) => (
                    <div key={e.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-600">{displayActorLabel(e, role)}</span>
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
