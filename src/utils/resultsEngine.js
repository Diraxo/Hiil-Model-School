// Single shared source for Total/Average/Rank/Class-Average/Top-Student calculations, so Results,
// Student Profile, and any other consumer never disagree on what a student's average is (a past
// bug class: each screen had its own inline mean-of-pct formula). Pure functions only — no `db`,
// no React — callers (DataContext) supply plain arrays. Does NOT change assessment weighting or
// the annual-blended Report Card average / S2-only Promotion reference average, which are
// legitimately different metrics from the per-semester numbers computed here.
import { resultTotals } from "../components/ui";

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// `academicYearId` (optional) scopes the match to one year — classId alone is not a reliable key
// since it's a persistent identity, not re-created per year: a repeating/retained student keeps
// the SAME classId next year, so without this a query can silently resolve to their locked
// record from the year they repeated. Callers that don't pass one keep the old (unscoped)
// behavior — every live caller now passes it via DataContext's classSemesterResults.
function subjectPct(results, studentId, classId, subject, semester, academicYearId) {
  const record = results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && (!academicYearId || !r.academicYearId || r.academicYearId === academicYearId));
  const t = resultTotals(record);
  return { pct: t.count > 0 ? t.pct : null, complete: t.completionStatus === "COMPLETE" };
}

// A subject with no result yet (or an incomplete one) is excluded from the average, not scored as
// 0 — matches how the Report Card / Parent Results / old grid "Overall" have always behaved.
function computeStudentSemesterAverage({ results, studentId, classId, subjects, semester, academicYearId }) {
  const bySubject = {};
  let sumPct = 0, sumTotal = 0, subjectsComplete = 0;
  for (const subject of subjects) {
    const { pct, complete } = subjectPct(results, studentId, classId, subject, semester, academicYearId);
    bySubject[subject] = complete ? pct : null;
    if (complete) { sumPct += pct; sumTotal += pct; subjectsComplete += 1; }
  }
  const subjectsRequired = subjects.length;
  const average = subjectsComplete > 0 ? Math.round(sumPct / subjectsComplete) : null;
  const total = subjectsComplete > 0 ? sumTotal : null;
  return { average, total, subjectsComplete, subjectsRequired, allComplete: subjectsRequired > 0 && subjectsComplete === subjectsRequired, bySubject };
}

// Standard competition ranking (1, 2, 2, 4 — ties share a rank, the next rank skips by the
// tie-group size). Only rows with allComplete are eligible; the rest get rank:null so a student
// with one subject scored doesn't outrank a student with a real, complete record. Returns the
// full row list back (order preserved) with rank/rankLabel merged on.
function rankStudents(rows) {
  const eligible = rows.filter((r) => r.allComplete && r.average != null);
  const sorted = [...eligible].sort((a, b) => b.average - a.average);
  const rankByStudentId = new Map();
  let place = 0, seen = 0, prevAvg = null;
  for (const row of sorted) {
    seen += 1;
    if (row.average !== prevAvg) { place = seen; prevAvg = row.average; }
    rankByStudentId.set(row.studentId, place);
  }
  return rows.map((row) => {
    const rank = rankByStudentId.get(row.studentId) ?? null;
    return { ...row, rank, rankLabel: rank ? ordinal(rank) : "—" };
  });
}

// Orchestrates the above for every student in one class+semester. `requiredSubjectsForClass` is
// passed in (rather than imported) so this stays a pure function — DataContext supplies its own
// teacherAssignments-derived implementation, the same one Report Cards/Promotion already use, so
// the subject list here never drifts from theirs.
function computeClassSemesterResults({ db, classId, semester, requiredSubjectsForClass, academicYearId }) {
  const subjects = requiredSubjectsForClass(classId);
  const students = db.students.filter((s) => s.classId === classId);
  const baseRows = students.map((s) => ({
    studentId: s.id,
    ...computeStudentSemesterAverage({ results: db.results, studentId: s.id, classId, subjects, semester, academicYearId }),
  }));
  const rows = rankStudents(baseRows);

  const studentsTotal = rows.length;
  const studentsWithAnyResult = rows.filter((r) => r.subjectsComplete > 0).length;
  const studentsAllComplete = rows.filter((r) => r.allComplete).length;

  // Class average includes any student with at least one graded subject — requiring every student
  // to finish every subject before showing a class average would leave it blank for weeks during
  // normal entry. Rank/Top Student intentionally use the stricter allComplete rule above; a
  // student can count toward the class average while still showing "—" for rank.
  const withAverage = rows.filter((r) => r.average != null);
  const classAverage = withAverage.length ? Math.round(withAverage.reduce((sum, r) => sum + r.average, 0) / withAverage.length) : null;

  const rank1 = rows.filter((r) => r.rank === 1);
  const topStudents = rank1.length ? rank1 : [];

  const subjectAverages = {};
  for (const subject of subjects) {
    const pcts = rows.map((r) => r.bySubject[subject]).filter((p) => p != null);
    subjectAverages[subject] = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  }

  return { classId, semester, subjects, rows, studentsTotal, studentsWithAnyResult, studentsAllComplete, classAverage, topStudents, subjectAverages };
}

// Ties broken by studentId (stable, arbitrary) — no school policy exists yet for a genuine
// cross-class tie at the very top, so this is a documented placeholder, not a real tiebreak rule.
function findSchoolTopPerformer(perClassResults) {
  let best = null;
  for (const classResult of perClassResults) {
    for (const student of classResult.topStudents) {
      if (!best || student.average > best.average || (student.average === best.average && student.studentId < best.studentId)) {
        best = { ...student, classId: classResult.classId, semester: classResult.semester };
      }
    }
  }
  return best;
}

export { ordinal, subjectPct, computeStudentSemesterAverage, rankStudents, computeClassSemesterResults, findSchoolTopPerformer };
