import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The academic-year management UI, driven against a fake data layer built with the REAL scope / worklist
// logic (utils/academicYearScope.js), so what is asserted is what an admin sees.
const toastSpy = vi.fn();
const ctx = { data: null, user: { id: "u1", role: "OWNER" } };
vi.mock("../src/context/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../src/context/AuthContext", () => ({ useAuth: () => ({ currentUser: ctx.user, realUser: ctx.user }) }));
vi.mock("../src/context/DataContext", () => ({ useData: () => ctx.data }));

import {
  AcademicYearSelector, AcademicYearViewBanner, AcademicYearAttentionBanner, AcademicYearSettingsModal, NewAcademicYearWizard, AcademicYearTag,
} from "../src/components/academicYear";
import { FeeScheduleList } from "../src/components/ui";
import { buildAcademicYearScope, reenrollmentCandidates } from "../src/utils/academicYearScope";

const Y18 = { id: "y18", gcLabel: "2025-2026", ecLabel: "2018-2019", yearStart: "2025-09-11", yearEnd: "2026-07-07", sem1Start: "2025-09-11", sem1End: "2026-01-19", breakDays: 15, sem2Start: "2026-02-04", sem2End: "2026-07-07", resultFinalizationGraceDays: 15, isCurrent: false, closedAt: "2026-09-12T00:00:00Z" };
const Y19 = { id: "y19", gcLabel: "2026-2027", ecLabel: "2019-2020", yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-11", sem1End: "2027-01-19", breakDays: 15, sem2Start: "2027-02-04", sem2End: "2027-07-07", resultFinalizationGraceDays: 15, isCurrent: true, closedAt: null };
const Y20 = { id: "y20", gcLabel: "2027-2028", ecLabel: "2020-2021", yearStart: "2027-09-12", yearEnd: "2028-07-07", sem1Start: "2027-09-12", sem1End: "2028-01-19", breakDays: 15, sem2Start: "2028-02-04", sem2End: "2028-07-07", resultFinalizationGraceDays: 15, isCurrent: false, closedAt: null };

const STUDENTS = [
  { id: "s1", studentId: "TMA-1", firstName: "Ahmed", lastName: "Hassan", grade: "Grade 2", section: "A", status: "ACTIVE" },
  { id: "s2", studentId: "TMA-2", firstName: "Aisha", lastName: "Mohamed", grade: "KG2", section: "B", status: "ACTIVE" },
];
const enr = (studentId, academicYearId, grade, section) => ({ id: `${studentId}-${academicYearId}`, studentId, academicYearId, grade, section, status: "ACTIVE" });
const ENROLLMENTS = [enr("s1", "y19", "Grade 2", "A"), enr("s2", "y19", "KG2", "B"), enr("s1", "y18", "Grade 1", "A")];

function makeData({ years = [Y18, Y19, Y20], selectedId = null, today = "2026-09-28", enrollments = ENROLLMENTS, decisions = [], audit = [] } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today + "T09:00:00"));
  const scope = buildAcademicYearScope({ years, selectedId, todayKey: today });
  const data = {
    db: {
      academicYears: years, yearScope: scope, workspaceYear: scope.selectedAcademicYear, operationalYear: scope.currentAcademicYear,
      classes: [{ id: "c1", grade: "Grade 3", section: "A" }, { id: "c2", grade: "Grade 1", section: "B" }],
      students: STUDENTS, enrollments, studentYearDecisions: decisions, academicYearAudit: audit,
    },
    setWorkspaceYearId: vi.fn(),
    setCurrentAcademicYear: vi.fn(async () => ({ ok: true })),
    createAcademicYear: vi.fn(async () => ({ ok: true, year: { ...Y20, id: "newyear" } })),
    saveAcademicCalendar: vi.fn(async () => ({ ok: true })),
    registerStudentForYear: vi.fn(async () => ({ ok: true })),
    markStudentNotReturning: vi.fn(async () => ({ ok: true })),
    reenrollmentWorklist: (source, target) => reenrollmentCandidates({ students: STUDENTS, enrollments, decisions, sourceYearId: source, targetYearId: target }),
    studentFullName: (s) => `${s.firstName} ${s.lastName}`,
    gradeOptions: () => ["Grade 1", "Grade 3"],
  };
  return data;
}

beforeEach(() => { toastSpy.mockClear(); ctx.user = { id: "u1", role: "OWNER" }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("header selector", () => {
  it("the owner picks any academic year; the current one is marked and the choice is sent up", () => {
    ctx.data = makeData();
    render(<AcademicYearSelector />);
    const select = screen.getByLabelText("Academic Year");
    expect(select.value).toBe("y19");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "2020-2021 E.C. / 2027-2028 G.C. — upcoming",
      "2019-2020 E.C. / 2026-2027 G.C. — current",
      "2018-2019 E.C. / 2025-2026 G.C. — closed",
    ]);
    fireEvent.change(select, { target: { value: "y18" } });
    expect(ctx.data.setWorkspaceYearId).toHaveBeenCalledWith("y18");
    fireEvent.change(select, { target: { value: "y19" } });
    expect(ctx.data.setWorkspaceYearId).toHaveBeenLastCalledWith(null); // back to the current year
  });

  it("finance can pick a year too; a teacher can't — they only see the current year", () => {
    ctx.user = { id: "f", role: "FINANCE" };
    ctx.data = makeData();
    const { unmount } = render(<AcademicYearSelector />);
    expect(screen.getByLabelText("Academic Year")).toBeTruthy();
    unmount();
    ctx.user = { id: "t", role: "TEACHER" };
    render(<AcademicYearSelector />);
    expect(screen.queryByLabelText("Academic Year")).toBeNull();
    expect(screen.getByText("2019-2020 E.C. / 2026-2027 G.C.")).toBeTruthy();
  });
});

describe("viewing another year", () => {
  it("shows a read-only banner naming the year, and returns to the current year on request", () => {
    ctx.data = makeData({ selectedId: "y18" });
    render(<AcademicYearViewBanner />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/Viewing 2018-2019 E\.C\. \/ 2025-2026 G\.C\./);
    expect(banner.textContent).toMatch(/closed, read-only/);
    fireEvent.click(screen.getByRole("button", { name: /Return to the current year/ }));
    expect(ctx.data.setWorkspaceYearId).toHaveBeenCalledWith(null);
  });
  it("is invisible in the current year", () => {
    ctx.data = makeData();
    const { container } = render(<AcademicYearViewBanner />);
    expect(container.innerHTML).toBe("");
  });
  it("an upcoming year is flagged as 'not the current academic year yet'", () => {
    ctx.data = makeData({ selectedId: "y20" });
    render(<AcademicYearViewBanner />);
    expect(screen.getByRole("status").textContent).toMatch(/not the current academic year yet/);
  });
  it("every dashboard / report is tagged with the academic year it shows", () => {
    ctx.data = makeData({ selectedId: "y18" });
    render(<AcademicYearTag />);
    const tag = screen.getByTestId("academic-year-tag");
    expect(tag.textContent).toMatch(/Academic Year: 2018-2019 E\.C\. \/ 2025-2026 G\.C\./);
    expect(tag.textContent).toMatch(/Closed/);
  });
});

describe("lifecycle banners for the owner / educational director", () => {
  it("ending soon", () => {
    ctx.data = makeData({ today: "2027-06-20" });
    render(<AcademicYearAttentionBanner onReview={() => {}} onCreateNext={() => {}} />);
    expect(screen.getByText(/Academic year ending soon/)).toBeTruthy();
  });
  it("ended -> closed, with Review Year / Create Next Academic Year, and never for a teacher", () => {
    ctx.data = makeData({ today: "2027-08-01" });
    const onReview = vi.fn(), onCreate = vi.fn();
    const { unmount } = render(<AcademicYearAttentionBanner onReview={onReview} onCreateNext={onCreate} />);
    expect(screen.getByText(/Academic year closed/)).toBeTruthy();
    expect(screen.getByText(/Academic Year Closed on/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review Year" }));
    fireEvent.click(screen.getByRole("button", { name: /Create Next Academic Year/ }));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledTimes(1);
    unmount();
    ctx.user = { id: "t", role: "TEACHER" };
    const { container } = render(<AcademicYearAttentionBanner onReview={onReview} onCreateNext={onCreate} />);
    expect(container.innerHTML).toBe("");
  });
  it("an ordinary mid-year day shows nothing", () => {
    ctx.data = makeData({ today: "2026-12-01" });
    const { container } = render(<AcademicYearAttentionBanner onReview={() => {}} onCreateNext={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Academic Year settings: compact by default", () => {
  const open = (extra = {}) => render(<AcademicYearSettingsModal open onClose={() => {}} renderCalendarEditor={(p) => <div data-testid="editor" data-open={String(p.open)} data-year={p.year?.id} />} {...extra} />);

  it("shows the current year summary — not the giant date form", () => {
    ctx.data = makeData();
    open();
    expect(screen.getByText("Current academic year")).toBeTruthy();
    expect(screen.getByText("2019-2020 E.C.")).toBeTruthy();
    expect(screen.getByText("2026-2027 G.C.")).toBeTruthy();
    expect(screen.getByText("CURRENT")).toBeTruthy();
    expect(screen.getByText(/Meskerem 1, 2019 → Sene 30, 2019 E\.C\./)).toBeTruthy(); // Meskerem 1 -> Sene 30
    expect(screen.getByText(/10 months — Meskerem 2019 → Sene 2019/)).toBeTruthy();
    expect(screen.getByText(/15 days after a semester ends/)).toBeTruthy();
    // none of the calendar form's fields or its Save button are on this screen
    expect(screen.queryByRole("button", { name: /Save Calendar/ })).toBeNull();
    expect(screen.queryByText("Academic year start")).toBeNull();
    // the editor is mounted but closed until asked for
    expect(screen.getByTestId("editor").dataset.open).toBe("false");
  });

  it("[Edit Academic Calendar] opens the full form for the current year", () => {
    ctx.data = makeData();
    open();
    fireEvent.click(screen.getByRole("button", { name: /Edit Academic Calendar/ }));
    expect(screen.getByTestId("editor").dataset.open).toBe("true");
    expect(screen.getByTestId("editor").dataset.year).toBe("y19");
  });

  it("lists previous years (closed, with their closure date) and upcoming years separately", () => {
    ctx.data = makeData();
    open();
    expect(screen.getByText("Previous academic years")).toBeTruthy();
    expect(screen.getByText("Upcoming academic years")).toBeTruthy();
    expect(screen.getByText("2018-2019 E.C. / 2025-2026 G.C.")).toBeTruthy();
    expect(screen.getByText("Previous")).toBeTruthy();
    expect(screen.getByText(/Closed .*E\.C\./)).toBeTruthy();
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText(/kept exactly as it was/)).toBeTruthy();
  });

  it("[View] on a previous year switches the workspace to it (read-only) without changing the current year", () => {
    ctx.data = makeData();
    const onClose = vi.fn();
    open({ onClose });
    const prev = screen.getByText("2018-2019 E.C. / 2025-2026 G.C.").closest("div").parentElement.parentElement;
    fireEvent.click(within(prev).getByRole("button", { name: /View/ }));
    expect(ctx.data.setWorkspaceYearId).toHaveBeenCalledWith("y18");
    expect(ctx.data.setCurrentAcademicYear).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("[Make Current] asks for confirmation, and a closed year also needs a reason (exceptional reopening)", async () => {
    ctx.data = makeData();
    open();
    fireEvent.click(screen.getByRole("button", { name: /Make Current/ }));
    const dialog = screen.getByText("Switch academic year?").closest("div").parentElement;
    expect(dialog.textContent).toMatch(/You are switching the entire school workspace to 2018-2019 E\.C\. \/ 2025-2026 G\.C\./);
    expect(dialog.textContent).toMatch(/Attendance, fees, payments, payroll, results and reports will now show that year's data/);
    expect(dialog.textContent).toMatch(/recorded in the audit log/);
    // no reason -> nothing happens
    fireEvent.click(within(dialog).getByRole("button", { name: "Make Current" }));
    await Promise.resolve();
    expect(ctx.data.setCurrentAcademicYear).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/reason/i), "error");
    fireEvent.change(within(dialog).getByPlaceholderText(/Correcting a published result/), { target: { value: "Audit correction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make Current" }));
    await waitFor(() => expect(ctx.data.setCurrentAcademicYear).toHaveBeenCalledWith("y18", { reason: "Audit correction" }));
  });

  it("Cancel leaves the current year alone", () => {
    ctx.data = makeData();
    open();
    fireEvent.click(screen.getByRole("button", { name: /Make Current/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(ctx.data.setCurrentAcademicYear).not.toHaveBeenCalled();
  });

  it("a teacher can't manage years: no Edit / Make Current / Create buttons", () => {
    ctx.user = { id: "t", role: "TEACHER" };
    ctx.data = makeData();
    open();
    expect(screen.queryByRole("button", { name: /Edit Academic Calendar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Make Current/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Next Academic Year/ })).toBeNull();
  });

  it("shows the year's recent audit history", () => {
    ctx.data = makeData({ audit: [{ id: "a1", academicYearId: "y18", action: "REOPENED", actorName: "Owner Person", reason: "Audit", at: Date.UTC(2026, 8, 20) }] });
    open();
    expect(screen.getByText("Recent changes")).toBeTruthy();
    expect(screen.getByText("Reopened")).toBeTruthy();
    expect(screen.getByText(/Owner Person/)).toBeTruthy();
  });

  it("a year whose closure has passed says 'Academic Year Closed' with the closure date", () => {
    ctx.data = makeData({ today: "2027-08-01" });
    open();
    expect(screen.getByText(/Academic Year Closed/)).toBeTruthy();
    expect(screen.getByText(/CURRENT · Closed/)).toBeTruthy();
  });
});

describe("Create Next Academic Year wizard", () => {
  const renderWizard = (props = {}) => render(<NewAcademicYearWizard open onClose={() => {}} {...props} />);
  const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Create year & continue)$/ }));

  it("step 1 pre-fills Meskerem 1 -> Sene 30 of the next E.C. year", async () => {
    ctx.data = makeData({ years: [Y18, Y19] });
    renderWizard();
    expect(screen.getByText("Academic dates").closest("li").getAttribute("aria-current")).toBe("step");
    expect(screen.getAllByDisplayValue("2020")[0]).toBeTruthy();
    expect(screen.getByText(/2020-2021 E\.C\. \/ 2027-2028 G\.C\./)).toBeTruthy();
    expect(screen.getByText(/Fees and payroll run for 10 months: Meskerem 2020 → Sene 2020/)).toBeTruthy();
  });

  it("changing the E.C. year re-derives the dates and the months", () => {
    ctx.data = makeData({ years: [Y18, Y19] });
    renderWizard();
    fireEvent.change(screen.getAllByDisplayValue("2020")[0], { target: { value: "2021" } });
    expect(screen.getByText(/2021-2022 E\.C\./)).toBeTruthy();
    expect(screen.getByText(/Meskerem 2021 → Sene 2021/)).toBeTruthy();
  });

  it("refuses to create a year that already exists", () => {
    ctx.data = makeData({ years: [Y18, Y19, Y20] });
    renderWizard();
    expect(screen.getAllByDisplayValue("2021")[0]).toBeTruthy(); // 2020 exists already, so the next one is suggested
    fireEvent.change(screen.getAllByDisplayValue("2021")[0], { target: { value: "2020" } });
    next();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/already exists/), "error");
    expect(ctx.data.createAcademicYear).not.toHaveBeenCalled();
  });

  it("walks dates -> semesters -> billing months, creates the (inactive) year only at the end of step 3", async () => {
    ctx.data = makeData({ years: [Y18, Y19] });
    renderWizard();
    next();                                                       // -> semesters
    expect(screen.getByText("Semester 1 starts")).toBeTruthy();
    expect(screen.getByText(/Semester 2 then starts on/)).toBeTruthy();
    next();                                                       // -> billing months
    expect(screen.getByText(/these 10 months/)).toBeTruthy();
    const months = screen.getAllByText(/^(Meskerem|Tikimt|Hidar|Tahsas|Tir|Yekatit|Megabit|Miyazya|Ginbot|Sene) 2020$/);
    expect(months).toHaveLength(10);
    expect(screen.queryByText(/Hamle|Nehasse|2019$/)).toBeNull();
    expect(ctx.data.createAcademicYear).not.toHaveBeenCalled();   // nothing persisted while planning
    next();                                                       // "Create year & continue"
    await waitFor(() => expect(ctx.data.createAcademicYear).toHaveBeenCalledTimes(1));
    const [fields] = ctx.data.createAcademicYear.mock.calls[0];
    expect(fields).toMatchObject({ yearStart: "2027-09-12", yearEnd: "2028-07-07", breakDays: 15, sem2End: "2028-07-07" });
    await screen.findByText(/Students of/);
  });

  it("step 4 lists the previous year's students; Register / Not returning act on the NEW year only", async () => {
    ctx.data = makeData({ years: [Y18, Y19, Y20] });
    renderWizard({ resumeYearId: "y20" });                         // resuming an upcoming year starts at re-enrollment
    expect(screen.getByText(/Students of/)).toBeTruthy();
    expect(screen.getByText("Ahmed Hassan")).toBeTruthy();
    expect(screen.getByText("Aisha Mohamed")).toBeTruthy();
    expect(screen.getByText("2 to decide")).toBeTruthy();
    // Ahmed: register into the suggested next grade
    const ahmed = screen.getByText("Ahmed Hassan").closest("div").parentElement.parentElement;
    fireEvent.click(within(ahmed).getByRole("button", { name: "Register" }));
    expect(within(ahmed).getByDisplayValue("Grade 3")).toBeTruthy();
    fireEvent.click(within(ahmed).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(ctx.data.registerStudentForYear).toHaveBeenCalledWith({ studentId: "s1", yearId: "y20", grade: "Grade 3", section: "A" }));
    // Aisha: not returning — no deletion API is even called
    const aisha = screen.getByText("Aisha Mohamed").closest("div").parentElement.parentElement;
    fireEvent.click(within(aisha).getByRole("button", { name: "Not returning" }));
    await waitFor(() => expect(ctx.data.markStudentNotReturning).toHaveBeenCalledWith({ studentId: "s2", yearId: "y20", reason: "" }));
    expect(Object.keys(ctx.data).some((k) => /delete|remove/i.test(k))).toBe(false);
  });

  it("a registered student shows their new grade; a not-returning one can still be registered instead (same person)", () => {
    ctx.data = makeData({
      years: [Y18, Y19, Y20],
      enrollments: [...ENROLLMENTS, enr("s1", "y20", "Grade 3", "A")],
      decisions: [{ id: "d", studentId: "s2", academicYearId: "y20", decision: "NOT_RETURNING", reason: "" }],
    });
    renderWizard({ resumeYearId: "y20" });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText(/Registered — Grade 3A/)).toBeTruthy();
    expect(screen.getByText("Not returning", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register instead" })).toBeTruthy();
  });

  it("step 5: students without a decision block activation until they are explicitly recorded as not returning", async () => {
    ctx.data = makeData({ years: [Y18, Y19, Y20], enrollments: [...ENROLLMENTS, enr("s1", "y20", "Grade 3", "A")] });
    renderWizard({ resumeYearId: "y20" });
    next();
    expect(screen.getByText(/1 student has no decision/)).toBeTruthy();
    const activate = screen.getByRole("button", { name: /Activate as current year/ });
    expect(activate.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Record them( all)? as/));
    expect(activate.disabled).toBe(false);
    fireEvent.click(activate);
    const dialog = screen.getByText("Make this the current academic year?").closest("div").parentElement;
    expect(dialog.textContent).toMatch(/2019-2020 E\.C\. \/ 2026-2027 G\.C\. is closed \(kept, read-only\)/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(ctx.data.setCurrentAcademicYear).toHaveBeenCalledWith("y20", { allowUndecided: true }));
  });

  it("step 5 with every student decided activates without any override", async () => {
    ctx.data = makeData({
      years: [Y18, Y19, Y20],
      enrollments: [...ENROLLMENTS, enr("s1", "y20", "Grade 3", "A")],
      decisions: [{ id: "d", studentId: "s2", academicYearId: "y20", decision: "NOT_RETURNING", reason: "" }],
    });
    renderWizard({ resumeYearId: "y20" });
    next();
    expect(screen.queryByLabelText(/Record them( all)? as/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Activate as current year/ }));
    fireEvent.click(within(screen.getByText("Make this the current academic year?").closest("div").parentElement).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(ctx.data.setCurrentAcademicYear).toHaveBeenCalledWith("y20", { allowUndecided: false }));
  });
});

describe("fee months: Paid / Due / Not applicable", () => {
  const rows = [
    { label: "Meskerem 2019 (September 2026)", status: "NOT_APPLICABLE", paid: 0, remaining: 0 },
    { label: "Tikimt 2019 (October 2026)", status: "NOT_APPLICABLE", paid: 0, remaining: 0 },
    { label: "Yekatit 2019 (February 2027)", status: "PAID", paid: 1000, remaining: 0 },
    { label: "Megabit 2019 (March 2027)", status: "UNPAID", paid: 0, remaining: 1000, current: true },
    { label: "Miyazya 2019 (April 2027)", status: "PARTIAL", paid: 400, remaining: 600 },
    { label: "Ginbot 2019 (May 2027)", status: "UNPAID", paid: 0, remaining: 1000, voided: 1000 },
  ];
  it("months before the student joined read 'Not applicable' in words, disabled, with no amounts — not as debt", () => {
    const { container } = render(<FeeScheduleList rows={rows} />);
    const na = container.querySelectorAll('[data-status="NOT_APPLICABLE"]');
    expect(na).toHaveLength(2);
    na.forEach((el) => {
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.textContent).toMatch(/Not applicable/);
      expect(el.textContent).not.toMatch(/paid|remaining|Unpaid/i);
    });
  });
  it("paid / partially paid / unpaid keep their own readable text (never colour alone), and a voided receipt is noted", () => {
    render(<FeeScheduleList rows={rows} />);
    expect(screen.getByText("Paid in full")).toBeTruthy();
    expect(screen.getByText("Partially paid")).toBeTruthy();
    expect(screen.getAllByText("Unpaid").length).toBe(2);
    expect(screen.getByText(/Receipt voided/)).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
  });
});
