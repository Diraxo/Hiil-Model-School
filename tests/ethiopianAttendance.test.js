// Attendance on the Ethiopian Calendar: the Monthly Register (and every attendance date picker) is
// paged/labelled in E.C., while attendance rows keep the real Gregorian date they were stored under.
// These tests pin the mapping (E.C. day <-> stored date key), that no record is lost, re-dated or
// re-counted by the calendar change, and the calendar edge cases (Pagumen, leap year, New Year).
import { describe, it, expect } from "vitest";
import {
  ecMonthDays, ecMonthRange, ecMonthKey, ecMonthKeyOfDateKey, shiftEcMonthKey, ecMonthTitle,
  gregorianToEthiopian, ethiopianToGregorian, ethiopianToGregorianKey, toDateKey, daysInEthiopianMonth,
  parseEcMonthKey,
} from "../src/utils/ethiopianCalendar";
import { registerDays, studentRegisterRow } from "../src/utils/attendanceRegister";
import { classifyAttendanceDate, addDays } from "../src/utils/academicCalendar";
import { ATTENDANCE_STATUSES } from "../src/utils/constants";

const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

// The school's 2019 E.C. (2026-27) calendar as used elsewhere in the suite.
const cal = {
  yearStart: "2026-09-01", yearEnd: "2027-08-07",
  sem1Start: "2026-09-14", sem1End: "2027-02-14", breakDays: 15,
  sem2Start: "2027-03-02", sem2End: "2027-08-02",
};
const TODAY = "2027-06-30";
const classifier = (closures = {}) => (dateKey) => classifyAttendanceDate(dateKey, cal, TODAY, closures);

describe("E.C. month helpers (the one engine in ethiopianCalendar.js)", () => {
  it("Meskerem 2019 runs 11 Sep – 10 Oct 2026 and day N is exactly N days after 11 Sep", () => {
    const days = ecMonthDays("2019-01");
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: 1, dateKey: "2026-09-11" });
    expect(days[29]).toEqual({ day: 30, dateKey: "2026-10-10" });
    days.forEach(({ day, dateKey }) => expect(dateKey).toBe(toDateKey(addDaysDate("2026-09-11", day - 1))));
  });

  it("the E.C. day number is NOT the Gregorian day number (Meskerem 4 is 14 September)", () => {
    const d = ecMonthDays("2019-01").find((x) => x.dateKey === "2026-09-14");
    expect(d.day).toBe(4);
    expect(ecMonthKeyOfDateKey("2026-09-14")).toBe("2019-01");
    expect(gregorianToEthiopian(keyToDate("2026-09-28"))).toEqual({ year: 2019, month: 1, day: 18 });
  });

  it("E.C. -> Gregorian -> E.C. round-trips for every day of E.C. 2015-2022 (all 13 months)", () => {
    for (let year = 2015; year <= 2022; year++) {
      for (let month = 1; month <= 13; month++) {
        for (let day = 1; day <= daysInEthiopianMonth(year, month); day++) {
          const back = gregorianToEthiopian(ethiopianToGregorian(year, month, day));
          expect(back).toEqual({ year, month, day });
        }
      }
    }
  });

  it("Gregorian -> E.C. -> Gregorian round-trips for every day 2024-01-01 .. 2030-12-31 and each date falls in exactly one register month", () => {
    let d = keyToDate("2024-01-01");
    const end = keyToDate("2030-12-31");
    const seen = new Map();
    while (d <= end) {
      const key = toDateKey(d);
      const ec = gregorianToEthiopian(d);
      expect(toDateKey(ethiopianToGregorian(ec.year, ec.month, ec.day))).toBe(key);
      const mk = ecMonthKeyOfDateKey(key);
      const inMonth = ecMonthDays(mk).filter((x) => x.dateKey === key);
      expect(inMonth).toHaveLength(1);
      expect(inMonth[0].day).toBe(ec.day);
      seen.set(key, mk);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    expect(seen.size).toBeGreaterThan(2500);
  });

  it("Ethiopian New Year: 1 Meskerem 2019 = 11 Sep 2026; the day before is the last Pagumen day of 2018", () => {
    expect(ethiopianToGregorianKey(2019, 1, 1)).toBe("2026-09-11");
    expect(gregorianToEthiopian(keyToDate("2026-09-10"))).toEqual({ year: 2018, month: 13, day: 5 });
    expect(ecMonthKeyOfDateKey("2026-09-10")).toBe("2018-13");
    expect(ecMonthKeyOfDateKey("2026-09-11")).toBe("2019-01");
  });

  it("New Year is 12 September the Gregorian year before a leap year (Meskerem 1, 2020 = 12 Sep 2027)", () => {
    expect(ethiopianToGregorianKey(2020, 1, 1)).toBe("2027-09-12");
  });

  it("Pagumen has 5 days normally and 6 in an Ethiopian leap year (2019 % 4 = 3), and rolls into Meskerem", () => {
    expect(daysInEthiopianMonth(2018, 13)).toBe(5);
    expect(daysInEthiopianMonth(2019, 13)).toBe(6);
    const pag = ecMonthDays("2019-13");
    expect(pag).toHaveLength(6);
    expect(pag[0].dateKey).toBe("2027-09-06");
    expect(pag[5].dateKey).toBe("2027-09-11");
    expect(ecMonthDays("2018-13")).toHaveLength(5);
    // the day after the last Pagumen day is Meskerem 1 of the next E.C. year
    expect(ecMonthKeyOfDateKey("2027-09-12")).toBe("2020-01");
    expect(ecMonthDays("2020-01")[0].dateKey).toBe("2027-09-12");
  });

  it("Gregorian leap day (29 Feb 2028) sits in Yekatit 2020 and maps back to itself", () => {
    const ec = gregorianToEthiopian(keyToDate("2028-02-29"));
    expect(ec).toEqual({ year: 2020, month: 6, day: 21 });
    expect(ethiopianToGregorianKey(2020, 6, 21)).toBe("2028-02-29");
  });

  it("shiftEcMonthKey pages through all 13 months and across E.C. years, both ways", () => {
    expect(shiftEcMonthKey("2019-01", 1)).toBe("2019-02");
    expect(shiftEcMonthKey("2019-12", 1)).toBe("2019-13");
    expect(shiftEcMonthKey("2019-13", 1)).toBe("2020-01");
    expect(shiftEcMonthKey("2020-01", -1)).toBe("2019-13");
    expect(shiftEcMonthKey("2019-01", -1)).toBe("2018-13");
    let k = "2019-01";
    for (let i = 0; i < 13; i++) k = shiftEcMonthKey(k, 1);
    expect(k).toBe("2020-01");
  });

  it("titles and ranges", () => {
    expect(ecMonthTitle("2019-01")).toBe("Meskerem 2019");
    expect(ecMonthTitle("2019-13")).toBe("Pagumen 2019");
    expect(ecMonthRange("2019-01")).toEqual({ startKey: "2026-09-11", endKey: "2026-10-10" });
    expect(parseEcMonthKey("2019-14")).toBeNull();
    expect(ecMonthKey(2019, 3)).toBe("2019-03");
  });
});

function addDaysDate(key, n) { const d = keyToDate(key); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

describe("Monthly Register columns: E.C. day numbers over real school days", () => {
  const noRecords = () => false;

  it("Meskerem 2019 columns are E.C. days 4-8, 11-15, 18-22, 25-29 (Mon-Fri from 14 Sep) — not 14 15 16 ... 28", () => {
    const days = registerDays("2019-01", { classify: classifier(), hasRecord: noRecords });
    expect(days.map((d) => d.day)).toEqual([4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29]);
    expect(days[0].dateKey).toBe("2026-09-14");
    expect(days.at(-1).dateKey).toBe("2026-10-09");
    // every column maps back to the E.C. day it shows
    days.forEach((d) => expect(gregorianToEthiopian(keyToDate(d.dateKey)).day).toBe(d.day));
  });

  it("weekends never appear (Sat/Sun of that E.C. month are E.C. 9-10, 16-17, 23-24, 30)", () => {
    const shown = new Set(registerDays("2019-01", { classify: classifier(), hasRecord: noRecords }).map((d) => d.day));
    [9, 10, 16, 17, 23, 24, 30].forEach((d) => expect(shown.has(d)).toBe(false));
  });

  it("a school closure hides its E.C. day; a closure that already has a record still shows (unavailable)", () => {
    const closures = { "2026-09-15": { reason: "Holiday" } }; // Meskerem 5
    const hidden = registerDays("2019-01", { classify: classifier(closures), hasRecord: noRecords });
    expect(hidden.map((d) => d.day)).not.toContain(5);
    const kept = registerDays("2019-01", { classify: classifier(closures), hasRecord: (k) => k === "2026-09-15" });
    const col = kept.find((d) => d.day === 5);
    expect(col).toMatchObject({ dateKey: "2026-09-15", available: false });
  });

  it("the E.C. month before the first attendance date and the semester break have no available days", () => {
    // Pagumen 2018 (6-10 Sep 2026) is before sem1Start (14 Sep)
    expect(registerDays("2018-13", { classify: classifier(), hasRecord: noRecords })).toEqual([]);
    // Semester break: sem1End 2027-02-14 + 15 days -> Feb 15-Mar 1 2027 (Yekatit 8-22, Megabit 1-?).
    const breakDays = registerDays("2019-06", { classify: classifier(), hasRecord: noRecords }).map((d) => d.dateKey);
    breakDays.forEach((k) => expect(k <= "2027-02-14" || k >= "2027-03-02").toBe(true));
  });

  it("outside the academic year (after year end) shows nothing, Pagumen included", () => {
    expect(registerDays("2019-13", { classify: classifier(), hasRecord: noRecords })).toEqual([]); // 6-11 Sep 2027 > TODAY & > year end
  });

  it("uses the same availability rules as everything else: available days match classifyAttendanceDate exactly", () => {
    const c = classifier();
    for (const key of ["2019-01", "2019-02", "2019-06", "2019-07", "2019-11"]) {
      const cols = registerDays(key, { classify: c, hasRecord: noRecords });
      const expected = ecMonthDays(key).filter((d) => c(d.dateKey).available).map((d) => d.dateKey);
      expect(cols.map((d) => d.dateKey)).toEqual(expected);
    }
  });
});

describe("existing attendance is preserved: same rows, same dates, same statuses, same totals", () => {
  // A stand-in for stored rows: attendance.date stays the Gregorian key it was saved under.
  const students = ["s1", "s2", "s3"];
  const statuses = ["Present", "Absent", "Late", "Present", "Present", "Sick", "Permission", "Excused"];
  const rows = [];
  let n = 0;
  for (let d = keyToDate("2026-09-14"); toDateKey(d) <= "2026-12-31"; d = addDaysDate(toDateKey(d), 1)) {
    const key = toDateKey(d);
    if (!classifier()(key).available) continue;
    students.forEach((s, si) => rows.push({ id: `a${n++}`, studentId: s, classId: "g9", date: key, status: statuses[(n + si) % statuses.length] }));
  }
  const snapshot = JSON.stringify(rows);

  function registerFor(monthKey) {
    const days = registerDays(monthKey, { classify: classifier(), hasRecord: (k) => rows.some((r) => r.date === k) });
    return { days, perStudent: Object.fromEntries(students.map((s) => [s, studentRegisterRow(rows, s, days, ATTENDANCE_STATUSES)])) };
  }
  const monthKeys = ["2019-01", "2019-02", "2019-03", "2019-04"]; // Meskerem..Tahsas covers all rows

  it("every stored row appears under the E.C. month/day its own date converts to, with its status untouched", () => {
    let seenRows = 0;
    for (const mk of monthKeys) {
      const { days, perStudent } = registerFor(mk);
      students.forEach((s) => {
        days.forEach((d, i) => {
          const rec = perStudent[s].cells[i];
          if (!rec) return;
          seenRows++;
          const ec = gregorianToEthiopian(keyToDate(rec.date));
          expect(ecMonthKey(ec.year, ec.month)).toBe(mk);
          expect(ec.day).toBe(d.day);
          expect(rec.date).toBe(d.dateKey);
        });
      });
    }
    expect(seenRows).toBe(rows.length); // nothing dropped, nothing shown twice
    expect(JSON.stringify(rows)).toBe(snapshot); // rows themselves never mutated
  });

  it("per-status totals summed across the E.C. months equal the totals from the stored rows (and from Gregorian months)", () => {
    const byEc = {}; const byGc = {}; const truth = {};
    ATTENDANCE_STATUSES.forEach((st) => { byEc[st] = 0; byGc[st] = 0; truth[st] = 0; });
    rows.forEach((r) => { truth[r.status]++; });
    for (const mk of monthKeys) {
      students.forEach((s) => { const t = registerFor(mk).perStudent[s].totals; ATTENDANCE_STATUSES.forEach((st) => { byEc[st] += t[st]; }); });
    }
    // Gregorian-month partition of the very same rows
    const gcMonths = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
    gcMonths.forEach((gm) => rows.filter((r) => r.date.slice(0, 7) === gm).forEach((r) => { byGc[r.status]++; }));
    expect(byEc).toEqual(truth);
    expect(byGc).toEqual(truth);
  });

  it("a student's percentage is Present+Late over recorded days, computed from the same records", () => {
    const { days, perStudent } = registerFor("2019-02");
    const s = perStudent.s1;
    const mine = rows.filter((r) => r.studentId === "s1" && days.some((d) => d.dateKey === r.date));
    const recorded = mine.length;
    const presentLike = mine.filter((r) => r.status === "Present" || r.status === "Late").length;
    expect(s.pct).toBe(Math.round((presentLike / recorded) * 100));
    // the row/column counts add up to the recorded days
    expect(Object.values(s.totals).reduce((a, b) => a + b, 0)).toBe(recorded);
  });

  it("a student with no records shows no percentage and no false absences", () => {
    const { days } = registerFor("2019-01");
    const row = studentRegisterRow(rows, "nobody", days, ATTENDANCE_STATUSES);
    expect(row.pct).toBeNull();
    expect(row.cells.every((c) => c === null)).toBe(true);
    expect(Object.values(row.totals).every((v) => v === 0)).toBe(true);
  });
});
