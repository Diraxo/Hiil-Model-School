// Pure fee-ledger read model, parameterized by `dbLike` (the last-fetched Supabase state) — moved out
// of DataContext.jsx so the rules can be unit-tested without the whole provider.
//
// Fee schema (Blocker 2): fee_types (catalog) -> fee_schedules (one per fee type per ACADEMIC YEAR) ->
// fee_installments (one per billing month of that year) -> student_fee_obligations (what one student
// owes for one installment) -> payment_allocations (how a payment funds obligations). Everything is
// keyed by the academic year through its schedule, so a payment can never leak into another year's
// balance: an obligation belongs to exactly one installment, which belongs to exactly one schedule.

function localTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function scheduleForFeeType(dbLike, feeTypeId, academicYearId) {
  return dbLike.feeSchedules.find((s) => s.feeTypeId === feeTypeId && s.academicYearId === academicYearId) || null;
}
function installmentsForSchedule(dbLike, scheduleId) {
  return dbLike.feeInstallments.filter((i) => i.feeScheduleId === scheduleId).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
}
function obligationForInstallment(dbLike, studentId, feeInstallmentId) {
  return dbLike.studentFeeObligations.find((o) => o.studentId === studentId && o.feeInstallmentId === feeInstallmentId) || null;
}
function adjustmentsTotal(dbLike, obligationId) {
  return (dbLike.feeObligationAdjustments || []).filter((a) => a.obligationId === obligationId).reduce((s, a) => s + a.amount, 0);
}
// Excludes allocations belonging to a VOIDED payment — a voided receipt must stop counting toward
// the balance of every student it covered (the promise the Void Payment modal makes), not just
// disappear from the "Collected" dashboard stat.
function allocationsTotal(dbLike, obligationId) {
  return (dbLike.paymentAllocations || [])
    .filter((a) => a.obligationId === obligationId)
    .filter((a) => { const p = dbLike.payments.find((pp) => pp.id === a.paymentId); return p && p.status !== "VOIDED"; })
    .reduce((s, a) => s + a.amount, 0);
}
// Allocations of VOIDED receipts against one obligation — shown as a muted "receipt voided" note on
// the month, never counted toward what is paid.
function voidedAllocationsTotal(dbLike, obligationId) {
  return (dbLike.paymentAllocations || [])
    .filter((a) => a.obligationId === obligationId)
    .filter((a) => { const p = dbLike.payments.find((pp) => pp.id === a.paymentId); return p && p.status === "VOIDED"; })
    .reduce((s, a) => s + a.amount, 0);
}
// Net owed is always computed at read time from the obligation's frozen amountDue minus every
// adjustment/allocation against it — never stored, so it can never drift out of sync with them.
function netOwedForObligation(dbLike, obligation) {
  if (!obligation) return 0;
  return Math.max(0, obligation.amountDue - adjustmentsTotal(dbLike, obligation.id) - allocationsTotal(dbLike, obligation.id));
}

// Status of one billing period for one student. NOT_APPLICABLE is its own state — a month the student
// was never billed for (they enrolled after it, or the fee doesn't cover them) — and is NEVER a debt:
// it has no obligation, so it contributes nothing to any balance.
const FEE_PERIOD_STATUS = Object.freeze({
  PAID: "PAID", PARTIAL: "PARTIAL", UNPAID: "UNPAID", NOT_APPLICABLE: "NOT_APPLICABLE",
});

// Shared engine behind installmentStatusForStudent/busScheduleForStudent/balanceFor/
// dueStatusForFeeType. Returns:
//   rows     — one obligation-backed row per installment THIS STUDENT OWES, in schedule order (the only
//              rows that count toward balances and that can be paid);
//   periods  — every installment of the year's schedule in order: the same rows plus a NOT_APPLICABLE
//              placeholder for each month the student has no obligation for (Decision A: a mid-year
//              joiner's earlier months). Display-only — never used in a sum.
function feeRowsForStudentIn(dbLike, student, feeType, academicYearId, todayKey = localTodayKey()) {
  const schedule = scheduleForFeeType(dbLike, feeType.id, academicYearId);
  if (!schedule) return { schedule: null, installments: [], rows: [], periods: [], currentIndex: -1 };
  const installments = installmentsForSchedule(dbLike, schedule.id);
  const todayMonth = todayKey.slice(0, 7); // YYYY-MM
  const allRows = installments.map((inst) => {
    const ob = obligationForInstallment(dbLike, student.id, inst.id);
    const instMonth = (inst.periodMonth || inst.dueDate || "").slice(0, 7);
    if (!ob) {
      return { installment: inst, amountDue: 0, paid: 0, remaining: 0, voided: 0, status: FEE_PERIOD_STATUS.NOT_APPLICABLE, obligationId: null, instMonth, applicable: false };
    }
    const remaining = netOwedForObligation(dbLike, ob);
    const paid = ob.amountDue - remaining;
    const status = remaining <= 0 ? FEE_PERIOD_STATUS.PAID : paid > 0 ? FEE_PERIOD_STATUS.PARTIAL : FEE_PERIOD_STATUS.UNPAID;
    return { installment: inst, amountDue: ob.amountDue, paid, remaining, voided: voidedAllocationsTotal(dbLike, ob.id), status, obligationId: ob.id, instMonth, applicable: true };
  });
  const baseRows = allRows.filter((r) => r.applicable);
  // BLOCKER 6: "current" is the row for the current *calendar month* — a monthly fee's period is
  // the whole month, not "any date before the 1st". If the student has no obligation for the
  // current month (mid-year joiner, or the academic year has ended) fall back to the first future
  // row, else the last. currentIndex indexes into the returned `rows`, so callers that slice
  // `rows` by it (dueStatusForFeeType) stay correct for mid-year joiners too.
  let currentIndex = baseRows.findIndex((r) => r.instMonth === todayMonth);
  if (currentIndex === -1) {
    const firstFuture = baseRows.findIndex((r) => r.instMonth > todayMonth);
    currentIndex = firstFuture === -1 ? baseRows.length - 1 : firstFuture;
  }
  const currentObligationId = currentIndex >= 0 && baseRows[currentIndex] ? baseRows[currentIndex].obligationId : null;
  const rows = baseRows.map((r, i) => ({ ...r, isCurrent: i === currentIndex }));
  const periods = allRows.map((r) => ({ ...r, isCurrent: r.applicable && r.obligationId === currentObligationId }));
  return { schedule, installments, rows, periods, currentIndex };
}

export {
  FEE_PERIOD_STATUS,
  scheduleForFeeType, installmentsForSchedule, obligationForInstallment,
  adjustmentsTotal, allocationsTotal, voidedAllocationsTotal, netOwedForObligation,
  feeRowsForStudentIn,
};
