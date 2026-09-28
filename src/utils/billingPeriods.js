// Billing periods are DERIVED from an academic year's own start/end dates — never from a global
// list of Ethiopian months. The academic year (academic_years.year_start/year_end) owns the school
// calendar; fee schedules, installments, obligations and payments all hang off its id.
//
// The billing period is the ETHIOPIAN month (the school's primary calendar): one period per Ethiopian
// month of which [yearStart, yearEnd] covers at least half (15 of its 30 days), so Meskerem 1 -> Sene 30
// is exactly 10 periods and a stray edge day of a neighbouring month never adds one. Each period is keyed by its Gregorian "anchor" month
// (the civil month holding the Ethiopian month's 16th day), which is what fee_installments.period_month,
// fee_schedules.billed_months and payroll_payments.month store. The rule is mirrored on the server by
// public.academic_year_billing_months (generate_monthly_fee_installments uses it). Each period also
// carries the real date range it covers inside the year (clipped to the year's start/end) and a
// `partial` flag, so the UI can say so instead of silently including a month.
//
// Pure functions only (date keys are "YYYY-MM-DD" strings) so the rules are unit-testable.
import { ethiopianMonthName, ethiopianMonthsCoveredBy, formatEthiopianDateFromKey } from "./ethiopianCalendar";
import { monthLabel } from "./helpers";

// A school year is roughly 10–12 months. Anything beyond ~13 months (400 days) is not one school
// year — it is a start date left behind from a previous year, and it would make the fee screen show
// two years' worth of months. Mirrored by the academic_years_validate_span trigger.
const MAX_ACADEMIC_YEAR_DAYS = 400;
// Semester 1 begins at (or a few weeks after) the start of the year, not most of a year later.
const MAX_SEM1_START_OFFSET_DAYS = 92;

function parseKey(key) {
  const [y, m, d] = String(key || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
// Calendar months touched by [a, b] — the same count the fee month picker would have offered.
function calendarMonthsTouched(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
function monthsSpanLabel(days) {
  const months = Math.round(days / 30.44);
  return `${months} month${months === 1 ? "" : "s"}`;
}

// Whether the dates describe ONE coherent school year. Returns [] when they do, otherwise
// user-facing problems. Deliberately only the rules that catch the "start date left in the previous
// year" class of mistake; the ordering rules (semesters inside the year) stay in the calendar form
// and the academic_years_dates_ordered constraint.
function academicYearDateProblems(fields) {
  const problems = [];
  const { yearStart, yearEnd, sem1Start } = fields || {};
  if (!yearStart || !yearEnd) return [{ code: "missing_dates", message: "The academic year has no start and end dates." }];
  if (!(yearStart < yearEnd)) {
    problems.push({ code: "start_after_end", message: "The academic year's start date must be before its end date." });
    return problems;
  }
  const span = daysBetween(yearStart, yearEnd);
  if (span > MAX_ACADEMIC_YEAR_DAYS) {
    problems.push({
      code: "span_too_long",
      message: `This academic year covers ${calendarMonthsTouched(yearStart, yearEnd)} calendar months (${formatEthiopianDateFromKey(yearStart)} – ${formatEthiopianDateFromKey(yearEnd)} E.C.). A school year is at most about 13 months — its start date is probably left over from the previous year.`,
    });
  }
  if (sem1Start && sem1Start >= yearStart) {
    const offset = daysBetween(yearStart, sem1Start);
    if (offset > MAX_SEM1_START_OFFSET_DAYS) {
      problems.push({
        code: "semester1_far_from_start",
        message: `Semester 1 starts ${monthsSpanLabel(offset)} after the academic year does (${formatEthiopianDateFromKey(yearStart)} → ${formatEthiopianDateFromKey(sem1Start)} E.C.). The academic year should start at the beginning of Semester 1.`,
      });
    }
  }
  return problems;
}

// The billing periods of one academic year: [{ anchor, monthKey, ecYear, ecMonth, start, end, partial,
// ecLabel, gcLabel, label }], oldest first. `anchor` is the "YYYY-MM-01" month-start date
// fee_schedules.billed_months / fee_installments.period_month use. `valid` is false (and `periods`
// empty) when the year's own dates are inconsistent — the caller must then send the admin to fix the
// calendar rather than show months from outside the year.
function academicYearBillingPeriods(year) {
  const problems = academicYearDateProblems(year);
  if (problems.length > 0) return { valid: false, problems, periods: [] };
  const periods = ethiopianMonthsCoveredBy(year.yearStart, year.yearEnd).map((m) => {
    const start = m.spanStart < year.yearStart ? year.yearStart : m.spanStart;
    const end = m.spanEnd > year.yearEnd ? year.yearEnd : m.spanEnd;
    const ecLabel = `${ethiopianMonthName(m.ecMonth, { withAmharic: false })} ${m.ecYear}`;
    const gcLabel = monthLabel(m.monthKey);
    return {
      anchor: m.anchor, monthKey: m.monthKey, ecYear: m.ecYear, ecMonth: m.ecMonth, start, end,
      partial: start !== m.spanStart || end !== m.spanEnd,
      ecLabel, gcLabel, label: `${ecLabel} (${gcLabel})`,
    };
  });
  return { valid: true, problems: [], periods };
}

// Month anchors ("YYYY-MM-01") that exist as billing records but fall outside a year with these dates
// — what a date change would leave orphaned. They are never deleted by a date change; this only powers
// the warning shown before saving. Same Ethiopian-month rule as the periods above, without the
// validity check (the caller has already validated the form's dates).
function anchorsOutsideYear(dates, anchors) {
  if (!dates || !dates.yearStart || !dates.yearEnd) return [];
  const inside = new Set(ethiopianMonthsCoveredBy(dates.yearStart, dates.yearEnd).map((m) => m.monthKey));
  return [...new Set((anchors || []).map((a) => String(a).slice(0, 7)))]
    .filter((mk) => !inside.has(mk))
    .sort()
    .map((mk) => `${mk}-01`);
}

export {
  MAX_ACADEMIC_YEAR_DAYS,
  MAX_SEM1_START_OFFSET_DAYS,
  academicYearDateProblems,
  academicYearBillingPeriods,
  anchorsOutsideYear,
};
