// Verifies the Ethiopian calendar conversion engine (src/utils/ethiopianCalendar.js), which is
// the single source of truth for EC<->GC conversion used across academic years, enrollment,
// fees, payments, payroll, and attendance display.
import { describe, it, expect } from "vitest";
import {
  ETHIOPIAN_MONTHS,
  isEthiopianLeapYear,
  isGregorianLeapYear,
  newYearInGregorianYear,
  gregorianToEthiopian,
  ethiopianToGregorian,
  getEthiopianToday,
  ethiopianMonthName,
  formatEthiopianDate,
  ecYearLabelForGcStart,
  daysInEthiopianMonth,
  ethiopianMonthLabelForGcMonthKey,
} from "../src/utils/ethiopianCalendar";

describe("Ethiopian months", () => {
  it("has exactly 13 months, Meskerem through Pagumen", () => {
    expect(ETHIOPIAN_MONTHS).toHaveLength(13);
    expect(ETHIOPIAN_MONTHS[0].en).toBe("Meskerem");
    expect(ETHIOPIAN_MONTHS[12].en).toBe("Pagumen");
  });

  it("month numbering: 1 = Meskerem ... 13 = Pagumen", () => {
    const names = ["Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit", "Megabit",
      "Miyazya", "Ginbot", "Sene", "Hamle", "Nehasse", "Pagumen"];
    names.forEach((name, i) => {
      expect(ethiopianMonthName(i + 1, { withAmharic: false })).toBe(name);
    });
  });

  it("includes the Amharic name alongside the English transliteration", () => {
    expect(ethiopianMonthName(1)).toBe("Meskerem (መስከረም)");
    expect(ethiopianMonthName(13)).toBe("Pagumen (ጳጉሜን)");
  });
});

describe("Ethiopian leap year", () => {
  it("matches the documented rule: leap the year before a Gregorian leap year", () => {
    // 2024, 2028 are Gregorian leap years -> EC 2015, 2019 are Ethiopian leap years.
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect(isEthiopianLeapYear(2019)).toBe(true);
    expect(isEthiopianLeapYear(2016)).toBe(false);
    expect(isEthiopianLeapYear(2017)).toBe(false);
    expect(isEthiopianLeapYear(2018)).toBe(false);
  });

  it("is equivalent to ethYear % 4 === 3", () => {
    for (let y = 1990; y <= 2040; y++) {
      expect(isEthiopianLeapYear(y)).toBe(((y % 4) + 4) % 4 === 3);
    }
  });
});

describe("Pagumen (13th month)", () => {
  it("has 6 days in a leap year and 5 in a non-leap year", () => {
    // EC 2015 is leap -> Pagumen 6 exists; EC 2016 is not -> Pagumen 6 must roll into Meskerem 1.
    const pag6of2015 = ethiopianToGregorian(2015, 13, 6);
    const meskerem1of2016 = ethiopianToGregorian(2016, 1, 1);
    expect((meskerem1of2016 - pag6of2015) / 86400000).toBe(1);

    const pag5of2016 = ethiopianToGregorian(2016, 13, 5);
    const meskerem1of2017 = ethiopianToGregorian(2017, 1, 1);
    expect((meskerem1of2017 - pag5of2016) / 86400000).toBe(1);
  });
});

describe("Known real-world anchors", () => {
  it("Ethiopian Millennium: Meskerem 1, 2000 EC = 12 September 2007 GC", () => {
    const gc = ethiopianToGregorian(2000, 1, 1);
    expect(gc.getFullYear()).toBe(2007);
    expect(gc.getMonth()).toBe(8); // September
    expect(gc.getDate()).toBe(12);

    const ec = gregorianToEthiopian(new Date(2007, 8, 12));
    expect(ec).toEqual({ year: 2000, month: 1, day: 1 });
  });

  it("Meskerem 1, 2018 EC = 11 September 2025 GC (2025 is not the year before a leap year)", () => {
    const gc = ethiopianToGregorian(2018, 1, 1);
    expect(gc.getFullYear()).toBe(2025);
    expect(gc.getMonth()).toBe(8);
    expect(gc.getDate()).toBe(11);
  });

  it("Ethiopian Christmas: Tahsas 29 = 7 January (Gregorian)", () => {
    const gc = ethiopianToGregorian(2018, 4, 29);
    expect(gc.getFullYear()).toBe(2026);
    expect(gc.getMonth()).toBe(0); // January
    expect(gc.getDate()).toBe(7);
  });
});

describe("Round-trip conversion (GC -> EC -> GC)", () => {
  it("recovers the exact same date for every day from 2000-01-01 to 2030-01-01", () => {
    let mismatches = 0;
    for (let t = new Date(2000, 0, 1).getTime(); t <= new Date(2030, 0, 1).getTime(); t += 86400000) {
      const d = new Date(t);
      const ec = gregorianToEthiopian(d);
      const back = ethiopianToGregorian(ec.year, ec.month, ec.day);
      if (back.getTime() !== d.getTime()) mismatches++;
      // Month/day must always be structurally valid.
      expect(ec.month).toBeGreaterThanOrEqual(1);
      expect(ec.month).toBeLessThanOrEqual(13);
      if (ec.month <= 12) {
        expect(ec.day).toBeGreaterThanOrEqual(1);
        expect(ec.day).toBeLessThanOrEqual(30);
      } else {
        expect(ec.day).toBeGreaterThanOrEqual(1);
        expect(ec.day).toBeLessThanOrEqual(isEthiopianLeapYear(ec.year) ? 6 : 5);
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe("Round-trip conversion (EC -> GC -> EC)", () => {
  it("recovers the exact same Ethiopian date for every day of every month (incl. Pagumen) across EC 1993-2023", () => {
    let mismatches = 0;
    for (let y = 1993; y <= 2023; y++) {
      const leap = isEthiopianLeapYear(y);
      for (let m = 1; m <= 13; m++) {
        const maxDay = m <= 12 ? 30 : (leap ? 6 : 5);
        for (let d = 1; d <= maxDay; d++) {
          const gc = ethiopianToGregorian(y, m, d);
          const back = gregorianToEthiopian(gc);
          if (back.year !== y || back.month !== m || back.day !== d) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe("getEthiopianToday", () => {
  it("returns a structurally valid Ethiopian date derived from the real system clock", () => {
    const today = getEthiopianToday();
    const expected = gregorianToEthiopian(new Date());
    expect(today).toEqual(expected);
    expect(today.month).toBeGreaterThanOrEqual(1);
    expect(today.month).toBeLessThanOrEqual(13);
  });
});

describe("formatEthiopianDate", () => {
  it("formats as 'Month day, year'", () => {
    expect(formatEthiopianDate({ year: 2018, month: 1, day: 12 })).toBe("Meskerem 12, 2018");
  });

  it("includes the Amharic name when requested", () => {
    expect(formatEthiopianDate({ year: 2018, month: 1, day: 12 }, { withAmharic: true }))
      .toBe("Meskerem (መስከረም) 12, 2018");
  });
});

describe("Academic year EC label", () => {
  it("derives the EC year label from a Gregorian school-year start date", () => {
    // A school year starting 1 September 2026 (GC) falls in EC year 2019 (New Year is 11 Sept 2026).
    expect(ecYearLabelForGcStart(new Date(2026, 8, 1))).toBe("2018-2019");
    // A school year starting after the EC New Year (e.g. mid-September) falls in the new EC year.
    expect(ecYearLabelForGcStart(new Date(2026, 8, 15))).toBe("2019-2020");
  });
});

describe("Gregorian leap year / New Year boundary", () => {
  it("New Year is 12 September in the Gregorian year before a Gregorian leap year", () => {
    expect(isGregorianLeapYear(2028)).toBe(true);
    const ny = newYearInGregorianYear(2027);
    expect(ny.getMonth()).toBe(8);
    expect(ny.getDate()).toBe(12);
  });

  it("New Year is 11 September otherwise", () => {
    expect(isGregorianLeapYear(2026)).toBe(false);
    const ny = newYearInGregorianYear(2025);
    expect(ny.getMonth()).toBe(8);
    expect(ny.getDate()).toBe(11);
  });
});

// Phase 2: Enrollment, Fees, Payments, Payroll, Attendance all build on these two helpers.
describe("daysInEthiopianMonth", () => {
  it("is 30 for every month 1-12, in both leap and non-leap years", () => {
    for (let m = 1; m <= 12; m++) {
      expect(daysInEthiopianMonth(2015, m)).toBe(30); // 2015 is leap
      expect(daysInEthiopianMonth(2016, m)).toBe(30); // 2016 is not
    }
  });

  it("Pagumen (13) is 6 days in an Ethiopian leap year, 5 otherwise", () => {
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect(daysInEthiopianMonth(2015, 13)).toBe(6);
    expect(isEthiopianLeapYear(2016)).toBe(false);
    expect(daysInEthiopianMonth(2016, 13)).toBe(5);
  });
});

describe("ethiopianMonthLabelForGcMonthKey", () => {
  it("maps each Gregorian civil month to its conventional Ethiopian equivalent", () => {
    // 2025-09 (September 2025) -> Meskerem 2018; 2025-10 -> Tikimt 2018; ... 2026-08 -> Nehasse 2018.
    const expected = [
      ["2025-09", "Meskerem 2018"], ["2025-10", "Tikimt 2018"], ["2025-11", "Hidar 2018"],
      ["2025-12", "Tahsas 2018"], ["2026-01", "Tir 2018"], ["2026-02", "Yekatit 2018"],
      ["2026-03", "Megabit 2018"], ["2026-04", "Miyazya 2018"], ["2026-05", "Ginbot 2018"],
      ["2026-06", "Sene 2018"], ["2026-07", "Hamle 2018"], ["2026-08", "Nehasse 2018"],
    ];
    expected.forEach(([monthKey, label]) => {
      expect(ethiopianMonthLabelForGcMonthKey(monthKey)).toBe(label);
    });
  });

  it("defaults to no Amharic script, matching formatEthiopianDate's default", () => {
    expect(ethiopianMonthLabelForGcMonthKey("2025-09")).toBe("Meskerem 2018");
    expect(ethiopianMonthLabelForGcMonthKey("2025-09", { withAmharic: true })).toBe("Meskerem (መስከረም) 2018");
  });

  it("returns an empty string for a missing/invalid key", () => {
    expect(ethiopianMonthLabelForGcMonthKey("")).toBe("");
    expect(ethiopianMonthLabelForGcMonthKey(null)).toBe("");
  });
});
