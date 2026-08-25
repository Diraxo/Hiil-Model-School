// Centralized Staff (not Payroll — Payroll stays open to Owner/Finance for every staff group,
// that's Finance's core job) create/edit/disable permission checks, mirroring the style of
// permissions.js (Results) and DataContext's canEditStaffAttendanceFor (Staff Attendance).
// Phase 1's UI calls these before rendering the relevant buttons/forms; Phase 2/Supabase RLS is
// the real enforcement layer, same caveat as the other Phase 1 permission helpers.
import { ROLES, staffGroupLabel, TEACHER_UNAVAILABLE_STATUSES } from "./constants";

function canManageDirectors(user) {
  return !!user && user.role === ROLES.OWNER;
}
function canManageTeachers(user) {
  return !!user && (user.role === ROLES.OWNER || user.role === ROLES.ADMIN);
}
function canManageOtherStaff(user) {
  return !!user && (user.role === ROLES.OWNER || user.role === ROLES.FINANCE);
}

// `position` is a staff record's `position` field (e.g. "Teacher", "Driver") — routes through
// staffGroupLabel so this always agrees with the Staff/Staff Attendance grouping.
function canManageStaffGroup(user, position) {
  const group = staffGroupLabel(position);
  if (group === "Directors") return canManageDirectors(user);
  if (group === "Teachers") return canManageTeachers(user);
  return canManageOtherStaff(user);
}

// Which staff positions a given user is allowed to pick when adding a new staff member —
// Owner sees every position, the Educational Director only Teachers, Finance only Other Staff.
function manageablePositions(user, allPositions) {
  return allPositions.filter((p) => canManageStaffGroup(user, p));
}

// A Teacher marked Absent, Sick, or Permission in their own staff attendance for a date is not
// expected to be at school — teacher-only academic actions for that date (taking student
// attendance, adding homework, entering results) are blocked until a substitute steps in or the
// record is corrected. A substitute being assigned does NOT restore these rights to the original
// teacher. Present/Late/Excused, and "no record yet", never block. Only ever applies to TEACHER —
// Owner/Educational Director/Finance are never subject to this.
// Reuses TEACHER_UNAVAILABLE_STATUSES (constants.js) — the same list that drives substitute
// coverage — so "needs a substitute" and "cannot self-edit academic records" are always one rule.
const ACADEMIC_ACTION_BLOCKING_STATUSES = TEACHER_UNAVAILABLE_STATUSES;
function canTeacherPerformAcademicAction(user, staffAttendanceRecord) {
  if (!user || user.role !== ROLES.TEACHER) return true;
  if (!staffAttendanceRecord) return true;
  return !ACADEMIC_ACTION_BLOCKING_STATUSES.includes(staffAttendanceRecord.status);
}

export {
  canManageDirectors, canManageTeachers, canManageOtherStaff, canManageStaffGroup, manageablePositions,
  canTeacherPerformAcademicAction, ACADEMIC_ACTION_BLOCKING_STATUSES,
};
