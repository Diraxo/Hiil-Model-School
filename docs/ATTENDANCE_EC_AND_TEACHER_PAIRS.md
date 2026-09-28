# Attendance on the Ethiopian Calendar + teacher class/subject pairs

No migration, no data change. Both fixes are client-side; the database already stores the right shape.

## 1. Attendance is E.C.-first

**Storage (unchanged).** `attendance.date` is a Postgres `date` — the real Gregorian day. Rows are never re-dated, re-created or re-counted.

**What was wrong.** The Monthly Register was keyed by a *Gregorian* month (`"2026-09"`); only its heading was translated ("Meskerem 2019 (September 2026)"). Its columns were the Gregorian day numbers 1-30 of September — `14 15 16 17 18 21 22 …` — not Meskerem days. The student profile's Attendance tab did the same.

**Now.**

| Piece | Behaviour |
|---|---|
| E.C. month key | `"2019-01"` = Meskerem 2019 (`ecMonthKey*` / `ecMonthDays` / `ecMonthRange` / `shiftEcMonthKey` in `src/utils/ethiopianCalendar.js` — the one conversion engine; 13 months, leap Pagumen) |
| `EcMonthNav` (`ui.jsx`) | pages by E.C. month, e.g. "Meskerem 2019 E.C. (11 Sept – 10 Oct 2026 G.C.)" |
| Monthly Register | `registerDays()` (`src/utils/attendanceRegister.js`) converts each E.C. day to the stored Gregorian date key and looks records up by it. Columns show the **E.C. day number** (Meskerem 2019 → `4 5 6 7 8 11 12 …`). School-day rules still come from `classifyAttendanceDate` — nothing re-implemented |
| Student profile → Attendance | same E.C. month paging; records filtered by the month's Gregorian span; row dates shown E.C.-first |
| `DateNav` (take/view/edit attendance, staff + parent attendance) | E.C. day/month/year selects (with a "G.C." switch to the native picker); value handed back is still the Gregorian key |
| "Recorded by … · date" | E.C. first |

Also fixed in the engine: `ethiopianToGregorian` / `gregorianToEthiopian` now use calendar-day arithmetic, so a DST change between New Year and the target date cannot shift the result by a day (only matters for browsers in DST time zones; East Africa has none).

**Totals.** A register month is now an E.C. month (11 Sep – 10 Oct), so a month's totals differ from the old Gregorian-September window — but every record is counted exactly once, and the sum over all months equals the stored rows (asserted in `tests/ethiopianAttendance.test.js`, and checked against the real 179 production rows).

## 2. Teacher assignments are class + subject pairs

**Model (unchanged, already correct).** `teacher_assignments(teacher_id, class_id, subject_id)`, `unique(class_id, subject_id)`; RLS helper `teaches_class_subject(class, subject)` checks that exact row. Results, homework, evidence and result-audit policies all use it. Class-level scopes (attendance, students, timetable read, result-configuration read) deliberately use "any assignment in the class or head teacher" — those are not subject-scoped.

**What was wrong.** The Add/Edit Teacher form collected `classIds[]` and `subjects[]` independently and `_resolveTeacherAssignments` crossed them. Selecting Grade 9 + Grade 10 and English + Mathematics created every valid combination; opening *Edit* on a teacher with two pairs and pressing Save would widen it the same way. Saving also deleted all of a teacher's rows and re-inserted them.

**Now.**
- `src/utils/teacherAssignments.js`: pair helpers (`addPair`, `removePair`, `diffPairs`, `teachesPair`, `resolveTeacherPairs`). No function crosses two lists.
- Teacher form: "Teaching assignments" — an explicit list (`Grade 9 — English  [Remove]`) plus one Class + Subject "Add" row. The subject list is the chosen class's curriculum. A pair held by another teacher is offered only as "Reassign & add".
- `createTeacher({ assignments })`, `updateTeacherAssignments(teacherId, assignments, reassignments)` take pairs. Update writes only the **difference** (no delete-all-and-recreate); an invalid pair fails the whole request instead of being silently dropped.
- Teacher cards show pair badges instead of separate Classes / Subjects lists.

## Tests
`ethiopianAttendance.test.js`, `ethiopianAttendanceUi.test.jsx`, `teacherAssignmentPairs.test.js`, `teacherAssignmentForm.test.jsx`, `teacherAssignmentDataContext.test.jsx`, `teacherAssignmentPairsDb.test.js` (PGlite replica of every migration: direct inserts of unassigned pairs into results/homework/teacher_assignments are refused).
