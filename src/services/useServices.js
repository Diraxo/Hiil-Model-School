import { useMemo } from "react";
import { useData } from "../context/DataContext";
import {
  createStudentService, createTeacherService, createParentService, createClassService,
  createSubjectService, createHomeworkService, createAttendanceService, createResultsService,
  createResultAuditService, createResultService, createResultEvidenceService, createExamService,
  createBehaviorService, createAnnouncementService, createMessageService, createNotificationService,
  createActivityService,
  createFeeService, createPaymentService, createTimetableService, createReportService,
  createStaffService, createPayrollService, createExpenseService, createReportCardService, createAuditLogService,
} from "./index";

// Optional convenience hook: `const services = useServices();` gives you
// `services.students.create(...)`, `services.payments.record(...)`, etc.
// Most pages call `useData()` directly; new work can use this bundle instead.
// Every service here is Supabase-backed (see src/services/index.js).
export function useServices() {
  const data = useData();
  return useMemo(() => {
    if (!data) return null;
    return {
      students: createStudentService(),
      teachers: createTeacherService(),
      parents: createParentService(),
      classes: createClassService(),
      subjects: createSubjectService(),
      homework: createHomeworkService(),
      attendance: createAttendanceService(data),
      results: createResultsService(data),
      resultAudit: createResultAuditService(data),
      resultsSupabase: createResultService(),
      resultEvidence: createResultEvidenceService(),
      exams: createExamService(),
      behavior: createBehaviorService(data),
      announcements: createAnnouncementService(),
      messages: createMessageService(),
      notifications: createNotificationService(),
      activity: createActivityService(),
      fees: createFeeService(),
      payments: createPaymentService(),
      timetable: createTimetableService(data),
      reports: createReportService(data),
      staff: createStaffService(),
      payroll: createPayrollService(),
      expenses: createExpenseService(),
      reportCards: createReportCardService(),
      auditLog: createAuditLogService(data),
    };
  }, [data]);
}
