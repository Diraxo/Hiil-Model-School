// Semester result-lock messages must lead with the Ethiopian date and keep the Gregorian date
// secondary (Ethiopian Calendar is the school's primary calendar).
import { describe, it, expect } from "vitest";
import { classifySemesterResultLock, formatAcademicYearLabel, defaultAcademicCalendar, deriveAcademicYearLabels, academicYearStatus } from "../src/utils/academicCalendar";

const cal = {
  yearStart: "2026-09-01", yearEnd: "2027-08-07",
  sem1Start: "2026-09-14", sem1End: "2027-02-14",
  sem2Start: "2027-03-02", sem2End: "2027-08-02",
  resultFinalizationGraceDays: 7,
};

function expectEcFirst(message) {
  expect(message).toContain("E.C.");
  expect(message).toContain("G.C.");
  expect(message.indexOf("E.C.")).toBeLessThan(message.indexOf("G.C."));
}

describe("classifySemesterResultLock messages are EC-first", () => {
  it("S1 before it starts", () => {
    const r = classifySemesterResultLock("S1", cal, "2026-09-01");
    expect(r.phase).toBe("before_semester");
    expectEcFirst(r.message);
  });
  it("S1 grace expired", () => {
    const r = classifySemesterResultLock("S1", cal, "2027-02-27");
    expect(r.phase).toBe("grace_expired");
    expectEcFirst(r.message);
  });
  it("S2 before it starts", () => {
    const r = classifySemesterResultLock("S2", cal, "2027-02-20");
    expect(r.phase).toBe("before_semester");
    expectEcFirst(r.message);
  });
  it("S2 after the academic year ended", () => {
    const r = classifySemesterResultLock("S2", cal, "2027-08-20");
    expect(r.phase).toBe("year_ended");
    expectEcFirst(r.message);
  });
  it("S2 grace expired", () => {
    const r = classifySemesterResultLock("S2", { ...cal, yearEnd: "2027-09-30" }, "2027-08-20");
    expect(r.phase).toBe("grace_expired");
    expectEcFirst(r.message);
  });
});

describe("formatAcademicYearLabel", () => {
  it("shows 2019-2020 E.C. / 2026-2027 G.C. for a year starting 1 Sept 2026", () => {
    expect(formatAcademicYearLabel({ gcLabel: "2026-2027", yearStart: "2026-09-01" }))
      .toBe("2019-2020 E.C. / 2026-2027 G.C.");
  });
  it("ignores a stale stored ecLabel (rows saved before the label fix)", () => {
    expect(formatAcademicYearLabel({ gcLabel: "2026-2027", ecLabel: "2018-2019", yearStart: "2026-09-01" }))
      .toBe("2019-2020 E.C. / 2026-2027 G.C.");
  });
  it("still labels an earlier year correctly", () => {
    expect(formatAcademicYearLabel({ gcLabel: "2025-2026", ecLabel: "2018-2019", yearStart: "2025-09-11" }))
      .toBe("2018-2019 E.C. / 2025-2026 G.C.");
  });
  it("falls back to the stored ecLabel, then the G.C. label alone", () => {
    expect(formatAcademicYearLabel({ gcLabel: "2026-2027", ecLabel: "2019-2020" })).toBe("2019-2020 E.C. / 2026-2027 G.C.");
    expect(formatAcademicYearLabel({ gcLabel: "2026-2027" })).toBe("2026-2027");
    expect(formatAcademicYearLabel(null)).toBe("");
  });
});

describe("generated academic-year labels (dates are authoritative)", () => {
  it("derives both labels from the start/end dates", () => {
    expect(deriveAcademicYearLabels("2026-09-01", "2027-08-07")).toEqual({ gcLabel: "2026-2027", ecLabel: "2019-2020" });
  });
  it("uses a single G.C. year when start and end share one", () => {
    expect(deriveAcademicYearLabels("2026-09-01", "2026-12-30").gcLabel).toBe("2026");
  });
  it("formatAcademicYearLabel follows the dates over a stale stored gcLabel", () => {
    expect(formatAcademicYearLabel({ gcLabel: "2025-2026", ecLabel: "2018-2019", yearStart: "2026-09-01", yearEnd: "2027-08-07" }))
      .toBe("2019-2020 E.C. / 2026-2027 G.C.");
  });
  it("academicYearStatus is current / upcoming / previous", () => {
    expect(academicYearStatus({ isCurrent: true, yearStart: "2026-09-01" }, "2026-09-28")).toBe("current");
    expect(academicYearStatus({ isCurrent: false, yearStart: "2027-09-01" }, "2026-09-28")).toBe("upcoming");
    expect(academicYearStatus({ isCurrent: false, yearStart: "2025-09-01" }, "2026-09-28")).toBe("previous");
  });
});

describe("defaultAcademicCalendar", () => {
  it("does not change the academic-year dates, only the E.C. label", () => {
    const cal = defaultAcademicCalendar(new Date(2026, 8, 1));
    expect(cal.yearStart).toBe("2026-09-01");
    expect(cal.sem1Start).toBe("2026-09-01");
    expect(cal.gcLabel).toBe("2026-2027");
    expect(cal.ecLabel).toBe("2019-2020");
  });
  it("a year created from Meskerem 1 (the Create Year panel path) is labelled correctly", () => {
    const cal = defaultAcademicCalendar(new Date(2027, 8, 12)); // Meskerem 1, 2020 E.C.
    expect(cal.ecLabel).toBe("2020-2021");
  });
});
