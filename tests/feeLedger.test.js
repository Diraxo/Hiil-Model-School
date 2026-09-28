import { describe, expect, it } from "vitest";
import { feeRowsForStudentIn, FEE_PERIOD_STATUS, netOwedForObligation, allocationsTotal } from "../src/utils/feeLedger";
import { academicYearBillingPeriods } from "../src/utils/billingPeriods";

// One school fee, rolled out for 2018 E.C. and 2019 E.C., 1000 Birr a month, Meskerem .. Sene.
const Y18 = { id: "y18", yearStart: "2025-09-11", yearEnd: "2026-07-07", sem1Start: "2025-09-11" };
const Y19 = { id: "y19", yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-11" };
const FEE = { id: "ft", name: "School Fee", category: "TUITION" };

function build() {
  const feeSchedules = [], feeInstallments = [];
  for (const y of [Y18, Y19]) {
    feeSchedules.push({ id: `sch-${y.id}`, feeTypeId: "ft", academicYearId: y.id, unitAmount: 1000 });
    academicYearBillingPeriods(y).periods.forEach((p, i) => feeInstallments.push({
      id: `inst-${y.id}-${p.monthKey}`, feeScheduleId: `sch-${y.id}`, sequenceIndex: i, periodMonth: p.anchor, dueDate: p.anchor, label: p.gcLabel,
    }));
  }
  return { feeTypes: [FEE], feeSchedules, feeInstallments, studentFeeObligations: [], feeObligationAdjustments: [], payments: [], paymentAllocations: [] };
}
const inst = (db, yearId, monthKey) => db.feeInstallments.find((i) => i.id === `inst-${yearId}-${monthKey}`);
function bill(db, studentId, yearId, fromMonthKey) {
  db.feeInstallments.filter((i) => i.feeScheduleId === `sch-${yearId}` && i.periodMonth.slice(0, 7) >= fromMonthKey).forEach((i) => {
    db.studentFeeObligations.push({ id: `ob-${studentId}-${i.id}`, studentId, feeInstallmentId: i.id, amountDue: 1000 });
  });
}
function pay(db, studentId, yearId, monthKey, amount, { voided = false } = {}) {
  const ob = db.studentFeeObligations.find((o) => o.studentId === studentId && o.feeInstallmentId === inst(db, yearId, monthKey).id);
  const id = `pay-${db.payments.length}`;
  db.payments.push({ id, status: voided ? "VOIDED" : "POSTED", amountTotal: amount });
  db.paymentAllocations.push({ id: `al-${id}`, paymentId: id, obligationId: ob.id, amount });
}
const S = { id: "stu" };
const rowsOf = (db, yearId, today) => feeRowsForStudentIn(db, S, FEE, yearId, today);

describe("fee period status: Paid / Partial / Due / Not applicable", () => {
  it("a student billed all year sees 10 periods, each Paid, Partial or Unpaid — none 'not applicable'", () => {
    const db = build();
    bill(db, "stu", "y19", "2026-09");
    pay(db, "stu", "y19", "2026-09", 1000);
    pay(db, "stu", "y19", "2026-10", 400);
    const { periods, rows } = rowsOf(db, "y19", "2026-10-15");
    expect(periods).toHaveLength(10);
    expect(rows).toHaveLength(10);
    expect(periods.map((p) => p.status).slice(0, 3)).toEqual([FEE_PERIOD_STATUS.PAID, FEE_PERIOD_STATUS.PARTIAL, FEE_PERIOD_STATUS.UNPAID]);
    expect(periods.some((p) => p.status === FEE_PERIOD_STATUS.NOT_APPLICABLE)).toBe(false);
  });

  it("a Semester-2 joiner is NOT charged the months before they joined: they show Not applicable, never Unpaid", () => {
    const db = build();
    bill(db, "stu", "y19", "2027-02"); // joined in Yekatit (February 2027)
    pay(db, "stu", "y19", "2027-02", 1000);
    pay(db, "stu", "y19", "2027-05", 1000);
    const { periods, rows } = rowsOf(db, "y19", "2027-03-15");
    expect(periods).toHaveLength(10);
    const label = (p) => `${academicYearBillingPeriods(Y19).periods.find((x) => x.anchor === p.installment.periodMonth).ecLabel.split(" ")[0]}:${p.status}`;
    expect(periods.map(label)).toEqual([
      "Meskerem:NOT_APPLICABLE", "Tikimt:NOT_APPLICABLE", "Hidar:NOT_APPLICABLE", "Tahsas:NOT_APPLICABLE", "Tir:NOT_APPLICABLE",
      "Yekatit:PAID", "Megabit:UNPAID", "Miyazya:UNPAID", "Ginbot:PAID", "Sene:UNPAID",
    ]);
    // ...and they contribute NOTHING to what is owed or payable
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.applicable)).toBe(true);
    expect(rows.reduce((s, r) => s + r.remaining, 0)).toBe(3000);       // Megabit + Miyazya + Sene only
    expect(periods.filter((p) => p.status === "NOT_APPLICABLE").every((p) => p.amountDue === 0 && p.remaining === 0 && p.obligationId === null)).toBe(true);
  });

  it("'current' (the month being billed) is never a Not-applicable row", () => {
    const db = build();
    bill(db, "stu", "y19", "2027-02");
    const { periods } = rowsOf(db, "y19", "2026-10-05"); // today is before they joined: first billed month is next
    const current = periods.filter((p) => p.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].applicable).toBe(true);
    expect(current[0].instMonth).toBe("2027-02");
  });

  it("a student with no obligations at all (not enrolled / not billed) has only Not-applicable periods and owes nothing", () => {
    const db = build();
    const { periods, rows } = rowsOf(db, "y19", "2026-10-05");
    expect(periods).toHaveLength(10);
    expect(periods.every((p) => p.status === "NOT_APPLICABLE")).toBe(true);
    expect(rows).toEqual([]);
  });

  it("a voided receipt stops counting as paid: the month is Unpaid again and carries a 'voided' note", () => {
    const db = build();
    bill(db, "stu", "y19", "2026-09");
    pay(db, "stu", "y19", "2026-09", 1000, { voided: true });
    const [sep] = rowsOf(db, "y19", "2026-10-05").periods;
    expect(sep).toMatchObject({ status: "UNPAID", paid: 0, remaining: 1000, voided: 1000 });
  });

  it("an adjustment (discount) is honoured but never turns a month into Not applicable", () => {
    const db = build();
    bill(db, "stu", "y19", "2026-09");
    db.feeObligationAdjustments.push({ id: "adj", obligationId: `ob-stu-${inst(db, "y19", "2026-09").id}`, amount: 1000 });
    const [sep] = rowsOf(db, "y19", "2026-10-05").periods;
    expect(sep.status).toBe("PAID");
    expect(sep.applicable).toBe(true);
  });
});

describe("payments and balances never leak between academic years", () => {
  it("a payment in 2019 doesn't appear in 2018's balance, and vice versa", () => {
    const db = build();
    bill(db, "stu", "y18", "2025-09");
    bill(db, "stu", "y19", "2026-09");
    pay(db, "stu", "y19", "2026-10", 1000);
    pay(db, "stu", "y18", "2025-10", 300);
    const total = (yearId) => rowsOf(db, yearId, "2026-10-05").rows.reduce((s, r) => ({ paid: s.paid + r.paid, remaining: s.remaining + r.remaining }), { paid: 0, remaining: 0 });
    expect(total("y19")).toEqual({ paid: 1000, remaining: 9000 });
    expect(total("y18")).toEqual({ paid: 300, remaining: 9700 });
  });
  it("each obligation belongs to exactly one year's installment, so a year's rows only ever contain its own months", () => {
    const db = build();
    bill(db, "stu", "y18", "2025-09");
    bill(db, "stu", "y19", "2026-09");
    const months18 = rowsOf(db, "y18", "2026-10-05").periods.map((p) => p.instMonth);
    const months19 = rowsOf(db, "y19", "2026-10-05").periods.map((p) => p.instMonth);
    expect(months18.every((m) => m >= "2025-09" && m <= "2026-06")).toBe(true);
    expect(months19.every((m) => m >= "2026-09" && m <= "2027-06")).toBe(true);
    expect(months18.filter((m) => months19.includes(m))).toEqual([]);
  });
  it("a fee that was never rolled out for a year yields no periods (it is not silently borrowed from another year)", () => {
    const db = build();
    const none = feeRowsForStudentIn(db, S, FEE, "y-other", "2026-10-05");
    expect(none).toMatchObject({ schedule: null, rows: [], periods: [] });
  });
  it("voided allocations are excluded from paid totals", () => {
    const db = build();
    bill(db, "stu", "y19", "2026-09");
    pay(db, "stu", "y19", "2026-09", 700);
    pay(db, "stu", "y19", "2026-09", 300, { voided: true });
    const ob = db.studentFeeObligations[0];
    expect(allocationsTotal(db, ob.id)).toBe(700);
    expect(netOwedForObligation(db, ob)).toBe(300);
  });
});
