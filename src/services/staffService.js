// Real Supabase-backed staff (HR/payroll identity) + staff_attendance service.
//
// Salary/payment_schedule cannot be hidden column-by-column via RLS (Postgres RLS is row-level
// only) -- see the SCHEMA LIMITATION comment on `staff` in
// supabase/migrations/20260825190000_rls_policies.sql. So there are two read paths here:
//   - list()     -> the `staff_directory` view: no salary/payment_schedule columns at all, and
//                    RLS-scoped to Owner/Finance (every row), Educational Director (Teacher rows
//                    only), or a Teacher (their own row only).
//   - listFull() -> the `staff` table directly: has salary/payment_schedule, but RLS only returns
//                    rows for Owner/Finance -- anyone else gets an empty result, not an error.
// DataContext.jsx picks whichever is appropriate for the current user's role; this file doesn't
// re-implement that decision.
//
// employee_number is server-generated (a trigger + sequence, see
// supabase/migrations/20260825180522_init_profiles_and_roles.sql) -- never sent on create.
// The `staff_financial_field_guard` trigger independently blocks a salary/payment_schedule change
// from anyone but Owner/Finance even if a row-level check is somehow satisfied; update() here just
// forwards whatever patch it's given and lets Postgres reject what it must.
import { supabase } from "../lib/supabaseClient";

function mapStaff(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    employeeNumber: row.employee_number,
    name: row.name,
    position: row.position,
    employmentDate: row.employment_date,
    phone: row.phone || "",
    salary: row.salary !== undefined ? Number(row.salary) : undefined,
    paymentSchedule: row.payment_schedule,
    status: row.status,
    employmentStatus: row.employment_status,
    employmentEndDate: row.employment_end_date || null,
    photo: row.photo_url || null,
    hasShifts: !!row.has_shifts,
    bankAccount: row.bank_account || null,
  };
}

// Educational Director / Finance Director login accounts -- `profiles` rows with role ADMIN or
// FINANCE. Grouped here (not in teacherService.js) because their management already lives
// alongside Staff/Payroll on the Owner side (OwnerPages.jsx's Accounts & Access + Staff pages),
// same reasoning teacherService.js keeps to TEACHER-only.
function mapAccount(row) {
  return {
    id: row.id, role: row.role, name: row.full_name, email: row.email, phone: row.phone || "",
    photo: row.photo_url || null, status: row.status, mustChangePassword: !!row.must_change_password,
  };
}

function mapAttendance(row) {
  return {
    id: row.id,
    staffId: row.staff_id,
    date: row.date,
    period: row.period,
    status: row.status,
    arrivalTime: row.arrival_time || null,
    note: row.note || "",
    markedBy: row.marked_by || null,
    markedAt: row.marked_at ? new Date(row.marked_at).getTime() : null,
    leaveRequestId: row.leave_request_id || null,
  };
}

export function createStaffService() {
  return {
    // Shared status toggle for any login-linked staff (Teacher/Educational Director/Finance
    // Director) -- a plain `profiles` update, gated by RLS's self-or-manager policy plus the
    // profiles_privilege_guard trigger (only someone who manages this person's staff group may
    // change their status). No Edge Function needed here (unlike create/delete/password, which
    // need the service-role key) -- an ordinary authenticated update is the correct real mechanism.
    async setProfileStatus(profileId, status) {
      const { error } = await supabase.from("profiles").update({ status }).eq("id", profileId);
      if (error) throw error;
    },
    async listDirectorAccounts() {
      const { data, error } = await supabase.from("profiles").select("*").in("role", ["ADMIN", "FINANCE"]).order("full_name");
      if (error) throw error;
      return (data || []).map(mapAccount);
    },
    async list() {
      const { data, error } = await supabase.from("staff_directory").select("*").order("name");
      if (error) throw error;
      return (data || []).map(mapStaff);
    },
    async listFull() {
      const { data, error } = await supabase.from("staff").select("*").order("name");
      if (error) throw error;
      return (data || []).map(mapStaff);
    },
    // Self-service: the caller's own staff row, salary included (see
    // supabase/migrations/20260826010000_teacher_self_payroll_rpc.sql). Returns null for a caller
    // with no linked staff row (or when called by Owner/Finance, who already get everything via
    // listFull() and have no staff row of their own to speak of).
    async myRecord() {
      const { data, error } = await supabase.rpc("my_staff_record");
      if (error) throw error;
      return data ? mapStaff(data) : null;
    },
    async create(payload) {
      const row = {
        user_id: payload.userId || null,
        name: payload.name,
        position: payload.position,
        employment_date: payload.employmentDate,
        phone: payload.phone || null,
        salary: Number(payload.salary) || 0,
        has_shifts: !!payload.hasShifts,
        bank_account: payload.bankAccount || null,
        photo_url: payload.photo || null,
      };
      const { data, error } = await supabase.from("staff").insert(row).select().single();
      if (error) throw error;
      return mapStaff(data);
    },
    async update(id, patch) {
      const row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.position !== undefined) row.position = patch.position;
      if (patch.phone !== undefined) row.phone = patch.phone || null;
      if (patch.salary !== undefined) row.salary = Number(patch.salary) || 0;
      if (patch.photo !== undefined) row.photo_url = patch.photo || null;
      if (patch.hasShifts !== undefined) row.has_shifts = !!patch.hasShifts;
      if (patch.bankAccount !== undefined) row.bank_account = patch.bankAccount || null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.employmentStatus !== undefined) row.employment_status = patch.employmentStatus;
      if (patch.employmentEndDate !== undefined) row.employment_end_date = patch.employmentEndDate;
      const { data, error } = await supabase.from("staff").update(row).eq("id", id).select().single();
      if (error) throw error;
      return mapStaff(data);
    },
    async remove(id) {
      const { error } = await supabase.from("staff").delete().eq("id", id);
      if (error) throw error;
    },
    async listAttendance() {
      const { data, error } = await supabase.from("staff_attendance").select("*");
      if (error) throw error;
      return (data || []).map(mapAttendance);
    },
    // Upserts on the table's own unique(staff_id, date, period) constraint -- one call per marked
    // record, mirroring how DataContext already builds one record per staff member per save.
    async saveAttendanceRecord({ staffId, date, period, status, arrivalTime, note, markedBy, leaveRequestId }) {
      const row = {
        staff_id: staffId, date, period: period || "FULL_DAY", status,
        arrival_time: status === "Late" ? (arrivalTime || null) : null,
        note: note || null, marked_by: markedBy || null, marked_at: new Date().toISOString(),
        leave_request_id: leaveRequestId || null,
      };
      const { data, error } = await supabase
        .from("staff_attendance")
        .upsert(row, { onConflict: "staff_id,date,period" })
        .select()
        .single();
      if (error) throw error;
      return mapAttendance(data);
    },
  };
}
