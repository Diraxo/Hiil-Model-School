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

import { fmtDate, fmtDateLong, monthLabel } from "./helpers";

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
  // Math.round (not floor): both are local-midnight dates, so in a DST-observing timezone the gap can
  // be an hour short of a whole number of days — round() still lands on the right day count.
  const daysSinceNewYear = Math.round((date.getTime() - newYear.getTime()) / 86400000);
  const month = Math.floor(daysSinceNewYear / 30) + 1;
  const day = (daysSinceNewYear % 30) + 1;
  return { year: ethYear, month, day };
}

// Ethiopian { year, month (1-13), day } -> Gregorian Date. Inverse of gregorianToEthiopian.
function ethiopianToGregorian(ethYear, month, day) {
  const gcYear = ethYear + 7;
  const newYear = newYearInGregorianYear(gcYear);
  const offsetDays = 30 * (month - 1) + (day - 1);
  // Calendar-day arithmetic via the Date constructor (not + N*86400000ms), so a DST change between
  // New Year and the target date can't push the result an hour into the previous day.
  return new Date(newYear.getFullYear(), newYear.getMonth(), newYear.getDate() + offsetDays);
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
// around September) — e.g. "2019-2020" for a school year starting September 2026.
//
// A school year that starts in early September (e.g. 1 Sept 2026) begins a few days BEFORE the
// Ethiopian New Year (1 Meskerem = 11 Sept), i.e. still in Nehasse/Pagumen of the previous E.C.
// year, yet it is the school year of the E.C. year that starts days later. So the label follows
// the Ethiopian New Year nearest to the start date, not the E.C. year the start date falls in.
function ecYearLabelForGcStart(gcStartDate) {
  const gy = gcStartDate.getFullYear();
  let nearestGcYear = gy;
  let nearestDistance = Infinity;
  for (const candidate of [gy - 1, gy, gy + 1]) {
    const distance = Math.abs(gcStartDate.getTime() - newYearInGregorianYear(candidate).getTime());
    if (distance < nearestDistance) { nearestDistance = distance; nearestGcYear = candidate; }
  }
  const year = nearestGcYear - 7; // E.C. year that begins on that Gregorian year's Meskerem 1
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

// An Ethiopian month is a billing/payroll period of a date range when the range covers at least HALF
// of its 30 days. That makes Meskerem 1 -> Sene 30 exactly 10 periods, and stops a sloppy edge from
// dragging in a neighbouring school year's month: a year that starts on 1 Sept (Nehasse 26 — five days
// of the previous E.C. year) does NOT bill Nehasse, and one that ends on Hamle 1 does NOT bill Hamle.
const MIN_MONTH_COVERAGE_DAYS = 15;

function keyToDate(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function keyDaysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 86400000); }

// The Ethiopian months (1-12; never Pagumen) that the date range [startKey, endKey] covers, oldest
// first: [{ ecYear, ecMonth, monthKey, anchor, spanStart, spanEnd, coveredDays }]. `anchor`
// ("YYYY-MM-01") is the Gregorian civil month that carries the Ethiopian month's label under
// ethiopianMonthLabelForGcMonthKey (the month holding its 16th day) — the key
// fee_installments.period_month / payroll_payments.month / fee_schedules.billed_months use.
// Mirrored in SQL by public.academic_year_billing_months (supabase migration 20260929000000).
function ethiopianMonthsCoveredBy(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return [];
  const first = gregorianToEthiopian(keyToDate(startKey));
  const last = gregorianToEthiopian(keyToDate(endKey));
  const out = [];
  let y = first.year, m = first.month;
  while (y < last.year || (y === last.year && m <= last.month)) {
    if (m <= 12) {
      const spanStart = ethiopianToGregorianKey(y, m, 1), spanEnd = ethiopianToGregorianKey(y, m, 30);
      const from = spanStart > startKey ? spanStart : startKey;
      const to = spanEnd < endKey ? spanEnd : endKey;
      const coveredDays = keyDaysBetween(from, to) + 1;
      if (coveredDays >= MIN_MONTH_COVERAGE_DAYS) {
        const mid = ethiopianToGregorian(y, m, 16);
        const monthKey = `${mid.getFullYear()}-${pad2(mid.getMonth() + 1)}`;
        out.push({ ecYear: y, ecMonth: m, monthKey, anchor: `${monthKey}-01`, spanStart, spanEnd, coveredDays });
      }
    }
    m += 1;
    if (m > 13) { m = 1; y += 1; }
  }
  return out;
}

// ---- Ethiopian month as a navigable period (attendance registers, attendance month views) ----
// An "E.C. month key" is "YYYY-MM" in the ETHIOPIAN calendar (year 2019, month 01-13) — NOT a
// Gregorian month key. Stored attendance rows keep their Gregorian "YYYY-MM-DD" date; these helpers
// only translate between the two so a screen can page by E.C. month and still query the exact same
// underlying dates. Everything goes through gregorianToEthiopian/ethiopianToGregorian above.

function ecMonthKey(year, month) { return `${year}-${pad2(month)}`; }

function parseEcMonthKey(key) {
  const [year, month] = (key || "").split("-").map(Number);
  if (!year || !month || month < 1 || month > 13) return null;
  return { year, month };
}

// The E.C. month a "YYYY-MM-DD" Gregorian date key falls in.
function ecMonthKeyOfDateKey(dateKey) {
  const ec = gregorianToEthiopian(keyToDate(dateKey));
  return ecMonthKey(ec.year, ec.month);
}

// Previous/next E.C. month (rolls Pagumen -> Meskerem of the next E.C. year and back).
function shiftEcMonthKey(key, delta) {
  const p = parseEcMonthKey(key);
  if (!p) return key;
  const index = p.year * 13 + (p.month - 1) + delta;
  return ecMonthKey(Math.floor(index / 13), (((index % 13) + 13) % 13) + 1);
}

// Every day of an E.C. month as [{ day, dateKey }], where dateKey is the real Gregorian
// "YYYY-MM-DD" that day is stored under (30 days, or 5/6 for Pagumen).
function ecMonthDays(key) {
  const p = parseEcMonthKey(key);
  if (!p) return [];
  const count = daysInEthiopianMonth(p.year, p.month);
  return Array.from({ length: count }, (_, i) => ({ day: i + 1, dateKey: ethiopianToGregorianKey(p.year, p.month, i + 1) }));
}

// First and last Gregorian date keys of an E.C. month — the range attendance is loaded for.
function ecMonthRange(key) {
  const days = ecMonthDays(key);
  return days.length ? { startKey: days[0].dateKey, endKey: days[days.length - 1].dateKey } : null;
}

// "Meskerem 2019" (or with Amharic).
function ecMonthTitle(key, { withAmharic = false } = {}) {
  const p = parseEcMonthKey(key);
  return p ? `${ethiopianMonthName(p.month, { withAmharic })} ${p.year}` : "";
}

// The Gregorian span an E.C. month covers, e.g. "11 Sep – 10 Oct 2026".
function ecMonthGcSpanLabel(key) {
  const r = ecMonthRange(key);
  if (!r) return "";
  const a = keyToDate(r.startKey), b = keyToDate(r.endKey);
  const fmt = (d, withYear) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return a.getFullYear() === b.getFullYear() ? `${fmt(a)} – ${fmt(b, true)}` : `${fmt(a, true)} – ${fmt(b, true)}`;
}

// The school's standard dual-calendar date caption, EC-first: "Meskerem 12, 2018 E.C. (12
// September 2026 G.C.)". Pass { long: true } for the full-month-name Gregorian variant (default
// is the short "12 Sep 2026" form). Consolidates what used to be a near-identical private
// `ecDate` helper copy-pasted across half a dozen page files.
function formatEthiopianDateWithGc(dateKey, { long = false } = {}) {
  if (!dateKey) return "";
  return `${formatEthiopianDateFromKey(dateKey)} E.C. (${(long ? fmtDateLong : fmtDate)(dateKey)} G.C.)`;
}

// Dual-calendar month/period caption: "Meskerem 2018 (September 2026)". Consolidates the
// previously copy-pasted private `ecMonthLabel` helper.
function ethiopianMonthLabelWithGc(monthKey) {
  return monthKey ? `${ethiopianMonthLabelForGcMonthKey(monthKey)} (${monthLabel(monthKey)})` : "";
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
  ethiopianMonthsCoveredBy,
  MIN_MONTH_COVERAGE_DAYS,
  formatEthiopianDateWithGc,
  ethiopianMonthLabelWithGc,
  ecMonthKey,
  parseEcMonthKey,
  ecMonthKeyOfDateKey,
  shiftEcMonthKey,
  ecMonthDays,
  ecMonthRange,
  ecMonthTitle,
  ecMonthGcSpanLabel,
};
