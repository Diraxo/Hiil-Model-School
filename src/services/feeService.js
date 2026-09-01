// Phase 4 (Fees / Payments / Expenses): real Supabase-backed fee-catalog service.
//
// Owns only the "what fees exist and what does each student owe" side of finance:
//   fee_types  -> fee_schedules (per academic year) -> fee_installments (monthly)
//   -> student_fee_obligations -> fee_obligation_adjustments
//
// Payments/allocations/methods live in paymentService.js; expenses in expenseService.js.
// DataContext.jsx owns the read-side state + refetch and shadows every list into the mock
// `db` shape so the ~15 pure fee helpers (scheduleForFeeType / feeRowsForStudentIn /
// netOwedForObligation / describeAllocation / ...) keep working unchanged.
//
// RLS (20260825190000_rls_policies.sql L1176-1240):
//   fee_types / fee_schedules / fee_installments : SELECT any ACTIVE member; INSERT/UPDATE
//     Owner/Finance. fee_installments DELETE added in 20260902000000 (Owner/Finance, and the
//     student_fee_obligations FK is ON DELETE RESTRICT so a billed installment can't be removed).
//   student_fee_obligations : SELECT Owner/Finance or a linked parent; INSERT Owner/Finance.
//   fee_obligation_adjustments : SELECT Owner/Finance or linked parent; writes only via the
//     add_obligation_adjustment RPC.
// Generation RPCs (20260902010000): generate_monthly_fee_installments /
//   materialize_obligations_for_schedule / materialize_obligations_for_student -- all
//   SECURITY DEFINER, Owner/Finance-only, idempotent.
import { supabase } from "../lib/supabaseClient";

const ts = (v) => (v ? new Date(v).getTime() : null);
const num = (v) => (v == null ? null : Number(v));

function mapFeeType(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description || "",
    defaultUnitAmount: num(r.default_unit_amount) || 0,
    defaultUnitMonths: num(r.default_unit_months) || 1,
    defaultUnitsPerYear: r.default_units_per_year || 1,
    archivedAt: ts(r.archived_at),
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
  };
}

function mapSchedule(r) {
  return {
    id: r.id,
    feeTypeId: r.fee_type_id,
    academicYearId: r.academic_year_id,
    unitAmount: num(r.unit_amount) || 0,
    unitMonths: num(r.unit_months) || 1,
    unitsPerYear: r.units_per_year || 1,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    createdBy: r.created_by || null,
  };
}

function mapInstallment(r) {
  return {
    id: r.id,
    feeScheduleId: r.fee_schedule_id,
    sequenceIndex: r.sequence_index,
    label: r.label,
    dueDate: r.due_date,
    amount: num(r.amount) || 0,
    periodMonth: r.period_month || null,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
  };
}

function mapObligation(r) {
  return {
    id: r.id,
    studentId: r.student_id,
    feeInstallmentId: r.fee_installment_id,
    amountDue: num(r.amount_due) || 0,
    createdReason: r.created_reason,
    createdAt: ts(r.created_at),
  };
}

function mapAdjustment(r) {
  return {
    id: r.id,
    obligationId: r.obligation_id,
    type: r.type,
    amount: num(r.amount) || 0,
    reason: r.reason || "",
    createdBy: r.created_by || null,
    createdAt: ts(r.created_at),
  };
}

export function createFeeService() {
  return {
    async listFeeTypes() {
      const { data, error } = await supabase.from("fee_types").select("*").order("created_at");
      if (error) throw error;
      return (data || []).map(mapFeeType);
    },
    async listSchedules() {
      const { data, error } = await supabase.from("fee_schedules").select("*").order("created_at");
      if (error) throw error;
      return (data || []).map(mapSchedule);
    },
    async listInstallments() {
      const { data, error } = await supabase
        .from("fee_installments").select("*").order("fee_schedule_id").order("sequence_index");
      if (error) throw error;
      return (data || []).map(mapInstallment);
    },
    async listObligations() {
      const { data, error } = await supabase.from("student_fee_obligations").select("*");
      if (error) throw error;
      return (data || []).map(mapObligation);
    },
    async listAdjustments() {
      const { data, error } = await supabase.from("fee_obligation_adjustments").select("*").order("created_at");
      if (error) throw error;
      return (data || []).map(mapAdjustment);
    },

    /* ---------- fee_types ---------- */
    async createFeeType({ name, category, description, defaultUnitAmount, defaultUnitMonths, defaultUnitsPerYear }) {
      const { data, error } = await supabase.from("fee_types").insert({
        name: name.trim(),
        category,
        description: description || null,
        default_unit_amount: Number(defaultUnitAmount) || 0,
        default_unit_months: Number(defaultUnitMonths) || 1,
        default_units_per_year: Number(defaultUnitsPerYear) || 1,
      }).select().single();
      if (error) throw error;
      return mapFeeType(data);
    },
    async updateFeeType(id, patch) {
      const row = {};
      if (patch.name !== undefined) row.name = patch.name.trim();
      if (patch.category !== undefined) row.category = patch.category;
      if (patch.description !== undefined) row.description = patch.description || null;
      if (patch.defaultUnitAmount !== undefined) row.default_unit_amount = Number(patch.defaultUnitAmount) || 0;
      if (patch.defaultUnitMonths !== undefined) row.default_unit_months = Number(patch.defaultUnitMonths) || 1;
      if (patch.defaultUnitsPerYear !== undefined) row.default_units_per_year = Number(patch.defaultUnitsPerYear) || 1;
      const { data, error } = await supabase.from("fee_types").update(row).eq("id", id).select().single();
      if (error) throw error;
      return mapFeeType(data);
    },
    async archiveFeeType(id) {
      const { error } = await supabase.from("fee_types").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    async deleteFeeType(id) {
      const { error } = await supabase.from("fee_types").delete().eq("id", id);
      if (error) throw error;
    },
    async hasSchedules(feeTypeId) {
      const { count, error } = await supabase
        .from("fee_schedules").select("id", { count: "exact", head: true }).eq("fee_type_id", feeTypeId);
      if (error) throw error;
      return (count || 0) > 0;
    },

    /* ---------- fee_schedules + monthly installments ---------- */
    async createSchedule({ feeTypeId, academicYearId, unitAmount, unitMonths, unitsPerYear, createdBy }) {
      const { data, error } = await supabase.from("fee_schedules").insert({
        fee_type_id: feeTypeId,
        academic_year_id: academicYearId,
        unit_amount: Number(unitAmount) || 0,
        unit_months: Number(unitMonths) || 1,
        units_per_year: Number(unitsPerYear) || 1,
        created_by: createdBy || null,
      }).select().single();
      if (error) throw error;
      return mapSchedule(data);
    },
    async updateSchedule(id, patch) {
      const row = {};
      if (patch.unitAmount !== undefined) row.unit_amount = Number(patch.unitAmount) || 0;
      if (patch.unitMonths !== undefined) row.unit_months = Number(patch.unitMonths) || 1;
      if (patch.unitsPerYear !== undefined) row.units_per_year = Number(patch.unitsPerYear) || 1;
      const { data, error } = await supabase.from("fee_schedules").update(row).eq("id", id).select().single();
      if (error) throw error;
      return mapSchedule(data);
    },
    async generateMonthlyInstallments(scheduleId) {
      const { data, error } = await supabase.rpc("generate_monthly_fee_installments", { p_fee_schedule_id: scheduleId });
      if (error) throw error;
      return (data || []).map(mapInstallment);
    },
    async updateInstallment(id, patch) {
      const row = {};
      if (patch.label !== undefined) row.label = patch.label;
      if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
      if (patch.amount !== undefined) row.amount = Number(patch.amount) || 0;
      const { data, error } = await supabase.from("fee_installments").update(row).eq("id", id).select().single();
      if (error) throw error;
      return mapInstallment(data);
    },
    async deleteInstallment(id) {
      const { error } = await supabase.from("fee_installments").delete().eq("id", id);
      if (error) throw error;
    },
    async installmentHasObligations(installmentId) {
      const { count, error } = await supabase
        .from("student_fee_obligations").select("id", { count: "exact", head: true }).eq("fee_installment_id", installmentId);
      if (error) throw error;
      return (count || 0) > 0;
    },

    /* ---------- obligation materialization (RPCs) ---------- */
    async materializeForSchedule(scheduleId, anchorDate = null, reason = "YEAR_ROLLOUT") {
      const { data, error } = await supabase.rpc("materialize_obligations_for_schedule", {
        p_fee_schedule_id: scheduleId,
        p_anchor_date: anchorDate,
        p_reason: reason,
      });
      if (error) throw error;
      return data || 0;
    },
    async materializeForStudent(studentId, academicYearId, anchorDate = null, reason = "ENROLLMENT") {
      const { data, error } = await supabase.rpc("materialize_obligations_for_student", {
        p_student_id: studentId,
        p_academic_year_id: academicYearId,
        p_anchor_date: anchorDate,
        p_reason: reason,
      });
      if (error) throw error;
      return data || 0;
    },

    /* ---------- adjustments (RPC) ---------- */
    async addAdjustment(obligationId, { type, amount, reason }, createdBy) {
      const { data, error } = await supabase.rpc("add_obligation_adjustment", {
        p_obligation_id: obligationId,
        p_type: type,
        p_amount: Number(amount) || 0,
        p_reason: reason,
        p_created_by: createdBy || null,
      });
      if (error) throw error;
      return Array.isArray(data) ? mapAdjustment(data[0]) : mapAdjustment(data);
    },
  };
}
