// Single source of truth for "who is this" across leave requests, behavior records,
// announcements, and notifications — so every screen in the app renders the same
// student/teacher/director/owner label instead of five slightly different bare-name reimplementations.
import { ROLES, ROLE_LABEL } from "./constants";
import { fullName } from "./helpers";

function classLabelFor(db, classId) {
  const c = db.classes.find((x) => x.id === classId);
  return c ? `${c.grade}${c.section}` : "";
}

function teacherClassLabels(db, teacherUserId) {
  const classIds = [...new Set(db.teacherAssignments.filter((ta) => ta.teacherId === teacherUserId).map((ta) => ta.classId))];
  return classIds.map((id) => classLabelFor(db, id)).filter(Boolean);
}

// "Ahmed Abdi Hassan · Grade 3A" (or just the name if the student has no assigned class).
function studentIdentity(db, student) {
  if (!student) return { name: "", classLabel: "", display: "A student" };
  const name = fullName(student.firstName, student.middleName, student.lastName);
  const classLabel = classLabelFor(db, student.classId);
  return { name, classLabel, display: classLabel ? `${name} · ${classLabel}` : name };
}

// "T. Amina Hassan · Grade 3A" for teachers (joining multiple assigned classes with a comma),
// "Educational Director · Name" / "Finance Director · Name" for directors,
// "Mohamed Hassan · Driver" for Other Staff (never a "T." prefix for non-teachers).
function staffIdentity(db, staff) {
  if (!staff) return { name: "", classLabel: "", display: "A staff member" };
  const name = staff.name;
  if (staff.position === "Teacher") {
    const classLabel = teacherClassLabels(db, staff.userId).join(", ");
    return { name, classLabel, display: classLabel ? `T. ${name} · ${classLabel}` : `T. ${name}` };
  }
  if (staff.position === "Educational Director" || staff.position === "Finance Director") {
    return { name, classLabel: "", display: `${staff.position} · ${name}` };
  }
  return { name, classLabel: "", display: staff.position ? `${name} · ${staff.position}` : name };
}

function ownerIdentity() {
  return { name: "School Administration", classLabel: "", display: "School Administration" };
}

// Resolves any login account (Owner/Director/Teacher/Parent) to its display identity —
// the one function leave deciders, announcement authors, and notification "actors" all go through.
function userIdentity(db, userId) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { name: "", classLabel: "", display: "Unknown" };
  if (user.role === ROLES.OWNER) return ownerIdentity();
  if (user.role === ROLES.ADMIN || user.role === ROLES.FINANCE || user.role === ROLES.TEACHER) {
    const staff = db.staff.find((s) => s.userId === userId);
    if (staff) return staffIdentity(db, staff);
    return { name: user.name, classLabel: "", display: `${ROLE_LABEL[user.role] || user.role} · ${user.name}` };
  }
  return { name: user.name, classLabel: "", display: user.name };
}

// The subject of a leave/permission request — a student (kind "STUDENT") or a staff
// member (kind "STAFF", subjectId is a staff row id, not a user id).
function leaveSubjectIdentity(db, kind, subjectId) {
  if (kind === "STUDENT") {
    const s = db.students.find((x) => x.id === subjectId);
    return studentIdentity(db, s).display;
  }
  const staff = db.staff.find((x) => x.id === subjectId);
  return staffIdentity(db, staff).display;
}

// The announcement "From:" line uses its own em-dash compound wording per spec
// ("Owner — School Administration", "Educational Director — Name", "T. Name") —
// deliberately distinct from the dot-separated `display` format used everywhere else.
function announcementSenderLabel(db, authorId) {
  const user = db.users.find((u) => u.id === authorId);
  if (!user) return "School Administration";
  if (user.role === ROLES.OWNER) return "Owner — School Administration";
  if (user.role === ROLES.ADMIN || user.role === ROLES.FINANCE) {
    const staff = db.staff.find((s) => s.userId === authorId);
    return `${ROLE_LABEL[user.role] || user.role} — ${staff ? staff.name : user.name}`;
  }
  if (user.role === ROLES.TEACHER) {
    const staff = db.staff.find((s) => s.userId === authorId);
    return `T. ${staff ? staff.name : user.name}`;
  }
  return user.name;
}

export {
  classLabelFor, teacherClassLabels, studentIdentity, staffIdentity, ownerIdentity,
  userIdentity, leaveSubjectIdentity, announcementSenderLabel,
};
