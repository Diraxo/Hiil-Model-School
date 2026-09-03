// Barrel export for the per-domain data services. Every service in this folder is
// Supabase-backed: it talks to Postgres (RLS-enforced), the SECURITY DEFINER RPCs,
// Storage, and Realtime through the shared client in src/lib/supabaseClient.js.
// DataContext owns the read-side state + refetch for each domain; pages import these
// through `useServices()` / `useData()` and never touch the client directly.
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
