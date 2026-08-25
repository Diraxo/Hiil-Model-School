// Gregorian -> Ethiopian calendar conversion, used only to compute an academic year's E.C. label
// (e.g. "2018-2019") from its Gregorian start date. Day-level UI throughout the app stays
// Gregorian-only — see the "Ethiopian calendar depth" decision in the Students-module plan.
//
// Ethiopian New Year (1 Meskerem) falls on 11 September (Gregorian) in most years, or 12
// September in the Gregorian year immediately before a Gregorian leap year (i.e. when `Y + 1` is
// a leap year) — this is the standard, widely-documented rule and is exact for any modern date.
// The Ethiopian year has 12 months of 30 days plus a 13th month (Pagume) of 5 or 6 days.

function isGregorianLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Gregorian date (in year `y`) that Ethiopian New Year falls on.
function newYearInGregorianYear(y) {
  const day = isGregorianLeapYear(y + 1) ? 12 : 11;
  return new Date(y, 8, day); // September
}

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

// The E.C. label for the school year that starts on `gcStartDate` (a Gregorian Date, typically
// around September) — e.g. "2018-2019" for a school year starting September 2026.
function ecYearLabelForGcStart(gcStartDate) {
  const { year } = gregorianToEthiopian(gcStartDate);
  return `${year}-${year + 1}`;
}

export { isGregorianLeapYear, newYearInGregorianYear, gregorianToEthiopian, ecYearLabelForGcStart };
