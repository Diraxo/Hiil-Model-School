// Single source of truth for "is this date available for student attendance" across every
// role's UI (Owner, Educational Director, Teacher, Parent). Date keys are "YYYY-MM-DD" strings,
// which sort/compare correctly with plain string comparison, so most of this module never
// touches the Date object at all.
import { academicYearStart } from "./constants";
import { ecYearLabelForGcStart } from "./ethiopianCalendar";
import { fmtDateLong } from "./helpers";

function pad2(n) { return String(n).padStart(2, "0"); }
function toKey(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
function addDays(dateKey, delta) {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return toKey(d);
}
// Whole days from `fromKey` to `toKey` (positive when `toKey` is later) — used only for the
// "N days until/remaining" countdown text below, never for date-range comparisons (those stay
// plain string comparisons on the YYYY-MM-DD keys).
function daysBetween(fromKey, toKey) {
  return Math.round((new Date(toKey + "T00:00:00") - new Date(fromKey + "T00:00:00")) / 86400000);
}
function daysLabel(n) { return `${n} day${n === 1 ? "" : "s"}`; }

// Saturday/Sunday, purely by day-of-week — independent of the configured academic calendar, so
// it's the one place every role's UI (and classifyAttendanceDate below) checks before treating a
// date as a potential school day. Kept as its own function so a future "admin can turn Saturday
// into a school day" setting only has to change this one spot.
function isWeekendDate(dateKey) {
  const dow = new Date(dateKey + "T00:00:00").getDay(); // 0 = Sunday, 6 = Saturday
  return dow === 0 || dow === 6;
}

const DEFAULT_BREAK_DAYS = 15;
const DEFAULT_RESULT_FINALIZATION_GRACE_DAYS = 14;

// Sensible out-of-the-box calendar for a school year starting on `start` (a Date, defaults to the
// current September-to-September school year) — used both to seed the very first academic year
// and as a template when an admin creates a new one.
function defaultAcademicCalendar(start = academicYearStart()) {
  const yearStart = toKey(start);
  const sem1Start = yearStart;
  const sem1End = addDays(yearStart, 130); // ~4.3 months
  const breakDays = DEFAULT_BREAK_DAYS;
  const breakEnd = addDays(sem1End, breakDays);
  const sem2Start = addDays(breakEnd, 1);
  const yearEnd = addDays(yearStart, 333); // ~11 months, end of school year
  const sem2End = yearEnd;
  const gcLabel = `${start.getFullYear()}-${start.getFullYear() + 1}`;
  return {
    yearName: gcLabel, // kept for back-compat with any code still reading `.yearName`
    gcLabel,
    ecLabel: ecYearLabelForGcStart(start),
    yearStart, yearEnd,
    sem1Start, sem1End,
    breakDays,
    sem2Start, sem2End,
    resultFinalizationGraceDays: DEFAULT_RESULT_FINALIZATION_GRACE_DAYS,
    isCurrent: true,
    updatedAt: null, updatedBy: null,
  };
}

// The single academic year flagged `isCurrent`, falling back to the most recently-started one —
// there should always be exactly one current year, but this stays defensive against bad data.
function currentAcademicYear(academicYears) {
  if (!Array.isArray(academicYears) || academicYears.length === 0) return null;
  return academicYears.find((y) => y.isCurrent) ||
    [...academicYears].sort((a, b) => (b.yearStart || "").localeCompare(a.yearStart || ""))[0];
}

// The Date the currently-active academic year starts on — what fee/installment/bus-cycle math
// anchors to, so those periods track whatever the admin configured in Academic Calendar &
// Settings instead of assuming a fixed Sept-1 school year. Falls back to the Sept-1 guess only
// when no academic year has been configured yet (shouldn't happen once the app has seeded/migrated).
function activeYearStartDate(academicYears) {
  const year = currentAcademicYear(academicYears);
  return year && year.yearStart ? new Date(year.yearStart + "T00:00:00") : academicYearStart();
}

// "2018-2019 E.C. / 2026-2027 G.C." — the dual-calendar label shown everywhere an academic year
// is displayed. Falls back gracefully if a year is missing its E.C. label (e.g. old seed data).
function formatAcademicYearLabel(year) {
  if (!year) return "";
  const gc = year.gcLabel || year.yearName || "";
  return year.ecLabel ? `${year.ecLabel} E.C. / ${gc} G.C.` : gc;
}

function computeBreakRange(cal) {
  const breakStart = addDays(cal.sem1End, 1);
  const breakEnd = addDays(cal.sem1End, cal.breakDays || DEFAULT_BREAK_DAYS);
  return { breakStart, breakEnd };
}

// Suggests Semester 2 dates from the other fields — used to pre-fill the settings form and by
// an explicit "Recalculate" action, never forced silently over an admin's manual edits.
function suggestSemester2(cal) {
  const { breakEnd } = computeBreakRange(cal);
  const sem2Start = addDays(breakEnd, 1);
  const sem2End = cal.yearEnd && cal.yearEnd > sem2Start ? cal.yearEnd : addDays(sem2Start, 150);
  return { sem2Start, sem2End };
}

const PHASE_LABEL = {
  before_year: "Before the academic year",
  before_semester1: "Before Semester 1",
  semester1: "Semester 1",
  break: "School Break",
  gap: "Outside the configured semesters",
  semester2: "Semester 2",
  after_year: "After the academic year",
  future: "Future date",
  closed: "No School",
  closedToday: "No School Today",
  weekend: "Weekend",
};

// Classifies one date against the configured calendar. `todayKey` is injected by the caller
// (rather than read from `new Date()` in here) so this stays pure and easy to test.
// `closuresByDate` (optional `{ [dateKey]: { reason, ... } }`) overrides everything else —
// a closure scheduled for a future date still reads as closed rather than
// "hasn't happened yet", and a closure always wins over an otherwise-open school day.
// Saturday/Sunday are the next thing checked, ahead of the semester/break math — they're a
// structural fact about the calendar, not something an admin has to mark off manually every
// week. This is what stops a Saturday that happens to fall inside Semester 1's date range from
// reading as an open school day (and therefore stops "Take Attendance" from being offered, and
// every "Today's Classes"-style view from listing periods, on a weekend).
function classifyAttendanceDate(dateKey, cal, todayKey, closuresByDate) {
  const closure = closuresByDate && closuresByDate[dateKey];
  if (closure) {
    const label = dateKey === todayKey ? PHASE_LABEL.closedToday : PHASE_LABEL.closed;
    return { phase: "closed", available: false, label, message: closure.reason || "The school is closed on this date." };
  }
  if (!cal) return { phase: "future", available: false, label: PHASE_LABEL.future, message: "No academic calendar has been configured yet." };
  if (dateKey > todayKey) {
    return { phase: "future", available: false, label: PHASE_LABEL.future, message: "This date hasn't happened yet." };
  }
  if (dateKey < cal.yearStart) {
    const countdown = dateKey === todayKey ? ` ${daysLabel(daysBetween(todayKey, cal.yearStart))} until school starts on ${cal.yearStart}.` : "";
    return { phase: "before_year", available: false, label: PHASE_LABEL.before_year, message: `The ${cal.yearName || "current"} academic year hasn't started yet.${countdown}` };
  }
  if (dateKey < cal.sem1Start) {
    return { phase: "before_semester1", available: false, label: PHASE_LABEL.before_semester1, message: `Attendance hasn't started yet. The first attendance date is ${cal.sem1Start}.` };
  }
  if (isWeekendDate(dateKey)) {
    const label = dateKey === todayKey ? PHASE_LABEL.closedToday : PHASE_LABEL.weekend;
    return { phase: "weekend", available: false, label, message: "Weekend — school is not in session. Classes resume on the next school day." };
  }
  if (dateKey <= cal.sem1End) {
    return { phase: "semester1", available: true, label: PHASE_LABEL.semester1, message: "" };
  }
  const { breakStart, breakEnd } = computeBreakRange(cal);
  if (dateKey <= breakEnd) {
    const countdown = dateKey === todayKey ? ` ${daysLabel(daysBetween(todayKey, breakEnd))} remaining.` : "";
    return { phase: "break", available: false, label: PHASE_LABEL.break, message: `School activities are paused for the break (${breakStart} – ${breakEnd}).${countdown}` };
  }
  if (dateKey < cal.sem2Start) {
    return { phase: "gap", available: false, label: PHASE_LABEL.gap, message: "This date isn't part of Semester 1 or Semester 2." };
  }
  if (dateKey <= cal.sem2End) {
    return { phase: "semester2", available: true, label: PHASE_LABEL.semester2, message: "" };
  }
  if (dateKey <= cal.yearEnd) {
    return { phase: "gap", available: false, label: PHASE_LABEL.gap, message: "This date isn't part of Semester 1 or Semester 2." };
  }
  return { phase: "after_year", available: false, label: PHASE_LABEL.after_year, message: `The ${cal.yearName || "academic"} year has ended.` };
}

function isAttendanceDateAvailable(dateKey, cal, todayKey, closuresByDate) {
  return classifyAttendanceDate(dateKey, cal, todayKey, closuresByDate).available;
}

function minKey(a, b) { return a < b ? a : b; }

// Whether a given semester's results are currently editable, derived purely from the academic
// calendar's dates (not any per-record manual lock — see permissions.js `effectiveResultLock`,
// which layers the manual `publishStatus === "LOCKED"` check and any `autoLockOverride` on top of
// this). Mirrors classifyAttendanceDate's phase-classification style/shape.
//
// A semester stays editable for `resultFinalizationGraceDays` after it ends (a configurable
// "finalization window"), UNLESS the next hard boundary (Semester 2 starting, or the academic
// year ending) arrives first — that boundary always wins regardless of how much grace remains.
function classifySemesterResultLock(semester, cal, todayKey) {
  if (!cal) return { locked: true, phase: "no_calendar", message: "No academic calendar has been configured yet." };
  const graceDays = Number.isFinite(cal.resultFinalizationGraceDays) ? cal.resultFinalizationGraceDays : DEFAULT_RESULT_FINALIZATION_GRACE_DAYS;
  const semLabel = semester === "S2" ? "Semester 2" : "Semester 1";

  if (semester === "S2") {
    if (todayKey < cal.sem2Start) {
      return { locked: true, phase: "before_semester", message: `${semLabel} hasn't started yet. It begins on ${fmtDateLong(cal.sem2Start)}.` };
    }
    if (todayKey > cal.yearEnd) {
      return { locked: true, phase: "year_ended", message: `${semLabel} is locked — the academic year ended on ${fmtDateLong(cal.yearEnd)}. Results are now read-only.` };
    }
    const ceiling = minKey(addDays(cal.sem2End, graceDays), cal.yearEnd);
    if (todayKey > ceiling) {
      const yearIsCeiling = ceiling === cal.yearEnd;
      return {
        locked: true,
        phase: yearIsCeiling ? "year_ended" : "grace_expired",
        message: yearIsCeiling
          ? `${semLabel} is locked — the academic year ended on ${fmtDateLong(cal.yearEnd)}. Results are now read-only.`
          : `${semLabel} is locked — ${semLabel} ended on ${fmtDateLong(cal.sem2End)} and the ${graceDays}-day finalization window has passed. Results are now read-only.`,
      };
    }
    return { locked: false, phase: todayKey <= cal.sem2End ? "active" : "grace_period", message: "" };
  }

  // S1
  if (todayKey < cal.sem1Start) {
    return { locked: true, phase: "before_semester", message: `${semLabel} hasn't started yet. It begins on ${fmtDateLong(cal.sem1Start)}.` };
  }
  if (todayKey >= cal.sem2Start) { // hard cutoff — wins over the grace period, no exceptions
    return { locked: true, phase: "next_semester_started", message: `${semLabel} is locked — Semester 2 has begun. Results are now read-only.` };
  }
  const ceiling = minKey(addDays(cal.sem1End, graceDays), addDays(cal.sem2Start, -1));
  if (todayKey > ceiling) {
    return { locked: true, phase: "grace_expired", message: `${semLabel} is locked — ${semLabel} ended on ${fmtDateLong(cal.sem1End)} and the ${graceDays}-day finalization window has passed. Results are now read-only.` };
  }
  return { locked: false, phase: todayKey <= cal.sem1End ? "active" : "grace_period", message: "" };
}

// The earliest date attendance could ever be recorded for — used as the DateNav lower bound.
function earliestAttendanceDate(cal) {
  return cal.sem1Start;
}

// The latest date attendance UI can browse/navigate to — always "today", regardless of the
// configured academic year's end date. This is deliberately NOT clamped to `cal.yearEnd`: once
// today's date has moved past the configured academic year (e.g. a new year hasn't been created
// yet), attendance can no longer be *recorded* for today (classifyAttendanceDate correctly returns
// `after_year`/unavailable for that), but every role's daily/monthly attendance views must still be
// able to open on today's real date and show that "outside academic year" message — not silently
// jump back to (and default to reading as "today") whatever old date the stale year happened to end
// on. See classifyAttendanceDate for the actual recordability rule.
function latestAttendanceDate(cal, todayKey) {
  return todayKey;
}

export {
  DEFAULT_BREAK_DAYS,
  DEFAULT_RESULT_FINALIZATION_GRACE_DAYS,
  defaultAcademicCalendar,
  currentAcademicYear,
  activeYearStartDate,
  formatAcademicYearLabel,
  computeBreakRange,
  suggestSemester2,
  classifyAttendanceDate,
  isAttendanceDateAvailable,
  classifySemesterResultLock,
  isWeekendDate,
  earliestAttendanceDate,
  latestAttendanceDate,
  addDays,
  toKey,
};
