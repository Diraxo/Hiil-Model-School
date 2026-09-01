import { useMemo } from "react";
import { useData } from "../context/DataContext";
import {
  createStudentService, createTeacherService, createParentService, createClassService,
  createSubjectService, createHomeworkService, createAttendanceService, createResultsService,
  createResultAuditService, createResultService, createResultEvidenceService, createExamService,
  createBehaviorService, createAnnouncementService, createMessageService, createNotificationService,
  createPaymentService, createTimetableService, createReportService,
  createStaffService, createPayrollService, createExpenseService, createReportCardService, createAuditLogService,
} from "./index";

// Optional convenience hook: `const services = useServices();` gives you
// `services.students.create(...)`, `services.payments.record(...)`, etc.
// Existing pages call `useData()` directly (unchanged, to keep this pass
// low-risk); new work can use this instead, and it's the natural place to
// start once Phase 2 swaps individual services for Supabase-backed ones.
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
      announcements: createAnnouncementService(data),
      messages: createMessageService(data),
      notifications: createNotificationService(data),
      payments: createPaymentService(data),
      timetable: createTimetableService(data),
      reports: createReportService(data),
      staff: createStaffService(),
      payroll: createPayrollService(),
      expenses: createExpenseService(data),
      reportCards: createReportCardService(),
      auditLog: createAuditLogService(data),
    };
  }, [data]);
}
