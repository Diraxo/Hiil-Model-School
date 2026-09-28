import { describe, expect, it } from "vitest";
import {
  academicYearBillingPeriods, academicYearDateProblems, anchorsOutsideYear,
  MAX_ACADEMIC_YEAR_DAYS, MAX_SEM1_START_OFFSET_DAYS,
} from "../src/utils/billingPeriods";
import { defaultAcademicCalendar, currentAcademicYear } from "../src/utils/academicCalendar";
import { ethiopianToGregorianKey, ethiopianMonthLabelForGcMonthKey } from "../src/utils/ethiopianCalendar";

// 2019 E.C. (2026-27 G.C.): Meskerem 1, 2019 = 11 Sep 2026.
const Y2019 = { id: "y2019", yearStart: "2026-09-11", yearEnd: "2027-06-30", sem1Start: "2026-09-14", isCurrent: true };
// 2018 E.C. (2025-26 G.C.): Meskerem 1, 2018 = 11 Sep 2025.
const Y2018 = { id: "y2018", yearStart: "2025-09-11", yearEnd: "2026-06-30", sem1Start: "2025-09-15", isCurrent: false };
// The inconsistent production row: start left in Meskerem 1, 2018, everything else in 2019.
const BAD = { id: "bad", yearStart: "2025-09-11", yearEnd: "2027-07-08", sem1Start: "2026-09-14", isCurrent: true };

describe("the fee's month picker comes from the selected academic year", () => {
  it("the current academic year only produces its own periods", () => {
    const { valid, periods } = academicYearBillingPeriods(Y2019);
    expect(valid).toBe(true);
    expect(periods.map((p) => p.monthKey)).toEqual([
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
    ]);
    expect(periods.every((p) => p.anchor === `${p.monthKey}-01`)).toBe(true);
  });

  it("previous academic-year months are not shown", () => {
    const keys = academicYearBillingPeriods(Y2019).periods.map((p) => p.monthKey);
    expect(keys.some((k) => k < "2026-09")).toBe(false);
    expect(keys.some((k) => k.startsWith("2025"))).toBe(false);
    expect(academicYearBillingPeriods(Y2019).periods.some((p) => /2018/.test(p.label))).toBe(false);
  });

  it("every period sits inside the year's dates and never outside them", () => {
    for (const y of [Y2018, Y2019]) {
      const { periods } = academicYearBillingPeriods(y);
      for (const p of periods) {
        expect(p.start >= y.yearStart && p.end <= y.yearEnd).toBe(true);
        expect(p.start <= p.end).toBe(true);
        expect(p.start.slice(0, 7)).toBe(p.monthKey);
      }
    }
  });

  it("changing the selected academic year changes the available periods", () => {
    const years = [Y2018, Y2019];
    const pick = (id) => academicYearBillingPeriods(years.find((y) => y.id === id)).periods.map((p) => p.monthKey);
    expect(pick("y2018")[0]).toBe("2025-09");
    expect(pick("y2019")[0]).toBe("2026-09");
    expect(pick("y2018").filter((k) => pick("y2019").includes(k))).toEqual([]);
  });

  it("creating a new academic year produces periods from ITS dates", () => {
    const start = ethiopianToGregorianKey(2020, 1, 1); // Meskerem 1, 2020 E.C.
    expect(start).toBe("2027-09-12");
    const cal = defaultAcademicCalendar(new Date(start + "T00:00:00"));
    const { valid, periods } = academicYearBillingPeriods(cal);
    expect(valid).toBe(true);
    expect(periods[0].monthKey).toBe("2027-09");
    expect(periods.every((p) => p.monthKey >= "2027-09" && p.monthKey <= cal.yearEnd.slice(0, 7))).toBe(true);
    expect(periods.some((p) => p.monthKey < "2027-09")).toBe(false);
    // the old years' months are nowhere in it
    const old = academicYearBillingPeriods(Y2019).periods.map((p) => p.monthKey);
    expect(periods.filter((p) => old.includes(p.monthKey))).toEqual([]);
  });

  it("the default calendar for any September start is itself a valid single school year", () => {
    for (const y of [2025, 2026, 2027, 2028, 2029]) {
      const cal = defaultAcademicCalendar(new Date(y, 8, 1));
      expect(academicYearDateProblems(cal)).toEqual([]);
      // Meskerem .. Sene: the default year ends on Sene 30, whatever September day it starts on
      const { periods } = academicYearBillingPeriods(cal);
      expect(periods).toHaveLength(10);
      expect(periods[0].ecMonth).toBe(1);
      expect(periods.at(-1).ecMonth).toBe(10);
    }
  });

  it("only the current year's periods are used when the list also holds a previous year", () => {
    const cur = currentAcademicYear([Y2018, Y2019]);
    expect(cur.id).toBe("y2019");
    expect(academicYearBillingPeriods(cur).periods).toHaveLength(10);
  });
});

describe("Ethiopian + Gregorian labels stay correct", () => {
  it("labels each period EC-first with the Gregorian month alongside", () => {
    const { periods } = academicYearBillingPeriods(Y2019);
    expect(periods[0]).toMatchObject({ ecLabel: "Meskerem 2019", gcLabel: "September 2026", label: "Meskerem 2019 (September 2026)" });
    expect(periods[4].label).toBe("Tir 2019 (January 2027)");
    expect(periods[9].label).toBe("Sene 2019 (June 2027)");
  });

  it("2018 E.C. months carry 2018 labels only in the 2018 year", () => {
    const labels = academicYearBillingPeriods(Y2018).periods.map((p) => p.ecLabel);
    expect(labels[0]).toBe("Meskerem 2018");
    expect(labels.every((l) => /2018$/.test(l))).toBe(true); // Sept 2025 .. June 2026 are all E.C. 2018
    expect(academicYearBillingPeriods(Y2019).periods.some((p) => /2018$/.test(p.ecLabel))).toBe(false);
  });
});

describe("a period is an Ethiopian month the year covers at least half of (billed, and flagged when partial)", () => {
  it("Meskerem 1 -> Sene 30, 2019 E.C. is exactly the 10 months Meskerem .. Sene", () => {
    const y = { yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-14" };
    const { valid, periods } = academicYearBillingPeriods(y);
    expect(valid).toBe(true);
    expect(periods.map((p) => p.ecLabel)).toEqual([
      "Meskerem 2019", "Tikimt 2019", "Hidar 2019", "Tahsas 2019", "Tir 2019", "Yekatit 2019", "Megabit 2019", "Miyazya 2019", "Ginbot 2019", "Sene 2019",
    ]);
    expect(periods.every((p) => !p.partial)).toBe(true); // every month is covered in full
    expect(periods[0]).toMatchObject({ start: "2026-09-11", end: "2026-10-10", anchor: "2026-09-01" });
    expect(periods[9]).toMatchObject({ start: "2027-06-08", end: "2027-07-07", anchor: "2027-06-01" });
  });
  it("a Sept 1 start (Nehasse 26 of the previous E.C. year) does not drag in Nehasse or Pagumen", () => {
    const { periods } = academicYearBillingPeriods({ yearStart: "2026-09-01", yearEnd: "2027-07-07", sem1Start: "2026-09-01" });
    expect(periods[0].ecLabel).toBe("Meskerem 2019");
    expect(periods.some((p) => /2018/.test(p.ecLabel) || /Nehasse|Pagumen/.test(p.ecLabel))).toBe(false);
    expect(periods).toHaveLength(10);
  });
  it("a stray Hamle 1 end (the production row) does not add an 11th month; a real Hamle 20 does", () => {
    expect(academicYearBillingPeriods({ yearStart: "2026-09-11", yearEnd: "2027-07-08", sem1Start: "2026-09-14" }).periods).toHaveLength(10);
    const long = academicYearBillingPeriods({ yearStart: "2026-09-11", yearEnd: "2027-07-27", sem1Start: "2026-09-14" }).periods;
    expect(long).toHaveLength(11);
    expect(long.at(-1)).toMatchObject({ ecLabel: "Hamle 2019", partial: true, end: "2027-07-27" });
  });
  it("a year starting mid-Meskerem still bills Meskerem, clipped to the start date and flagged partial", () => {
    const [first, second] = academicYearBillingPeriods({ yearStart: "2026-09-20", yearEnd: "2027-07-07", sem1Start: "2026-09-21" }).periods;
    expect(first).toMatchObject({ ecLabel: "Meskerem 2019", start: "2026-09-20", end: "2026-10-10", partial: true });
    expect(second).toMatchObject({ ecLabel: "Tikimt 2019", partial: false });
  });
  it("less than half a month is not a billing period (a year that starts on Meskerem 20 skips Meskerem)", () => {
    const { periods } = academicYearBillingPeriods({ yearStart: "2026-09-30", yearEnd: "2027-07-07", sem1Start: "2026-10-01" });
    expect(periods[0].ecLabel).toBe("Tikimt 2019");
  });
  it("a year ending mid-month clips the last period to the end date", () => {
    const last = academicYearBillingPeriods({ yearStart: "2026-09-11", yearEnd: "2027-06-25", sem1Start: "2026-09-14" }).periods.at(-1);
    expect(last).toMatchObject({ ecLabel: "Sene 2019", start: "2027-06-08", end: "2027-06-25", partial: true });
  });
  it("the anchor month of each period carries that period's own Ethiopian label (SQL uses the same convention)", () => {
    const { periods } = academicYearBillingPeriods({ yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-14" });
    for (const p of periods) expect(ethiopianMonthLabelForGcMonthKey(p.monthKey)).toBe(p.ecLabel);
  });
});

describe("the inconsistent year (2018 start, 2019 semesters) is refused, not shown", () => {
  it("reports the mistake and generates NO periods — old months are not offered", () => {
    const r = academicYearBillingPeriods(BAD);
    expect(r.valid).toBe(false);
    expect(r.periods).toEqual([]);
    expect(r.problems.map((p) => p.code)).toEqual(["span_too_long", "semester1_far_from_start"]);
  });
  it("explains it in Ethiopian dates, so the admin can see which date is wrong", () => {
    const [span, sem] = academicYearBillingPeriods(BAD).problems;
    expect(span.message).toMatch(/Meskerem 1, 2018/);
    expect(span.message).toMatch(/23 calendar months/);
    expect(sem.message).toMatch(/Meskerem 4, 2019/);
  });
  it("is fixed by moving the start to Meskerem 1, 2019 and the end to Sene 30 (10 months, no 2018 month)", () => {
    const fixed = { ...BAD, yearStart: ethiopianToGregorianKey(2019, 1, 1), yearEnd: ethiopianToGregorianKey(2019, 10, 30) };
    expect(fixed.yearStart).toBe("2026-09-11");
    expect(fixed.yearEnd).toBe("2027-07-07");
    const { valid, periods } = academicYearBillingPeriods(fixed);
    expect(valid).toBe(true);
    expect(periods).toHaveLength(10); // Sep 2026 .. Jun 2027 (Meskerem 2019 .. Sene 2019)
    expect(periods[0].ecLabel).toBe("Meskerem 2019");
    expect(periods.at(-1).ecLabel).toBe("Sene 2019");
    expect(periods.some((p) => /2018/.test(p.label))).toBe(false);
  });
});

describe("academicYearDateProblems", () => {
  it("accepts a normal year", () => expect(academicYearDateProblems(Y2019)).toEqual([]));
  it("flags missing dates and end-before-start", () => {
    expect(academicYearDateProblems({}).map((p) => p.code)).toEqual(["missing_dates"]);
    expect(academicYearDateProblems({ yearStart: "2027-01-01", yearEnd: "2026-01-01" }).map((p) => p.code)).toEqual(["start_after_end"]);
  });
  it("the limits are a school year plus slack", () => {
    expect(MAX_ACADEMIC_YEAR_DAYS).toBeGreaterThanOrEqual(366);
    expect(MAX_SEM1_START_OFFSET_DAYS).toBeGreaterThanOrEqual(31);
    expect(academicYearDateProblems({ yearStart: "2026-09-11", yearEnd: "2027-10-15" })).toEqual([]); // 13 months is still fine
    expect(academicYearDateProblems({ yearStart: "2026-09-11", yearEnd: "2027-12-01" }).map((p) => p.code)).toEqual(["span_too_long"]);
  });
});

describe("changing a year's dates never silently drops billed months", () => {
  it("anchorsOutsideYear lists the billed months the new dates would leave outside the year", () => {
    const billed = ["2026-09-01", "2026-10-01", "2027-06-01"];
    expect(anchorsOutsideYear({ yearStart: "2026-10-15", yearEnd: "2027-06-30" }, billed)).toEqual(["2026-09-01"]);
    expect(anchorsOutsideYear({ yearStart: "2026-09-11", yearEnd: "2027-05-31" }, billed)).toEqual(["2027-06-01"]);
    expect(anchorsOutsideYear({ yearStart: "2026-09-11", yearEnd: "2027-06-30" }, billed)).toEqual([]);
  });
  it("deduplicates and sorts, and tolerates junk", () => {
    expect(anchorsOutsideYear({ yearStart: "2026-10-15", yearEnd: "2027-06-30" }, ["2026-09-01", "2026-09-01", "2025-09-01"])).toEqual(["2025-09-01", "2026-09-01"]);
    expect(anchorsOutsideYear(null, ["2026-09-01"])).toEqual([]);
    expect(anchorsOutsideYear({ yearStart: "2026-09-11", yearEnd: "2027-06-30" }, null)).toEqual([]);
  });
});
