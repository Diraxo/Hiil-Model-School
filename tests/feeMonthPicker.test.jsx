import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The fee settings screen the school reported: "Months this fee applies to — 10 of 23 selected",
// listing Meskerem 2018 … Hamle 2019. These tests drive the REAL FeeSettingsModal / Academic Calendar
// modal against a fake data layer and pin what the admin actually sees.
const toastSpy = vi.fn();
const ctx = { data: null };
vi.mock("../src/context/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({ currentUser: { id: "owner", role: "OWNER" }, realUser: { id: "owner", role: "OWNER" } }),
}));
vi.mock("../src/context/DataContext", () => ({ useData: () => ctx.data }));

import { FeeSettingsModal, AcademicCalendarSettingsModal } from "../src/pages/admin/AdminPages";

const Y2018 = { id: "y2018", gcLabel: "2025-2026", ecLabel: "2018-2019", yearStart: "2025-09-11", yearEnd: "2026-06-30", sem1Start: "2025-09-15", sem1End: "2026-01-20", breakDays: 15, sem2Start: "2026-02-05", sem2End: "2026-06-30", resultFinalizationGraceDays: 15, isCurrent: false };
const Y2019 = { id: "y2019", gcLabel: "2026-2027", ecLabel: "2019-2020", yearStart: "2026-09-11", yearEnd: "2027-06-30", sem1Start: "2026-09-14", sem1End: "2027-01-20", breakDays: 15, sem2Start: "2027-02-05", sem2End: "2027-06-30", resultFinalizationGraceDays: 15, isCurrent: true };
// the inconsistent production row: start left in Meskerem 1, 2018 while semesters are in 2019
const BAD = { ...Y2019, id: "bad", yearStart: "2025-09-11", yearEnd: "2027-07-08", sem1Start: "2026-09-14", sem2End: "2027-07-08" };
const FEE = { id: "ft1", name: "School Fee", category: "TUITION", defaultUnitAmount: 1000, archivedAt: null };

function makeData({ years, schedules = [], installments = [] }) {
  const currentYear = years.find((y) => y.isCurrent);
  return {
    db: {
      academicYears: years, academicCalendar: currentYear, workspaceYear: currentYear, operationalYear: currentYear, feeTypes: [FEE], feeSchedules: schedules, feeInstallments: installments,
      studentFeeObligations: [], schoolClosures: [],
    },
    rolloutFeeTypeForYear: vi.fn(async () => ({ ok: true, message: "ok" })),
    updateFeeScheduleMonths: vi.fn(async () => ({ ok: true })),
    updateFeeScheduleGrades: vi.fn(async () => ({ ok: true })),
    saveAcademicCalendar: vi.fn(async () => ({ ok: true })),
    createAcademicYear: vi.fn(async () => ({ ok: true })),
    setCurrentAcademicYear: vi.fn(async () => ({ ok: true })),
  };
}

// Text of every month checkbox row ("Meskerem 2019 (September 2026)") currently on screen.
const MONTH_ROW = /\((January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\)/;
const monthRows = () => screen.queryAllByRole("checkbox")
  .map((c) => c.closest("label")?.textContent || "")
  .filter((t) => MONTH_ROW.test(t));

function openRollout() {
  render(<FeeSettingsModal open onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Roll Out for Year/ }));
}

beforeEach(() => { toastSpy.mockClear(); });
afterEach(() => { cleanup(); });

describe("Fee settings → Roll Out: months come from the selected academic year", () => {
  it("shows only the current academic year's months, with EC + GC labels and 'N of N academic months'", () => {
    ctx.data = makeData({ years: [Y2018, Y2019] });
    openRollout();
    const rows = monthRows();
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatch(/Meskerem 2019 \(September 2026\)/);
    expect(rows[9]).toMatch(/Sene 2019 \(June 2027\)/);
    expect(rows.some((r) => /2018/.test(r))).toBe(false); // previous academic year's months are not offered
    expect(screen.getByText("10 of 10 academic months selected")).toBeTruthy();
  });

  it("flags a month only partly inside the year, with its real date range", () => {
    // a year that starts on Meskerem 10 (20 Sep 2026) covers 21 of Meskerem's 30 days
    ctx.data = makeData({ years: [{ ...Y2019, yearStart: "2026-09-20", sem1Start: "2026-09-21" }] });
    openRollout();
    expect(screen.getByText(/Partial: .*20.*Sep.*2026.*10.*Oct.*2026/)).toBeTruthy();
  });

  it("a full Meskerem 1 -> Sene 30 year shows exactly 10 months, none partial, and no Hamle / Nehasse / 2018 month", () => {
    ctx.data = makeData({ years: [{ ...Y2019, yearEnd: "2027-07-07", sem2End: "2027-07-07" }] });
    openRollout();
    const rows = monthRows();
    expect(rows).toHaveLength(10);
    expect(rows[9]).toMatch(/Sene 2019 \(June 2027\)/);
    expect(rows.some((r) => /Partial/.test(r) || /Hamle|Nehasse|Pagumen|2018/.test(r))).toBe(false);
    expect(screen.getByText("10 of 10 academic months selected")).toBeTruthy();
  });

  it("selecting a different academic year in Fee Settings changes the available months", () => {
    ctx.data = makeData({ years: [Y2018, Y2019] });
    render(<FeeSettingsModal open onClose={() => {}} />);
    fireEvent.change(screen.getByDisplayValue(/2019-2020 E\.C\. \/ 2026-2027 G\.C\. — current/), { target: { value: "y2018" } });
    fireEvent.click(screen.getByRole("button", { name: /Roll Out for Year/ }));
    const rows = monthRows();
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatch(/Meskerem 2018 \(September 2025\)/);
    expect(rows.every((r) => !/2019|2026 |2027/.test(r.replace(/Partial:.*$/, "").replace("(June 2026)", "")))).toBe(true);
    expect(rows.some((r) => /September 2026/.test(r))).toBe(false);
  });

  it("roll-out is sent for the SELECTED academic year, restricted to that year's own months", async () => {
    ctx.data = makeData({ years: [Y2018, Y2019] });
    openRollout();
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.click(screen.getByText("Meskerem 2019 (September 2026)"));
    fireEvent.click(screen.getByText("Tikimt 2019 (October 2026)"));
    fireEvent.click(screen.getByText("Grade 9")); // a school fee needs at least one grade
    fireEvent.click(screen.getByRole("button", { name: /^Roll Out$/ }));
    await Promise.resolve();
    expect(ctx.data.rolloutFeeTypeForYear).toHaveBeenCalledTimes(1);
    const [feeTypeId, yearId, opts] = ctx.data.rolloutFeeTypeForYear.mock.calls[0];
    expect(feeTypeId).toBe("ft1");
    expect(yearId).toBe("y2019");
    expect(opts.billedMonths).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("an inconsistent year (start left in 2018) shows NO months, explains why, and can't be rolled out", () => {
    ctx.data = makeData({ years: [BAD] });
    openRollout();
    expect(monthRows()).toHaveLength(0);
    expect(screen.getByText(/dates need fixing before fees can be set up/)).toBeTruthy();
    expect(screen.getByText(/23 calendar months/)).toBeTruthy();
    expect(screen.getAllByText(/Meskerem 1, 2018/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Roll Out$/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Roll Out$/ }));
    expect(ctx.data.rolloutFeeTypeForYear).not.toHaveBeenCalled();
  });

  it("an already rolled-out fee keeps its months; billing outside the year's dates is preserved, listed and read-only", () => {
    const schedule = { id: "s1", feeTypeId: "ft1", academicYearId: "y2019", unitAmount: 1000, applicableGrades: ["Grade 9"] };
    const inst = (m, i) => ({ id: `i${i}`, feeScheduleId: "s1", sequenceIndex: i, periodMonth: `${m}-01`, dueDate: `${m}-01`, label: m });
    // Aug 2026 is billed (and possibly paid) but the year now starts in Sept 2026 → outside its dates
    ctx.data = makeData({ years: [Y2018, Y2019], schedules: [schedule], installments: ["2026-08", "2026-09", "2026-10"].map(inst) });
    openRollout();
    const rows = monthRows();
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => /August 2026/.test(r))).toBe(false); // not offered as a selectable month
    expect(screen.getByText("2 of 10 academic months selected")).toBeTruthy();
    expect(screen.getByText(/Already billed outside this academic year's dates: Nehasse 2018/)).toBeTruthy();
    expect(screen.getByText(/kept exactly as recorded/)).toBeTruthy();
    // nothing to save until the admin actually changes something
    expect(screen.getByRole("button", { name: /Save Changes/ }).disabled).toBe(true);
  });

  it("removing a billed month from an existing fee sends only in-year months to the server", async () => {
    const schedule = { id: "s1", feeTypeId: "ft1", academicYearId: "y2019", unitAmount: 1000, applicableGrades: ["Grade 9"] };
    const inst = (m, i) => ({ id: `i${i}`, feeScheduleId: "s1", sequenceIndex: i, periodMonth: `${m}-01`, dueDate: `${m}-01`, label: m });
    ctx.data = makeData({ years: [Y2019], schedules: [schedule], installments: ["2026-08", "2026-09", "2026-10", "2026-11"].map(inst) });
    openRollout();
    fireEvent.click(screen.getByText("Hidar 2019 (November 2026)")); // un-select November
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));
    await Promise.resolve();
    expect(ctx.data.updateFeeScheduleMonths).toHaveBeenCalledTimes(1);
    expect(ctx.data.updateFeeScheduleMonths.mock.calls[0]).toEqual(["s1", ["2026-09-01", "2026-10-01"]]);
  });
});

describe("Academic Calendar & Attendance: saving dates", () => {
  const openCalendar = (data) => { ctx.data = data; render(<AcademicCalendarSettingsModal open onClose={() => {}} />); };

  it("refuses to save a year whose start is left in the previous school year (the root cause), and saves nothing", async () => {
    openCalendar(makeData({ years: [BAD] }));
    fireEvent.click(screen.getByRole("button", { name: /Save Calendar/ }));
    await Promise.resolve();
    expect(ctx.data.saveAcademicCalendar).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/23 calendar months/), "error");
  });

  it("saves a consistent year", async () => {
    openCalendar(makeData({ years: [Y2019] }));
    fireEvent.click(screen.getByRole("button", { name: /Save Calendar/ }));
    await screen.findByRole("button", { name: /Save Calendar/ });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.data.saveAcademicCalendar).toHaveBeenCalledTimes(1);
    expect(ctx.data.saveAcademicCalendar.mock.calls[0][0]).toMatchObject({ yearStart: "2026-09-11", yearEnd: "2027-06-30" });
  });

  it("warns — and only saves after confirmation — when billed months would fall outside the new dates; nothing is deleted", async () => {
    const schedule = { id: "s1", feeTypeId: "ft1", academicYearId: "y2019", unitAmount: 1000, applicableGrades: null };
    const inst = (m, i) => ({ id: `i${i}`, feeScheduleId: "s1", sequenceIndex: i, periodMonth: `${m}-01`, dueDate: `${m}-01`, label: m });
    // Fees are billed through July 2027 but the calendar says the year ends 30 Jun 2027
    openCalendar(makeData({ years: [Y2019], schedules: [schedule], installments: ["2026-09", "2027-06", "2027-07"].map(inst) }));
    fireEvent.click(screen.getByRole("button", { name: /Save Calendar/ }));
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.data.saveAcademicCalendar).not.toHaveBeenCalled();
    const dialog = screen.getByText("Some billed months would fall outside this academic year");
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/Hamle 2019/)).toBeTruthy();
    expect(screen.getByText(/Nothing is deleted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save dates anyway" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.data.saveAcademicCalendar).toHaveBeenCalledTimes(1);
  });
});
