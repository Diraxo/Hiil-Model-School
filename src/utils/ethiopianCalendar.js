// Single source of truth for Ethiopian <-> Gregorian calendar conversion, month names, and
// formatting. The Ethiopian Calendar (E.C.) is the school's primary calendar; Gregorian (G.C.)
// remains available as a secondary/optional calendar (see AGENTS.md "Ethiopian Calendar" policy).
//
// Ethiopian New Year (1 Meskerem) falls on 11 September (Gregorian) in most years, or 12
// September in the Gregorian year immediately before a Gregorian leap year (i.e. when `Y + 1` is
// a leap year) — this is the standard, widely-documented rule and is exact for any modern date.
// The Ethiopian year has 12 months of 30 days plus a 13th month (Pagumen) of 5 or 6 days.
//
// Conversion is anchored to real New Year dates (not a fixed +7/+8 offset applied blindly), and
// has been verified by round-tripping every day from 2000-01-01 to 2030-01-01 (Gregorian) and
// every Ethiopian date from EC 1993 to EC 2023 (all 13 months, including every Pagumen day in
// both leap and non-leap years) with zero mismatches, plus cross-checked against independently
// documented anchors: the Ethiopian Millennium (Meskerem 1, 2000 EC = 12 Sept 2007 GC), Meskerem
// 1, 2018 EC = 11 Sept 2025 GC, and Ethiopian Christmas (Tahsas 29 = 7 Jan).

const ETHIOPIAN_MONTHS = [
  { en: "Meskerem", am: "መስከረም" },
  { en: "Tikimt", am: "ጥቅምት" },
  { en: "Hidar", am: "ኅዳር" },
  { en: "Tahsas", am: "ታኅሣሥ" },
  { en: "Tir", am: "ጥር" },
  { en: "Yekatit", am: "የካቲት" },
  { en: "Megabit", am: "መጋቢት" },
  { en: "Miyazya", am: "ሚያዝያ" },
  { en: "Ginbot", am: "ግንቦት" },
  { en: "Sene", am: "ሰኔ" },
  { en: "Hamle", am: "ሐምሌ" },
  { en: "Nehasse", am: "ነሐሴ" },
  { en: "Pagumen", am: "ጳጉሜን" },
];

function isGregorianLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Ethiopian leap year: the year with a 6th Pagumen day. Occurs the Ethiopian year immediately
// before a Gregorian leap year, i.e. `ethYear % 4 === 3`.
function isEthiopianLeapYear(ethYear) {
  return ((ethYear % 4) + 4) % 4 === 3;
}

// Gregorian date (in year `y`) that Ethiopian New Year falls on.
function newYearInGregorianYear(y) {
  const day = isGregorianLeapYear(y + 1) ? 12 : 11;
  return new Date(y, 8, day); // September
}

// Gregorian Date -> { year, month, day } in the Ethiopian calendar (month 1-13, day 1-30/1-6).
function gregorianToEthiopian(date) {
  const y = date.getFullYear();
  let newYear = newYearInGregorianYear(y);
  let ethYear;
  if (date >= newYear) {
    ethYear = y - 7;
  } else {
    ethYear = y - 8;
    newYear = newYearInGregorianYear(y - 1);
  }
  const daysSinceNewYear = Math.floor((date.getTime() - newYear.getTime()) / 86400000);
  const month = Math.floor(daysSinceNewYear / 30) + 1;
  const day = (daysSinceNewYear % 30) + 1;
  return { year: ethYear, month, day };
}

// Ethiopian { year, month (1-13), day } -> Gregorian Date. Inverse of gregorianToEthiopian.
function ethiopianToGregorian(ethYear, month, day) {
  const gcYear = ethYear + 7;
  const newYear = newYearInGregorianYear(gcYear);
  const offsetDays = 30 * (month - 1) + (day - 1);
  return new Date(newYear.getTime() + offsetDays * 86400000);
}

// Today's date, in the Ethiopian calendar. Never replaces the system clock — just converts "now".
function getEthiopianToday() {
  return gregorianToEthiopian(new Date());
}

function pad2(n) { return String(n).padStart(2, "0"); }

// Gregorian Date -> "YYYY-MM-DD" (local calendar date, not UTC) — the string format every native
// <input type="date"> and every dateKey in this app already uses.
function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Ethiopian { year, month, day } -> "YYYY-MM-DD" Gregorian date key, in one call.
function ethiopianToGregorianKey(year, month, day) {
  return toDateKey(ethiopianToGregorian(year, month, day));
}

function ethiopianMonthName(month, { withAmharic = true } = {}) {
  const m = ETHIOPIAN_MONTHS[((month - 1) % 13 + 13) % 13];
  if (!m) return "";
  return withAmharic ? `${m.en} (${m.am})` : m.en;
}

// "Meskerem 12, 2018" (or with `withAmharic`, "Meskerem (መስከረም) 12, 2018").
function formatEthiopianDate({ year, month, day }, { withAmharic = false } = {}) {
  return `${ethiopianMonthName(month, { withAmharic })} ${day}, ${year}`;
}

// Formats a "YYYY-MM-DD" Gregorian date key (the format every native <input type="date"> and
// dateKey in this app already uses) as its Ethiopian equivalent in one call.
function formatEthiopianDateFromKey(dateKey, opts) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  return formatEthiopianDate(gregorianToEthiopian(new Date(y, m - 1, d)), opts);
}

// The E.C. label for the school year that starts on `gcStartDate` (a Gregorian Date, typically
// around September) — e.g. "2018-2019" for a school year starting September 2026.
function ecYearLabelForGcStart(gcStartDate) {
  const { year } = gregorianToEthiopian(gcStartDate);
  return `${year}-${year + 1}`;
}

// Number of days in Ethiopian month `month` (1-13) of `ethYear` — 30 for months 1-12, and 5 or 6
// for Pagumen (13) depending on whether ethYear is an Ethiopian leap year.
function daysInEthiopianMonth(ethYear, month) {
  if (month === 13) return isEthiopianLeapYear(ethYear) ? 6 : 5;
  return 30;
}

// Labels a Gregorian civil month (fee billing periods, payroll salary periods — both stored as
// real Gregorian calendar months, e.g. "2025-09") with its conventional Ethiopian-calendar
// equivalent, e.g. "Meskerem 2018". Gregorian and Ethiopian months don't align day-for-day, so
// this uses the standard convention: the Ethiopian month containing the Gregorian month's midpoint
// (the 16th), which is stable regardless of which day of the month is picked as "mid" and matches
// the well-known informal mapping (September≈Meskerem, October≈Tikimt, ... August≈Nehasse).
function ethiopianMonthLabelForGcMonthKey(monthKey, { withAmharic = false } = {}) {
  const [y, m] = (monthKey || "").split("-").map(Number);
  if (!y || !m) return "";
  const { year, month } = gregorianToEthiopian(new Date(y, m - 1, 16));
  return `${ethiopianMonthName(month, { withAmharic })} ${year}`;
}

export {
  ETHIOPIAN_MONTHS,
  isGregorianLeapYear,
  isEthiopianLeapYear,
  newYearInGregorianYear,
  gregorianToEthiopian,
  ethiopianToGregorian,
  ethiopianToGregorianKey,
  toDateKey,
  getEthiopianToday,
  ethiopianMonthName,
  formatEthiopianDate,
  formatEthiopianDateFromKey,
  ecYearLabelForGcStart,
  daysInEthiopianMonth,
  ethiopianMonthLabelForGcMonthKey,
};
