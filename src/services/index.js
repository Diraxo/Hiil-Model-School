// Barrel export for all Phase-1 mock services. Each one wraps the same
// DataContext instance so there's a single source of truth, but gives
// Phase 2 a clean per-domain seam to swap in Supabase-backed versions
// (e.g. replace createStudentService's internals with real queries and
// every page that imports `services` keeps working unchanged).
export { createStudentService } from "./studentService";
export { createTeacherService } from "./teacherService";
export { createParentService } from "./parentService";
export { createClassService } from "./classService";
export { createSubjectService } from "./subjectService";
export { createHomeworkService } from "./homeworkService";
export { createAttendanceService } from "./attendanceService";
export { createResultsService } from "./resultsService";
export { createResultAuditService } from "./resultAuditService";
export { createResultService } from "./resultService";
export { createResultEvidenceService } from "./resultEvidenceService";
export { createExamService } from "./examService";
export { createBehaviorService } from "./behaviorService";
export { createAnnouncementService } from "./announcementService";
export { createMessageService } from "./messageService";
export { createNotificationService } from "./notificationService";
export { createActivityService } from "./activityService";
export { createFeeService } from "./feeService";
export { createPaymentService } from "./paymentService";
export { createTimetableService } from "./timetableService";
export { createClosureService } from "./closureService";
export { createReportService } from "./reportService";
export { createStaffService } from "./staffService";
export { createPayrollService } from "./payrollService";
export { createExpenseService } from "./expenseService";
export { createProfilePhotoService } from "./profilePhotoService";
export { createReportCardService } from "./reportCardService";
export { createAuditLogService } from "./auditLogService";
export { createAccountService } from "./accountService";
