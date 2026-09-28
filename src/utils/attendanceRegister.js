// Pure logic behind the Monthly Register (ClassMonthlyRegisterModal in AdminPages.jsx), kept out of
// the component so the calendar mapping and the totals can be tested without rendering anything.
//
// Attendance rows are stored against a real Gregorian "YYYY-MM-DD" date (attendance.date) and that
// never changes. The register is paged by ETHIOPIAN month: it takes an E.C. month key ("2019-01" =
// Meskerem 2019), converts each of that month's E.C. days to the Gregorian date key it is stored
// under (via src/utils/ethiopianCalendar.js — the one conversion engine), and looks records up by that
// key. The number shown in a column is the E.C. day of the month, never a Gregorian day number.
import { ecMonthDays } from "./ethiopianCalendar";

// The columns of a class's register for one E.C. month: every E.C. day that was available for
// attendance (per the shared classifyAttendanceDay rules — this file never re-derives weekends,
// closures, breaks or the academic year) or that already has a record. Days that are neither
// (weekend, closure, break, outside the year) are left out exactly as before.
//   classify(dateKey) -> { available }      hasRecord(dateKey) -> boolean
// Returns [{ dateKey, day, available }] where `day` is the E.C. day number.
function registerDays(ecMonthKey, { classify, hasRecord }) {
  const list = [];
  for (const { day, dateKey } of ecMonthDays(ecMonthKey)) {
    const available = !!classify(dateKey).available;
    if (available || hasRecord(dateKey)) list.push({ dateKey, day, available });
  }
  return list;
}

// One student's per-status totals over the register's columns, and their attendance percentage.
// Present + Late count toward the percentage — the same rule as data.studentAttendanceRate, so a
// student's rate never disagrees between the register and the pages that show it.
function studentRegisterRow(attendance, studentId, days, statuses) {
  const totals = {};
  statuses.forEach((st) => { totals[st] = 0; });
  const cells = days.map((d) => {
    const rec = attendance.find((a) => a.studentId === studentId && a.date === d.dateKey) || null;
    if (rec) totals[rec.status] = (totals[rec.status] || 0) + 1;
    return rec;
  });
  const recorded = Object.values(totals).reduce((sum, n) => sum + n, 0);
  const presentLike = (totals.Present || 0) + (totals.Late || 0);
  const pct = recorded > 0 ? Math.round((presentLike / recorded) * 100) : null;
  return { cells, totals, pct };
}

export { registerDays, studentRegisterRow };
