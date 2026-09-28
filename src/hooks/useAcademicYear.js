// The one hook every academic-year-sensitive screen reads. It exposes the workspace scope decided ONCE in
// DataContext (see utils/academicYearScope.js buildAcademicYearScope) — so no screen ever re-derives "the
// current year" from today's date:
//
//   currentAcademicYear        the operational year (the one all day-to-day writes belong to)
//   selectedAcademicYear       the year the workspace is showing (an admin's selection, else the current year)
//   setSelectedAcademicYear(id | null)   switch the workspace; null returns to the current year
//   academicYears              every year, newest first
//   isCurrentYear              the selected year IS the current year
//   isClosedYear               the selected year is closed (Academic Year Closed)
//   isReadOnlyYear             the selected year is a previous year: nothing can be written to it
//   academicPeriods            billing / payroll periods of the SELECTED year (Ethiopian months)
//   academicYearStatus         { status, phase, closeDate, ... } lifecycle of the selected year
import { useData } from "../context/DataContext";
import { buildAcademicYearScope } from "../utils/academicYearScope";

function localTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useAcademicYear() {
  const data = useData();
  // A data layer without a precomputed scope (a partial fake in a test) still gets a coherent one.
  const scope = (data.db && data.db.yearScope)
    || buildAcademicYearScope({ years: (data.db && data.db.academicYears) || [], selectedId: null, todayKey: localTodayKey() });
  return { ...scope, setSelectedAcademicYear: data.setWorkspaceYearId || (() => {}) };
}
