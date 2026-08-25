import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, BookOpen, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info, UserPlus,
  Wallet, Bus, ImagePlus, BellRing, Lock
} from "lucide-react";
import {
  ROLES, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, ATTENDANCE_STATUSES, ATTENDANCE_STATUS_TONE, SCHOOL_DAYS,
  todayDayName, academicYearStart, addMonthsFloat, feeCoverage,
  SUBJECTS, GRADES, SECTIONS, sectionLabel,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI, ASSESSMENT_COMPONENT_LABEL, computeSemesterResult,
} from "../utils/constants";
import {
  uid, fmtDate, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor,
} from "../utils/helpers";
import { displayActorLabel } from "../utils/resultAudit";
import { useToast } from "../context/ToastContext";


function Logo({ size = 40 }) {
  return (
    <img
      src={LOGO_DATA_URI}
      alt="Tilmaan Modern Academy"
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tones[tone] || tones.slate}`}>{children}</span>;
}
function statusTone(status) {
  return { ACTIVE: "green", ABSENT: "amber", SUSPENDED: "red", TRANSFERRED: "indigo", GRADUATED: "sky", WITHDRAWN: "slate", ...ATTENDANCE_STATUS_TONE }[status] || "slate";
}

const ATTENDANCE_BUTTON_CLASS = {
  Present: "bg-emerald-600 text-white border-emerald-600",
  Late: "bg-amber-500 text-white border-amber-500",
  Sick: "bg-indigo-500 text-white border-indigo-500",
  Permission: "bg-sky-500 text-white border-sky-500",
  Excused: "bg-slate-500 text-white border-slate-500",
  Absent: "bg-red-500 text-white border-red-500",
};
// Shared status-button row used by every attendance editor (student, staff, and their
// respective overview/take-attendance screens) so the six statuses only need to be wired once.
function AttendanceStatusPicker({ value, onChange, statuses = ATTENDANCE_STATUSES, size = "sm" }) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {statuses.map((st) => (
        <button key={st} type="button" onClick={() => onChange(st)} className={`rounded-md font-medium border ${pad} ${value === st ? ATTENDANCE_BUTTON_CLASS[st] : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>{st}</button>
      ))}
    </div>
  );
}

// Computes a student's semester-result totals against the fixed-weight schema (Midterm 1/2,
// Student Book, Final Exam — 20/20/10/50, summing to 100) via the shared `computeSemesterResult`.
// Kept as `resultTotals` (same name/shape as the retired bookmark/midterm/final version) so the
// handful of screens that only read `.pct`/`.count` don't all need touching.
function resultTotals(record) {
  const r = computeSemesterResult(record);
  return { total: r.total, totalMax: 100, pct: r.total, count: r.completedCount, completionStatus: r.completionStatus };
}

// Shared audit-trail list for one result record: old -> new value, the acting user (masked per
// utils/resultAudit.js's `displayActorLabel` — an Owner edit reads as "School Administration" to
// everyone but the Owner), the stated reason (if any), and when. Callers must gate rendering with
// permissions.js `canViewResultAudit` — Parents and Finance never see this.
// Shown above the gradebook editor when a semester's results are calendar-auto-locked (see
// utils/academicCalendar.js classifySemesterResultLock) — makes the "why can't I edit this"
// question self-answering instead of a silently-disabled Save button.
function SemesterLockBanner({ lockInfo }) {
  if (!lockInfo || !lockInfo.locked) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5 mb-4 flex items-start gap-2.5">
      <Lock size={18} className="shrink-0 mt-0.5 text-amber-500" />
      <div>
        <p className="text-sm font-semibold text-amber-800">Results are locked</p>
        {lockInfo.message && <p className="text-xs mt-0.5 text-amber-700">{lockInfo.message}</p>}
      </div>
    </div>
  );
}

function ResultAuditTrail({ entries, viewerRole }) {
  if (!entries || entries.length === 0) return <p className="text-xs text-slate-400 py-2">No changes recorded yet.</p>;
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div key={e.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-600">{displayActorLabel(e, viewerRole)}</span>
            <span className="text-slate-400 shrink-0" title={`${fmtDate(e.at)} ${fmtTime(e.at)}`}>{timeAgo(e.at)}</span>
          </div>
          <p className="text-slate-500 mt-0.5">
            {e.component && `${ASSESSMENT_COMPONENT_LABEL[e.component] || e.component}: `}
            {e.action === "PUBLISHED" && "Published"}
            {e.action === "LOCKED" && "Locked"}
            {e.action === "UNLOCKED" && "Unlocked"}
            {e.action === "EVIDENCE_ADDED" && "Evidence photo added"}
            {e.action === "EVIDENCE_REMOVED" && "Evidence photo removed"}
            {e.action === "AUTO_LOCK_OVERRIDDEN" && "Unlocked (auto-lock override)"}
            {e.action === "AUTO_LOCK_REINSTATED" && "Re-locked (auto-lock reinstated)"}
            {(e.diff || []).map((d, i) => (
              <span key={i}>{e.action === "COMPONENT_UPDATED" ? `${d.field} ${d.from ?? "—"} → ${d.to ?? "—"}` : ""}{i < e.diff.length - 1 ? "; " : ""}</span>
            ))}
          </p>
          {e.reason && <p className="text-slate-400 mt-0.5 italic">"{e.reason}"</p>}
        </div>
      ))}
    </div>
  );
}

// Confirmation modal for unlocking a result (manually locked OR calendar-auto-locked) — a reason
// is required and recorded to the audit trail (see DataContext's unlockResult/overrideAutoLock).
// `lockMessage` is the specific reason it's currently locked (e.g. from effectiveResultLock), so
// the person unlocking sees exactly what they're overriding before they type a reason.
function UnlockReasonModal({ open, onClose, lockMessage, onConfirm }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Unlock Result">
      {lockMessage && <p className="text-sm text-slate-600 mb-3">{lockMessage}</p>}
      <p className="text-xs text-slate-400 mb-3">Unlocking this result will be recorded in its audit history.</p>
      <Field label="Reason for unlocking" required>
        <AutoGrowTextarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this result needs to be corrected…" className={inputCls} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <button
          type="button"
          disabled={!reason.trim()}
          onClick={() => { const r = reason.trim(); onClose(); onConfirm(r); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${reason.trim() ? "bg-red-600 hover:bg-red-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
        >
          Unlock & Record
        </button>
      </div>
    </Modal>
  );
}

function Avatar({ name, photo, size = 36, className = "" }) {
  if (photo) return <img src={photo} alt={name} className={`rounded-full object-cover shrink-0 ${className}`} style={{ width: size, height: size }} />;
  return (
    <div className={`rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${avatarColor(name)} ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name) || "?"}
    </div>
  );
}

function Modal({ open, onClose, title, children, wide, maxWidthClass }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-4">
        <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidthClass || (wide ? "sm:max-w-2xl" : "sm:max-w-md")} my-6 sm:my-0 animate-none`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800 text-base">{title}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg p-1.5"><X size={18} /></button>
          </div>
          <div className="px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", danger }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600 mb-5">{description}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <button onClick={() => { onConfirm(); onClose(); }} className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-sky-600 hover:bg-sky-700"}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

function EmptyState({ icon: Icon = ClipboardList, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mb-4">
        <Icon size={24} className="text-slate-400" />
      </div>
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function CopyIdChip({ id, label = "Copy" }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(id);
        toast(ok ? "Student ID copied." : "Couldn't copy automatically — please select and copy the ID manually.", ok ? "info" : "error");
      }}
      className="inline-flex items-center gap-1 text-slate-400 hover:text-sky-600 shrink-0"
      title="Copy Student ID"
    >
      <Copy size={13} />{label && <span className="text-[11px] font-medium">{label}</span>}
    </button>
  );
}

function Field({ label, children, required, error }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-xs font-medium text-slate-500 mb-1.5">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {error && <span className="block text-xs text-red-500 mt-1">{error}</span>}
    </label>
  );
}
const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400";

// A <textarea> that grows to fit its content instead of scrolling internally — used by the
// announcement composer so a long message stays fully visible while it's being written.
function AutoGrowTextarea({ value, onChange, className = "", minRows = 3, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      className={`${inputCls} resize-none overflow-hidden ${className}`}
      {...rest}
    />
  );
}

function Card({ children, className = "" }) {
  return <div className={`bg-white border border-slate-200 rounded-xl ${className}`}>{children}</div>;
}

function StatCard({ label, value, icon: Icon, tone = "sky", sub }) {
  const tones = { sky: "bg-sky-50 text-sky-600", emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-600", indigo: "bg-indigo-50 text-indigo-600", red: "bg-red-50 text-red-600" };
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="text-2xl font-semibold text-slate-800 mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon size={18} /></div>
      </div>
    </Card>
  );
}

function SimpleBar({ segments, height = 10 }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="flex w-full rounded-full overflow-hidden" style={{ height }}>
      {segments.map((s, i) => (
        <div key={i} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
      ))}
    </div>
  );
}

// Local calendar-day keys, deliberately never round-tripped through toISOString()/UTC: doing so
// shifts the date by a day for anyone outside UTC-to-UTC-minus zones (e.g. local midnight in a
// UTC+3 timezone is still "yesterday" in UTC), which silently broke Previous/Next by a day.
function dateKeyOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function todayKeyStr() { return dateKeyOf(new Date()); }
function shiftDateKey(dateKey, deltaDays) {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return dateKeyOf(d);
}
function dateKeyLabel(dateKey) {
  const today = todayKeyStr();
  if (dateKey === today) return "Today";
  if (dateKey === shiftDateKey(today, -1)) return "Yesterday";
  return new Date(dateKey + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
// A professional calendar-style date navigator: back/forward one day at a time, or jump via the
// native date picker. Never allows navigating past today by default.
// Optional `minDate`/`maxDate` bound the range (e.g. an academic calendar's first/last valid
// attendance date), and `skipDates(dateKey)` lets Previous/Next step over dates that fall inside
// the range but still aren't selectable (e.g. a school break) so the arrows only ever land on a
// usable date. The native date input can still be used to jump directly onto a skipped date —
// callers are expected to render their own "unavailable" messaging for that case.
function DateNav({ date, onChange, minDate, maxDate, skipDates }) {
  const today = todayKeyStr();
  const effectiveMax = maxDate || today;

  function findValid(startDate, delta) {
    let cur = startDate;
    let guard = 0;
    while (guard++ < 400) {
      if (minDate && cur < minDate) return null;
      if (cur > effectiveMax) return null;
      if (!skipDates || !skipDates(cur)) return cur;
      cur = shiftDateKey(cur, delta);
    }
    return null;
  }

  const prevDate = findValid(shiftDateKey(date, -1), -1);
  const nextDate = findValid(shiftDateKey(date, 1), 1);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <button type="button" disabled={!prevDate} onClick={() => prevDate && onChange(prevDate)} className={`p-1.5 rounded-lg border ${!prevDate ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}><ChevronLeft size={16} /></button>
      <div className="relative">
        <CalendarDays size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input type="date" value={date} min={minDate || undefined} max={effectiveMax} onChange={(e) => e.target.value && onChange(e.target.value)} className="rounded-lg border border-slate-200 pl-8 pr-2.5 py-1.5 text-sm text-slate-700" />
      </div>
      <button type="button" disabled={!nextDate} onClick={() => nextDate && onChange(nextDate)} className={`p-1.5 rounded-lg border ${!nextDate ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}><ChevronRight size={16} /></button>
      <span className="text-sm font-medium text-slate-600">{dateKeyLabel(date)}</span>
      {date < effectiveMax && <button type="button" onClick={() => onChange(effectiveMax)} className="text-xs text-sky-600 font-medium ml-1">Jump to today</button>}
    </div>
  );
}

// Shown in place of the attendance-recording UI whenever the selected date isn't available —
// before the academic year/semester starts, during a school break, or after the year ends.
// Shared by every role's attendance page so the messaging stays consistent everywhere.
function AttendanceCalendarNotice({ classification }) {
  if (!classification || classification.available) return null;
  const isBreak = classification.phase === "break";
  const isClosed = classification.phase === "closed";
  const isWeekend = classification.phase === "weekend";
  const toneCls = isClosed ? "bg-red-50 border-red-200 text-red-800" : isBreak ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-slate-50 border-slate-200 text-slate-600";
  const Icon = isClosed || isWeekend ? School : AlertTriangle;
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 mb-4 text-sm flex items-start gap-2 ${toneCls}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">{classification.label}</p>
        {classification.message && <p className="text-xs mt-0.5 opacity-90">{classification.message}</p>}
      </div>
    </div>
  );
}

// Shown in place of a day's schedule wherever "today" isn't a normal school day — a weekend, a
// school closure, a break, or outside the configured academic year — driven by a single
// classifyAttendanceDay(today) result so every Dashboard/Timetable "Today" widget (Teacher,
// Parent, Owner/Educational Director) reads the same fact instead of separately checking
// closureForDate() and todayDayName(). Renders nothing when today is an ordinary school day.
function NoSchoolTodayBanner({ classification }) {
  if (!classification || classification.available) return null;
  const isClosed = classification.phase === "closed";
  const toneCls = isClosed ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50";
  const iconCls = isClosed ? "text-red-500" : "text-slate-400";
  const titleCls = isClosed ? "text-red-800" : "text-slate-700";
  const msgCls = isClosed ? "text-red-700" : "text-slate-500";
  return (
    <div className={`rounded-lg border px-4 py-3.5 mb-4 flex items-start gap-2.5 ${toneCls}`}>
      <School size={18} className={`shrink-0 mt-0.5 ${iconCls}`} />
      <div>
        <p className={`text-sm font-semibold ${titleCls}`}>{classification.label}</p>
        {classification.message && <p className={`text-xs mt-0.5 ${msgCls}`}>{classification.message}</p>}
      </div>
    </div>
  );
}

// A short "where are we in this school day" strip shown above an attendance page's day content.
// Says nothing when the day is unavailable — AttendanceCalendarNotice already covers that case.
function DayStatusBanner({ dateKey, todayKey, counts }) {
  const today = todayKey || todayKeyStr();
  if (dateKey > today) return null;
  const isToday = dateKey === today;
  const total = (counts || []).reduce((sum, c) => sum + c.n, 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Badge tone={isToday ? "sky" : "slate"}>{isToday ? "Today" : "Completed school day"}</Badge>
        {!isToday && total === 0 && <span className="text-xs text-slate-400">Not recorded yet.</span>}
      </div>
      {!isToday && total > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {counts.filter((c) => c.n > 0).map((c) => (
            <Badge key={c.status} tone={statusTone(c.status)}>{c.status} {c.n}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}


// Shared PAID/PARTIAL/UNPAID badge — used by both Fees (student payments, via balanceFor) and
// Payroll (staff salaries, via staffSalarySummary), which already compute the exact same
// three-way status from actual payment sums. One rendering so the two stay visually consistent.
function PaymentStatusBadge({ status }) {
  if (status === "PAID") return <Badge tone="green">Paid in full</Badge>;
  if (status === "PARTIAL") return <Badge tone="amber">Partially paid</Badge>;
  return <Badge tone="red">Unpaid</Badge>;
}

// Minimal multi-select: `items` is [{id, label, sublabel?}], `selectedIds` the checked subset.
// Deliberately no search box — every caller today picks among a handful of siblings or a
// filtered student list, not the whole school roster.
function CheckboxList({ items, selectedIds, onChange, emptyLabel = "Nothing to select" }) {
  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }
  if (items.length === 0) return <p className="text-xs text-slate-400 py-2">{emptyLabel}</p>;
  return (
    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
      {items.map((it) => (
        <label key={it.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
          <input type="checkbox" checked={selectedIds.includes(it.id)} onChange={() => toggle(it.id)} className="rounded border-slate-300 text-sky-600 shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block truncate">{it.label}</span>
            {it.sublabel && <span className="block text-xs text-slate-400">{it.sublabel}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

// Shared renderer for both `installmentStatusForStudent` and `busScheduleForStudent` — callers
// normalize either shape into `{label, dueLabel?, amountDue, paid, remaining, status}` rows first,
// so this stays pure presentation with no knowledge of tuition vs. bus.
function FeeScheduleList({ rows, emptyLabel = "Nothing configured yet." }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-slate-400 py-2">{emptyLabel}</p>;
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between py-2 text-sm gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-slate-700 truncate">{r.label}</p>
              {r.current && <span className="shrink-0 text-[10px] font-medium text-sky-600 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-full">Current</span>}
            </div>
            {r.dueLabel && <p className="text-xs text-slate-400">{r.dueLabel}</p>}
          </div>
          <div className="text-right shrink-0">
            <PaymentStatusBadge status={r.status} />
            <p className="text-xs text-slate-500 mt-0.5">{formatMoney(r.paid)} paid{r.remaining > 0 ? ` • ${formatMoney(r.remaining)} remaining` : ""}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const CALENDAR_CELL_TONE = {
  slate: "bg-slate-100 text-slate-600",
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  sky: "bg-sky-100 text-sky-800",
  indigo: "bg-indigo-100 text-indigo-800",
};
// A month-at-a-time calendar grid for attendance history (e.g. a staff profile's "click a date
// to see that day's record" view). `year`/`month` (0-indexed, JS Date convention) pick the month;
// `getDayInfo(dateKey)` returns `{ status, note }` or null for a day with no record; `minDate`
// caps how far back navigation can go (an employee's start date), `maxDate` caps how far forward
// (today). Purely presentational — callers own the month state and the click handler.
function MonthCalendarGrid({ year, month, getDayInfo, onSelectDay, minDate, maxDate }) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = first.getDay(); // 0 = Sunday
  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function keyFor(d) { return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-slate-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const dateKey = keyFor(d);
          const outOfRange = (minDate && dateKey < minDate) || (maxDate && dateKey > maxDate);
          const info = !outOfRange ? getDayInfo(dateKey) : null;
          const tone = info ? (statusTone(info.status) || "slate") : "slate";
          const clickable = !outOfRange && !!onSelectDay;
          return (
            <button
              key={dateKey}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelectDay(dateKey)}
              title={info ? `${dateKey} — ${info.status}${info.note ? `: ${info.note}` : ""}` : dateKey}
              className={`aspect-square rounded-lg text-[11px] font-medium flex items-center justify-center transition-colors ${outOfRange ? "text-slate-200" : info ? CALENDAR_CELL_TONE[tone] : "bg-slate-50 text-slate-400"} ${clickable ? "hover:ring-2 hover:ring-sky-300 cursor-pointer" : "cursor-default"}`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toolbar({ children }) {
  return <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-4">{children}</div>;
}
function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="relative flex-1 min-w-[180px]">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls + " pl-9"}
        type="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
      />
    </div>
  );
}
function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls + " sm:w-40"}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function PrimaryButton({ children, onClick, icon: Icon = Plus, type = "button", full }) {
  return (
    <button type={type} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${full ? "w-full" : ""}`}>
      <Icon size={15} />{children}
    </button>
  );
}
function GhostButton({ children, onClick, icon: Icon, danger }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      {Icon && <Icon size={13} />}{children}
    </button>
  );
}


export {
  inputCls, Logo, Badge, statusTone, resultTotals, Avatar, Modal, ConfirmDialog, EmptyState,
  CopyIdChip, Field, Card, StatCard, SimpleBar, AutoGrowTextarea, todayKeyStr, shiftDateKey, dateKeyLabel, DateNav, AttendanceCalendarNotice, DayStatusBanner, NoSchoolTodayBanner,
  Toolbar, SearchInput, Select, PrimaryButton, GhostButton, AttendanceStatusPicker,
  ResultAuditTrail, UnlockReasonModal, SemesterLockBanner, PaymentStatusBadge, MonthCalendarGrid,
  CheckboxList, FeeScheduleList,
};
