// Pure staff-payroll read model, parameterized by `dbLike` (the last-fetched Supabase state) — moved
// out of DataContext.jsx so the eligibility rules can be unit-tested without the whole provider.
//
// The payroll calculation used for every read-only display (staffSalarySummary, dashboards,
// payslips). The authoritative overpayment cap is enforced server-side by the record_payroll_payment /
// record_salary_advance RPCs, which re-run this same month math inside the insert transaction so
// concurrent writes can't jointly exceed a month's obligation.
//
// Salary-advance model (revised): a salary advance IS money paid to the employee against a
// specific salary period (`salary_advances.payroll_month`, set when the advance is recorded), so
// it reduces that month's remaining obligation exactly the way a direct payroll payment does.
// There is ONE calculation, here, and every screen (staff detail, payroll summary/list, salary
// history, payslip, "My Salary", dashboards) reads its status/balance from it.
//
//   paid for month M   = Σ payroll_payments.amount (month = M)      -- direct salary payments
//                      + Σ salary_advances.amount   (payroll_month = M)  -- advances for that period
//   remaining for M    = max(0, salary + allowances - deductions - paid for M)   -- never negative
//   status             = remaining == 0 ? PAID : paid > 0 ? PARTIAL : UNPAID
//
// This is NOT the old "creditPool" bug (Blocker 5A): that silently netted an unconsumed advance
// balance against whichever month happened to be oldest-unpaid, flipping unrelated months to
// "Paid" with no record. Here an advance only ever touches the ONE month it was explicitly
// recorded against — a real transaction, with a date, visible in the advance history.
//
// The legacy `payroll_payments.advance_applied` field is retired as a crediting mechanism (new
// payments always write 0). It is no longer added to any month's paid total — the advance itself
// is now the credit, via its own row — so the two can never double-count.
//
// ACADEMIC-YEAR SCOPE. When a `year` is passed the payroll periods are the year's own billing
// periods (utils/billingPeriods.js — never a global month list), so no month outside that year is
// ever listed, owed or summed. A staff member is only owed from the month of their employment start
// (the existing policy: the month a person joins counts in full, whatever day of it they joined —
// joining on the 29th of a 30-day month still includes that month) through the month their employment
// ends; earlier periods are NOT_APPLICABLE and are never treated as arrears. Without a usable `year`
// (none given, or its dates are inconsistent and yield no periods) the legacy whole-employment-span
// calculation is kept, so a bad calendar row can never blank the payroll screens.
import { academicYearBillingPeriods } from "./billingPeriods";

function localTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthKeyOf(dateKey) { return dateKey ? String(dateKey).slice(0, 7) : ""; }

// Legacy employment-span months: employment start month .. min(employment end, today), "YYYY-MM".
function employmentSpanMonths(staff, todayKey) {
  const startKey = monthKeyOf(staff.employmentDate);
  if (!startKey) return [];
  const capKey = staff.employmentEndDate && monthKeyOf(staff.employmentEndDate) < monthKeyOf(todayKey) ? monthKeyOf(staff.employmentEndDate) : monthKeyOf(todayKey);
  const months = [];
  let [y, m] = startKey.split("-").map(Number);
  const [cy, cm] = capKey.split("-").map(Number);
  while (y < cy || (y === cy && m <= cm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

// Every payroll period of `year` with what it means for ONE staff member:
//   state "NOT_APPLICABLE" — before they joined (or after their employment ended): never owed;
//   state "ELAPSED"        — owed (its month has begun);
//   state "FUTURE"         — inside their employment but the month hasn't started yet.
// `valid: false` when the year's own dates are inconsistent (no periods can be derived).
function payrollPeriodsForStaff({ year, staff, todayKey = localTodayKey() }) {
  const billing = academicYearBillingPeriods(year);
  if (!billing.valid) return { valid: false, problems: billing.problems, periods: [] };
  const startKey = monthKeyOf(staff && staff.employmentDate);
  const endKey = monthKeyOf(staff && staff.employmentEndDate);
  const nowKey = monthKeyOf(todayKey);
  const periods = billing.periods.map((p) => {
    let state = "ELAPSED";
    if ((startKey && p.monthKey < startKey) || (endKey && p.monthKey > endKey)) state = "NOT_APPLICABLE";
    else if (p.monthKey > nowKey) state = "FUTURE";
    return { ...p, state, eligible: state !== "NOT_APPLICABLE" };
  });
  return { valid: true, problems: [], periods };
}

function computeStaffPayrollSummary(dbLike, staffId, { year = null, todayKey = localTodayKey() } = {}) {
  const s = dbLike.staff.find((x) => x.id === staffId);
  if (!s) return null;

  let months;
  let yearMonthKeys = null; // every period of the scoped year (null = legacy, unscoped)
  let periods = [];
  let scoped = false;
  if (year) {
    const scope = payrollPeriodsForStaff({ year, staff: s, todayKey });
    if (scope.valid && scope.periods.length > 0) {
      scoped = true;
      periods = scope.periods;
      yearMonthKeys = new Set(scope.periods.map((p) => p.monthKey));
      months = scope.periods.filter((p) => p.state === "ELAPSED").map((p) => p.monthKey);
    }
  }
  if (!scoped) months = employmentSpanMonths(s, todayKey);

  const inScope = (mk) => !yearMonthKeys || yearMonthKeys.has(mk);
  const history = dbLike.payrollPayments.filter((p) => p.staffId === staffId && inScope(p.month)).sort((a, b) => b.createdAt - a.createdAt);
  const rawAdvances = dbLike.salaryAdvances.filter((a) => a.staffId === staffId && inScope(a.payrollMonth)).sort((a, b) => a.createdAt - b.createdAt);
  const cashPaid = history.reduce((sum, p) => sum + p.amount, 0);
  const advanceGiven = rawAdvances.reduce((sum, a) => sum + a.amount, 0);
  // "Total paid" = every Birr that has actually reached the employee for salary — direct payments
  // plus advances (advances are real cash out the door the moment they're given).
  const totalPaid = cashPaid + advanceGiven;
  const totalExpected = months.length * s.salary;
  const rows = months.map((mk) => {
    const paymentsForMonth = history.filter((p) => p.month === mk);
    const advancesForMonth = rawAdvances.filter((a) => a.payrollMonth === mk);
    const monthAllowances = paymentsForMonth.reduce((sum, p) => sum + (p.allowances || 0), 0);
    const monthDeductions = paymentsForMonth.reduce((sum, p) => sum + (p.deductions || 0), 0);
    const cashThisMonth = paymentsForMonth.reduce((sum, p) => sum + p.amount, 0);
    const advanceThisMonth = advancesForMonth.reduce((sum, a) => sum + a.amount, 0);
    const paidThisMonth = cashThisMonth + advanceThisMonth;
    const gross = s.salary + monthAllowances - monthDeductions;
    const remaining = Math.max(0, gross - paidThisMonth);
    const status = remaining <= 0 ? "PAID" : paidThisMonth > 0 ? "PARTIAL" : "UNPAID";
    return {
      month: mk, payments: paymentsForMonth, payment: paymentsForMonth[0] || null,
      advancesForMonth, cashThisMonth, advanceThisMonth, paidThisMonth, remaining, status,
    };
  });
  const monthRemaining = (mk) => {
    const r = rows.find((x) => x.month === mk);
    if (r) return r.remaining;
    // A month outside the elapsed-employment window (e.g. a future period) has its full salary
    // still to pay.
    return Math.max(0, s.salary);
  };
  // Each advance stays a permanent record. Its display just names the salary period it was
  // applied to — there is no separate "recovery" step any more.
  const advances = rawAdvances.map((a) => ({
    ...a, appliedMonth: a.payrollMonth, status: "APPLIED",
  })).sort((a, b) => b.createdAt - a.createdAt);
  // Aggregate still owed across the whole (scoped) span — a single flat subtraction so an
  // advance (already inside totalPaid) can never be double-counted across months.
  const outstanding = Math.max(0, totalExpected - totalPaid);
  const currentMonthKey = rows.length ? rows[rows.length - 1].month : months[months.length - 1] || null;
  const currentMonthAvailable = currentMonthKey ? monthRemaining(currentMonthKey) : 0;
  // Most a NEW advance can be for a given month: that month's own unmet obligation. Defaults to
  // the current month when no month is named.
  const maxAdvanceForMonth = (mk) => monthRemaining(mk || currentMonthKey);
  const maxAdvance = currentMonthAvailable;
  return {
    staff: s, months, history, rows, totalPaid, cashPaid, totalExpected, outstanding,
    advances, advanceGiven, currentMonthKey, currentMonthAvailable, maxAdvance, maxAdvanceForMonth, monthRemaining,
    yearScoped: scoped, periods,
  };
}

export { computeStaffPayrollSummary, payrollPeriodsForStaff, employmentSpanMonths };
