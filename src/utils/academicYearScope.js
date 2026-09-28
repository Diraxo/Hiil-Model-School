// The academic year as the central scope of the whole system — ONE place for the rules every screen
// used to re-derive from "whatever year today's date falls in".
//
//  * Lifecycle: an academic year is UPCOMING (set up, never activated — still editable), CURRENT (the
//    one operational year — enforced by a partial unique index) or PREVIOUS/CLOSED (read-only history
//    that is kept forever, never deleted or hidden). Stored facts are `isCurrent` and `closedAt`.
//  * Workspace scope: admins/owner/finance can VIEW any year (the header selector); everything that
//    reads "the year" follows the selection. Only the operational year (or an upcoming one being set
//    up) is writable.
//  * Periods: billing/payroll periods come from the selected year's own dates
//    (utils/billingPeriods.js), never from a global month list.
//  * Enrollment: a student is permanent; an ENROLLMENT belongs to one year. "Not returning" is a
//    decision about a year, never a deletion.
//
// Pure functions only (date keys are "YYYY-MM-DD" strings) so the rules are unit-testable.
import {
  academicYearStatus, currentAcademicYear, addDays, computeBreakRange, defaultAcademicCalendar,
  DEFAULT_RESULT_FINALIZATION_GRACE_DAYS,
} from "./academicCalendar";
import { academicYearBillingPeriods, academicYearDateProblems } from "./billingPeriods";
import { ethiopianToGregorianKey } from "./ethiopianCalendar";
import { GRADES } from "./constants";

// "Academic year ending soon" starts this many days before the year's end date.
const ENDING_SOON_DAYS = 30;

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
const byStartDesc = (a, b) => (b.yearStart || "").localeCompare(a.yearStart || "");

// Lifecycle of one year as of `todayKey`.
//   status   "current" | "previous" | "upcoming"          (stored lifecycle)
//   phase    "upcoming" | "active" | "ending_soon" | "ended" | "closed"
//              ended  = the year's end date has passed; the result-finalization window (the year's grace
//                       days) is still running before the year is considered closed
//              closed = closed by an admin (previous), or that window has passed
//   closed   the phase is "closed" — the UI shows "Academic Year Closed" with `closeDate`
//   readOnly true only for a PREVIOUS year: operational writes are refused. (A current year past its
//            window is *locked by date* — attendance dates, result locks — but its fees/payments
//            stay recordable, which is why it isn't read-only.)
function academicYearLifecycle(year, todayKey) {
  if (!year) return null;
  const status = academicYearStatus(year, todayKey);
  const graceDays = Number.isFinite(year.resultFinalizationGraceDays) ? year.resultFinalizationGraceDays : DEFAULT_RESULT_FINALIZATION_GRACE_DAYS;
  const finalizeUntil = year.yearEnd ? addDays(year.yearEnd, graceDays) : null;
  let phase;
  if (status === "upcoming") phase = "upcoming";
  else if (status === "previous") phase = "closed";
  else if (!year.yearEnd) phase = "active";
  else if (todayKey > finalizeUntil) phase = "closed";
  else if (todayKey > year.yearEnd) phase = "ended";
  else if (daysBetween(todayKey, year.yearEnd) <= ENDING_SOON_DAYS) phase = "ending_soon";
  else phase = "active";
  const closeDate = status === "previous"
    ? (year.closedAt ? String(year.closedAt).slice(0, 10) : finalizeUntil)
    : (phase === "closed" ? finalizeUntil : null);
  return {
    status, phase, graceDays, finalizeUntil, closeDate,
    closed: phase === "closed",
    readOnly: status === "previous",
    daysToEnd: year.yearEnd ? daysBetween(todayKey, year.yearEnd) : null,
  };
}

const PHASE_LABEL = {
  upcoming: "Upcoming", active: "Current", ending_soon: "Ending soon", ended: "Ended — finalizing results", closed: "Closed",
};

// A student/admin-facing headline for the lifecycle banners on the Owner/Admin dashboards; null when
// nothing needs attention (an ordinary active year, or a not-yet-started one).
function academicYearAttention(year, todayKey) {
  const lc = academicYearLifecycle(year, todayKey);
  if (!lc || lc.status !== "current") return null;
  if (lc.phase === "ending_soon") return { level: "info", title: "Academic year ending soon", days: lc.daysToEnd };
  if (lc.phase === "ended") return { level: "warning", title: "Academic year ended", finalizeUntil: lc.finalizeUntil };
  if (lc.phase === "closed") return { level: "warning", title: "Academic year closed", closeDate: lc.closeDate };
  return null;
}

// The year the workspace is showing: the admin's selection when it names a real year, otherwise the
// operational (current) year. Never derived from today's date — the caller passes the id.
function resolveWorkspaceYear(years, selectedId) {
  if (!Array.isArray(years) || years.length === 0) return null;
  return (selectedId && years.find((y) => y.id === selectedId)) || currentAcademicYear(years);
}

// Everything a screen needs to know about the academic-year scope, in one object — what
// `useAcademicYear()` returns.
function buildAcademicYearScope({ years, selectedId, todayKey }) {
  const list = [...(years || [])].sort(byStartDesc);
  const current = currentAcademicYear(list);
  const selected = resolveWorkspaceYear(list, selectedId);
  const lifecycle = selected ? academicYearLifecycle(selected, todayKey) : null;
  const billing = selected ? academicYearBillingPeriods(selected) : { valid: false, problems: [], periods: [] };
  const isCurrentYear = !!(selected && current && selected.id === current.id);
  return {
    academicYears: list,
    currentAcademicYear: current,
    selectedAcademicYear: selected,
    isCurrentYear,
    isClosedYear: !!(lifecycle && lifecycle.closed),
    isReadOnlyYear: !!(lifecycle && lifecycle.readOnly),
    academicPeriods: billing.periods,
    academicPeriodsValid: billing.valid,
    academicPeriodProblems: billing.problems,
    academicYearStatus: lifecycle,
  };
}

// The year whose [yearStart, yearEnd] contains `dateKey` — how date-keyed records (attendance rows,
// which carry no year id) are assigned to a year. A date in two overlapping years (bad data) prefers
// the current year, then the most recently started.
function yearForDate(years, dateKey) {
  const hits = (years || []).filter((y) => y.yearStart && y.yearEnd && dateKey >= y.yearStart && dateKey <= y.yearEnd);
  if (hits.length <= 1) return hits[0] || null;
  return hits.find((y) => y.isCurrent) || hits.sort(byStartDesc)[0];
}

// The year whose billing periods include a "YYYY-MM" month key (payroll months, fee period months).
function yearForBillingMonth(years, monthKey) {
  const hits = (years || []).filter((y) => academicYearBillingPeriods(y).periods.some((p) => p.monthKey === monthKey));
  if (hits.length <= 1) return hits[0] || null;
  return hits.find((y) => y.isCurrent) || hits.sort(byStartDesc)[0];
}

// Whether a date key lies inside a year's dates.
function dateInYear(year, dateKey) {
  return !!(year && year.yearStart && year.yearEnd && dateKey >= year.yearStart && dateKey <= year.yearEnd);
}

// ---- Enrollment across years -------------------------------------------------------------------

// Students still on the roll can be carried into the next year; graduated / transferred / withdrawn
// ones can't.
const RETURNING_ELIGIBLE = new Set(["ACTIVE", "ABSENT", "SUSPENDED"]);

// The grade a returning student is normally registered into (Grade 3 -> Grade 4; the last grade stays).
function nextGrade(grade) {
  const i = GRADES.indexOf(grade);
  if (i === -1) return grade;
  return GRADES[Math.min(i + 1, GRADES.length - 1)];
}

// The re-enrollment worklist for a year being set up: every student who was enrolled in `sourceYearId`
// (and is still eligible), with what has been decided for `targetYearId`:
//   REGISTERED     an enrollment row exists for the target year;
//   NOT_RETURNING  the admin recorded that the student is not coming back this year;
//   PENDING        no decision yet.
// Nothing here deletes or edits anything — a student who isn't registered simply has no enrollment for
// the target year, and every earlier enrollment, result, attendance and payment stays exactly as it was.
function reenrollmentCandidates({ students, enrollments, decisions, sourceYearId, targetYearId }) {
  const studentById = new Map((students || []).map((s) => [s.id, s]));
  const targetByStudent = new Map((enrollments || []).filter((e) => e.academicYearId === targetYearId).map((e) => [e.studentId, e]));
  const decisionByStudent = new Map((decisions || []).filter((d) => d.academicYearId === targetYearId).map((d) => [d.studentId, d]));
  return (enrollments || [])
    .filter((e) => e.academicYearId === sourceYearId && RETURNING_ELIGIBLE.has(e.status))
    .map((source) => {
      const student = studentById.get(source.studentId);
      if (!student) return null;
      const target = targetByStudent.get(student.id) || null;
      const decision = decisionByStudent.get(student.id) || null;
      return {
        student, source, target, decisionRow: decision,
        decision: target ? "REGISTERED" : decision ? "NOT_RETURNING" : "PENDING",
        suggestedGrade: nextGrade(source.grade), suggestedSection: source.section || "",
      };
    })
    .filter(Boolean);
}

// Students on the roll of `yearId` (they have an enrollment row for it) — the roster of that year.
function enrolledStudentIds(enrollments, yearId) {
  return new Set((enrollments || []).filter((e) => e.academicYearId === yearId).map((e) => e.studentId));
}

// ---- New year creation -------------------------------------------------------------------------

// The Ethiopian year the next school year would be: the E.C. year after the one the latest year ENDS in
// (its end date is more reliable than its start, which is exactly what was wrong on the bad row).
function suggestedNextEcYear(years, gregorianToEthiopian, todayDate = new Date()) {
  const latest = [...(years || [])].sort(byStartDesc)[0];
  if (!latest || !latest.yearEnd) return gregorianToEthiopian(todayDate).year;
  return gregorianToEthiopian(new Date(latest.yearEnd + "T00:00:00")).year + 1;
}

// The default calendar of the school year of E.C. year `ecYear`: Meskerem 1 -> Sene 30 (10 months),
// Semester 1 from the start, a 15-day break, Semester 2 to the last day. Every date is editable in the
// wizard; this is only the pre-fill.
function defaultYearFormForEcYear(ecYear) {
  const start = ethiopianToGregorianKey(ecYear, 1, 1);
  const cal = defaultAcademicCalendar(new Date(start + "T00:00:00"));
  const end = ethiopianToGregorianKey(ecYear, 10, 30);
  return {
    ecYear, yearStart: start, yearEnd: end,
    sem1Start: cal.sem1Start, sem1End: cal.sem1End, breakDays: cal.breakDays,
    sem2Start: cal.sem2Start, sem2End: end,
    resultFinalizationGraceDays: cal.resultFinalizationGraceDays,
  };
}

// The first thing wrong with a calendar form (year + semesters + break), as a sentence a person can act
// on — null when it is fine. Semester 2 always starts the day after the break ends, so its start is derived,
// never typed. The same ordering rules the academic_years_dates_ordered constraint enforces, plus the
// "one school year" rules of billingPeriods.academicYearDateProblems.
function calendarFormProblem(form) {
  if (!form || !form.yearStart || !form.yearEnd) return "Choose the academic year's start and end dates.";
  const { breakEnd } = computeBreakRange(form);
  const sem2Start = addDays(breakEnd, 1);
  if (!(form.yearStart < form.yearEnd)) return "The academic year's start date must be before its end date.";
  if (!(form.sem1Start >= form.yearStart)) return "Semester 1 can't start before the academic year begins.";
  if (!(form.sem1Start < form.sem1End)) return "Semester 1's start date must be before its end date.";
  if (!(form.sem1End <= form.yearEnd)) return "Semester 1 must end on or before the academic year ends.";
  if (!(form.sem2End > sem2Start)) return "Semester 2's end date must be after the school break ends.";
  if (!(form.sem2End <= form.yearEnd)) return "Semester 2 must end on or before the academic year ends.";
  const problems = academicYearDateProblems(form);
  return problems.length > 0 ? problems[0].message : null;
}

export {
  defaultYearFormForEcYear, calendarFormProblem,
  ENDING_SOON_DAYS, PHASE_LABEL, RETURNING_ELIGIBLE,
  academicYearLifecycle, academicYearAttention, resolveWorkspaceYear, buildAcademicYearScope,
  yearForDate, yearForBillingMonth, dateInYear,
  nextGrade, reenrollmentCandidates, enrolledStudentIds, suggestedNextEcYear,
};
