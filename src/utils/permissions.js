// Centralized Results permission checks — replaces ad hoc inline role checks (e.g. the old
// head-teacher-only `classIsEditable` in the Results UI) with a single source of truth for who
// can view/edit/publish/lock a given student+class+subject+semester result. Reuses the existing
// `teacherAssignments` ({teacherId, subject, classId}) ownership convention already used by
// homework/timetable — NOT `headTeacherId`, which only tells you who leads a class, not who
// teaches a given subject in it. This is a deliberate behavior fix versus today's Results UI:
// the target permission matrix is subject-level ("a teacher cannot touch another teacher's
// subject"), which only teacherAssignments encodes.
//
// These are client-side helpers that decide which inputs/buttons to render. The real enforcement
// is Supabase RLS (see supabase/migrations/20260825190000_rls_policies.sql and the per-domain
// service headers); these checks just keep the UI honest and give a friendly message.
import { ROLES } from "./constants";
import { classifySemesterResultLock } from "./academicCalendar";

function isAssignedSubjectTeacher(user, classId, subject, teacherAssignments) {
  return !!user && Array.isArray(teacherAssignments) &&
    teacherAssignments.some((ta) => ta.teacherId === user.id && ta.classId === classId && ta.subject === subject);
}

// ctx: { classId, subject, studentId, teacherAssignments, parentChildIds }
function canViewResult(user, ctx) {
  if (!user) return false;
  if (user.role === ROLES.OWNER || user.role === ROLES.ADMIN) return true;
  if (user.role === ROLES.TEACHER) return isAssignedSubjectTeacher(user, ctx.classId, ctx.subject, ctx.teacherAssignments);
  if (user.role === ROLES.PARENT) return !!ctx.parentChildIds && ctx.parentChildIds.includes(ctx.studentId);
  return false; // FINANCE and anyone else: zero access to Results
}

// `record` may be null if no result has been saved yet for this student+subject+semester.
function canEditResultComponent(user, ctx, record) {
  if (record && record.publishStatus === "LOCKED") return false; // locked blocks everyone, including Owner/Admin, until unlocked
  if (!user) return false;
  if (user.role === ROLES.OWNER || user.role === ROLES.ADMIN) return true;
  if (user.role === ROLES.TEACHER) return isAssignedSubjectTeacher(user, ctx.classId, ctx.subject, ctx.teacherAssignments);
  return false;
}

function canPublishResult(user) { return !!user && (user.role === ROLES.OWNER || user.role === ROLES.ADMIN); }
function canLockResult(user) { return canPublishResult(user); }
function canUnlockResult(user) { return canPublishResult(user); }

// Parents never see the audit trail; everyone else follows the same scoping as canViewResult.
function canViewResultAudit(user, ctx) {
  if (!user || user.role === ROLES.PARENT || user.role === ROLES.FINANCE) return false;
  return canViewResult(user, ctx);
}

// The single answer both DataContext's mutators and the gradebook UI consult for "can this
// result be edited right now" — combines the manual publishStatus lock (wins outright, matches
// today's behavior/message exactly), the calendar-derived auto-lock, and any active
// `autoLockOverride` on the record. `record` may be null (nothing saved yet — the calendar alone
// decides). `cal` must be the result's OWN academic year (resolve via `record.academicYearId`,
// falling back to the current year for a not-yet-created record), never assumed to be "whatever
// year is current" once records can belong to a past year.
function effectiveResultLock(record, semester, cal, todayKey) {
  if (record && record.publishStatus === "LOCKED") {
    return { locked: true, source: "manual", phase: "manual", message: "This result is locked. Ask the Owner or Educational Director to unlock it first." };
  }
  const auto = classifySemesterResultLock(semester, cal, todayKey);
  if (!auto.locked) return { locked: false, source: "none", phase: auto.phase, message: "" };
  if (record && record.autoLockOverride) {
    return { locked: false, source: "override", phase: auto.phase, message: auto.message, overrideReason: record.autoLockOverride.reason };
  }
  return { locked: true, source: "auto", phase: auto.phase, message: auto.message };
}

export {
  isAssignedSubjectTeacher, canViewResult, canEditResultComponent,
  canPublishResult, canLockResult, canUnlockResult, canViewResultAudit,
  effectiveResultLock,
};
