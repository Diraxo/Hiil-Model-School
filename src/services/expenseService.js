// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase.
export function createExpenseService(data) {
  return {
    list: () => data.db.expenses,
    create: (payload, recordedBy) => data.createExpense(payload, recordedBy),
    remove: (id) => data.deleteExpense(id),
  };
}
