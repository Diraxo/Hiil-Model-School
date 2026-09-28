// Academic-year management UI: the header selector, the "you are viewing another year" banner, the lifecycle
// banners (ending soon / ended / closed), the compact Academic Year settings screen (current year +
// previous / upcoming years + Make Current) and the five-step "Create next academic year" wizard
// (dates -> semesters & break -> billing months -> re-enroll students -> review & activate).
//
// The rules live in utils/academicYearScope.js and the database; this file is presentation + wiring.
import React, { useMemo, useState } from "react";
import {
  CalendarDays, Check, ChevronRight, Eye, Info, AlertTriangle, ArrowLeft, Plus, History, UserCheck, UserX, RefreshCw,
} from "lucide-react";
import { Modal, ConfirmDialog, Card, Badge, Field, PrimaryButton, GhostButton, inputCls, EthiopianDateField } from "./ui";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useMutationGuard } from "../hooks/useMutationGuard";
import { useAcademicYear } from "../hooks/useAcademicYear";
import { ROLES, GRADES } from "../utils/constants";
import { canManageAcademicYears } from "../utils/studentPermissions";
import { fmtDate } from "../utils/helpers";
import { formatAcademicYearLabel, computeBreakRange, addDays, academicYearStatus } from "../utils/academicCalendar";
import { academicYearLifecycle, academicYearAttention, suggestedNextEcYear, defaultYearFormForEcYear, calendarFormProblem, PHASE_LABEL } from "../utils/academicYearScope";
import { academicYearBillingPeriods } from "../utils/billingPeriods";
import { formatEthiopianDateFromKey, gregorianToEthiopian } from "../utils/ethiopianCalendar";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const ecRange = (a, b) => `${formatEthiopianDateFromKey(a)} → ${formatEthiopianDateFromKey(b)} E.C.`;
const gcRange = (a, b) => `${fmtDate(a)} → ${fmtDate(b)} G.C.`;
const STATUS_TONE = { current: "sky", upcoming: "amber", previous: "slate" };
const STATUS_TEXT = { current: "Current", upcoming: "Upcoming", previous: "Previous" };
const CAN_PICK_YEAR = new Set([ROLES.OWNER, ROLES.ADMIN, ROLES.FINANCE]);

// ---------------------------------------------------------------------------------------------------
// Header selector
// ---------------------------------------------------------------------------------------------------

// The workspace's academic year. Owner / Educational Director / Finance choose which year the whole app
// shows; everyone else sees (but can't change) the current year.
function AcademicYearSelector() {
  const auth = useAuth();
  const ay = useAcademicYear();
  const { currentAcademicYear: current, selectedAcademicYear: selected, academicYears } = ay;
  if (!current || !selected) return null;
  const today = todayKey();
  const optionText = (y) => {
    const st = academicYearStatus(y, today);
    return `${formatAcademicYearLabel(y)}${st === "current" ? " — current" : st === "upcoming" ? " — upcoming" : " — closed"}`;
  };
  if (!CAN_PICK_YEAR.has(auth.currentUser.role)) {
    return (
      <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5" title="Academic year">
        <CalendarDays size={13} className="text-slate-400" />{formatAcademicYearLabel(current)}
      </span>
    );
  }
  return (
    <label className="flex items-center gap-1.5 min-w-0">
      <span className="hidden lg:inline text-[11px] font-medium text-slate-400 whitespace-nowrap">Academic Year</span>
      <select
        aria-label="Academic Year"
        value={selected.id}
        onChange={(e) => ay.setSelectedAcademicYear(e.target.value === current.id ? null : e.target.value)}
        className={`text-xs rounded-lg border px-2 py-1.5 max-w-[210px] sm:max-w-[290px] truncate bg-white ${ay.isCurrentYear ? "border-slate-200 text-slate-600" : "border-amber-300 text-amber-800 bg-amber-50 font-medium"}`}
      >
        {academicYears.map((y) => <option key={y.id} value={y.id}>{optionText(y)}</option>)}
      </select>
    </label>
  );
}

// "Academic Year: 2019-2020 E.C. / 2026-2027 G.C." — printed on every dashboard and report so it is always
// clear which year the numbers belong to (reports never silently combine years).
function AcademicYearTag({ className = "" }) {
  const ay = useAcademicYear();
  if (!ay.selectedAcademicYear) return null;
  return (
    <p className={`text-xs text-slate-500 inline-flex items-center gap-1.5 ${className}`} data-testid="academic-year-tag">
      <CalendarDays size={12} className="text-slate-400" />
      <span>Academic Year: <span className="font-medium text-slate-700">{formatAcademicYearLabel(ay.selectedAcademicYear)}</span></span>
      {!ay.isCurrentYear && <Badge tone={ay.isReadOnlyYear ? "slate" : "amber"}>{ay.isReadOnlyYear ? "Closed" : "Upcoming"}</Badge>}
    </p>
  );
}

// Shown across the top of the workspace while an admin is looking at a year other than the current one:
// nothing on screen is the current year's data, and writes are refused (see the guard in DataContext).
function AcademicYearViewBanner() {
  const ay = useAcademicYear();
  if (ay.isCurrentYear || !ay.selectedAcademicYear) return null;
  const readOnly = ay.isReadOnlyYear;
  return (
    <div role="status" className={`rounded-lg border px-3.5 py-2.5 mb-4 flex flex-wrap items-center justify-between gap-2 text-sm ${readOnly ? "bg-slate-100 border-slate-300 text-slate-700" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
      <p className="min-w-0">
        <Eye size={14} className="inline -mt-0.5 mr-1.5" />
        Viewing <strong>{formatAcademicYearLabel(ay.selectedAcademicYear)}</strong>
        {readOnly ? " — closed, read-only. Attendance, fees, payments, payroll and results show that year's data and can't be changed." : " — not the current academic year yet. Screens show that year's data."}
      </p>
      <button type="button" onClick={() => ay.setSelectedAcademicYear(null)} className="text-xs font-semibold underline whitespace-nowrap">Return to the current year</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Lifecycle banner (Owner / Educational Director dashboards)
// ---------------------------------------------------------------------------------------------------

function AcademicYearAttentionBanner({ onReview, onCreateNext }) {
  const auth = useAuth();
  const ay = useAcademicYear();
  if (!canManageAcademicYears(auth.currentUser) || !ay.currentAcademicYear) return null;
  const a = academicYearAttention(ay.currentAcademicYear, todayKey());
  if (!a) return null;
  const detail = a.title === "Academic year ending soon"
    ? `${a.days} day${a.days === 1 ? "" : "s"} left. Get the next academic year ready.`
    : a.title === "Academic year ended"
      ? `The year ended; it closes on ${formatEthiopianDateFromKey(a.finalizeUntil)} E.C. (${fmtDate(a.finalizeUntil)}).`
      : `Academic Year Closed on ${formatEthiopianDateFromKey(a.closeDate)} E.C. (${fmtDate(a.closeDate)}). Create the next year to continue.`;
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 mb-4 ${a.level === "info" ? "bg-sky-50 border-sky-200 text-sky-900" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-1.5"><AlertTriangle size={15} />{a.title} — {formatAcademicYearLabel(ay.currentAcademicYear)}</p>
          <p className="text-xs mt-0.5">{detail}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <GhostButton onClick={onReview}>Review Year</GhostButton>
          <PrimaryButton icon={Plus} onClick={onCreateNext}>Create Next Academic Year</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Academic Year settings (compact) — the full calendar form opens only from "Edit Academic Calendar"
// ---------------------------------------------------------------------------------------------------

function SummaryRow({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <dt className="text-xs text-slate-400 sm:w-40 shrink-0">{label}</dt>
      <dd className="text-sm text-slate-700 min-w-0">{children}</dd>
    </div>
  );
}

function YearLine({ year, status, lifecycle, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-slate-100">
      <div className="min-w-0">
        <p className="font-medium text-slate-700 text-sm">{formatAcademicYearLabel(year)}</p>
        <p className="text-xs text-slate-400">{ecRange(year.yearStart, year.yearEnd)}</p>
        {status === "previous" && lifecycle?.closeDate && <p className="text-[11px] text-slate-400">Closed {formatEthiopianDateFromKey(lifecycle.closeDate)} E.C.</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Badge>
        {actions}
      </div>
    </div>
  );
}

function AcademicYearSettingsModal({ open, onClose, renderCalendarEditor, startWizard = false }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const ay = useAcademicYear();
  const canManage = canManageAcademicYears(auth.currentUser);
  const [editing, setEditing] = useState(false);
  const [wizard, setWizard] = useState(null); // { resumeYearId } | null
  const [switching, setSwitching] = useState(null); // the year the admin asked to Make Current
  const [reason, setReason] = useState("");
  const { busy, run } = useMutationGuard();
  // "Create Next Academic Year" from a dashboard banner opens the wizard straight away.
  React.useEffect(() => { if (open && startWizard) setWizard({ resumeYearId: null }); }, [open, startWizard]);
  if (!open) return null;

  const today = todayKey();
  const current = ay.currentAcademicYear;
  const lifecycle = current ? academicYearLifecycle(current, today) : null;
  const billing = current ? academicYearBillingPeriods(current) : { valid: false, periods: [] };
  const list = ay.academicYears.map((y) => ({ y, status: academicYearStatus(y, today), lc: academicYearLifecycle(y, today) }));
  const previous = list.filter((x) => x.status === "previous");
  const upcoming = list.filter((x) => x.status === "upcoming");
  const audit = (data.db.academicYearAudit || []).slice(0, 8);
  const nameOfYear = (id) => { const yy = ay.academicYears.find((q) => q.id === id); return yy ? formatAcademicYearLabel(yy) : ""; };

  function view(y) {
    ay.setSelectedAcademicYear(y.id === current?.id ? null : y.id);
    toast(`Viewing ${formatAcademicYearLabel(y)}.`, "info");
    onClose();
  }
  async function confirmSwitch() {
    const y = switching;
    const reopen = academicYearStatus(y, today) === "previous";
    if (reopen && !reason.trim()) { toast("Give a reason for reopening a closed academic year.", "error"); return; }
    await run(async () => {
      const res = await data.setCurrentAcademicYear(y.id, { reason: reason.trim() || undefined });
      toast(res.ok ? `${formatAcademicYearLabel(y)} is now the current academic year.` : (res.message || "Couldn't switch the academic year."), res.ok ? "success" : "error");
      if (res.ok) { setSwitching(null); setReason(""); }
    }, { key: `switch-year:${y.id}` });
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Academic Year" wide>
        {/* ---- current year ---- */}
        {current ? (
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Current academic year</p>
                <p className="text-xl font-semibold text-slate-800 mt-0.5">{formatAcademicYearLabel(current).split(" / ")[0]}</p>
                <p className="text-sm text-slate-500">{formatAcademicYearLabel(current).split(" / ")[1]}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge tone={lifecycle.phase === "closed" ? "slate" : lifecycle.phase === "active" ? "sky" : "amber"}>
                  {lifecycle.phase === "active" ? "CURRENT" : `CURRENT · ${PHASE_LABEL[lifecycle.phase]}`}
                </Badge>
                {canManage && <GhostButton icon={CalendarDays} onClick={() => setEditing(true)}>Edit Academic Calendar</GhostButton>}
              </div>
            </div>
            {lifecycle.closed && (
              <p className="mt-3 text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                <strong>Academic Year Closed</strong> on {formatEthiopianDateFromKey(lifecycle.closeDate)} E.C. ({fmtDate(lifecycle.closeDate)}). Create the next academic year to continue.
              </p>
            )}
            <dl className="mt-3">
              <SummaryRow label="Academic period">
                {ecRange(current.yearStart, current.yearEnd)}
                <span className="block text-xs text-slate-400">{gcRange(current.yearStart, current.yearEnd)}</span>
              </SummaryRow>
              <SummaryRow label="Semester 1">{ecRange(current.sem1Start, current.sem1End)}</SummaryRow>
              <SummaryRow label="School break">
                {(() => { const { breakStart, breakEnd } = computeBreakRange(current); return `${ecRange(breakStart, breakEnd)} (${current.breakDays} days)`; })()}
              </SummaryRow>
              <SummaryRow label="Semester 2">{ecRange(current.sem2Start, current.sem2End)}</SummaryRow>
              <SummaryRow label="Result finalization">
                {current.resultFinalizationGraceDays} days after a semester ends
                <span className="block text-xs text-slate-400">The year closes {formatEthiopianDateFromKey(lifecycle.finalizeUntil)} E.C.</span>
              </SummaryRow>
              <SummaryRow label="Billing months">
                {billing.valid && billing.periods.length > 0
                  ? <>{billing.periods.length} months — {billing.periods[0].ecLabel} → {billing.periods[billing.periods.length - 1].ecLabel}</>
                  : <span className="text-red-700">The year's dates need fixing before fees and payroll can be set up.</span>}
              </SummaryRow>
            </dl>
          </Card>
        ) : (
          <p className="text-sm text-slate-500 mb-4">No academic year is set up yet.</p>
        )}

        {/* ---- upcoming ---- */}
        {(upcoming.length > 0 || canManage) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Upcoming academic years</p>
              {canManage && <button type="button" onClick={() => setWizard({ resumeYearId: null })} className="text-xs text-brand-600 font-medium inline-flex items-center gap-1"><Plus size={12} />Create Next Academic Year</button>}
            </div>
            {upcoming.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : (
              <div className="space-y-1.5">
                {upcoming.map(({ y, status, lc }) => (
                  <YearLine key={y.id} year={y} status={status} lifecycle={lc} actions={(
                    <>
                      <GhostButton icon={Eye} onClick={() => view(y)}>View</GhostButton>
                      {canManage && <GhostButton icon={ChevronRight} onClick={() => setWizard({ resumeYearId: y.id })}>Set up &amp; activate</GhostButton>}
                    </>
                  )} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- previous ---- */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Previous academic years</p>
          {previous.length === 0 ? <p className="text-xs text-slate-400">No previous academic years.</p> : (
            <div className="space-y-1.5">
              {previous.map(({ y, status, lc }) => (
                <YearLine key={y.id} year={y} status={status} lifecycle={lc} actions={(
                  <>
                    <GhostButton icon={Eye} onClick={() => view(y)}>View</GhostButton>
                    {canManage && <GhostButton icon={RefreshCw} onClick={() => { setReason(""); setSwitching(y); }}>Make Current</GhostButton>}
                  </>
                )} />
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-2">A previous year is kept exactly as it was — students, attendance, results, fees, payments and payroll — and is read-only.</p>
        </div>

        {/* ---- history ---- */}
        {audit.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1"><History size={12} />Recent changes</p>
            <ul className="text-xs text-slate-500 space-y-1">
              {audit.map((a) => (
                <li key={a.id}>
                  <span className="font-medium text-slate-600">{AUDIT_TEXT[a.action] || a.action}</span>
                  {a.academicYearId ? ` — ${nameOfYear(a.academicYearId)}` : ""}
                  {a.actorName ? ` · ${a.actorName}` : ""}
                  {a.at ? ` · ${fmtDate(new Date(a.at))}` : ""}
                  {a.reason ? <span className="text-slate-400"> — “{a.reason}”</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      {/* ---- Make Current (a closed year needs a reason: exceptional reopening) ---- */}
      <Modal open={!!switching} onClose={busy ? () => {} : () => setSwitching(null)} title="Switch academic year?">
        {switching && (
          <div>
            <p className="text-sm text-slate-600 mb-3">
              You are switching the entire school workspace to <strong>{formatAcademicYearLabel(switching)}</strong>. Attendance, fees, payments, payroll, results and reports will now show that year's data, and {current ? formatAcademicYearLabel(current) : "the current year"} will be closed.
            </p>
            {academicYearStatus(switching, today) === "previous" && (
              <Field label="Reason for reopening this closed year" required>
                <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Correcting a published result" />
                <p className="text-[11px] text-slate-400 mt-1">Reopening a closed year is exceptional. It is recorded in the audit log.</p>
              </Field>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
              <button type="button" disabled={busy} onClick={() => setSwitching(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <PrimaryButton icon={Check} onClick={confirmSwitch} loading={busy} loadingText="Switching…">Make Current</PrimaryButton>
            </div>
          </div>
        )}
      </Modal>

      {renderCalendarEditor && renderCalendarEditor({ open: editing, onClose: () => setEditing(false), year: current })}
      <NewAcademicYearWizard open={!!wizard} resumeYearId={wizard?.resumeYearId || null} onClose={() => setWizard(null)} />
    </>
  );
}

const AUDIT_TEXT = {
  CREATED: "Year created", CALENDAR_UPDATED: "Calendar changed", ACTIVATED: "Made current", REOPENED: "Reopened",
  HISTORICAL_PAYMENT: "Payment recorded into a closed year", HISTORICAL_PAYROLL: "Payroll recorded into a closed year",
};

// ---------------------------------------------------------------------------------------------------
// Create next academic year — five steps. The year is created (inactive, editable) at the end of step 3 and
// only becomes current when the last step is confirmed.
// ---------------------------------------------------------------------------------------------------

const STEPS = ["Academic dates", "Semesters & break", "Billing months", "Re-enroll students", "Review & activate"];

function NewAcademicYearWizard({ open, onClose, resumeYearId = null }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const ay = useAcademicYear();
  const { busy, run } = useMutationGuard();
  const current = ay.currentAcademicYear;
  const resumeYear = resumeYearId ? ay.academicYears.find((y) => y.id === resumeYearId) : null;

  const initialForm = useMemo(() => {
    if (resumeYear) {
      return { ecYear: gregorianToEthiopian(new Date(resumeYear.yearStart + "T00:00:00")).year, yearStart: resumeYear.yearStart, yearEnd: resumeYear.yearEnd, sem1Start: resumeYear.sem1Start, sem1End: resumeYear.sem1End, breakDays: resumeYear.breakDays, sem2Start: resumeYear.sem2Start, sem2End: resumeYear.sem2End, resultFinalizationGraceDays: resumeYear.resultFinalizationGraceDays };
    }
    return defaultYearFormForEcYear(suggestedNextEcYear(ay.academicYears, gregorianToEthiopian));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeYearId]);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [yearId, setYearId] = useState(resumeYearId);
  const [recordUndecided, setRecordUndecided] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [activateError, setActivateError] = useState("");
  const [filter, setFilter] = useState("PENDING");

  React.useEffect(() => {
    if (!open) return;
    setForm(initialForm); setYearId(resumeYearId); setStep(resumeYearId ? 4 : 1);
    setRecordUndecided(false); setActivateError(""); setFilter("PENDING");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeYearId]);

  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const { breakStart, breakEnd } = computeBreakRange(form);
  const sem2Start = addDays(breakEnd, 1);
  const fields = () => ({
    yearStart: form.yearStart, yearEnd: form.yearEnd, sem1Start: form.sem1Start, sem1End: form.sem1End,
    breakDays: Number(form.breakDays) || 0, sem2Start, sem2End: form.sem2End,
    resultFinalizationGraceDays: Math.max(0, parseInt(form.resultFinalizationGraceDays, 10) || 0),
  });
  const billing = academicYearBillingPeriods({ ...form });
  const problem = calendarFormProblem({ ...form, breakDays: Number(form.breakDays) || 0 });
  const createdYear = yearId ? ay.academicYears.find((y) => y.id === yearId) : null;
  // Another year that already covers the same E.C. school year (compared by its first billing month's E.C. year).
  const clash = !yearId && billing.valid && billing.periods.length > 0
    ? ay.academicYears.find((y) => academicYearBillingPeriods(y).periods[0]?.ecYear === billing.periods[0].ecYear)
    : null;

  function changeEcYear(value) {
    const n = parseInt(value, 10);
    setForm(Number.isFinite(n) && n > 1900 && n < 2200 ? defaultYearFormForEcYear(n) : { ...form, ecYear: value });
  }

  // Step 3 -> 4 creates the year (inactive: not current, editable); going back and forward again just saves changes.
  async function saveYear() {
    if (problem) { toast(problem, "error"); return false; }
    let ok = false;
    await run(async () => {
      if (yearId) {
        const res = await data.saveAcademicCalendar(fields(), auth.currentUser.id, yearId);
        if (!res.ok) { toast(res.message || "Couldn't save the calendar.", "error"); return; }
      } else {
        const res = await data.createAcademicYear(fields(), auth.currentUser.id);
        if (!res.ok) { toast(res.message || "Couldn't create the academic year.", "error"); return; }
        setYearId(res.year.id);
      }
      ok = true;
    }, { key: `wizard-save-year:${form.yearStart}` });
    return ok;
  }

  async function next() {
    if (step === 1) {
      if (!form.yearStart || !form.yearEnd || form.yearStart >= form.yearEnd) { toast("The academic year's start date must be before its end date.", "error"); return; }
      if (!billing.valid) { toast(billing.problems[0].message, "error"); return; }
      if (clash) { toast(`${formatAcademicYearLabel(clash)} already exists. Set it up from the Upcoming list instead of creating it again.`, "error"); return; }
    }
    if (step === 2 && problem) { toast(problem, "error"); return; }
    if (step === 3) { if (!(await saveYear())) return; }
    setStep((n) => Math.min(5, n + 1));
  }

  // ---- step 4 data
  const sourceYear = current && current.id !== yearId ? current : null;
  const worklist = yearId && sourceYear ? data.reenrollmentWorklist(sourceYear.id, yearId) : [];
  const counts = {
    registered: worklist.filter((w) => w.decision === "REGISTERED").length,
    notReturning: worklist.filter((w) => w.decision === "NOT_RETURNING").length,
    pending: worklist.filter((w) => w.decision === "PENDING").length,
  };
  const shown = worklist
    .filter((w) => filter === "ALL" || w.decision === filter)
    .sort((a, b) => data.studentFullName(a.student).localeCompare(data.studentFullName(b.student)));

  const activationLabel = createdYear ? formatAcademicYearLabel(createdYear) : "";

  async function activate() {
    setActivateError("");
    const res = await data.setCurrentAcademicYear(yearId, { allowUndecided: recordUndecided });
    if (!res.ok) { setActivateError(res.message || "Couldn't activate the academic year."); throw new Error(res.message); }
    toast(`${activationLabel} is now the current academic year.`, "success");
    onClose();
  }

  return (
    <>
      <Modal open={open} onClose={busy ? () => {} : onClose} title={resumeYear ? `Set up ${formatAcademicYearLabel(resumeYear)}` : "Create Next Academic Year"} maxWidthClass="sm:max-w-3xl">
        <ol className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={`flex items-center gap-1.5 ${step === i + 1 ? "text-brand-700 font-semibold" : step > i + 1 ? "text-emerald-700" : "text-slate-400"}`}>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] border ${step === i + 1 ? "border-brand-500 bg-brand-50" : step > i + 1 ? "border-emerald-500 bg-emerald-50" : "border-slate-300"}`}>{step > i + 1 ? <Check size={11} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div>
            <Field label="Academic year (Ethiopian Calendar)" required>
              <div className="flex items-center gap-2">
                <input type="number" className={inputCls} style={{ maxWidth: 120 }} value={form.ecYear} onChange={(e) => changeEcYear(e.target.value)} disabled={!!yearId} />
                <span className="text-sm text-slate-500 whitespace-nowrap">– {(Number(form.ecYear) || 0) + 1} E.C.</span>
              </div>
            </Field>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Academic year starts" required><EthiopianDateField value={form.yearStart} onChange={(v) => set("yearStart", v)} /></Field>
              <Field label="Academic year ends" required><EthiopianDateField value={form.yearEnd} onChange={(v) => set("yearEnd", v)} /></Field>
            </div>
            <p className="text-xs text-slate-500">
              Will be created as <strong className="text-slate-700">{formatAcademicYearLabel({ yearStart: form.yearStart, yearEnd: form.yearEnd })}</strong>.
              {billing.valid && billing.periods.length > 0 && <> Fees and payroll run for {billing.periods.length} months: {billing.periods[0].ecLabel} → {billing.periods[billing.periods.length - 1].ecLabel}.</>}
            </p>
            {!billing.valid && billing.problems.map((p) => <p key={p.code} className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{p.message}</p>)}
            {clash && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">{formatAcademicYearLabel(clash)} already exists — set it up from the Upcoming list.</p>}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Semester 1 starts" required><EthiopianDateField value={form.sem1Start} onChange={(v) => set("sem1Start", v)} /></Field>
              <Field label="Semester 1 ends" required><EthiopianDateField value={form.sem1End} onChange={(v) => set("sem1End", v)} /></Field>
            </div>
            <Field label="School break (days)" required>
              <input type="number" min={0} className={inputCls} value={form.breakDays} onChange={(e) => set("breakDays", Math.max(0, parseInt(e.target.value, 10) || 0))} />
              <p className="text-xs text-slate-400 mt-1">Break: {formatEthiopianDateFromKey(breakStart)} → {formatEthiopianDateFromKey(breakEnd)} E.C. Semester 2 then starts on {formatEthiopianDateFromKey(sem2Start)} E.C.</p>
            </Field>
            <Field label="Semester 2 ends" required><EthiopianDateField value={form.sem2End} onChange={(v) => set("sem2End", v)} /></Field>
            <Field label="Result finalization grace period (days after a semester ends)" required>
              <input type="number" min={0} className={inputCls} value={form.resultFinalizationGraceDays} onChange={(e) => set("resultFinalizationGraceDays", Math.max(0, parseInt(e.target.value, 10) || 0))} />
            </Field>
            {problem && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{problem}</p>}
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="text-sm text-slate-600 mb-3">
              Fees and payroll for this year use exactly these {billing.periods.length} months — generated from the academic year's own dates, never from a fixed list.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {billing.periods.map((p) => (
                <div key={p.anchor} className="rounded-lg border border-slate-200 px-2.5 py-2">
                  <p className="text-xs font-medium text-slate-700">{p.ecLabel}</p>
                  <p className="text-[11px] text-slate-400">{p.gcLabel}</p>
                  {p.partial && <p className="text-[10px] text-amber-700">Partial month</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">Continuing creates the year (not yet current). Fees are rolled out for it later in Fees → Fee Settings.</p>
          </div>
        )}

        {step === 4 && (
          <div>
            {!sourceYear ? (
              <p className="text-sm text-slate-500">There is no current academic year to carry students over from. Register students in the Students page once this year is active.</p>
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-1">Students of <strong>{formatAcademicYearLabel(sourceYear)}</strong>. Registering creates their enrollment for {activationLabel || "the new year"}; <em>Not returning</em> only means they aren't enrolled this year — the student and all their history stay.</p>
                <div className="flex flex-wrap items-center gap-2 my-3 text-xs">
                  <Badge tone="green">{counts.registered} registered</Badge>
                  <Badge tone="slate">{counts.notReturning} not returning</Badge>
                  <Badge tone="amber">{counts.pending} to decide</Badge>
                  <span className="mx-1 text-slate-300">|</span>
                  {["PENDING", "REGISTERED", "NOT_RETURNING", "ALL"].map((f) => (
                    <button key={f} type="button" onClick={() => setFilter(f)} className={`px-2 py-1 rounded-md border ${filter === f ? "border-brand-300 bg-brand-50 text-brand-700 font-medium" : "border-slate-200 text-slate-500"}`}>
                      {{ PENDING: "To decide", REGISTERED: "Registered", NOT_RETURNING: "Not returning", ALL: "All" }[f]}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  <GhostButton icon={UserCheck} disabled={busy || counts.pending === 0} onClick={() => registerAll()}>Register all remaining (next grade)</GhostButton>
                  <GhostButton icon={UserX} disabled={busy || counts.pending === 0} onClick={() => notReturningAll()}>Mark all remaining not returning</GhostButton>
                </div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {shown.length === 0 ? <p className="text-xs text-slate-400 p-3">Nobody in this list.</p> : shown.map((w) => (
                    <ReenrollRow key={w.student.id} w={w} yearId={yearId} data={data} toast={toast} run={run} busy={busy} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {step === 5 && createdYear && (
          <div>
            <Card className="p-4 mb-3">
              <p className="text-sm font-semibold text-slate-800">{activationLabel}</p>
              <p className="text-xs text-slate-500">{ecRange(createdYear.yearStart, createdYear.yearEnd)} · {gcRange(createdYear.yearStart, createdYear.yearEnd)}</p>
              <dl className="mt-2">
                <SummaryRow label="Billing months">{academicYearBillingPeriods(createdYear).periods.length} months</SummaryRow>
                <SummaryRow label="Semesters">{ecRange(createdYear.sem1Start, createdYear.sem1End)}; {ecRange(createdYear.sem2Start, createdYear.sem2End)}</SummaryRow>
                {sourceYear && <SummaryRow label="Students">{counts.registered} registered · {counts.notReturning} not returning · {counts.pending} without a decision</SummaryRow>}
              </dl>
            </Card>
            {counts.pending > 0 && (
              <label className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={recordUndecided} onChange={(e) => setRecordUndecided(e.target.checked)} />
                <span>{counts.pending} student{counts.pending === 1 ? " has" : "s have"} no decision. Record {counts.pending === 1 ? "them" : "them all"} as <strong>Not returning</strong> and continue. (They stay in the system and can be registered later.)</span>
              </label>
            )}
            <p className="text-xs text-slate-500 flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" />Activating makes this the current year and closes {current ? formatAcademicYearLabel(current) : "the previous year"}: its records stay, read-only. This is recorded in the audit log.</p>
            {activateError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{activateError}</p>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-slate-100">
          <button type="button" disabled={busy || step === 1 || (resumeYear && step === 4)} onClick={() => setStep((n) => Math.max(1, n - 1))} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            <ArrowLeft size={14} />Back
          </button>
          {step < 5 ? (
            <PrimaryButton icon={ChevronRight} onClick={next} loading={busy} loadingText="Saving…">{step === 3 ? "Create year & continue" : "Next"}</PrimaryButton>
          ) : (
            <PrimaryButton icon={Check} disabled={busy || (counts.pending > 0 && !recordUndecided)} onClick={() => setConfirmActivate(true)}>Activate as current year</PrimaryButton>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmActivate}
        onClose={() => setConfirmActivate(false)}
        onConfirm={activate}
        title="Make this the current academic year?"
        description={`${activationLabel} becomes the current academic year and ${current ? formatAcademicYearLabel(current) : "the previous year"} is closed (kept, read-only). Attendance, fees, payments, payroll, results and reports switch to the new year.`}
        confirmLabel="Activate"
      />
    </>
  );

  // ---- bulk actions (declared after return for readability; hoisted function declarations)
  async function registerAll() {
    await run(async () => {
      let failed = 0;
      for (const w of worklist.filter((x) => x.decision === "PENDING")) {
        const res = await data.registerStudentForYear({ studentId: w.student.id, yearId, grade: w.suggestedGrade, section: w.suggestedSection });
        if (!res.ok) { failed += 1; if (failed === 1) toast(res.message || "Couldn't register a student.", "error"); }
      }
      if (failed === 0) toast("Registered.", "success");
    }, { key: `wizard-register-all:${yearId}` });
  }
  async function notReturningAll() {
    await run(async () => {
      let failed = 0;
      for (const w of worklist.filter((x) => x.decision === "PENDING")) {
        const res = await data.markStudentNotReturning({ studentId: w.student.id, yearId, reason: "" });
        if (!res.ok) { failed += 1; if (failed === 1) toast(res.message || "Couldn't record the decision.", "error"); }
      }
      if (failed === 0) toast("Recorded.", "success");
    }, { key: `wizard-notreturning-all:${yearId}` });
  }
}

function ReenrollRow({ w, yearId, data, toast, run, busy }) {
  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState(w.suggestedGrade);
  const [section, setSection] = useState(w.suggestedSection);
  const sections = useMemo(() => [...new Set(data.db.classes.filter((c) => c.grade === grade).map((c) => c.section || ""))], [data.db.classes, grade]);
  const name = data.studentFullName(w.student);

  const register = () => run(async () => {
    const res = await data.registerStudentForYear({ studentId: w.student.id, yearId, grade, section });
    toast(res.ok ? `${name} registered for ${grade}${section}.` : (res.message || "Couldn't register the student."), res.ok ? "success" : "error");
    if (res.ok) setOpen(false);
  }, { key: `wizard-register:${w.student.id}:${yearId}` });
  const notReturning = () => run(async () => {
    const res = await data.markStudentNotReturning({ studentId: w.student.id, yearId, reason: "" });
    toast(res.ok ? `${name} is not returning this year.` : (res.message || "Couldn't record that decision."), res.ok ? "success" : "error");
  }, { key: `wizard-notreturning:${w.student.id}:${yearId}` });

  return (
    <div className="px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 truncate">{name}</p>
          <p className="text-xs text-slate-400">{w.student.studentId} · {w.source.grade}{w.source.section || ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {w.decision === "REGISTERED" && <Badge tone="green">Registered — {w.target.grade}{w.target.section || ""}</Badge>}
          {w.decision === "NOT_RETURNING" && <Badge tone="slate">Not returning</Badge>}
          {w.decision !== "REGISTERED" && (
            <button type="button" disabled={busy} onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-brand-600 border border-brand-200 rounded-lg px-2.5 py-1 hover:bg-brand-50">{w.decision === "NOT_RETURNING" ? "Register instead" : "Register"}</button>
          )}
          {w.decision === "PENDING" && (
            <button type="button" disabled={busy} onClick={notReturning} className="text-xs font-medium text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1 hover:bg-slate-50">Not returning</button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 bg-slate-50 rounded-lg p-2.5">
          <label className="text-xs text-slate-500">Grade
            <select className={inputCls + " mt-0.5 !py-1"} value={grade} onChange={(e) => { setGrade(e.target.value); setSection(""); }}>
              {[...new Set([...data.gradeOptions(), grade])].sort((a, b) => GRADES.indexOf(a) - GRADES.indexOf(b)).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Section
            <select className={inputCls + " mt-0.5 !py-1"} value={section} onChange={(e) => setSection(e.target.value)}>
              {[...new Set([...sections, section])].map((sec) => <option key={sec} value={sec}>{sec || "None"}</option>)}
            </select>
          </label>
          <PrimaryButton icon={Check} disabled={busy} onClick={register}>Confirm</PrimaryButton>
        </div>
      )}
    </div>
  );
}

export {
  AcademicYearTag, AcademicYearSelector, AcademicYearViewBanner, AcademicYearAttentionBanner, AcademicYearSettingsModal, NewAcademicYearWizard,
};
