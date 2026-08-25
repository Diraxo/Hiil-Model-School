// Money-side payroll permissions, mirroring staffPermissions.js's style. Staff CRUD (including
// bank account edits) stays governed by canManageStaffGroup — these are only about salary,
// advances, and payments, which stay Owner/Finance regardless of staff group. In practice these
// are also enforced by page routing (AppShell only ever routes "staff"/"payroll" to Owner/
// Finance), but the helpers exist so the UI's intent is explicit and doesn't silently drift if
// routing ever changes.
import { ROLES, staffGroupLabel } from "./constants";

function canSetSalary(user) {
  return !!user && (user.role === ROLES.OWNER || user.role === ROLES.FINANCE);
}
// Viewing salary/payroll data at all (StaffProfilePage's Payroll History card, salary figures in
// the header, Recent Activity payroll deep-links) — Educational Director gets zero visibility
// into salary/payroll, same as they get zero visibility into student payments.
function canViewPayroll(user) {
  return !!user && (user.role === ROLES.OWNER || user.role === ROLES.FINANCE);
}
function canRecordAdvance(user) {
  return !!user && (user.role === ROLES.OWNER || user.role === ROLES.FINANCE);
}
function canRecordPayrollPayment(user) {
  return !!user && (user.role === ROLES.OWNER || user.role === ROLES.FINANCE);
}

// Finance can't touch a Director's core staff record (name/position/phone/status — that's
// canManageStaffGroup's job in staffPermissions.js, and Finance fails canManageDirectors there)
// but payroll IS Finance's job, so this opens a narrow financial-only edit path onto salary + bank
// account. Owner already gets the full edit via canManageStaffGroup, so this only ever matters for
// Finance-on-Director — StaffProfilePage offers it as the fallback when the full edit isn't available.
function canEditDirectorFinancials(user, position) {
  return !!user && user.role === ROLES.FINANCE && staffGroupLabel(position) === "Directors";
}

export { canSetSalary, canRecordAdvance, canRecordPayrollPayment, canViewPayroll, canEditDirectorFinancials };
