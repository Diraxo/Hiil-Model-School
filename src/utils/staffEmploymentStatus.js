// Employment (are they currently employed) is a separate concept from account status (can they
// log in) — see endEmployment/reactivateEmployment/setStaffStatus/setAccountStatus in
// DataContext.jsx. A disabled login does NOT mean employment ended, and ended employment does NOT
// erase the staff record — see staffSalarySummary (DataContext.jsx) for how this caps payroll
// accrual, and deleteStaff/deleteTeacher for the (separate, still-destructive) permanent-delete path.
function employmentActiveOn(staff, dateKey) {
  if (!staff) return false;
  if (staff.employmentDate && staff.employmentDate > dateKey) return false;
  if (staff.employmentEndDate && dateKey > staff.employmentEndDate) return false;
  return true;
}

export { employmentActiveOn };
