// The in-memory shape the rest of the app's `db` object is built on. Every domain is served from
// Supabase and DataContext overlays the live rows onto this object, so nothing here is read at
// runtime except as an empty starting point before the first fetch resolves. It carries NO user
// records, NO credentials, and NO demo data. (This file replaced the old seed.js, which used to
// build an in-browser demo school and persist it to localStorage.)
//
// `academicCalendar` is a sane default — utils/academicCalendar.js's classifyAttendanceDate /
// classifySemesterResultLock read it directly, and DataContext replaces it with the real active
// academic year as soon as one loads.
import { DEFAULT_TIMETABLE_CONFIG } from "../utils/constants";
import { defaultAcademicCalendar } from "../utils/academicCalendar";

export function buildSkeleton() {
  const now = Date.now();
  return {
    version: 1,
    updatedAt: now,
    users: [],
    students: [],
    classes: [],
    subjects: [],
    classSubjects: [],
    teacherAssignments: [],
    homework: [],
    attendance: [],
    staffAttendance: [],
    periodLogs: [],
    results: [],
    resultAuditLog: [],
    resultEvidence: [],
    examAnnouncements: [],
    behaviorRecords: [],
    announcements: [],
    notifications: [],
    conversations: [],
    messages: [],
    activities: [],
    feeTypes: [],
    feeSchedules: [],
    feeInstallments: [],
    studentFeeObligations: [],
    feeObligationAdjustments: [],
    paymentMethods: [],
    payments: [],
    paymentAllocations: [],
    paymentAuditLog: [],
    timetableEntries: [],
    substitutions: [],
    schoolClosures: [],
    leaveRequests: [],
    ownerLeaveLog: [],
    enrollments: [],
    studentDocuments: [],
    staff: [],
    payrollPayments: [],
    salaryAdvances: [],
    expenses: [],
    reportCards: [],
    academicYears: [],
    timetableConfig: { ...DEFAULT_TIMETABLE_CONFIG, updatedAt: now, updatedBy: null },
    academicCalendar: defaultAcademicCalendar(),
  };
}
