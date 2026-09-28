import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

// The REAL DataProvider (the academic-year scope, write guard, rolls, finance totals, payroll scoping,
// re-enrollment actions) against a fake Supabase client and stubbed list services. What is asserted is what
// every page reads off `useData()`.
const h = vi.hoisted(() => {
  // A chainable, awaitable stand-in for any supabase query builder: every call returns itself and awaiting it
  // resolves to an empty result.
  const chain = () => {
    const p = new Proxy(function () {}, {
      get(_, prop) { if (prop === "then") return (res) => res({ data: [], error: null }); return () => p; },
      apply() { return p; },
    });
    return p;
  };
  return {
    chain,
    state: {},
    spies: {},
  };
});

vi.mock("../src/lib/supabaseClient", () => ({
  supabase: {
    from: () => h.chain(), channel: () => h.chain(), removeChannel() {}, storage: { from: () => h.chain() },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "owner" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  recoveryUrlState: {}, scrubAuthParamsFromUrl() {},
}));
vi.mock("../src/context/ToastContext", () => ({ useToast: () => () => {} }));

function stub(path, factoryName, override) {
  return async (importOriginal) => {
    const orig = await importOriginal();
    return { ...orig, [factoryName]: () => ({ ...orig[factoryName](), ...override() }) };
  };
}
vi.mock("../src/services/academicYearService", stub("academicYearService", "createAcademicYearService", () => ({
  list: async () => h.state.years,
  listDecisions: async () => h.state.decisions,
  listAudit: async () => [],
  listTeacherAssignmentSnapshots: async () => h.state.snapshots || [],
  setCurrent: (...a) => h.spies.setCurrent(...a),
  registerStudent: (...a) => h.spies.registerStudent(...a),
  markNotReturning: (...a) => h.spies.markNotReturning(...a),
  update: (...a) => h.spies.updateYear(...a),
})));
vi.mock("../src/services/studentService", stub("studentService", "createStudentService", () => ({
  list: async () => h.state.students,
  listEnrollments: async () => h.state.enrollments,
  listDocuments: async () => [],
  create: (...a) => h.spies.createStudent(...a),
  syncEnrollment: async () => null,
})));
vi.mock("../src/services/classService", stub("classService", "createClassService", () => ({
  list: async () => h.state.classes, listCurriculum: async () => [],
})));
vi.mock("../src/services/feeService", stub("feeService", "createFeeService", () => ({
  listFeeTypes: async () => h.state.feeTypes, listSchedules: async () => h.state.schedules, listInstallments: async () => h.state.installments,
  listObligations: async () => h.state.obligations, listAdjustments: async () => [],
})));
vi.mock("../src/services/paymentService", stub("paymentService", "createPaymentService", () => ({
  list: async () => h.state.payments, listAllocations: async () => h.state.allocations, listMethods: async () => [],
  recordPaymentBatch: (...a) => h.spies.recordPayment(...a),
})));
vi.mock("../src/services/attendanceService", stub("attendanceService", "createAttendanceService", () => ({
  list: async () => h.state.attendance, listPeriodLogs: async () => [],
})));
vi.mock("../src/services/staffService", stub("staffService", "createStaffService", () => ({
  list: async () => h.state.staff, listFull: async () => h.state.staff, myRecord: async () => null, listAttendance: async () => [],
})));
vi.mock("../src/services/payrollService", stub("payrollService", "createPayrollService", () => ({
  listPayments: async () => h.state.payrollPayments, listAdvances: async () => h.state.advances, myPayments: async () => [], myAdvances: async () => [],
})));
vi.mock("../src/services/expenseService", stub("expenseService", "createExpenseService", () => ({
  list: async () => h.state.expenses,
})));

import { DataProvider, useData } from "../src/context/DataContext";

// Meskerem 1 .. Sene 30 for 2018 (closed history), 2019 (current) and 2020 (being set up).
const yr = (id, ec, start, end, extra) => ({
  id, ecLabel: `${ec}-${ec + 1}`, gcLabel: `${ec + 7}-${ec + 8}`, yearStart: start, yearEnd: end, sem1Start: start,
  sem1End: `${ec + 8}-01-19`, breakDays: 15, sem2Start: `${ec + 8}-02-04`, sem2End: end, resultFinalizationGraceDays: 15, ...extra,
});
const Y18 = yr("y18", 2018, "2025-09-11", "2026-07-07", { isCurrent: false, closedAt: "2026-09-12T00:00:00Z" });
const Y19 = yr("y19", 2019, "2026-09-11", "2027-07-07", { isCurrent: true, closedAt: null });
const Y20 = yr("y20", 2020, "2027-09-12", "2028-07-07", { isCurrent: false, closedAt: null });

const student = (id, first, grade, classId, status = "ACTIVE") => ({ id, studentId: `TMA-${id}`, firstName: first, middleName: "", lastName: "Test", grade, section: "A", classId, status, usesBus: false, parentIds: [], admissionDate: "2025-09-11" });
const enr = (studentId, academicYearId, grade, classId, status = "ACTIVE") => ({ id: `${studentId}-${academicYearId}`, studentId, academicYearId, grade, section: "A", classId, status });

function reset() {
  h.state = {
    years: [Y18, Y19, Y20],
    decisions: [],
    // the students table describes the OPERATIONAL year (2019): Ahmed is in Grade 2, Aisha in Grade 1
    students: [student("s1", "Ahmed", "Grade 2", "c2"), student("s2", "Aisha", "Grade 1", "c1")],
    enrollments: [enr("s1", "y18", "Grade 1", "c1"), enr("s2", "y18", "KG2", "c0"), enr("s1", "y19", "Grade 2", "c2"), enr("s2", "y19", "Grade 1", "c1")],
    classes: [{ id: "c0", grade: "KG2", section: "A" }, { id: "c1", grade: "Grade 1", section: "A" }, { id: "c2", grade: "Grade 2", section: "A" }],
    feeTypes: [{ id: "ft", name: "School Fee", category: "TUITION", archivedAt: null }],
    schedules: [{ id: "sch18", feeTypeId: "ft", academicYearId: "y18", unitAmount: 1000, unitMonths: 1, unitsPerYear: 10, applicableGrades: null }, { id: "sch19", feeTypeId: "ft", academicYearId: "y19", unitAmount: 1000, unitMonths: 1, unitsPerYear: 10, applicableGrades: null }],
    installments: [], obligations: [], payments: [], allocations: [], attendance: [], staff: [], payrollPayments: [], advances: [], expenses: [],
  };
  // 10 monthly installments per year (Sep..Jun)
  const months = { sch18: ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"], sch19: ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"] };
  for (const [sch, list] of Object.entries(months)) list.forEach((m, i) => h.state.installments.push({ id: `${sch}-${m}`, feeScheduleId: sch, sequenceIndex: i, label: m, dueDate: `${m}-01`, amount: 1000, periodMonth: `${m}-01` }));
  h.spies = {
    setCurrent: vi.fn(async () => ({ changed: true })),
    registerStudent: vi.fn(async () => undefined),
    markNotReturning: vi.fn(async () => undefined),
    updateYear: vi.fn(async () => Y19),
    recordPayment: vi.fn(async () => ({ payment: { id: "pay1", receiptNo: "0001", amountTotal: 300 }, allocations: [] })),
    createStudent: vi.fn(async (f) => ({ ...student("new", f.firstName || "New", f.grade, null), studentId: "TMA-NEW" })),
  };
}

let probe;
function Probe() { probe = useData(); return null; }
async function mount() {
  render(<DataProvider><Probe /></DataProvider>);
  await waitFor(() => expect(probe && probe.db.students.length).toBeGreaterThan(0));
  await waitFor(() => expect(probe.db.feeSchedules.length).toBe(2));
}
const data = () => probe;
const select = async (id, enabled = true) => { await act(async () => { data().setWorkspaceScopeEnabled(enabled); data().setWorkspaceYearId(id); }); };
const oneObligation = (studentId, yearId, month, amountDue = 1000) => {
  const sch = yearId === "y18" ? "sch18" : "sch19";
  h.state.obligations.push({ id: `ob-${studentId}-${sch}-${month}`, studentId, feeInstallmentId: `${sch}-${month}`, amountDue });
};

beforeEach(() => { try { window.localStorage.clear(); } catch { /* */ } reset(); });
afterEach(() => { cleanup(); });

describe("the workspace scope", () => {
  it("defaults to the current (operational) year, and a selection is ignored until the shell enables it for the role", async () => {
    await mount();
    expect(data().db.workspaceYear.id).toBe("y19");
    expect(data().db.operationalYear.id).toBe("y19");
    await select("y18", false);                       // a teacher / parent: scope not enabled
    expect(data().db.workspaceYear.id).toBe("y19");
    expect(data().db.academicCalendar.id).toBe("y19");
  });

  it("selecting a year switches the calendar, the lifecycle flags and the periods together; null returns to the current year", async () => {
    await mount();
    await select("y18");
    expect(data().db.workspaceYear.id).toBe("y18");
    expect(data().db.academicCalendar).toMatchObject({ id: "y18", readOnly: true });
    expect(data().db.yearScope).toMatchObject({ isCurrentYear: false, isReadOnlyYear: true, isClosedYear: true });
    expect(data().db.yearScope.academicPeriods[0].ecLabel).toBe("Meskerem 2018");
    await select(null);
    expect(data().db.workspaceYear.id).toBe("y19");
    expect(data().db.academicCalendar.readOnly).toBe(false);
    expect(data().db.yearScope.academicPeriods[0].ecLabel).toBe("Meskerem 2019");
  });

  it("the choice survives a reload (per-browser), but a role that can't pick a year still gets the current one", async () => {
    await mount();
    await select("y18");
    cleanup();
    await mount();
    expect(data().db.workspaceYear.id).toBe("y19");   // scope not enabled yet on a fresh mount
    await act(async () => data().setWorkspaceScopeEnabled(true));
    expect(data().db.workspaceYear.id).toBe("y18");   // remembered
    await act(async () => data().setWorkspaceScopeEnabled(false));
    expect(data().db.workspaceYear.id).toBe("y19");
  });

  it("an unknown remembered year falls back to the current year", async () => {
    window.localStorage.setItem("hiil.workspaceAcademicYear", "deleted-year");
    await mount();
    await act(async () => data().setWorkspaceScopeEnabled(true));
    expect(data().db.workspaceYear.id).toBe("y19");
  });
});

describe("attendance follows the selected year", () => {
  it("a date in a closed year is view-only ('Academic Year Closed'); the same date is recordable when its year is the current one", async () => {
    await mount();
    expect(data().classifyAttendanceDay("2026-10-06").phase).not.toBe("year_closed");
    await select("y18");
    const c = data().classifyAttendanceDay("2025-10-06");
    expect(c).toMatchObject({ available: false, phase: "year_closed", label: "Academic Year Closed" });
  });
  it("browsing a closed year is capped at that year's end, not 'today'", async () => {
    await mount();
    await select("y18");
    expect(data().attendanceDateBounds()).toEqual({ min: "2025-09-11", max: "2026-07-07" });
  });
  it("a class's attendance roster in a past year is that year's enrollments, not today's students", async () => {
    await mount();
    expect(data().attendanceRosterForClass("c1").map((s) => s.id)).toEqual(["s2"]);        // 2019: Aisha in Grade 1
    await select("y18");
    expect(data().attendanceRosterForClass("c1").map((s) => s.id)).toEqual(["s1"]);        // 2018: Ahmed was in Grade 1
    expect(data().attendanceRosterForClass("c0").map((s) => s.id)).toEqual(["s2"]);        // 2018: Aisha was in KG2
  });
});

describe("rolls and dashboards are per year", () => {
  it("studentsInYear: the current year is the students table; a past year carries THAT year's grade and class", async () => {
    await mount();
    expect(data().studentsInYear().map((s) => `${s.id}:${s.grade}`).sort()).toEqual(["s1:Grade 2", "s2:Grade 1"]);
    await select("y18");
    expect(data().studentsInYear().map((s) => `${s.id}:${s.grade}`).sort()).toEqual(["s1:Grade 1", "s2:KG2"]);
    // explicit year always works, whatever the workspace shows
    expect(data().studentsInYear("y19")).toHaveLength(2);
    expect(data().studentsInYear("y20")).toEqual([]);   // nobody enrolled in the year being set up yet
  });
  it("the Students / Fees family list follows the selected year's roll", async () => {
    h.state.enrollments = h.state.enrollments.filter((e) => !(e.studentId === "s2" && e.academicYearId === "y18"));
    await mount();
    expect(data().familyGroups().flatMap((g) => g.children).map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    await select("y18");
    expect(data().familyGroups().flatMap((g) => g.children).map((s) => s.id)).toEqual(["s1"]);
  });
  it("re-enrollment worklist: previous year's students with their decision for the new year", async () => {
    h.state.decisions = [{ id: "d1", studentId: "s2", academicYearId: "y20", decision: "NOT_RETURNING", reason: "" }];
    h.state.enrollments.push(enr("s1", "y20", "Grade 3", "c3"));
    await mount();
    const list = data().reenrollmentWorklist("y19", "y20");
    expect(Object.fromEntries(list.map((w) => [w.student.id, w.decision]))).toEqual({ s1: "REGISTERED", s2: "NOT_RETURNING" });
  });
});

describe("fees and payments per year", () => {
  it("a student who joined in Yekatit sees the earlier months as Not applicable — and owes only what applies", async () => {
    for (const m of ["2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]) oneObligation("s1", "y19", m);
    h.state.payments = [{ id: "p1", status: "POSTED", amountTotal: 1000 }];
    h.state.allocations = [{ id: "a1", paymentId: "p1", obligationId: "ob-s1-sch19-2027-02", amount: 1000 }];
    await mount();
    const s1 = data().db.students.find((s) => s.id === "s1");
    const { periods, rows } = data().installmentStatusForStudent(s1);
    expect(periods).toHaveLength(10);
    expect(periods.slice(0, 5).every((p) => p.status === "NOT_APPLICABLE")).toBe(true);
    expect(periods[5].status).toBe("PAID");
    expect(rows).toHaveLength(5);
    expect(data().balanceFor(s1, data().db.feeTypes[0])).toMatchObject({ amountOwed: 4000, status: "PARTIAL" });
    // the payment-modal list carries every month too, N/A included
    const modal = data().feeInstallmentRowsForStudent(s1, data().db.feeTypes[0]);
    expect(modal.periods.filter((p) => p.applicable === false)).toHaveLength(5);
    expect(modal.rows.every((r) => r.status !== "NOT_APPLICABLE")).toBe(true);
  });

  it("a payment stays in its own year: each year's balance and collected total ignore the other", async () => {
    for (const m of ["2025-09", "2025-10"]) oneObligation("s1", "y18", m);
    for (const m of ["2026-09", "2026-10"]) oneObligation("s1", "y19", m);
    h.state.payments = [{ id: "pOld", status: "POSTED", amountTotal: 700 }, { id: "pNew", status: "POSTED", amountTotal: 400 }, { id: "pVoid", status: "VOIDED", amountTotal: 999 }];
    h.state.allocations = [
      { id: "a1", paymentId: "pOld", obligationId: "ob-s1-sch18-2025-10", amount: 700 },
      { id: "a2", paymentId: "pNew", obligationId: "ob-s1-sch19-2026-10", amount: 400 },
      { id: "a3", paymentId: "pVoid", obligationId: "ob-s1-sch19-2026-09", amount: 999 },
    ];
    await mount();
    const s1 = data().db.students.find((s) => s.id === "s1");
    expect(data().yearFinanceTotals().collected).toBe(400);            // workspace = 2019
    expect(data().yearFinanceTotals("y18").collected).toBe(700);
    expect(data().balanceFor(s1, data().db.feeTypes[0], "y19").amountOwed).toBe(1600);
    expect(data().balanceFor(s1, data().db.feeTypes[0], "y18").amountOwed).toBe(1300);
    await select("y18");
    expect(data().yearFinanceTotals().collected).toBe(700);            // the selection changes what "the year" means
    expect(data().balanceFor(s1, data().db.feeTypes[0]).amountOwed).toBe(1300);
    expect(data().monthlyFinanceReport().rows.map((r) => r.monthKey)).toEqual(["2025-10"]);
  });

  it("finance totals count only the year's own payroll months and expenses", async () => {
    h.state.staff = [{ id: "t1", name: "Tigist", salary: 10000, employmentDate: "2025-01-15", employmentEndDate: null }];
    h.state.payrollPayments = [
      { id: "pp-old", staffId: "t1", amount: 10000, month: "2025-10", allowances: 0, deductions: 0, createdAt: 1 },
      { id: "pp-new", staffId: "t1", amount: 4000, month: "2026-10", allowances: 0, deductions: 0, createdAt: 2 },
    ];
    h.state.advances = [{ id: "adv", staffId: "t1", amount: 500, payrollMonth: "2026-11", createdAt: 3 }];
    h.state.expenses = [{ id: "e1", date: "2025-11-01", totalAmount: 111, items: [] }, { id: "e2", date: "2026-11-01", totalAmount: 222, items: [] }];
    await mount();
    expect(data().yearFinanceTotals()).toMatchObject({ payrollPaid: 4500, expenses: 222 });
    expect(data().yearFinanceTotals("y18")).toMatchObject({ payrollPaid: 10000, expenses: 111 });
  });
});

describe("payroll is scoped to the selected year and the person's start month", () => {
  const staff = (over = {}) => ({ id: "t1", name: "Tigist", salary: 10000, employmentDate: "2025-01-15", employmentEndDate: null, ...over });
  it("periods are the year's Ethiopian months and never reach into another year", async () => {
    h.state.staff = [staff()];
    h.state.payrollPayments = [{ id: "old", staffId: "t1", amount: 10000, month: "2025-10", allowances: 0, deductions: 0, createdAt: 1 }];
    await mount();
    const now = data().staffSalarySummary("t1");
    expect(now.yearScoped).toBe(true);
    expect(now.months.every((m) => m >= "2026-09" && m <= "2027-06")).toBe(true);
    expect(now.history).toEqual([]);                                   // the 2018 payment is not part of 2019
    await select("y18");
    const past = data().staffSalarySummary("t1");
    expect(past.months).toHaveLength(10);
    expect(past.months[0]).toBe("2025-09");
    expect(past.history.map((p) => p.id)).toEqual(["old"]);
  });
  it("a teacher who joined in Megabit is owed from Megabit, not from Meskerem", async () => {
    h.state.staff = [staff({ employmentDate: "2027-03-05" })];
    await mount();
    await select("y19");
    const s = data().staffSalarySummary("t1");
    expect(s.periods.filter((p) => p.state === "NOT_APPLICABLE")).toHaveLength(6);
    expect(s.months.every((m) => m >= "2027-03")).toBe(true);
  });
});

describe("write guard: nothing day-to-day is written into a year that isn't the current one", () => {
  it("while viewing a closed year, enrolment / attendance / results / payments / payroll actions are refused with a clear message and never reach the server", async () => {
    await mount();
    await select("y18");
    for (const name of ["createStudent", "updateStudent", "saveAttendance", "saveResultComponent", "recordPaymentBatch", "recordPayrollPayment", "recordSalaryAdvance", "createHomework"]) {
      const res = await data()[name]({});
      expect(res.ok, name).toBe(false);
      expect(res.message, name).toMatch(/2018-2019 E\.C\. \/ 2025-2026 G\.C\., which is closed \(read-only\)/);
    }
    expect(h.spies.createStudent).not.toHaveBeenCalled();
  });
  it("while viewing the year being set up, the same actions are refused too (they would land in the current year)", async () => {
    await mount();
    await select("y20");
    const res = await data().createStudent({ firstName: "X", grade: "Grade 1", section: "A" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not the current academic year/);
  });
  it("in the current year the same action goes through", async () => {
    await mount();
    await select("y18");
    expect((await data().createStudent({ firstName: "Nora", grade: "Grade 1", section: "A" })).ok).toBe(false);
    await select(null);
    const res = await data().createStudent({ firstName: "Nora", grade: "Grade 1", section: "A" });
    expect(res.ok).toBe(true);
    expect(h.spies.createStudent).toHaveBeenCalledTimes(1);
  });
  it("the calendar of a closed year can't be saved", async () => {
    await mount();
    const res = await data().saveAcademicCalendar({ yearStart: "2025-09-11", yearEnd: "2026-07-07", sem1Start: "2025-09-11", sem1End: "2026-01-19", breakDays: 15, sem2Start: "2026-02-04", sem2End: "2026-07-07", resultFinalizationGraceDays: 15 }, "u1", "y18");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/closed \(read-only\)/);
    expect(h.spies.updateYear).not.toHaveBeenCalled();
  });
  it("the calendar of an upcoming year (the wizard) and of the current year can be saved", async () => {
    await mount();
    const f = { yearStart: "2027-09-12", yearEnd: "2028-07-07", sem1Start: "2027-09-12", sem1End: "2028-01-19", breakDays: 15, sem2Start: "2028-02-04", sem2End: "2028-07-07", resultFinalizationGraceDays: 15 };
    expect((await data().saveAcademicCalendar(f, "u1", "y20")).ok).toBe(true);
    expect(h.spies.updateYear).toHaveBeenCalledWith("y20", expect.objectContaining({ yearStart: "2027-09-12", yearEnd: "2028-07-07" }), "u1");
  });
});

describe("Make Current, registering and not-returning go through the server actions", () => {
  it("setCurrentAcademicYear sends the reason / override, refreshes everything, and the workspace follows the new current year", async () => {
    await mount();
    await select("y18");
    h.state.years = [Y18, { ...Y19, isCurrent: false, closedAt: "2026-10-01T00:00:00Z" }, { ...Y20, isCurrent: true }];
    const res = await data().setCurrentAcademicYear("y20", { allowUndecided: true });
    expect(res.ok).toBe(true);
    expect(h.spies.setCurrent).toHaveBeenCalledWith("y20", { reason: undefined, allowUndecided: true });
    await waitFor(() => expect(data().db.operationalYear.id).toBe("y20"));
    expect(data().db.workspaceYear.id).toBe("y20");                     // selection cleared -> follows current
    expect(data().db.academicYears.find((y) => y.id === "y19").isCurrent).toBe(false);   // nothing was deleted
    expect(data().db.academicYears).toHaveLength(3);
  });
  it("a failure is reported, not swallowed", async () => {
    await mount();
    h.spies.setCurrent.mockRejectedValueOnce(new Error("Reopening a closed academic year needs a reason."));
    const res = await data().setCurrentAcademicYear("y18");
    expect(res).toMatchObject({ ok: false, message: "Reopening a closed academic year needs a reason." });
  });
  it("registerStudentForYear / markStudentNotReturning call the server with the chosen year — never a delete", async () => {
    await mount();
    expect((await data().registerStudentForYear({ studentId: "s1", yearId: "y20", grade: "Grade 3", section: "A" })).ok).toBe(true);
    expect(h.spies.registerStudent).toHaveBeenCalledWith({ studentId: "s1", yearId: "y20", grade: "Grade 3", section: "A" });
    expect((await data().markStudentNotReturning({ studentId: "s2", yearId: "y20", reason: "Moved" })).ok).toBe(true);
    expect(h.spies.markNotReturning).toHaveBeenCalledWith({ studentId: "s2", yearId: "y20", reason: "Moved" });
    expect(data().db.students).toHaveLength(2);                          // nobody disappeared
  });
  it("without the database update the actions explain what is missing instead of failing silently", async () => {
    await mount();
    h.spies.registerStudent.mockRejectedValueOnce(new Error("Could not find the function public.register_student_for_year in the schema cache"));
    const res = await data().registerStudentForYear({ studentId: "s1", yearId: "y20", grade: "Grade 3", section: "A" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/latest database update/);
  });
  it("a non-admin gets a plain 'only the Owner or Educational Director' message", async () => {
    await mount();
    h.spies.markNotReturning.mockRejectedValueOnce(new Error("Only the Owner or Educational Director may record that a student is not returning"));
    const res = await data().markStudentNotReturning({ studentId: "s2", yearId: "y20" });
    expect(res.message).toMatch(/Only the Owner or Educational Director/);
  });
});

describe("historical adjustments: money into a closed year is deliberate, reasoned and owner-only", () => {
  const lines = [{ studentId: "s1", installmentId: "sch18-2025-10", amount: 300, method: "Cash", date: "2026-10-01" }];
  it("a normal payment is refused while a closed year is being viewed", async () => {
    await mount();
    await select("y18");
    const res = await data().recordPaymentBatch(lines, "owner");
    expect(res.receiptNo).toBeUndefined();
    expect(res.error).toMatch(/closed \(read-only\)/);
    expect(h.spies.recordPayment).not.toHaveBeenCalled();
  });
  it("recordHistoricalPayment needs the closed year to be the one being viewed, and a reason", async () => {
    await mount();
    const notClosed = await data().recordHistoricalPayment(lines, "owner", "late arrears");
    expect(notClosed.receiptNo).toBeNull();
    expect(notClosed.error).toMatch(/only for a closed academic year/);
    await select("y18");
    const noReason = await data().recordHistoricalPayment(lines, "owner", "   ");
    expect(noReason.error).toMatch(/reason/i);
    expect(h.spies.recordPayment).not.toHaveBeenCalled();
  });
  it("with a reason it goes through the historical RPC path and returns the receipt", async () => {
    await mount();
    await select("y18");
    const res = await data().recordHistoricalPayment(lines, "owner", "Arrears collected after year end");
    expect(res.receiptNo).toBe("0001");
    expect(h.spies.recordPayment).toHaveBeenCalledWith(lines, "owner", { historicalReason: "Arrears collected after year end" });
  });
  it("a server refusal (not the owner) comes back as a readable message", async () => {
    await mount();
    await select("y18");
    h.spies.recordPayment.mockRejectedValueOnce(new Error("Only the Owner may record a payment into a closed academic year"));
    const res = await data().recordHistoricalPayment(lines, "finance", "x");
    expect(res.receiptNo).toBeNull();
    expect(res.error).toMatch(/Owner/);
  });
});

describe("teacher assignments per year", () => {
  it("a closed year shows who taught what when it closed; the current year shows the live assignments", async () => {
    h.state.snapshots = [
      { id: "1", academicYearId: "y18", teacherId: "t1", teacherName: "Tigist", subjectId: "sub1", classId: "c1" },
      { id: "2", academicYearId: "y18", teacherId: "t2", teacherName: "Dawit", subjectId: "sub2", classId: "c2" },
    ];
    await mount();
    expect(data().teacherAssignmentsInYear()).toMatchObject({ historical: false });      // workspace = current year
    await select("y18");
    const past = data().teacherAssignmentsInYear();
    expect(past.historical).toBe(true);
    expect(past.rows.map((r) => r.teacherName).sort()).toEqual(["Dawit", "Tigist"]);
    // a year with no snapshot (closed before this feature, or upcoming) falls back to the live list
    expect(data().teacherAssignmentsInYear("y20").historical).toBe(false);
  });
  it("changing assignments is not possible while another year is being viewed", async () => {
    await mount();
    await select("y18");
    const res = await data().updateTeacherAssignments("t1", [{ classId: "c1", subject: "Math" }]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/closed \(read-only\)/);
  });
});
