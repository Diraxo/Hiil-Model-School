// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createPayrollService(data) {
  return {
    list: () => data.db.payrollPayments,
    summaryFor: (staffId) => data.staffSalarySummary(staffId),
    record: (staffId, payload, recordedBy) => data.recordPayrollPayment(staffId, payload, recordedBy),
  };
}
