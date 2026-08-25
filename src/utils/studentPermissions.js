// Centralized Students permission checks — replaces the single ad hoc `isTeacher` check that used
// to gate `StudentProfilePage` (Edit/Suspend/Delete/Payments were otherwise wide open to whoever
// opened the page, including Teacher and Finance). Mirrors the existing `utils/permissions.js`
// (Results) / `utils/staffPermissions.js` (Staff) pattern: simple `(user) -> boolean` checks, no
// server-side enforcement yet (Phase 2/Supabase RLS's job) — Phase 1's UI calls these before
// rendering inputs/buttons.
import { ROLES, STUDENT_STATUS } from "./constants";

// A student in one of these statuses is no longer part of day-to-day school life — they drop out
// of attendance-taking and homework-target rosters, but their historical records stay fully
// visible on their own profile (that view reads directly by studentId, not through a roster).
const ATTENDANCE_INELIGIBLE_STATUSES = ["SUSPENDED", "TRANSFERRED", "GRADUATED", "WITHDRAWN", "ARCHIVED"];
function canTakeAttendance(status) { return !ATTENDANCE_INELIGIBLE_STATUSES.includes(status); }

function canEditStudent(user) { return !!user && (user.role === ROLES.OWNER || user.role === ROLES.ADMIN); }
function canDeleteStudent(user) { return canEditStudent(user); }
function canSuspendStudent(user) { return canEditStudent(user); }
function canChangeStudentPhoto(user) { return canEditStudent(user); }
function canManageAcademicYears(user) { return canEditStudent(user); }
// Spec §20/§14: Owner and Educational Director can add behavior records; Teacher/Finance cannot
// (Teacher can still view them on a student's profile).
function canAddBehavior(user) { return canEditStudent(user); }

// Spec §17: only Owner and Finance & Operations Director ever see a student's payment
// information — Educational Director and Teacher get zero access, no matter how they reach the
// student profile.
function canViewStudentPayments(user) { return !!user && (user.role === ROLES.OWNER || user.role === ROLES.FINANCE); }

// Blocker 4 (payment void policy): same two roles that can see payments at all, no separate
// approval workflow for V1. A payment can only ever be voided, never edited or deleted.
function canVoidPayment(user) { return canViewStudentPayments(user); }

// Status -> explanatory copy, shared by every "this student is no longer active" surface (Parent
// dashboard's suspension block, Teacher's student-profile banner) so they can't drift apart.
// Text-only (no JSX) so it stays usable from any surface regardless of layout.
function studentStatusNotice(student) {
  if (!student || !ATTENDANCE_INELIGIBLE_STATUSES.includes(student.status)) return null;
  switch (student.status) {
    case "SUSPENDED":
      return {
        title: `${student.name || "This student"} is currently suspended`,
        message: student.suspension
          ? `${student.suspension.reason}${student.suspension.notes ? ` — ${student.suspension.notes}` : ""}`
          : "This student is suspended.",
        dateRange: student.suspension ? { start: student.suspension.startDate, end: student.suspension.endDate } : null,
      };
    case "TRANSFERRED":
      return { title: "This student has transferred out", message: "They no longer appear on class rosters or attendance." };
    case "GRADUATED":
      return { title: "This student has graduated", message: "Historical records remain available; they no longer appear on class rosters." };
    case "WITHDRAWN":
      return { title: "This student has withdrawn", message: "They no longer appear on class rosters or attendance." };
    case "ARCHIVED":
      return { title: "This student's record is archived", message: "They no longer appear on class rosters or attendance." };
    default:
      return null;
  }
}

export {
  STUDENT_STATUS, ATTENDANCE_INELIGIBLE_STATUSES, canTakeAttendance,
  canEditStudent, canDeleteStudent, canSuspendStudent, canChangeStudentPhoto,
  canManageAcademicYears, canAddBehavior, canViewStudentPayments, canVoidPayment, studentStatusNotice,
};
