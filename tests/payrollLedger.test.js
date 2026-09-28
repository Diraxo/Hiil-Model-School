import { describe, expect, it } from "vitest";
import { computeStaffPayrollSummary, payrollPeriodsForStaff } from "../src/utils/payrollLedger";

const Y18 = { id: "y18", yearStart: "2025-09-11", yearEnd: "2026-07-07", sem1Start: "2025-09-11" };
const Y19 = { id: "y19", yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-11" };
const BAD = { id: "bad", yearStart: "2025-09-11", yearEnd: "2027-07-08", sem1Start: "2026-09-14" };

const staff = (over = {}) => ({ id: "t1", name: "Tigist", salary: 10000, employmentDate: "2025-01-15", employmentEndDate: null, ...over });
const db = (staffRow, payments = [], advances = []) => ({ staff: [staffRow], payrollPayments: payments, salaryAdvances: advances });
const pay = (month, amount, id = month) => ({ id, staffId: "t1", month, amount, allowances: 0, deductions: 0, createdAt: 1 });
const ec = (p) => p.ecLabel.split(" ")[0];

describe("payroll periods come from the academic year (never a global month list)", () => {
  it("a staff member employed all year has the year's 10 Ethiopian months: Meskerem .. Sene", () => {
    const { valid, periods } = payrollPeriodsForStaff({ year: Y19, staff: staff(), todayKey: "2027-08-01" });
    expect(valid).toBe(true);
    expect(periods.map(ec)).toEqual(["Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit", "Megabit", "Miyazya", "Ginbot", "Sene"]);
    expect(periods.every((p) => p.state === "ELAPSED")).toBe(true);
  });
  it("never lists a month of another year: the 2018 periods are 2018's, the 2019 periods 2019's", () => {
    const a = payrollPeriodsForStaff({ year: Y18, staff: staff(), todayKey: "2026-12-01" }).periods.map((p) => p.monthKey);
    const b = payrollPeriodsForStaff({ year: Y19, staff: staff(), todayKey: "2027-08-01" }).periods.map((p) => p.monthKey);
    expect(a[0]).toBe("2025-09");
    expect(b[0]).toBe("2026-09");
    expect(a.filter((m) => b.includes(m))).toEqual([]);
  });
  it("months that haven't started yet are FUTURE, not owed", () => {
    const { periods } = payrollPeriodsForStaff({ year: Y19, staff: staff(), todayKey: "2026-12-05" });
    expect(periods.map((p) => p.state)).toEqual(["ELAPSED", "ELAPSED", "ELAPSED", "ELAPSED", "FUTURE", "FUTURE", "FUTURE", "FUTURE", "FUTURE", "FUTURE"]);
  });
  it("an inconsistent year yields no periods (valid: false) instead of a 23-month list", () => {
    expect(payrollPeriodsForStaff({ year: BAD, staff: staff(), todayKey: "2026-12-01" })).toMatchObject({ valid: false, periods: [] });
  });
});

describe("a teacher who joins mid-year is not owed the months before they joined", () => {
  it("joined in Megabit: Meskerem .. Yekatit are NOT_APPLICABLE and never appear as arrears", () => {
    const s = staff({ employmentDate: "2027-03-05" });
    const { periods } = payrollPeriodsForStaff({ year: Y19, staff: s, todayKey: "2027-05-10" });
    expect(periods.map((p) => `${ec(p)}:${p.state}`)).toEqual([
      "Meskerem:NOT_APPLICABLE", "Tikimt:NOT_APPLICABLE", "Hidar:NOT_APPLICABLE", "Tahsas:NOT_APPLICABLE", "Tir:NOT_APPLICABLE", "Yekatit:NOT_APPLICABLE",
      "Megabit:ELAPSED", "Miyazya:ELAPSED", "Ginbot:ELAPSED", "Sene:FUTURE",
    ]);
    const sum = computeStaffPayrollSummary(db(s), "t1", { year: Y19, todayKey: "2027-05-10" });
    expect(sum.months).toEqual(["2027-03", "2027-04", "2027-05"]);
    expect(sum.totalExpected).toBe(30000);
    expect(sum.outstanding).toBe(30000); // three months owed, not nine
    expect(sum.yearScoped).toBe(true);
  });
  it("joining on the 29th of a month still includes that month (the existing payroll policy) — but not the month before", () => {
    const s = staff({ employmentDate: "2026-12-29" });
    const { months } = computeStaffPayrollSummary(db(s), "t1", { year: Y19, todayKey: "2027-01-05" });
    expect(months).toEqual(["2026-12", "2027-01"]);
    expect(months).not.toContain("2026-11");
  });
  it("employment that ends stops the periods after the end month", () => {
    const s = staff({ employmentEndDate: "2027-01-20" });
    const { months } = computeStaffPayrollSummary(db(s), "t1", { year: Y19, todayKey: "2027-06-01" });
    expect(months[months.length - 1]).toBe("2027-01");
    expect(months).toHaveLength(5); // Sep .. Jan
  });
  it("a payment already recorded for a month before the join date is ignored in the year total (it was never owed)", () => {
    const s = staff({ employmentDate: "2027-03-05" });
    const sum = computeStaffPayrollSummary(db(s, [pay("2027-03", 10000)]), "t1", { year: Y19, todayKey: "2027-05-10" });
    expect(sum.rows.find((r) => r.month === "2027-03").status).toBe("PAID");
    expect(sum.outstanding).toBe(20000);
  });
});

describe("payroll totals are scoped to the selected academic year", () => {
  const payments = [pay("2025-10", 10000, "old-oct"), pay("2026-10", 10000, "new-oct"), pay("2026-11", 4000, "new-nov")];
  it("2019 counts only 2019's payments; 2018 only 2018's — no cross-year leakage", () => {
    const s = staff();
    const y19 = computeStaffPayrollSummary(db(s, payments), "t1", { year: Y19, todayKey: "2026-12-05" });
    expect(y19.history.map((p) => p.id).sort()).toEqual(["new-nov", "new-oct"]);
    expect(y19.totalPaid).toBe(14000);
    expect(y19.months).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(y19.outstanding).toBe(40000 - 14000);
    const y18 = computeStaffPayrollSummary(db(s, payments), "t1", { year: Y18, todayKey: "2026-12-05" });
    expect(y18.history.map((p) => p.id)).toEqual(["old-oct"]);
    expect(y18.months).toHaveLength(10);              // a finished year: every period is owed
    expect(y18.outstanding).toBe(100000 - 10000);
  });
  it("advances follow their salary period into the right year", () => {
    const s = staff();
    const adv = [{ id: "a1", staffId: "t1", amount: 2000, payrollMonth: "2026-10", createdAt: 1 }, { id: "a0", staffId: "t1", amount: 500, payrollMonth: "2025-10", createdAt: 1 }];
    expect(computeStaffPayrollSummary(db(s, [], adv), "t1", { year: Y19, todayKey: "2026-12-05" }).advanceGiven).toBe(2000);
    expect(computeStaffPayrollSummary(db(s, [], adv), "t1", { year: Y18, todayKey: "2026-12-05" }).advanceGiven).toBe(500);
  });
  it("a bad calendar row can't blank payroll: it falls back to the whole-employment calculation", () => {
    const s = staff({ employmentDate: "2026-09-02" });
    const sum = computeStaffPayrollSummary(db(s), "t1", { year: BAD, todayKey: "2026-11-10" });
    expect(sum.yearScoped).toBe(false);
    expect(sum.months).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
  it("without a year the legacy behaviour is unchanged", () => {
    const s = staff({ employmentDate: "2026-09-02" });
    const sum = computeStaffPayrollSummary(db(s), "t1", { todayKey: "2026-11-10" });
    expect(sum.months).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(sum.yearScoped).toBe(false);
  });
});
