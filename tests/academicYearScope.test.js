import { describe, expect, it } from "vitest";
import {
  academicYearLifecycle, academicYearAttention, resolveWorkspaceYear, buildAcademicYearScope,
  yearForDate, yearForBillingMonth, dateInYear, nextGrade, reenrollmentCandidates, enrolledStudentIds,
  suggestedNextEcYear, ENDING_SOON_DAYS,
} from "../src/utils/academicYearScope";
import { academicYearStatus, classifyAttendanceDate, classifySemesterResultLock, currentAcademicYear } from "../src/utils/academicCalendar";
import { gregorianToEthiopian } from "../src/utils/ethiopianCalendar";

// 2018 E.C. (history), 2019 E.C. (current), 2020 E.C. (being set up) — Meskerem 1 .. Sene 30 each.
const Y18 = { id: "y18", yearStart: "2025-09-11", yearEnd: "2026-07-07", sem1Start: "2025-09-11", sem1End: "2026-01-19", breakDays: 15, sem2Start: "2026-02-04", sem2End: "2026-07-07", resultFinalizationGraceDays: 15, isCurrent: false, closedAt: "2026-09-12T00:00:00Z" };
const Y19 = { id: "y19", yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-11", sem1End: "2027-01-19", breakDays: 15, sem2Start: "2027-02-04", sem2End: "2027-07-07", resultFinalizationGraceDays: 15, isCurrent: true, closedAt: null };
const Y20 = { id: "y20", yearStart: "2027-09-12", yearEnd: "2028-07-07", sem1Start: "2027-09-12", sem1End: "2028-01-19", breakDays: 15, sem2Start: "2028-02-04", sem2End: "2028-07-07", resultFinalizationGraceDays: 15, isCurrent: false, closedAt: null };
const YEARS = [Y18, Y19, Y20];

describe("academic year lifecycle (upcoming / current / previous)", () => {
  it("status comes from the stored lifecycle, not from today's date", () => {
    expect(academicYearStatus(Y19, "2026-09-28")).toBe("current");
    expect(academicYearStatus(Y18, "2026-09-28")).toBe("previous");
    expect(academicYearStatus(Y20, "2026-09-28")).toBe("upcoming");
    // a year created AFTER its start date passed is still upcoming until an admin activates it
    expect(academicYearStatus({ ...Y20, yearStart: "2026-01-01" }, "2026-09-28")).toBe("upcoming");
  });
  it("rows loaded before the closedAt column exists fall back to the old date rule", () => {
    const legacy = { isCurrent: false, yearStart: "2025-09-01" };
    expect(academicYearStatus(legacy, "2026-09-28")).toBe("previous");
    expect(academicYearStatus({ isCurrent: false, yearStart: "2027-09-01" }, "2026-09-28")).toBe("upcoming");
  });
  it("there is exactly one current year in the list", () => {
    expect(YEARS.filter((y) => academicYearStatus(y, "2026-09-28") === "current")).toHaveLength(1);
    expect(currentAcademicYear(YEARS).id).toBe("y19");
  });

  it("current year phases: active -> ending soon -> ended (finalizing) -> closed", () => {
    expect(academicYearLifecycle(Y19, "2026-12-01")).toMatchObject({ status: "current", phase: "active", closed: false, readOnly: false });
    const soon = academicYearLifecycle(Y19, "2027-06-20");
    expect(soon).toMatchObject({ phase: "ending_soon", closed: false });
    expect(soon.daysToEnd).toBeLessThanOrEqual(ENDING_SOON_DAYS);
    const ended = academicYearLifecycle(Y19, "2027-07-10");
    expect(ended).toMatchObject({ phase: "ended", closed: false, readOnly: false, finalizeUntil: "2027-07-22" });
    const closed = academicYearLifecycle(Y19, "2027-07-23");
    expect(closed).toMatchObject({ phase: "closed", closed: true, closeDate: "2027-07-22" });
  });
  it("the result-finalization grace period is part of the lifecycle (uses the year's own days)", () => {
    const short = { ...Y19, resultFinalizationGraceDays: 5 };
    expect(academicYearLifecycle(short, "2027-07-12")).toMatchObject({ phase: "ended", finalizeUntil: "2027-07-12" });
    expect(academicYearLifecycle(short, "2027-07-13")).toMatchObject({ phase: "closed", closeDate: "2027-07-12" });
  });
  it("a previous year is closed and read-only, with its closure date; nothing about it is hidden", () => {
    expect(academicYearLifecycle(Y18, "2026-09-28")).toMatchObject({ status: "previous", phase: "closed", closed: true, readOnly: true, closeDate: "2026-09-12" });
  });
  it("an upcoming year is editable (not read-only, not closed)", () => {
    expect(academicYearLifecycle(Y20, "2026-09-28")).toMatchObject({ status: "upcoming", phase: "upcoming", closed: false, readOnly: false });
  });

  it("admin banners: ending soon / ended / closed — and nothing for an ordinary year", () => {
    expect(academicYearAttention(Y19, "2026-12-01")).toBeNull();
    expect(academicYearAttention(Y19, "2027-06-20")).toMatchObject({ title: "Academic year ending soon" });
    expect(academicYearAttention(Y19, "2027-07-10")).toMatchObject({ title: "Academic year ended" });
    expect(academicYearAttention(Y19, "2027-08-01")).toMatchObject({ title: "Academic year closed", closeDate: "2027-07-22" });
    expect(academicYearAttention(Y18, "2026-09-28")).toBeNull(); // history needs no attention
    expect(academicYearAttention(Y20, "2026-09-28")).toBeNull();
  });
});

describe("a closed year is read-only across attendance and results", () => {
  const closedCal = { ...Y18, readOnly: true };
  it("attendance can't be recorded in a read-only year, whatever the date", () => {
    const r = classifyAttendanceDate("2025-10-06", closedCal, "2026-09-28", {});
    expect(r).toMatchObject({ available: false, phase: "year_closed", label: "Academic Year Closed" });
    // the same date in a writable calendar object is a normal school day
    expect(classifyAttendanceDate("2025-10-06", Y18, "2026-09-28", {}).available).toBe(true);
  });
  it("results are locked in a read-only year even inside what would be a grace window", () => {
    const lock = classifySemesterResultLock("S1", { ...Y18, readOnly: true }, "2026-02-05");
    expect(lock).toMatchObject({ locked: true, phase: "year_closed" });
  });
  it("the grace period still works for the operational year: editable for N days after a semester ends", () => {
    expect(classifySemesterResultLock("S1", Y19, "2027-01-25")).toMatchObject({ locked: false, phase: "grace_period", daysRemaining: expect.any(Number) });
    expect(classifySemesterResultLock("S1", Y19, "2027-02-10").locked).toBe(true); // Semester 2 has begun
    // Semester 2 ends 20 June here, so its 15-day window runs to 5 July (before the year's own end)
    const earlyS2 = { ...Y19, sem2End: "2027-06-20" };
    expect(classifySemesterResultLock("S2", earlyS2, "2027-06-25")).toMatchObject({ locked: false, phase: "grace_period", windowEnds: "2027-07-05" });
    expect(classifySemesterResultLock("S2", earlyS2, "2027-07-06")).toMatchObject({ locked: true, phase: "grace_expired" });
    // when Semester 2 runs to the last day of the year, the year's end is the hard boundary (existing rule)
    expect(classifySemesterResultLock("S2", Y19, "2027-07-08")).toMatchObject({ locked: true, phase: "year_ended" });
  });
});

describe("the workspace scope: one selected year drives everything", () => {
  const today = "2026-09-28";
  it("with no selection the workspace is the operational year", () => {
    const scope = buildAcademicYearScope({ years: YEARS, selectedId: null, todayKey: today });
    expect(scope.selectedAcademicYear.id).toBe("y19");
    expect(scope.currentAcademicYear.id).toBe("y19");
    expect(scope).toMatchObject({ isCurrentYear: true, isReadOnlyYear: false, isClosedYear: false });
    expect(scope.academicYears.map((y) => y.id)).toEqual(["y20", "y19", "y18"]); // newest first
  });
  it("selecting a previous year changes the WHOLE context: year, periods, read-only flag, status", () => {
    const now = buildAcademicYearScope({ years: YEARS, selectedId: "y19", todayKey: today });
    const past = buildAcademicYearScope({ years: YEARS, selectedId: "y18", todayKey: today });
    expect(past.selectedAcademicYear.id).toBe("y18");
    expect(past.currentAcademicYear.id).toBe("y19"); // the operational year did not move
    expect(past).toMatchObject({ isCurrentYear: false, isReadOnlyYear: true, isClosedYear: true });
    expect(past.academicYearStatus.status).toBe("previous");
    // periods come from the selected year only — no month of the other year leaks in
    expect(now.academicPeriods.map((p) => p.ecLabel)[0]).toBe("Meskerem 2019");
    expect(past.academicPeriods.map((p) => p.ecLabel)[0]).toBe("Meskerem 2018");
    const nowKeys = new Set(now.academicPeriods.map((p) => p.monthKey));
    expect(past.academicPeriods.filter((p) => nowKeys.has(p.monthKey))).toEqual([]);
    expect(now.academicPeriods).toHaveLength(10);
    expect(past.academicPeriods).toHaveLength(10);
  });
  it("switching back to the current year restores the original context", () => {
    const a = buildAcademicYearScope({ years: YEARS, selectedId: "y19", todayKey: today });
    const b = buildAcademicYearScope({ years: YEARS, selectedId: "y18", todayKey: today });
    const c = buildAcademicYearScope({ years: YEARS, selectedId: "y19", todayKey: today });
    expect(b.selectedAcademicYear.id).not.toBe(a.selectedAcademicYear.id);
    expect(c).toEqual(a);
  });
  it("a selection that names no real year falls back to the current year (never to today's date)", () => {
    expect(resolveWorkspaceYear(YEARS, "does-not-exist").id).toBe("y19");
    expect(resolveWorkspaceYear([], "y18")).toBeNull();
  });
  it("an upcoming year can be viewed while it is set up, and is editable", () => {
    const up = buildAcademicYearScope({ years: YEARS, selectedId: "y20", todayKey: today });
    expect(up).toMatchObject({ isCurrentYear: false, isReadOnlyYear: false });
    expect(up.academicYearStatus.status).toBe("upcoming");
  });
  it("an inconsistent year yields no periods and says why, instead of showing another year's months", () => {
    const bad = { ...Y19, id: "bad", yearStart: "2025-09-11", yearEnd: "2027-07-08", sem1Start: "2026-09-14" };
    const scope = buildAcademicYearScope({ years: [bad], selectedId: "bad", todayKey: today });
    expect(scope.academicPeriods).toEqual([]);
    expect(scope.academicPeriodsValid).toBe(false);
    expect(scope.academicPeriodProblems.length).toBeGreaterThan(0);
  });
});

describe("assigning date-keyed and month-keyed records to a year", () => {
  it("yearForDate: an attendance date belongs to exactly the year whose dates contain it", () => {
    expect(yearForDate(YEARS, "2025-10-06").id).toBe("y18");
    expect(yearForDate(YEARS, "2026-10-06").id).toBe("y19");
    expect(yearForDate(YEARS, "2026-08-15")).toBeNull(); // the summer break belongs to no year
  });
  it("yearForDate prefers the current year when bad data overlaps two years", () => {
    const overlap = { ...Y18, id: "o", yearEnd: "2027-07-08", closedAt: null };
    expect(yearForDate([overlap, Y19], "2026-10-06").id).toBe("y19");
  });
  it("yearForBillingMonth: a payroll / fee month belongs to the year whose Ethiopian months include it", () => {
    expect(yearForBillingMonth(YEARS, "2026-10").id).toBe("y19");
    expect(yearForBillingMonth(YEARS, "2025-10").id).toBe("y18");
    expect(yearForBillingMonth(YEARS, "2027-07")).toBeNull(); // Hamle: not a period of any year
    expect(yearForBillingMonth(YEARS, "2027-10").id).toBe("y20");
  });
  it("dateInYear", () => {
    expect(dateInYear(Y19, "2026-09-11")).toBe(true);
    expect(dateInYear(Y19, "2027-07-08")).toBe(false);
    expect(dateInYear(null, "2026-09-11")).toBe(false);
  });
});

describe("re-enrollment: students persist, enrollments belong to a year", () => {
  const students = [
    { id: "s1", firstName: "Ahmed", grade: "Grade 2", status: "ACTIVE" },
    { id: "s2", firstName: "Aisha", grade: "KG2", status: "ACTIVE" },
    { id: "s3", firstName: "Grad", grade: "Grade 12", status: "ACTIVE" },
    { id: "s4", firstName: "Left", grade: "Grade 4", status: "ACTIVE" },
  ];
  const enr = (studentId, academicYearId, grade, status = "ACTIVE", section = "A") => ({ id: `${studentId}-${academicYearId}`, studentId, academicYearId, grade, section, status });
  const enrollments = [
    enr("s1", "y19", "Grade 2"), enr("s2", "y19", "KG2", "ACTIVE", "B"), enr("s3", "y19", "Grade 12", "GRADUATED"), enr("s4", "y19", "Grade 4", "WITHDRAWN"),
    enr("s1", "y18", "Grade 1"),
  ];

  it("lists the previous year's students still on the roll — graduated / withdrawn ones are not candidates", () => {
    const c = reenrollmentCandidates({ students, enrollments, decisions: [], sourceYearId: "y19", targetYearId: "y20" });
    expect(c.map((x) => x.student.id).sort()).toEqual(["s1", "s2"]);
    expect(c.every((x) => x.decision === "PENDING")).toBe(true);
  });
  it("suggests the next grade (repeating is a choice the admin makes), keeping the section", () => {
    const c = reenrollmentCandidates({ students, enrollments, decisions: [], sourceYearId: "y19", targetYearId: "y20" });
    expect(c.find((x) => x.student.id === "s1")).toMatchObject({ suggestedGrade: "Grade 3", suggestedSection: "A" });
    expect(c.find((x) => x.student.id === "s2")).toMatchObject({ suggestedGrade: "Grade 1", suggestedSection: "B" });
    expect(nextGrade("Grade 12")).toBe("Grade 12");
    expect(nextGrade("Something else")).toBe("Something else");
  });
  it("REGISTERED once an enrollment exists for the new year; the earlier enrollments are untouched", () => {
    const withNew = [...enrollments, enr("s1", "y20", "Grade 3")];
    const before = JSON.stringify(enrollments);
    const c = reenrollmentCandidates({ students, enrollments: withNew, decisions: [], sourceYearId: "y19", targetYearId: "y20" });
    expect(c.find((x) => x.student.id === "s1")).toMatchObject({ decision: "REGISTERED", target: { grade: "Grade 3" } });
    expect(JSON.stringify(enrollments)).toBe(before); // pure: nothing was mutated
    expect(withNew.filter((e) => e.studentId === "s1")).toHaveLength(3); // 2018, 2019, 2020 — one person, three enrollments
  });
  it("NOT_RETURNING is a decision about the year: the student stays in the list of students and keeps their history", () => {
    const decisions = [{ studentId: "s2", academicYearId: "y20", decision: "NOT_RETURNING", reason: "Moved" }];
    const c = reenrollmentCandidates({ students, enrollments, decisions, sourceYearId: "y19", targetYearId: "y20" });
    expect(c.find((x) => x.student.id === "s2")).toMatchObject({ decision: "NOT_RETURNING", target: null });
    expect(students.find((s) => s.id === "s2")).toBeTruthy();           // never removed
    expect(enrollments.some((e) => e.studentId === "s2" && e.academicYearId === "y19")).toBe(true);
    // a decision made for a DIFFERENT year does not carry over
    const other = [{ studentId: "s2", academicYearId: "y21", decision: "NOT_RETURNING" }];
    expect(reenrollmentCandidates({ students, enrollments, decisions: other, sourceYearId: "y19", targetYearId: "y20" }).find((x) => x.student.id === "s2").decision).toBe("PENDING");
  });
  it("a student who returns later is one person: registering finds the existing student, it never creates a second", () => {
    const decisions = [{ studentId: "s2", academicYearId: "y20", decision: "NOT_RETURNING" }];
    const registered = [...enrollments, enr("s2", "y20", "Grade 1", "ACTIVE", "B")];
    // once registered, the (stale) decision no longer wins
    const c = reenrollmentCandidates({ students, enrollments: registered, decisions, sourceYearId: "y19", targetYearId: "y20" });
    expect(c.find((x) => x.student.id === "s2").decision).toBe("REGISTERED");
    expect(students.filter((s) => s.firstName === "Aisha")).toHaveLength(1);
  });
  it("enrolledStudentIds is the roster of one year", () => {
    expect([...enrolledStudentIds(enrollments, "y18")]).toEqual(["s1"]);
    expect(enrolledStudentIds(enrollments, "y20").size).toBe(0);
  });
});

describe("creating the next year", () => {
  it("suggests the E.C. year after the latest year ENDS in — robust to a wrong start date", () => {
    expect(suggestedNextEcYear(YEARS.filter((y) => y.id !== "y20"), (d) => gregorianToEthiopian(d))).toBe(2020);
    const bad = { ...Y19, yearStart: "2025-09-11", yearEnd: "2027-07-08" }; // start left in 2018
    expect(suggestedNextEcYear([bad], (d) => gregorianToEthiopian(d))).toBe(2020);
    expect(suggestedNextEcYear([], (d) => gregorianToEthiopian(d), new Date(2026, 8, 28))).toBe(2019);
  });
});
