import React, { useState, useEffect } from "react";
import {
  Crown, Receipt, History, Banknote, ArrowLeftRight,
  UserCog, GraduationCap, Wallet, AlertTriangle, Plus, Check, Eye, EyeOff, RefreshCw, Search as SearchIcon,
  ArrowLeft, ChevronLeft, ChevronRight, Edit2, FileText, ImagePlus, CreditCard, ShieldCheck, ClipboardEdit, Trash2,
  UserX, UserCheck,
} from "lucide-react";
import {
  ROLES, ROLE_LABEL, STAFF_POSITIONS, formatMoney, ATTENDANCE_STATUSES,
  STAFF_SHIFT_PERIOD_LABEL, staffGroupLabel,
} from "../../utils/constants";
import { generatePassword, copyText, timeAgo, fmtDate, fullName, monthLabel } from "../../utils/helpers";
import {
  inputCls, Badge, Avatar, Modal, ConfirmDialog, EmptyState, Field, Card, StatCard,
  Toolbar, SearchInput, PrimaryButton, GhostButton, PaymentStatusBadge, MonthCalendarGrid, statusTone, todayKeyStr, NoSchoolTodayBanner,
} from "../../components/ui";
import { DocumentViewerModal, inferFileType } from "../../components/DocumentViewer";
import { AnnouncementsPreviewCard } from "../../components/announcements";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { StaffLeaveRequestForm, TodaysJournalSummaryCard } from "../admin/AdminPages";
import {
  canManageDirectors, canManageTeachers, canManageOtherStaff, canManageStaffGroup, manageablePositions,
} from "../../utils/staffPermissions";
import { canRecordAdvance, canViewPayroll, canSetSalary, canEditDirectorFinancials } from "../../utils/payrollPermissions";
import { employmentActiveOn } from "../../utils/staffEmploymentStatus";
import { useMutationGuard } from "../../hooks/useMutationGuard";

const STAFF_GROUPS = ["Directors", "Teachers", "Other Staff"];
// Every screen that lists staff (Staff, Payroll, Staff Attendance) groups the same way — this is
// the one place that does the grouping+filtering so they can't drift apart.
function groupStaff(staffList) {
  return STAFF_GROUPS
    .map((label) => ({ label, items: staffList.filter((s) => staffGroupLabel(s.position) === label) }))
    .filter((g) => g.items.length > 0);
}

// Same Directors/Teachers/Other Staff grouping as groupStaff, but for login accounts
// (db.users, bucketed by role) rather than staff/payroll records — used by Accounts & Access.
function userGroupLabel(role) {
  if (role === ROLES.ADMIN || role === ROLES.FINANCE) return "Directors";
  if (role === ROLES.TEACHER) return "Teachers";
  return "Other Staff";
}
function groupUsers(userList) {
  return STAFF_GROUPS
    .map((label) => ({ label, items: userList.filter((u) => userGroupLabel(u.role) === label) }))
    .filter((g) => g.items.length > 0);
}

/* ============================== OWNER DASHBOARD ============================== */

function OwnerDashboard({ setPage, onOpenActivity }) {
  const data = useData();
  const { db } = data;
  const activeStudents = db.students.filter((s) => s.status !== "WITHDRAWN" && s.status !== "TRANSFERRED" && s.status !== "ARCHIVED");
  // "Active Staff" means currently employed, not "can log in right now" (Blocker 3) — a staff
  // member with a disabled account but ongoing employment still counts here.
  const activeStaffCount = db.staff.filter((s) => employmentActiveOn(s, todayKeyStr())).length;
  const totalCollected = db.payments.filter((p) => p.status !== "VOIDED").reduce((sum, p) => sum + p.amountTotal, 0);
  const totalOutstanding = activeStudents.reduce((sum, s) => sum + data.studentPaymentSummary(s).totalOwed, 0);
  const payrollNetPay = db.staff.reduce((sum, s) => sum + (data.staffSalarySummary(s.id)?.outstanding || 0), 0);
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const expensesThisMonth = db.expenses.filter((e) => e.date?.slice(0, 7) === thisMonthKey).reduce((sum, e) => sum + e.totalAmount, 0);
  // Salary advances are real cash out the door the moment they're given (see recordSalaryAdvance
  // in DataContext) even though they're not a `payrollPayments` row — omitting them here would
  // understate every payout. `payrollPayments.amount` is direct salary cash and `salaryAdvances`
  // is advance cash — non-overlapping (an advance is never also a payroll_payments row), so this
  // sum is the complete salary cash outflow with no double-counting.
  const netPosition = totalCollected - db.payrollPayments.reduce((s, p) => s + p.amount, 0) - db.salaryAdvances.reduce((s, a) => s + a.amount, 0) - db.expenses.reduce((s, e) => s + e.totalAmount, 0);
  const todayInfo = data.classifySchoolDay(todayKeyStr());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2"><Crown size={20} className="text-amber-500" /> Owner Overview</h1>
        <p className="text-sm text-slate-400 mt-0.5">Hiil Model School — school-wide financial and operational position.</p>
      </div>

      <NoSchoolTodayBanner classification={todayInfo} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard label="Students" value={activeStudents.length} icon={GraduationCap} tone="sky" />
        <StatCard label="Active Staff" value={activeStaffCount} icon={UserCog} tone="indigo" />
        <StatCard label="School Fee Collected" value={formatMoney(totalCollected)} icon={Wallet} tone="emerald" />
        <StatCard label="School Fee Outstanding" value={formatMoney(totalOutstanding)} icon={AlertTriangle} tone="amber" />
        <StatCard label="Net Position" value={formatMoney(netPosition)} icon={Banknote} tone={netPosition >= 0 ? "emerald" : "red"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Payroll</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Staff on payroll</p><p className="text-lg font-semibold text-slate-800">{db.staff.length}</p></div>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Net pay owed</p><p className="text-lg font-semibold text-amber-600">{formatMoney(payrollNetPay)}</p></div>
          </div>
          <button onClick={() => setPage("payroll")} className="mt-3 text-xs font-medium text-sky-600 hover:text-sky-700">View Payroll →</button>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Expenses</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">This month</p><p className="text-lg font-semibold text-slate-800">{formatMoney(expensesThisMonth)}</p></div>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">All time</p><p className="text-lg font-semibold text-slate-800">{formatMoney(db.expenses.reduce((s, e) => s + e.totalAmount, 0))}</p></div>
          </div>
          <button onClick={() => setPage("expenses")} className="mt-3 text-xs font-medium text-sky-600 hover:text-sky-700">View Expenses →</button>
        </Card>
      </div>

      <TodaysJournalSummaryCard setPage={setPage} />

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">Recent Activity</h3>
          <button onClick={() => setPage("auditLog")} className="text-xs font-medium text-sky-600 hover:text-sky-700">Full Audit Log →</button>
        </div>
        <div className="space-y-3.5 max-h-80 overflow-y-auto">
          {db.activities.slice(0, 10).map((a) => (
            a.navigation ? (
              <button key={a.id} type="button" onClick={() => onOpenActivity && onOpenActivity(a.navigation)} className="w-full flex gap-3 text-xs text-left hover:bg-slate-50 rounded-lg -mx-1 px-1 py-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                <div><p className="text-slate-600 leading-snug hover:text-sky-700">{a.text}</p><p className="text-slate-300 mt-0.5">{timeAgo(a.createdAt)}</p></div>
              </button>
            ) : (
              <div key={a.id} className="flex gap-3 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                <div><p className="text-slate-600 leading-snug">{a.text}</p><p className="text-slate-300 mt-0.5">{timeAgo(a.createdAt)}</p></div>
              </div>
            )
          ))}
        </div>
      </Card>

      <AnnouncementsPreviewCard announcements={db.announcements} />
    </div>
  );
}

/* ============================== ACCOUNTS & ACCESS (Owner-only) ============================== */

function AccountsPage() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const [q, setQ] = useState("");
  const [addRole, setAddRole] = useState(null); // "DIRECTOR" | "FINANCE" | null
  const [confirmStatus, setConfirmStatus] = useState(null); // { user, next }
  const { isBusy, run } = useMutationGuard();

  const owner = db.users.find((u) => u.role === ROLES.OWNER);
  const directors = groupUsers(db.users.filter((u) => u.role === ROLES.ADMIN || u.role === ROLES.FINANCE))[0]?.items || [];
  // "View as" is staff-only — parents are never impersonable, so they're excluded from this list entirely.
  const staffAccounts = db.users.filter((u) => u.id !== auth.realUser.id && u.role !== ROLES.PARENT && u.name.toLowerCase().includes(q.toLowerCase()));
  const staffAccountGroups = groupUsers(staffAccounts);

  async function applyStatusChange() {
    if (!confirmStatus) return;
    const res = await data.setAccountStatus(confirmStatus.user.id, confirmStatus.next);
    if (!res.ok) { toast(res.message, "error"); setConfirmStatus(null); return; }
    toast(`${confirmStatus.user.name}'s access is now ${confirmStatus.next}.`, "info");
    setConfirmStatus(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Accounts & Access</h1>
        <p className="text-sm text-slate-400 mt-0.5">Manage leadership accounts and view the app as any staff member.</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Leadership Accounts</h3>
          <div className="flex gap-2">
            <GhostButton icon={Plus} onClick={() => setAddRole("DIRECTOR")}>Add Director</GhostButton>
            <GhostButton icon={Plus} onClick={() => setAddRole("FINANCE")}>Add Finance Director</GhostButton>
          </div>
        </div>

        {owner && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Owner</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={owner.name} size={36} />
                    <div><p className="text-sm font-semibold text-slate-700">{owner.name}</p><p className="text-xs text-slate-400">{ROLE_LABEL[owner.role]}</p></div>
                  </div>
                  <Badge tone={owner.status === "ACTIVE" ? "green" : owner.status === "SUSPENDED" ? "amber" : "red"}>{owner.status || "ACTIVE"}</Badge>
                </div>
                <p className="text-xs text-slate-400">{owner.email}</p>
              </Card>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Directors</p>
          {directors.length === 0 ? <p className="text-xs text-slate-400">No director accounts yet.</p> : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {directors.map((u, idx) => (
                <Card key={u.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs text-slate-400 w-4 shrink-0">{idx + 1}.</span>
                      <Avatar name={u.name} size={36} />
                      <div><p className="text-sm font-semibold text-slate-700">{u.name}</p><p className="text-xs text-slate-400">{ROLE_LABEL[u.role]}</p></div>
                    </div>
                    <Badge tone={u.status === "ACTIVE" ? "green" : u.status === "SUSPENDED" ? "amber" : "red"}>{u.status || "ACTIVE"}</Badge>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">{u.email}</p>
                  <div className="flex gap-2">
                    <GhostButton loading={isBusy(`reset-user-pw:${u.id}`)} onClick={() => run(async () => { const pw = generatePassword(); const res = await data.resetUserPassword(u.id, pw); if (!res.ok) { toast(res.message, "error"); return; } copyText(pw); toast(`New password copied: ${pw}`, "success"); }, { key: `reset-user-pw:${u.id}` })}>Reset Password</GhostButton>
                    <GhostButton danger={u.status === "ACTIVE"} onClick={() => setConfirmStatus({ user: u, next: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>
                      {u.status === "ACTIVE" ? "Disable" : "Enable"}
                    </GhostButton>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Staff Access — View as</h3>
        <p className="text-xs text-slate-400 mb-3">See exactly what a Director, Finance Director, Teacher, or other staff member sees — without knowing their password. You'll always be able to return to your Owner account. Parent accounts can't be viewed this way; use the Parents page to look up parent and student information instead.</p>
        <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search by name…" /></Toolbar>
        {staffAccountGroups.length === 0 ? <EmptyState icon={SearchIcon} title="No matching accounts" /> : (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {staffAccountGroups.map((g) => (
              <div key={g.label}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{g.label}</p>
                <div className="divide-y divide-slate-100">
                  {g.items.map((u, idx) => (
                    <div key={u.id} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs text-slate-400 w-4 shrink-0">{idx + 1}.</span>
                        <Avatar name={u.name} size={32} />
                        <div><p className="text-sm font-medium text-slate-700">{u.name}</p><p className="text-xs text-slate-400">{ROLE_LABEL[u.role]} · {u.email}</p></div>
                      </div>
                      <GhostButton icon={ArrowLeftRight} onClick={() => auth.viewAs(u.id)}>View as</GhostButton>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <LeadershipFormModal open={!!addRole} role={addRole} onClose={() => setAddRole(null)} />
      <ConfirmDialog open={!!confirmStatus} onClose={() => setConfirmStatus(null)} onConfirm={applyStatusChange}
        title={confirmStatus?.next === "DISABLED" ? "Disable this account?" : "Enable this account?"}
        description={confirmStatus?.next === "DISABLED" ? `${confirmStatus?.user.name} will no longer be able to sign in. Their historical records are kept.` : `${confirmStatus?.user.name} will be able to sign in again.`}
        confirmLabel={confirmStatus?.next === "DISABLED" ? "Disable" : "Enable"} danger={confirmStatus?.next === "DISABLED"} />
    </div>
  );
}

function LeadershipFormModal({ open, role, onClose }) {
  const data = useData();
  const toast = useToast();
  const empty = { name: "", email: "", phone: "", salary: 12000, password: "" };
  const [form, setForm] = useState(empty);
  const [showPw, setShowPw] = useState(false);
  const [createdCreds, setCreatedCreds] = useState(null);
  const { busy, run } = useMutationGuard();

  React.useEffect(() => {
    if (open) { setForm({ ...empty, password: generatePassword() }); setCreatedCreds(null); setShowPw(false); }
  }, [open, role]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  async function submit() {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) { toast("Please provide a name, email, and password.", "error"); return; }
    await run(async () => {
      const res = role === "DIRECTOR" ? await data.createDirectorAccount(form) : await data.createFinanceAccount(form);
      if (!res.ok) { toast(res.message, "error"); return; }
      setCreatedCreds({ email: form.email, password: form.password });
    }, { key: `create-leadership:${role}:${form.email.trim().toLowerCase()}` });
  }
  function close() { setForm(empty); setCreatedCreds(null); onClose(); }
  const roleLabel = role === "DIRECTOR" ? "Educational Director" : "Finance & Operations Director";

  if (createdCreds) {
    return (
      <Modal open={open} onClose={close} title={`${roleLabel} added`}>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><Check className="text-emerald-600" size={28} /></div>
          <p className="font-medium text-slate-700 mb-1">Account created.</p>
          <p className="text-xs text-slate-400 mb-4">Share these sign-in details privately. The password won't be shown again.</p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 max-w-xs mx-auto text-left space-y-2">
            <div><p className="text-[10px] text-slate-400 uppercase tracking-wide">Email</p><span className="font-mono text-sm text-slate-700">{createdCreds.email}</span></div>
            <div><p className="text-[10px] text-slate-400 uppercase tracking-wide">Temporary password</p><span className="font-mono text-sm font-semibold text-slate-700">{createdCreds.password}</span></div>
          </div>
          <button onClick={close} className="mt-5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title={`Add ${roleLabel}`}>
      <Field label="Full name" required><input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <Field label="Email" required><input type="email" className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
      <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      <Field label="Monthly salary (Birr)"><input type="number" className={inputCls} value={form.salary} onChange={(e) => set("salary", e.target.value)} /></Field>
      <Field label="Temporary password" required>
        <div className="relative">
          <input type={showPw ? "text" : "password"} className={inputCls + " pr-16 font-mono"} value={form.password} onChange={(e) => set("password", e.target.value)} />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            <button type="button" onClick={() => setShowPw((s) => !s)} className="text-slate-400 hover:text-slate-600">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            <button type="button" onClick={() => set("password", generatePassword())} className="text-slate-400 hover:text-sky-600"><RefreshCw size={14} /></button>
          </div>
        </div>
      </Field>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Adding…">Add {roleLabel}</PrimaryButton>
      </div>
    </Modal>
  );
}

/* ============================== STAFF ============================== */

function StaffPage({ onOpen }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editStaff, setEditStaff] = useState(null);
  const [endEmploymentTarget, setEndEmploymentTarget] = useState(null);
  const { isBusy, run } = useMutationGuard();

  const filtered = db.staff.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  const groups = groupStaff(filtered);
  const canAddAny = canManageDirectors(auth.realUser) || canManageTeachers(auth.realUser) || canManageOtherStaff(auth.realUser);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Staff</h1>
        {canAddAny && <PrimaryButton onClick={() => setAddOpen(true)}>Add Staff</PrimaryButton>}
      </div>
      <p className="text-sm text-slate-400 mb-4">{db.staff.length} paid employees — teachers, directors, and support staff.</p>
      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search staff name…" /></Toolbar>
      <div className="space-y-6">
        {groups.length === 0 ? <EmptyState icon={UserCog} title="No staff found" /> : groups.map((g) => (
          <div key={g.label}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{g.label}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.items.map((s) => {
                const canManage = canManageStaffGroup(auth.realUser, s.position);
                return (
                  <Card key={s.id} className="p-4">
                    <button type="button" onClick={() => onOpen && onOpen(s.id)} className="w-full text-left mb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={s.name} photo={s.photo} size={36} />
                          <div><p className="text-sm font-semibold text-slate-700">{s.name}</p><p className="text-xs text-slate-400">{s.position}{s.hasShifts ? " · AM/PM shifts" : ""}</p></div>
                        </div>
                        <Badge tone={s.status === "ACTIVE" ? "green" : "slate"}>{s.status}</Badge>
                      </div>
                      {s.employmentStatus === "ENDED" && <Badge tone="red">Employment Ended</Badge>}
                    </button>
                    <p className="text-xs text-slate-400 mb-3">{formatMoney(s.salary)} / month{s.phone ? ` · ${s.phone}` : ""}</p>
                    <div className="flex gap-2 mb-2">
                      <GhostButton onClick={() => onOpen && onOpen(s.id)}>View Profile</GhostButton>
                      {canManage && <GhostButton onClick={() => setEditStaff(s)}>Edit</GhostButton>}
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <button disabled={isBusy(`staff-status:${s.id}`)} onClick={() => run(async () => { const next = s.status === "ACTIVE" ? "DISABLED" : "ACTIVE"; const res = await data.setStaffStatus(s.id, next, auth.realUser.id); toast(res.ok ? `${s.name} ${next === "ACTIVE" ? "enabled" : "disabled"}.` : res.message, res.ok ? "info" : "error"); }, { key: `staff-status:${s.id}` })} className="flex-1 text-xs text-slate-500 font-medium border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50 disabled:opacity-50">{s.status === "ACTIVE" ? "Disable" : "Enable"}</button>
                        {s.employmentStatus === "ENDED" ? (
                          <button disabled={isBusy(`reactivate-emp:${s.id}`)} onClick={() => run(async () => { const res = await data.reactivateEmployment(s.id); toast(res.ok ? `${s.name}'s employment was reactivated.` : res.message, res.ok ? "success" : "error"); }, { key: `reactivate-emp:${s.id}` })} className="flex-1 text-xs text-emerald-600 font-medium border border-emerald-200 rounded-lg py-1.5 hover:bg-emerald-50 disabled:opacity-50">Reactivate</button>
                        ) : (
                          <button onClick={() => setEndEmploymentTarget(s)} className="flex-1 text-xs text-red-500 font-medium border border-red-100 rounded-lg py-1.5 hover:bg-red-50">End Employment</button>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <StaffFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      <StaffFormModal open={!!editStaff} staff={editStaff} onClose={() => setEditStaff(null)} />
      <EndEmploymentModal staff={endEmploymentTarget} onClose={() => setEndEmploymentTarget(null)} />
    </div>
  );
}

// Ending employment (Blocker 3) is deliberately separate from Delete — it stops future payroll
// accrual and new-assignment eligibility and disables login, but keeps every historical record
// (payroll, attendance, assignments) intact. Shared by StaffPage and StaffProfilePage.
function EndEmploymentModal({ staff, onClose }) {
  const data = useData();
  const toast = useToast();
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const { busy, run } = useMutationGuard();

  useEffect(() => { if (staff) setEndDate(new Date().toISOString().slice(0, 10)); }, [staff]);

  if (!staff) return null;

  async function submit() {
    if (!endDate) { toast("Please choose the last employed day.", "error"); return; }
    await run(async () => {
      const res = await data.endEmployment(staff.id, endDate);
      if (!res.ok) { toast(res.message, "error"); return; }
      toast(`${staff.name}'s employment ended effective ${fmtDate(endDate)}.`, "success");
      onClose();
    }, { key: `end-employment:${staff.id}` });
  }

  return (
    <Modal open={!!staff} onClose={onClose} title={`End Employment — ${staff.name}`}>
      <p className="text-xs text-slate-400 mb-3">This stops future payroll and removes {staff.name} from new class/subject assignments. Their attendance, payroll, and assignment history stay on record — this is not a delete. Their login is disabled as part of this.</p>
      <Field label="Last employed day" required><input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Working…">End Employment</PrimaryButton>
      </div>
    </Modal>
  );
}

function StaffFormModal({ open, onClose, staff }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const isEdit = !!staff;
  const positions = manageablePositions(auth.realUser, STAFF_POSITIONS);
  const empty = { firstName: "", middleName: "", lastName: "", name: "", position: positions[positions.length - 1] || STAFF_POSITIONS[STAFF_POSITIONS.length - 1], phone: "", salary: 4500, employmentDate: new Date().toISOString().slice(0, 10), hasShifts: false, photo: null, photoPreview: null, bankAccount: "" };
  const [form, setForm] = useState(empty);
  const { busy, run } = useMutationGuard();

  React.useEffect(() => {
    if (!open) return;
    if (staff) {
      const parts = (staff.name || "").trim().split(/\s+/);
      setForm({
        firstName: parts[0] || "", middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "", lastName: parts.length > 1 ? parts[parts.length - 1] : "",
        name: staff.name, position: staff.position, phone: staff.phone || "", salary: staff.salary, employmentDate: staff.employmentDate,
        hasShifts: !!staff.hasShifts, photo: staff.photo || null, photoPreview: null, bankAccount: staff.bankAccount || "",
      });
    } else setForm(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  const isOtherStaff = staffGroupLabel(form.position) === "Other Staff";
  // Salary is Owner/Finance's call — the Educational Director can manage a Teacher's record but
  // not their pay, so they get a read-only figure here instead of an editable input.
  const canEditSalary = canSetSalary(auth.realUser);

  function uploadPhoto(file) {
    setForm((f) => ({ ...f, photo: file, photoPreview: URL.createObjectURL(file) }));
  }

  async function submit() {
    const name = isOtherStaff ? fullName(form.firstName, form.middleName, form.lastName) : form.name;
    if (!name.trim()) { toast("Please provide the employee's name.", "error"); return; }
    const { firstName, middleName, lastName, ...rest } = form;
    const payload = { ...rest, name, bankAccount: form.bankAccount.trim() || null };
    await run(async () => {
      if (isEdit) {
        const res = await data.updateStaff(staff.id, payload);
        if (!res.ok) { toast(res.message, "error"); return; }
        toast("Staff record updated.", "success");
      } else {
        const newId = await data.createStaff(payload);
        if (!newId) { toast("Couldn't add this staff member.", "error"); return; }
        toast("Staff member added.", "success");
      }
      onClose();
    }, { key: isEdit ? `update-staff:${staff.id}` : `create-staff:${name.trim().toLowerCase()}:${form.position}` });
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Staff" : "Add Staff"}>
      <Field label="Position"><select className={inputCls} value={form.position} onChange={(e) => set("position", e.target.value)}>{positions.map((p) => <option key={p}>{p}</option>)}</select></Field>
      {isOtherStaff ? (
        <div className="grid grid-cols-3 gap-x-2">
          <Field label="First name" required><input className={inputCls} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Middle name"><input className={inputCls} value={form.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
          <Field label="Last name" required><input className={inputCls} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
        </div>
      ) : (
        <Field label="Full name" required><input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
      )}
      <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      <Field label="Monthly salary (Birr)" required>
        {canEditSalary ? (
          <input type="number" className={inputCls} value={form.salary} onChange={(e) => set("salary", e.target.value)} />
        ) : (
          <p className="text-sm text-slate-500 py-2">{formatMoney(form.salary)} <span className="text-xs text-slate-400">(set by Owner or Finance)</span></p>
        )}
      </Field>
      <Field label="Employment date"><input type="date" className={inputCls} value={form.employmentDate} onChange={(e) => set("employmentDate", e.target.value)} /></Field>
      <Field label="Bank account number (optional)"><input className={inputCls} placeholder="Can be added later" value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
      {isOtherStaff && (
        <Field label="Attendance">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" className="rounded border-slate-300 text-sky-600 focus:ring-sky-500" checked={form.hasShifts} onChange={(e) => set("hasShifts", e.target.checked)} />
            Records attendance twice a day (morning &amp; afternoon shifts — e.g. a driver)
          </label>
        </Field>
      )}
      <Field label="Photo (optional)">
        <div className="flex items-center gap-3">
          {(form.photoPreview || typeof form.photo === "string") && <Avatar name={isOtherStaff ? fullName(form.firstName, form.middleName, form.lastName) : form.name} photo={form.photoPreview || form.photo} size={40} />}
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 border border-sky-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-sky-50">
            <ImagePlus size={13} /> {(form.photoPreview || form.photo) ? "Replace photo" : "Add photo"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadPhoto(e.target.files[0])} />
          </label>
          {(form.photoPreview || form.photo) && <button type="button" onClick={() => setForm((f) => ({ ...f, photo: null, photoPreview: null }))} className="text-xs text-red-500 font-medium">Remove</button>}
        </div>
      </Field>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Saving…">{isEdit ? "Save Changes" : "Add Staff"}</PrimaryButton>
      </div>
    </Modal>
  );
}

// Finance's restricted edit path onto a Director's profile — see canEditDirectorFinancials.
// Everything but salary and bank account is read-only; core record changes (name/position/phone/
// status) stay Owner-only through the full StaffFormModal.
function DirectorFinancialsModal({ open, staff, onClose }) {
  const data = useData();
  const toast = useToast();
  const [salary, setSalary] = useState(0);
  const [bankAccount, setBankAccount] = useState("");
  const { busy, run } = useMutationGuard();

  useEffect(() => {
    if (open && staff) { setSalary(staff.salary ?? 0); setBankAccount(staff.bankAccount || ""); }
  }, [open, staff]);

  if (!staff) return null;

  async function submit() {
    await run(async () => {
      const res = await data.updateStaff(staff.id, { salary, bankAccount: bankAccount.trim() || null });
      if (!res.ok) { toast(res.message, "error"); return; }
      toast("Financial information updated.", "success");
      onClose();
    }, { key: `update-staff-financials:${staff.id}` });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit Financial Info — ${staff.name}`}>
      <p className="text-xs text-slate-400 mb-3">Name, position, phone, and status are managed by the Owner — only salary and bank account are editable here.</p>
      <Field label="Name"><p className="text-sm text-slate-600 py-2">{staff.name}</p></Field>
      <Field label="Position"><p className="text-sm text-slate-600 py-2">{staff.position}</p></Field>
      <Field label="Phone"><p className="text-sm text-slate-600 py-2">{staff.phone || "—"}</p></Field>
      <Field label="Status"><p className="text-sm text-slate-600 py-2">{staff.status}</p></Field>
      <Field label="Monthly salary (Birr)" required><input type="number" className={inputCls} value={salary} onChange={(e) => setSalary(e.target.value)} /></Field>
      <Field label="Bank account number"><input className={inputCls} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Saving…">Save Changes</PrimaryButton>
      </div>
    </Modal>
  );
}

/* ============================== STAFF PROFILE ============================== */

// Worst-first precedence for coloring a shift staff member's combined day cell/summary.
const STATUS_SEVERITY = ["Absent", "Sick", "Permission", "Excused", "Late", "Present"];
function worstStatus(statuses) {
  for (const s of STATUS_SEVERITY) if (statuses.includes(s)) return s;
  return null;
}

// Self-contained month-nav + status-badge summary + compact calendar, shared by StaffProfilePage
// and StaffPayrollModal (the Payroll "Manage" view) so both employee views show identical
// attendance data and can't drift apart. Owns its own month/day-detail state.
function EmployeeAttendanceCard({ staff }) {
  const data = useData();
  const { db } = data;
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [dayDetail, setDayDetail] = useState(null); // dateKey

  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const minMonth = staff.employmentDate.slice(0, 7);
  const maxMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const monthRecords = db.staffAttendance.filter((a) => a.staffId === staff.id && a.date.slice(0, 7) === monthKey);
  const summary = ATTENDANCE_STATUSES.map((status) => ({ status, n: monthRecords.filter((r) => r.status === status).length }));

  function getDayInfo(dateKey) {
    const records = db.staffAttendance.filter((a) => a.staffId === staff.id && a.date === dateKey);
    if (records.length === 0) return null;
    if (records.length === 1) return { status: records[0].status, note: records[0].note };
    const worst = worstStatus(records.map((r) => r.status));
    const label = records.map((r) => `${STAFF_SHIFT_PERIOD_LABEL[r.period] || r.period}: ${r.status}`).join(" · ");
    return { status: worst, note: label };
  }

  function canGoPrevMonth() { return monthKey > minMonth; }
  function canGoNextMonth() { return monthKey < maxMonth; }
  function shiftMonth(delta) {
    let y = viewYear, m = viewMonth + delta;
    if (m < 0) { m = 11; y -= 1; } if (m > 11) { m = 0; y += 1; }
    setViewYear(y); setViewMonth(m);
  }

  const dayRecords = dayDetail ? db.staffAttendance.filter((a) => a.staffId === staff.id && a.date === dayDetail) : [];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><ClipboardEdit size={15} /> Attendance</h3>
        <div className="flex items-center gap-2">
          <button disabled={!canGoPrevMonth()} onClick={() => shiftMonth(-1)} className={`p-1.5 rounded-lg border ${!canGoPrevMonth() ? "border-slate-100 text-slate-300" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}><ChevronLeft size={15} /></button>
          <span className="text-sm font-medium text-slate-600 w-32 text-center">{monthLabel(monthKey)}</span>
          <button disabled={!canGoNextMonth()} onClick={() => shiftMonth(1)} className={`p-1.5 rounded-lg border ${!canGoNextMonth() ? "border-slate-100 text-slate-300" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {summary.filter((s) => s.n > 0).map((s) => <Badge key={s.status} tone={statusTone(s.status)}>{s.status} {s.n}</Badge>)}
        {summary.every((s) => s.n === 0) && <span className="text-xs text-slate-400">No attendance recorded this month.</span>}
      </div>
      <MonthCalendarGrid year={viewYear} month={viewMonth} getDayInfo={getDayInfo} onSelectDay={setDayDetail} minDate={staff.employmentDate} maxDate={todayKeyStr()} />
      {dayDetail && (
        <Modal open={!!dayDetail} onClose={() => setDayDetail(null)} title={fmtDate(dayDetail)}>
          {dayRecords.length === 0 ? <p className="text-sm text-slate-400">No attendance record for this day.</p> : (
            <div className="space-y-2">
              {dayRecords.map((r) => (
                <div key={r.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                  <div>
                    {STAFF_SHIFT_PERIOD_LABEL[r.period] && <p className="text-xs font-medium text-slate-500 mb-0.5">{STAFF_SHIFT_PERIOD_LABEL[r.period]}</p>}
                    <Badge tone={statusTone(r.status)}>{r.status}{r.status === "Late" && r.arrivalTime ? ` · ${r.arrivalTime}` : ""}</Badge>
                  </div>
                  {r.note && <p className="text-xs text-slate-400 max-w-[60%] text-right">{r.note}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-3"><button type="button" onClick={() => setDayDetail(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button></div>
        </Modal>
      )}
    </Card>
  );
}

function StaffProfilePage({ staffId, onBack }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const staff = db.staff.find((s) => s.id === staffId);
  const [editOpen, setEditOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(null); // month key
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [financeEditOpen, setFinanceEditOpen] = useState(false);
  const [endEmploymentOpen, setEndEmploymentOpen] = useState(false);
  const { isBusy, run } = useMutationGuard();

  if (!staff) return <EmptyState icon={UserCog} title="Staff member not found" action={<GhostButton icon={ArrowLeft} onClick={onBack}>Back</GhostButton>} />;

  const canManage = canManageStaffGroup(auth.realUser, staff.position);
  const canPayroll = canViewPayroll(auth.realUser);
  // Finance can't manage a Director's core staff record (canManage is false for them here) but
  // salary/bank account is legitimately their job — this opens a narrow financial-only edit path
  // as a fallback when the full edit isn't available.
  const canEditFinancials = !canManage && canEditDirectorFinancials(auth.realUser, staff.position);
  const identity = data.staffIdentity(staff);
  const salary = data.staffSalarySummary(staff.id);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back</button>

      <Card className="p-5 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3.5">
            <Avatar name={staff.name} photo={staff.photo} size={56} />
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{identity.display}</h1>
              <p className="text-sm text-slate-400">{staff.phone || "No phone on file"}{staff.employeeNumber ? ` · ${staff.employeeNumber}` : ""}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge tone={staff.status === "ACTIVE" ? "green" : "slate"}>{staff.status}</Badge>
                {staff.employmentStatus === "ENDED" && <Badge tone="red">Employment Ended {fmtDate(staff.employmentEndDate)}</Badge>}
                <span className="text-xs text-slate-400">Started {fmtDate(staff.employmentDate)}{canPayroll ? ` · ${formatMoney(staff.salary)}/mo` : ""}</span>
              </div>
              {canPayroll && (
                <p className="text-xs mt-1.5">
                  <span className="text-slate-400">Bank account: </span>
                  {staff.bankAccount ? <span className="text-slate-600 font-medium">{staff.bankAccount}</span> : <span className="text-amber-600 font-medium">Not provided</span>}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canRecordAdvance(auth.realUser) && <GhostButton icon={Banknote} onClick={() => setAdvanceOpen(true)}>Give Advance</GhostButton>}
            {canManage && (
              <>
                <GhostButton icon={ShieldCheck} onClick={() => setLeaveOpen(true)}>Request Leave</GhostButton>
                <GhostButton icon={Edit2} onClick={() => setEditOpen(true)}>Edit</GhostButton>
                {staff.employmentStatus === "ENDED" ? (
                  <GhostButton icon={UserCheck} loading={isBusy(`reactivate-emp:${staff.id}`)} onClick={() => run(async () => { const res = await data.reactivateEmployment(staff.id); toast(res.ok ? `${staff.name}'s employment was reactivated.` : res.message, res.ok ? "success" : "error"); }, { key: `reactivate-emp:${staff.id}` })}>Reactivate Employment</GhostButton>
                ) : (
                  <GhostButton icon={UserX} danger onClick={() => setEndEmploymentOpen(true)}>End Employment</GhostButton>
                )}
                <GhostButton icon={Trash2} danger onClick={() => setDeleteConfirmOpen(true)}>Delete</GhostButton>
              </>
            )}
            {canEditFinancials && (
              <GhostButton icon={Banknote} onClick={() => setFinanceEditOpen(true)}>Edit Financial Info</GhostButton>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} danger confirmLabel="Delete Permanently"
        title="Delete Staff Member Permanently?"
        description={`This will permanently delete ${staff.name}'s staff record and payroll/attendance history. This action cannot be undone.`}
        onConfirm={async () => {
          const res = await data.deleteStaff(staff.id);
          setDeleteConfirmOpen(false);
          if (res.ok) { toast(`${staff.name} was deleted.`, "success"); onBack(); }
          else toast(res.message, "error");
        }}
      />
      <EndEmploymentModal staff={endEmploymentOpen ? staff : null} onClose={() => setEndEmploymentOpen(false)} />

      <div className="mb-5"><EmployeeAttendanceCard staff={staff} /></div>

      {canPayroll && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5"><Banknote size={15} /> Payroll History</h3>
          <div className={`grid ${salary.advanceGiven > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-3 mb-4`}>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Monthly Salary</p><p className="text-sm font-semibold text-slate-800">{formatMoney(staff.salary)}/mo</p></div>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Total paid</p><p className="text-sm font-semibold text-emerald-700">{formatMoney(salary.totalPaid)}</p></div>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Net Pay</p><p className="text-sm font-semibold text-amber-600">{formatMoney(salary.outstanding)}</p></div>
            {salary.advanceGiven > 0 && <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Advances</p><p className="text-sm font-semibold text-indigo-600">{formatMoney(salary.advanceGiven)}</p></div>}
          </div>
          {/* Payroll recording stays open to Owner/Finance for every staff group — only Staff CRUD (above) is group-restricted. */}
          <PayrollHistoryTable staff={staff} onPay={setPayOpen} />
          <AdvanceHistoryList staff={staff} />
        </Card>
      )}

      <StaffFormModal open={editOpen} staff={staff} onClose={() => setEditOpen(false)} />
      <DirectorFinancialsModal open={financeEditOpen} staff={staff} onClose={() => setFinanceEditOpen(false)} />
      {leaveOpen && (
        <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title={`Request Leave — ${staff.name}`}>
          <StaffLeaveRequestForm staffId={staff.id} requestedBy={auth.realUser.id} onSubmitted={() => setLeaveOpen(false)} />
        </Modal>
      )}
      <RecordPayrollModal staff={staff} month={payOpen} onClose={() => setPayOpen(null)} />
      <RecordAdvanceModal staff={advanceOpen ? staff : null} onClose={() => setAdvanceOpen(false)} />
    </div>
  );
}

/* ============================== PAYROLL ============================== */

// Shared between the profile page (inline) and StaffPayrollModal (in a Modal) so the two never
// drift apart. `onPay(month)` is omitted entirely when the viewer isn't allowed to record a payment.
function PayrollHistoryTable({ staff, onPay }) {
  const data = useData();
  const summary = data.staffSalarySummary(staff.id);
  return (
    <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0"><tr>
          <th className="text-left font-medium px-3 py-2">Month</th><th className="text-left font-medium px-3 py-2">Paid</th>
          <th className="text-left font-medium px-3 py-2">Remaining</th><th className="text-left font-medium px-3 py-2">Status</th>
          <th className="text-left font-medium px-3 py-2">Last payment</th><th></th>
        </tr></thead>
        <tbody>
          {[...summary.rows].reverse().map((r) => (
            <tr key={r.month} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-700">{monthLabel(r.month)}</td>
              <td className="px-3 py-2 text-slate-600">{formatMoney(r.paidThisMonth)}</td>
              <td className="px-3 py-2 text-slate-600">{r.remaining > 0 ? formatMoney(r.remaining) : "—"}</td>
              <td className="px-3 py-2"><PaymentStatusBadge status={r.status} /></td>
              <td className="px-3 py-2 text-slate-400">{r.payment ? `${fmtDate(r.payment.date)} · ${r.payment.method}` : "—"}</td>
              <td className="px-3 py-2">{onPay && r.status !== "PAID" && <GhostButton onClick={() => onPay(r.month)}>Pay</GhostButton>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Payroll recording stays open to Owner/Finance for every staff group — only Staff CRUD
// (create/edit/disable, in StaffPage) is restricted by canManageStaffGroup.
function StaffPayrollModal({ staff, onClose }) {
  const data = useData();
  const auth = useAuth();
  const [recordFor, setRecordFor] = useState(null); // month key
  const [advanceOpen, setAdvanceOpen] = useState(false);
  if (!staff) return null;
  const identity = data.staffIdentity(staff);
  const advanceGiven = data.staffSalarySummary(staff.id)?.advanceGiven || 0;
  const classes = staff.position === "Teacher" && staff.userId
    ? data.db.classes.filter((c) => c.subjectTeacherIds.includes(staff.userId) || c.headTeacherId === staff.userId)
    : [];

  return (
    <Modal open={!!staff} onClose={onClose} title={`Payroll — ${staff.name}`} wide>
      <Card className="p-4 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-3">
            <Avatar name={staff.name} photo={staff.photo} size={48} />
            <div>
              <p className="text-base font-semibold text-slate-800">{identity.display}</p>
              <p className="text-xs text-slate-400">{staff.position}{staff.hasShifts ? " · AM/PM shifts" : ""} · {staff.employeeNumber || `ID ${staff.id}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={staff.status === "ACTIVE" ? "green" : "slate"}>{staff.status}</Badge>
            {staff.employmentStatus === "ENDED" && <Badge tone="red">Employment ended {fmtDate(staff.employmentEndDate)}</Badge>}
            {canRecordAdvance(auth.realUser) && <GhostButton icon={Banknote} onClick={() => setAdvanceOpen(true)}>Give Advance</GhostButton>}
          </div>
        </div>
        {classes.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Assigned classes</p>
            <div className="flex flex-wrap gap-1">{classes.map((c) => <Badge key={c.id} tone="sky">{c.grade}{c.section}</Badge>)}</div>
          </div>
        )}
        <div className={`grid ${advanceGiven > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}>
          <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Start date</p><p className="text-sm font-semibold text-slate-800">{fmtDate(staff.employmentDate)}</p></div>
          <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Monthly salary</p><p className="text-sm font-semibold text-slate-800">{formatMoney(staff.salary)}</p></div>
          {advanceGiven > 0 && <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Advances</p><p className="text-sm font-semibold text-indigo-600">{formatMoney(advanceGiven)}</p></div>}
        </div>
        <p className="text-xs mt-3">
          <span className="text-slate-400">Bank account: </span>
          {staff.bankAccount ? <span className="text-slate-600 font-medium">{staff.bankAccount}</span> : <span className="text-amber-600 font-medium">Not provided</span>}
        </p>
      </Card>
      <div className="mb-4"><EmployeeAttendanceCard staff={staff} /></div>
      <PayrollHistoryTable staff={staff} onPay={setRecordFor} />
      <AdvanceHistoryList staff={staff} />
      <RecordPayrollModal staff={staff} month={recordFor} onClose={() => setRecordFor(null)} />
      <RecordAdvanceModal staff={advanceOpen ? staff : null} onClose={() => setAdvanceOpen(false)} />
    </Modal>
  );
}

function RecordPayrollModal({ staff, month, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const activeMethods = data.db.paymentMethods.filter((m) => m.active);
  const summary = data.staffSalarySummary(staff?.id);
  const rowFor = (m) => summary?.rows.find((r) => r.month === m);
  // The month row's `remaining` already nets out cash paid so far AND any advances recorded
  // against this salary period — Finance just pays what's left as cash.
  const emptyForm = (m) => {
    const row = rowFor(m);
    return {
      amount: row?.remaining || 0,
      method: activeMethods[0]?.name || "Cash", date: new Date().toISOString().slice(0, 10), note: "",
      allowances: 0, deductions: 0,
    };
  };
  const [form, setForm] = useState(() => emptyForm(month));
  const [error, setError] = useState("");
  const { busy, run } = useMutationGuard();
  React.useEffect(() => {
    // Keyed on staff?.id, not the `staff` object itself — the `db` object (and everything read
    // off it) is rebuilt on every refetch, including the one after a rejected payment, so `staff`
    // gets a new (identical) reference on every attempt. Depending on the object would wipe the
    // just-shown overpayment error and the user's typed amount the instant recordPayrollPayment
    // rejected it, before they ever saw why.
    if (month) { setForm(emptyForm(month)); setError(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, staff?.id]);
  if (!month) return null;
  const row = rowFor(month);
  const cashThisMonth = row?.cashThisMonth || 0;
  const advanceThisMonth = row?.advanceThisMonth || 0;
  // Cap mirrors DataContext's recordPayrollPayment / the record_payroll_payment RPC exactly
  // (salary + allowances - deductions - cash already paid this month - advances recorded for this
  // month) so the input's max and the server's hard cap never disagree.
  const cashCap = Math.max(0, (staff?.salary || 0) + (Number(form.allowances) || 0) - (Number(form.deductions) || 0) - cashThisMonth - advanceThisMonth);
  // Allowances/deductions re-suggest the Amount to pay — Finance can still retype Amount
  // afterward if the actual cash handed over differs.
  function setBreakdown(patch) {
    setForm((f) => {
      const next = { ...f, ...patch };
      const cap = Math.max(0, (staff?.salary || 0) + (Number(next.allowances) || 0) - (Number(next.deductions) || 0) - cashThisMonth - advanceThisMonth);
      return { ...next, amount: cap };
    });
  }
  async function submit() {
    // Financial mutation — guard hard against double-submit. Key encodes this exact intended
    // payment so a rapid second click / repeated Enter is dropped, while a legitimate later
    // top-up payment for the same month still goes through.
    const opKey = `record-payroll:${staff.id}:${month}:${Number(form.amount)}:${form.date}`;
    await run(async () => {
      const result = await data.recordPayrollPayment(staff.id, {
        amount: Number(form.amount), method: form.method, month, date: form.date, note: form.note,
        allowances: Number(form.allowances) || 0, deductions: Number(form.deductions) || 0,
      }, auth.realUser.id);
      if (!result.success) { setError(result.error); return; }
      toast(`${staff.name}'s salary for ${monthLabel(month)} recorded.`, "success");
      onClose();
    }, { key: opKey });
  }
  return (
    <Modal open={!!month} onClose={onClose} title={`Pay ${staff?.name} — ${monthLabel(month)}`}>
      <div className="grid grid-cols-2 gap-x-2">
        <Field label="Allowances (optional)"><input type="number" className={inputCls} value={form.allowances} onChange={(e) => setBreakdown({ allowances: e.target.value })} /></Field>
        <Field label="Deductions (optional)"><input type="number" className={inputCls} value={form.deductions} onChange={(e) => setBreakdown({ deductions: e.target.value })} /></Field>
      </div>
      <div className="bg-slate-50 rounded-lg p-3 mb-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-slate-400">Monthly Salary</span><span className="text-slate-700 font-medium">{formatMoney(staff?.salary || 0)}</span></div>
        {Number(form.allowances) > 0 && <div className="flex justify-between"><span className="text-slate-400">Allowances</span><span className="text-slate-700 font-medium">+{formatMoney(Number(form.allowances))}</span></div>}
        {Number(form.deductions) > 0 && <div className="flex justify-between"><span className="text-slate-400">Deductions</span><span className="text-slate-700 font-medium">-{formatMoney(Number(form.deductions))}</span></div>}
        {advanceThisMonth > 0 && <div className="flex justify-between"><span className="text-slate-400">Advances this month</span><span className="text-indigo-600 font-medium">-{formatMoney(advanceThisMonth)}</span></div>}
        {cashThisMonth > 0 && <div className="flex justify-between"><span className="text-slate-400">Cash already paid</span><span className="text-slate-700 font-medium">-{formatMoney(cashThisMonth)}</span></div>}
        <div className="flex justify-between pt-1 border-t border-slate-200"><span className="text-slate-500 font-medium">Remaining</span><span className="text-amber-600 font-semibold">{formatMoney(cashCap)}</span></div>
      </div>
      <Field label="Amount to Pay (Birr)" required><input type="number" max={cashCap} className={inputCls} value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value })); setError(""); }} /></Field>
      <Field label="Payment method"><select className={inputCls} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{activeMethods.map((m) => <option key={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
      <Field label="Note"><input className={inputCls} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Recording…">Record Payment</PrimaryButton>
      </div>
    </Modal>
  );
}

// Real money paid to a staff member against a specific salary period. It reduces that month's
// remaining pay directly (see computeStaffPayrollSummary) — there is no separate "recovery" step.
function RecordAdvanceModal({ staff, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const summary = data.staffSalarySummary(staff?.id);
  const monthOptions = [...(summary?.months || [])].reverse();
  const defaultMonth = summary?.currentMonthKey || monthOptions[0] || new Date().toISOString().slice(0, 7);
  const emptyForm = () => ({ amount: 0, date: new Date().toISOString().slice(0, 10), note: "", payrollMonth: defaultMonth });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const { busy, run } = useMutationGuard();
  React.useEffect(() => {
    if (staff) { setForm(emptyForm()); setError(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id]);
  if (!staff) return null;
  const maxAdvance = summary?.maxAdvanceForMonth ? summary.maxAdvanceForMonth(form.payrollMonth) : (staff.salary || 0);
  const amountNum = Math.max(0, Number(form.amount) || 0);
  const remainingAfter = Math.max(0, maxAdvance - amountNum);
  async function submit() {
    if (!Number(form.amount) || Number(form.amount) <= 0) { setError("Please enter an advance amount."); return; }
    await run(async () => {
      const result = await data.recordSalaryAdvance(staff.id, { amount: Number(form.amount), date: form.date, note: form.note, payrollMonth: form.payrollMonth }, auth.realUser.id);
      if (!result.success) { setError(result.error); return; }
      toast(`Salary advance recorded for ${staff.name}.`, "success");
      onClose();
    }, { key: `record-advance:${staff.id}:${form.payrollMonth}:${Number(form.amount)}:${form.date}` });
  }
  return (
    <Modal open={!!staff} onClose={onClose} title={`Give Advance — ${staff.name}`}>
      <Field label="Salary period this advance is for" required>
        <select className={inputCls} value={form.payrollMonth} onChange={(e) => { setForm((f) => ({ ...f, payrollMonth: e.target.value })); setError(""); }}>
          {monthOptions.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
          {!monthOptions.includes(form.payrollMonth) && <option value={form.payrollMonth}>{monthLabel(form.payrollMonth)}</option>}
        </select>
      </Field>
      <div className="bg-slate-50 rounded-lg p-3 mb-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-slate-400">Monthly Salary</span><span className="text-slate-700 font-medium">{formatMoney(staff.salary)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Still unpaid for {monthLabel(form.payrollMonth)}</span><span className="text-indigo-600 font-semibold">{formatMoney(maxAdvance)}</span></div>
      </div>
      <Field label="Amount (Birr)" required><input type="number" max={maxAdvance} className={inputCls} value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value })); setError(""); }} /></Field>
      {amountNum > 0 && <p className="text-xs text-slate-400 -mt-2 mb-3">Remaining for {monthLabel(form.payrollMonth)} after this advance: <span className="font-medium text-slate-600">{formatMoney(remainingAfter)}</span></p>}
      <Field label="Date paid"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
      <Field label="Note"><input className={inputCls} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Recording…">Record Advance</PrimaryButton>
      </div>
    </Modal>
  );
}

// Per-advance history — every advance stays visible forever as a permanent record of money paid,
// each labelled with the salary period it was applied to.
export function AdvanceHistoryList({ staff }) {
  const data = useData();
  const summary = data.staffSalarySummary(staff.id);
  const advances = summary?.advances || [];
  if (advances.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Salary Advance History</h4>
      <div className="space-y-2">
        {advances.map((a) => (
          <div key={a.id} className="border border-slate-200 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-slate-700 font-medium">{formatMoney(a.amount)} <span className="text-slate-400 font-normal">paid {fmtDate(a.date)}</span></p>
                {a.note && <p className="text-xs text-slate-400 mt-0.5">{a.note}</p>}
              </div>
              <Badge tone="indigo">Applied to {monthLabel(a.appliedMonth)}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PAYROLL_STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "PAID", label: "Paid" },
  { key: "PARTIAL", label: "Partial" },
  { key: "UNPAID", label: "Unpaid" },
];

function PayrollPage({ onOpen }) {
  const data = useData();
  const { db } = data;
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [payrollFor, setPayrollFor] = useState(null);

  // Each staff member's current-month payment status, computed once so both the filter tab
  // counts and the filtered list agree with each other.
  const withStatus = db.staff.map((s) => {
    const summary = data.staffSalarySummary(s.id);
    const thisMonth = summary.rows[summary.rows.length - 1];
    return { staff: s, summary, thisMonthStatus: thisMonth?.status || "UNPAID" };
  });
  const counts = { ALL: withStatus.length, PAID: 0, PARTIAL: 0, UNPAID: 0 };
  withStatus.forEach((w) => { counts[w.thisMonthStatus] = (counts[w.thisMonthStatus] || 0) + 1; });

  const byStatus = statusFilter === "ALL" ? withStatus : withStatus.filter((w) => w.thisMonthStatus === statusFilter);
  const filtered = byStatus.filter((w) => w.staff.name.toLowerCase().includes(q.toLowerCase())).map((w) => w.staff);
  const groups = groupStaff(filtered);
  const totalNetPay = db.staff.reduce((sum, s) => sum + (data.staffSalarySummary(s.id)?.outstanding || 0), 0);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Payroll</h1>
      <p className="text-sm text-slate-400 mb-4">Total net pay owed: <span className="font-semibold text-amber-600">{formatMoney(totalNetPay)}</span></p>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {PAYROLL_STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === f.key ? "bg-sky-600 border-sky-600 text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
          >
            {f.label} <span className={statusFilter === f.key ? "text-sky-100" : "text-slate-400"}>{counts[f.key] || 0}</span>
          </button>
        ))}
      </div>
      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search staff name…" /></Toolbar>
      {groups.length === 0 ? <EmptyState icon={Banknote} title="No staff found" /> : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{g.label}</p>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
                      <th className="text-left font-medium px-4 py-2.5 w-10">#</th>
                      <th className="text-left font-medium px-4 py-2.5">Name</th><th className="text-left font-medium px-4 py-2.5">Position</th>
                      <th className="text-left font-medium px-4 py-2.5">Bank Account</th>
                      <th className="text-left font-medium px-4 py-2.5">Status</th>
                      <th className="text-left font-medium px-4 py-2.5">Salary</th><th className="text-left font-medium px-4 py-2.5">This month</th>
                      <th className="text-left font-medium px-4 py-2.5">Net Pay</th><th></th>
                    </tr></thead>
                    <tbody>
                      {g.items.map((s, idx) => {
                        const summary = data.staffSalarySummary(s.id);
                        const thisMonth = summary.rows[summary.rows.length - 1];
                        return (
                          <tr key={s.id} onClick={() => onOpen && onOpen(s.id)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50">
                            <td className="px-4 py-2.5 text-slate-400">{idx + 1}</td>
                            <td className="px-4 py-2.5 text-slate-700 font-medium whitespace-nowrap hover:text-sky-600">{s.name}</td>
                            <td className="px-4 py-2.5 text-slate-500">{s.position}</td>
                            <td className="px-4 py-2.5">{s.bankAccount ? <span className="text-slate-600">{s.bankAccount}</span> : <Badge tone="amber">Not provided</Badge>}</td>
                            <td className="px-4 py-2.5">
                              <Badge tone={s.status === "ACTIVE" ? "green" : "slate"}>{s.status}</Badge>
                              {s.employmentStatus === "ENDED" && <span className="block mt-1"><Badge tone="red">Employment Ended</Badge></span>}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">{formatMoney(s.salary)}</td>
                            <td className="px-4 py-2.5"><PaymentStatusBadge status={thisMonth?.status || "UNPAID"} /></td>
                            <td className="px-4 py-2.5 text-amber-600 font-medium">{summary.outstanding > 0 ? formatMoney(summary.outstanding) : "—"}</td>
                            <td className="px-4 py-2.5"><GhostButton onClick={(e) => { e.stopPropagation(); setPayrollFor(s); }}>Manage</GhostButton></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
      <StaffPayrollModal staff={payrollFor} onClose={() => setPayrollFor(null)} />
    </div>
  );
}

/* ============================== PAYMENT METHODS ============================== */

function PaymentMethodsPage() {
  const data = useData();
  const toast = useToast();
  const { db } = data;
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const { busy, run, isBusy } = useMutationGuard();

  function addMethod() {
    if (!newName.trim()) { toast("Please name the payment method.", "error"); return; }
    run(async () => {
      await data.createPaymentMethod(newName);
      setNewName("");
      toast("Payment method added.", "success");
    }, { key: `create-payment-method:${newName.trim().toLowerCase()}` });
  }
  function saveRename(id) {
    run(async () => {
      await data.updatePaymentMethod(id, editingName);
      setEditingId(null);
    }, { key: `rename-payment-method:${id}` });
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1 flex items-center gap-2"><CreditCard size={18} /> Payment Methods</h1>
      <p className="text-sm text-slate-400 mb-4">Used across Fees, Payroll, and Expenses. Deactivating a method keeps its history but hides it from new payment forms.</p>
      <Card className="p-5 mb-4">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="e.g. New Bank" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMethod()} />
          <PrimaryButton onClick={addMethod} loading={busy} loadingText="Adding…">Add</PrimaryButton>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          {db.paymentMethods.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              {editingId === m.id ? (
                <input autoFocus className={inputCls + " max-w-xs"} value={editingName} onChange={(e) => setEditingName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRename(m.id)} onBlur={() => saveRename(m.id)} />
              ) : (
                <button type="button" onClick={() => { setEditingId(m.id); setEditingName(m.name); }} className="text-sm font-medium text-slate-700 hover:text-sky-600 text-left">{m.name}</button>
              )}
              <div className="flex items-center gap-2">
                <Badge tone={m.active ? "green" : "slate"}>{m.active ? "Active" : "Inactive"}</Badge>
                <GhostButton onClick={() => data.setPaymentMethodActive(m.id, !m.active)}>{m.active ? "Deactivate" : "Activate"}</GhostButton>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============================== EXPENSES ============================== */

function expenseSummaryLabel(items) {
  if (!items || items.length === 0) return "—";
  return items.length === 1 ? items[0].itemName : `${items.length} items`;
}

function ExpensesPage({ focus, clearFocus }) {
  const data = useData();
  const toast = useToast();
  const { db } = data;
  const [addOpen, setAddOpen] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewer, setViewer] = useState(null); // expense being viewed
  const total = db.expenses.reduce((s, e) => s + e.totalAmount, 0);

  // Deep-link from a Recent Activity item — open the exact expense that was recorded.
  useEffect(() => {
    if (!focus?.expenseId) return;
    const exp = db.expenses.find((e) => e.id === focus.expenseId);
    if (exp) setEditExpense(exp);
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const { run: runDelete } = useMutationGuard();
  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    runDelete(async () => {
      const res = await data.deleteExpense(target.id);
      if (res && res.success === false) { toast(res.error || "Couldn't remove this expense.", "error"); return; }
      toast("Expense removed.", "info");
      setDeleteTarget(null);
    }, { key: `delete-expense:${target.id}` });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Expenses</h1>
        <PrimaryButton onClick={() => setAddOpen(true)}>Add Expense</PrimaryButton>
      </div>
      <p className="text-sm text-slate-400 mb-4">Total recorded: <span className="font-semibold text-slate-700">{formatMoney(total)}</span></p>
      <Card className="overflow-hidden">
        {db.expenses.length === 0 ? <EmptyState icon={Receipt} title="No expenses recorded yet" action={<PrimaryButton onClick={() => setAddOpen(true)}>Add Expense</PrimaryButton>} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
                <th className="text-left font-medium px-4 py-2.5">#</th>
                <th className="text-left font-medium px-4 py-2.5">Date</th>
                <th className="text-left font-medium px-4 py-2.5">Items</th>
                <th className="text-left font-medium px-4 py-2.5">Method</th>
                <th className="text-left font-medium px-4 py-2.5">Total</th>
                <th className="text-left font-medium px-4 py-2.5">Purchased by</th>
                <th className="text-left font-medium px-4 py-2.5">Receipt</th><th></th>
              </tr></thead>
              <tbody>
                {[...db.expenses].sort((a, b) => b.createdAt - a.createdAt).map((e) => (
                  <tr key={e.id} onClick={() => setEditExpense(e)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-400 font-mono text-xs whitespace-nowrap">{e.expenseNo}</td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td className="px-4 py-2.5 text-slate-700 font-medium whitespace-nowrap hover:text-sky-600">{expenseSummaryLabel(e.items)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{e.method}</td>
                    <td className="px-4 py-2.5 text-slate-700 font-semibold">{formatMoney(e.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{e.purchasedBy || "—"}</td>
                    <td className="px-4 py-2.5">
                      {e.receiptImage ? (
                        <button type="button" onClick={(ev) => { ev.stopPropagation(); setViewer(e); }} className="text-sky-600 hover:text-sky-700" title="View receipt"><Eye size={15} /></button>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5"><div className="flex gap-2"><GhostButton icon={Edit2} onClick={(ev) => { ev.stopPropagation(); setEditExpense(e); }}>Edit</GhostButton><GhostButton danger onClick={(ev) => { ev.stopPropagation(); setDeleteTarget(e); }}>Delete</GhostButton></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ExpenseFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ExpenseFormModal open={!!editExpense} expense={editExpense} onClose={() => setEditExpense(null)} />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete}
        title="Delete this expense?" description={`This expense (${deleteTarget ? formatMoney(deleteTarget.totalAmount) : ""}) will be permanently removed.`} confirmLabel="Delete" danger />
      <DocumentViewerModal
        open={!!viewer} onClose={() => setViewer(null)}
        title={viewer ? `Expense ${viewer.expenseNo} — Receipt` : ""}
        fileName={viewer?.receiptName} fileDataUrl={viewer?.receiptImage}
        fileType={viewer ? (viewer.receiptType || inferFileType(viewer.receiptImage)) : "image"}
      />
    </div>
  );
}

function emptyExpenseItem() { return { itemName: "", quantity: 1, unitPrice: "" }; }

// One item row inside the multi-item expense form — quantity/unit price are the only inputs;
// the line total is always computed (quantity*unitPrice), never entered directly, so it can
// never drift from what the two inputs actually say.
function ExpenseItemRow({ item, index, onChange, onRemove, canRemove }) {
  const lineTotal = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1fr_80px_120px_120px_28px] gap-2 items-end border-b border-slate-200 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
      <div className="col-span-2 sm:col-span-1">
        <span className="block text-[11px] font-medium text-slate-500 mb-1">Item</span>
        <input className={inputCls} value={item.itemName} onChange={(e) => onChange(index, { itemName: e.target.value })} placeholder="e.g. Printer paper" />
      </div>
      <div>
        <span className="block text-[11px] font-medium text-slate-500 mb-1">Quantity</span>
        <input type="number" min={1} className={inputCls} value={item.quantity} onChange={(e) => onChange(index, { quantity: e.target.value })} />
      </div>
      <div>
        <span className="block text-[11px] font-medium text-slate-500 mb-1">Unit Price</span>
        <input type="number" min={0} className={inputCls} value={item.unitPrice} onChange={(e) => onChange(index, { unitPrice: e.target.value })} />
      </div>
      <div>
        <span className="block text-[11px] font-medium text-slate-500 mb-1">Total</span>
        <p className="text-sm font-semibold text-slate-700 py-2">{formatMoney(lineTotal)}</p>
      </div>
      <div className="flex justify-end sm:justify-center">
        {canRemove && <button type="button" onClick={() => onRemove(index)} className="text-slate-400 hover:text-red-500 p-2" title="Remove item"><Trash2 size={15} /></button>}
      </div>
    </div>
  );
}

// One expense transaction (one purchase/shopping trip) can carry any number of line items —
// Finance shouldn't have to click "Add Expense" once per item bought on the same trip.
function ExpenseFormModal({ open, onClose, expense }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const isEdit = !!expense;
  const activeMethods = data.db.paymentMethods.filter((m) => m.active);
  function defaultPurchasedBy() { return data.announcementSenderLabel(auth.realUser.id); }
  const empty = {
    date: new Date().toISOString().slice(0, 10), items: [emptyExpenseItem()],
    method: activeMethods[0]?.name || "Cash", purchasedBy: defaultPurchasedBy(), note: "",
    // receiptFile: a newly picked File to upload to the private expense-receipts bucket.
    // existingReceiptUrl/Name/Type: the already-saved receipt (a short-lived signed URL).
    // removeReceipt: drop the existing receipt on save.
    receiptFile: null, receiptPreviewUrl: null,
    existingReceiptUrl: null, existingReceiptName: null, existingReceiptType: null, removeReceipt: false,
  };
  const [form, setForm] = useState(empty);
  const { busy, run } = useMutationGuard();
  React.useEffect(() => {
    if (!open) return;
    if (expense) {
      setForm({
        ...empty,
        date: expense.date,
        items: expense.items.map((it) => ({ itemName: it.itemName, quantity: it.quantity, unitPrice: it.unitPrice })),
        method: expense.method, purchasedBy: expense.purchasedBy, note: expense.note || "",
        existingReceiptUrl: expense.receiptImage || null,
        existingReceiptName: expense.receiptName || null,
        existingReceiptType: expense.receiptType || null,
      });
    } else {
      setForm({ ...empty, purchasedBy: defaultPurchasedBy() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setItem(index, patch) { setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })); }
  function addItem() { setForm((f) => ({ ...f, items: [...f.items, emptyExpenseItem()] })); }
  // Never lets the last row disappear — the form always needs at least one item to submit.
  function removeItem(index) { setForm((f) => (f.items.length <= 1 ? f : { ...f, items: f.items.filter((_, i) => i !== index) })); }
  function pickReceipt(file) {
    if (!file) return;
    setForm((f) => ({
      ...f,
      receiptFile: file,
      receiptPreviewUrl: /\.pdf$/i.test(file.name) ? null : URL.createObjectURL(file),
      removeReceipt: false,
    }));
  }
  function clearReceipt() {
    setForm((f) => ({ ...f, receiptFile: null, receiptPreviewUrl: null, removeReceipt: true }));
  }
  const showReceiptName = form.receiptFile ? form.receiptFile.name : (!form.removeReceipt ? form.existingReceiptName : null);
  const showReceiptImageUrl = form.receiptPreviewUrl || (!form.receiptFile && !form.removeReceipt ? form.existingReceiptUrl : null);
  const showReceiptIsPdf = form.receiptFile ? /\.pdf$/i.test(form.receiptFile.name) : (form.existingReceiptType === "pdf");
  const hasReceipt = !!(form.receiptFile || (!form.removeReceipt && form.existingReceiptUrl));
  const grandTotal = form.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  function validate() {
    for (const it of form.items) {
      if (!it.itemName.trim()) return "Please name every item.";
      if (!(Number(it.quantity) > 0)) return "Quantity must be greater than 0.";
      if (!(Number(it.unitPrice) > 0)) return "Unit price must be greater than 0.";
    }
    return null;
  }
  function submit() {
    const err = validate();
    if (err) { toast(err, "error"); return; }
    const payload = {
      date: form.date, method: form.method, purchasedBy: form.purchasedBy, note: form.note,
      items: form.items.map((it) => ({ itemName: it.itemName.trim(), quantity: it.quantity, unitPrice: it.unitPrice })),
      receiptFile: form.receiptFile || undefined,
      removeReceipt: form.removeReceipt || undefined,
    };
    const opKey = isEdit ? `update-expense:${expense.id}` : `create-expense:${form.date}:${grandTotal}:${form.items.length}:${form.method}`;
    run(async () => {
      const result = isEdit ? await data.updateExpense(expense.id, payload) : await data.createExpense(payload, auth.realUser.id);
      if (!result.success) { toast(result.error, "error"); return; }
      toast(result.warning || (isEdit ? "Expense updated." : "Expense recorded."), result.warning ? "info" : "success");
      onClose();
    }, { key: opKey });
  }
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit Expense ${expense?.expenseNo || ""}` : "Add Expense"} wide>
      <Field label="Expense Date" required><input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>

      <div className="mb-3.5">
        <span className="block text-xs font-medium text-slate-500 mb-2">Expense Items</span>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          {form.items.map((item, i) => (
            <ExpenseItemRow key={i} item={item} index={i} onChange={setItem} onRemove={removeItem} canRemove={form.items.length > 1} />
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700">
          <Plus size={14} /> Add Item
        </button>
      </div>

      <div className="flex items-center justify-between bg-sky-50 rounded-lg px-4 py-3 mb-3.5">
        <span className="text-sm font-medium text-slate-600">Total Expense</span>
        <span className="text-lg font-semibold text-sky-700">{formatMoney(grandTotal)}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Payment method"><select className={inputCls} value={form.method} onChange={(e) => set("method", e.target.value)}>{activeMethods.map((m) => <option key={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Purchased by"><input className={inputCls} value={form.purchasedBy} onChange={(e) => set("purchasedBy", e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea className={inputCls} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
      <Field label="Receipt">
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 border border-sky-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-sky-50">
            <Receipt size={13} /> {hasReceipt ? "Replace receipt" : "Attach receipt (image or PDF)"}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pickReceipt(e.target.files[0])} />
          </label>
          {hasReceipt && (
            <button type="button" onClick={clearReceipt} className="text-xs font-medium text-red-500 hover:text-red-600">Remove</button>
          )}
        </div>
        {hasReceipt && (showReceiptIsPdf || !showReceiptImageUrl ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"><FileText size={13} /> {showReceiptName || "receipt"}</p>
        ) : (
          <img src={showReceiptImageUrl} alt="Receipt" className="mt-2 max-h-32 rounded-lg border border-slate-200" />
        ))}
        <p className="mt-1.5 text-[11px] text-slate-400">Stored privately — only the Owner and Finance can view it.</p>
      </Field>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check} loading={busy} loadingText="Saving…">{isEdit ? "Save Changes" : "Save Expense"}</PrimaryButton>
      </div>
    </Modal>
  );
}

/* ============================== AUDIT LOG ============================== */

function AuditLogPage() {
  const data = useData();
  const { db } = data;
  const [q, setQ] = useState("");
  const filtered = db.activities.filter((a) => a.text.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1 flex items-center gap-2"><History size={18} /> Audit Log</h1>
      <p className="text-sm text-slate-400 mb-4">Every recorded action across the school, most recent first.</p>
      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search activity…" /></Toolbar>
      <Card className="p-5">
        {filtered.length === 0 ? <EmptyState icon={History} title="No matching activity" /> : (
          <div className="space-y-3.5 max-h-[32rem] overflow-y-auto">
            {filtered.map((a) => (
              <div key={a.id} className="flex gap-3 text-sm border-b border-slate-50 pb-3 last:border-0">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                <div><p className="text-slate-600 leading-snug">{a.text}</p><p className="text-xs text-slate-300 mt-0.5">{fmtDate(a.createdAt)} · {timeAgo(a.createdAt)}</p></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export {
  OwnerDashboard, AccountsPage, StaffPage, StaffProfilePage, PayrollPage, PaymentMethodsPage, ExpensesPage, AuditLogPage,
};
