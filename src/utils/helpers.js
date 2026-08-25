let uidCounter = 1000;
const uid = (prefix) => `${prefix}_${(uidCounter++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function fmtDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
// Same as fmtDate but with the full month name (e.g. "17 September 2026") — used for fee/payment
// period dates, where an abbreviated month reads less professionally on a receipt-adjacent screen.
function fmtDateLong(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function fmtTime(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function to12Hour(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
// "2026-08" -> "August 2026" — the single shared formatter for every "YYYY-MM" payroll/salary
// period key, so Payroll, My Salary, Payslip, and Recent Activity can never disagree on how a
// month is displayed.
function monthLabel(monthKey) {
  const [y, m] = (monthKey || "").split("-").map(Number);
  if (!y || !m) return monthKey || "";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}
// Single source of truth for "First Middle Last" formatting, so students, teachers, and
// any other person record that splits its name into parts stay consistent everywhere.
function fullName(first, middle, last) {
  return [first, middle, last].map((p) => (p || "").trim()).filter(Boolean).join(" ");
}
// Plain inclusive calendar-day count between two "YYYY-MM-DD" date keys — deliberately NOT
// the weekday/holiday-skipping count used for attendance auto-fill; a leave display should
// read "24 Aug - 30 Aug = 7 days" regardless of weekends inside the range.
function leaveDurationDays(fromDate, toDate) {
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T00:00:00");
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
  return Math.round((to - from) / 86400000) + 1;
}
function leaveDurationLabel(fromDate, toDate) {
  const n = leaveDurationDays(fromDate, toDate);
  return `${n} day${n === 1 ? "" : "s"}`;
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}
function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}
function avatarColor(name = "") {
  const colors = ["bg-sky-600", "bg-emerald-700", "bg-indigo-600", "bg-teal-600", "bg-cyan-700", "bg-blue-700"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// Derives every period's (and the break's) start/end time from the school's timetable
// config, so times are always computed fresh instead of typed/stored per timetable entry.
function computePeriodSchedule(config) {
  const [startH, startM] = (config.startTime || "08:00").split(":").map(Number);
  const startMins = (isNaN(startH) ? 8 : startH) * 60 + (isNaN(startM) ? 0 : startM);
  const periodDuration = config.periodDurationMins || 45;
  const breakDuration = config.breakDurationMins || 0;
  const breakAfterPeriod = config.breakAfterPeriod || null;

  const periods = [];
  let cursor = startMins;
  let breakStart24 = null, breakEnd24 = null;
  for (let p = 1; p <= (config.periodsCount || 0); p++) {
    const start24 = minutesToHHMM(cursor);
    cursor += periodDuration;
    const end24 = minutesToHHMM(cursor);
    periods.push({ period: p, start24, end24, startLabel: to12Hour(start24), endLabel: to12Hour(end24) });
    if (breakAfterPeriod && p === breakAfterPeriod && breakDuration > 0) {
      breakStart24 = minutesToHHMM(cursor);
      cursor += breakDuration;
      breakEnd24 = minutesToHHMM(cursor);
    }
  }
  return {
    periods,
    breakAfterPeriod: breakStart24 ? breakAfterPeriod : null,
    breakStart24, breakEnd24,
    breakStartLabel: breakStart24 ? to12Hour(breakStart24) : "",
    breakEndLabel: breakEnd24 ? to12Hour(breakEnd24) : "",
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
// Converts a 0-999 chunk into words, e.g. 305 -> "Three Hundred Five".
function chunkToWords(n) {
  const parts = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) parts.push(ONES[n]); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}
// Whole-number to English words, grouped by thousand/million — used for the receipt's
// "amount in words" line. Only handles non-negative integers (Birr has no cents on this voucher).
function numberToWords(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return "Zero";
  const groups = [];
  const scales = ["", "Thousand", "Million", "Billion"];
  let scaleIdx = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) groups.unshift(`${chunkToWords(chunk)}${scales[scaleIdx] ? ` ${scales[scaleIdx]}` : ""}`);
    n = Math.floor(n / 1000);
    scaleIdx += 1;
  }
  return groups.join(" ");
}
function amountInWords(n) {
  return `${numberToWords(n)} Birr only`;
}
// "A" / "A and B" / "A, B, and C" — for summarizing a list of names into one readable sentence
// fragment (e.g. a payment notification covering several children).
function joinWithAnd(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export {
  uid, fmtDate, fmtDateLong, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor, fullName, computePeriodSchedule, leaveDurationDays, leaveDurationLabel,
  numberToWords, amountInWords, joinWithAnd, monthLabel,
};
