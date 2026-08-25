import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info, UserPlus,
  Wallet, Bus, ImagePlus, BellRing, Lock, ArrowRightLeft, History, Receipt as ReceiptIcon, FileText,
  CheckCheck, Image as ImageIcon, Banknote, Printer, ShieldCheck, Trophy, Pin, PinOff, Ban,
} from "lucide-react";
import {
  ROLES, ROLE_LABEL, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, ATTENDANCE_STATUSES, TEACHER_UNAVAILABLE_STATUSES, STAFF_SHIFT_PERIODS, STAFF_SHIFT_PERIOD_LABEL, LEAVE_REQUEST_REASONS, SCHOOL_DAYS,
  todayDayName, addMonthsFloat, feeCoverage,
  SUBJECTS, GRADES, SECTIONS, sectionLabel, gradeSectionCompare,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI, MIN_PERIODS, MAX_PERIODS,
  CLOSURE_REASON_PRESETS, staffGroupLabel,
  SEMESTERS, SEMESTER_LABEL, ASSESSMENT_COMPONENTS, ASSESSMENT_COMPONENT_LABEL, ASSESSMENT_COMPONENT_WEIGHT,
} from "../../utils/constants";
import {
  uid, fmtDate, fmtDateLong, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor, fullName, computePeriodSchedule,
  leaveDurationLabel, amountInWords, monthLabel,
} from "../../utils/helpers";
import {
  inputCls, Logo, Badge, statusTone, resultTotals, Avatar, Modal, ConfirmDialog, EmptyState,
  CopyIdChip, Field, Card, StatCard, SimpleBar, AutoGrowTextarea, todayKeyStr, shiftDateKey, dateKeyLabel, DateNav, AttendanceCalendarNotice, DayStatusBanner, NoSchoolTodayBanner,
  Toolbar, SearchInput, Select, PrimaryButton, GhostButton, AttendanceStatusPicker,
  ResultAuditTrail, UnlockReasonModal, SemesterLockBanner, PaymentStatusBadge, CheckboxList, FeeScheduleList,
} from "../../components/ui";
import { CashReceiptModal } from "../../components/Receipt";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { canEditResultComponent, canPublishResult, canLockResult, canUnlockResult, canViewResultAudit, isAssignedSubjectTeacher } from "../../utils/permissions";
import { usePresenceMap, isOnline, useOtherTyping, useTypingBroadcaster } from "../../utils/presence";
import { useActiveChild, ChildSwitcher } from "../parent/ParentPages";
import { PeriodAttendanceModal } from "../teacher/TeacherPages";
import { teacherLabel, homeworkSummary, HomeworkList, HomeworkDetailsModal } from "../../components/homework";
import { ReportCardModal } from "../../components/ReportCard";
import { LeaveRequestHistoryList, RejectLeaveModal } from "../../components/leave";
import { AnnouncementDetailModal, audienceLabel, AnnouncementAttachmentField, AnnouncementAttachmentChip, isAnnouncementLive, announcementReadStats } from "../../components/announcements";
import { computeBreakRange, suggestSemester2, currentAcademicYear, activeYearStartDate, formatAcademicYearLabel, defaultAcademicCalendar, addDays } from "../../utils/academicCalendar";
import { downloadElementAsPdf } from "../../utils/pdf";
import {
  canEditStudent, canDeleteStudent, canSuspendStudent, canChangeStudentPhoto,
  canManageAcademicYears, canAddBehavior, canViewStudentPayments, canVoidPayment, canTakeAttendance, studentStatusNotice,
} from "../../utils/studentPermissions";
import { DocumentViewerModal, inferFileType } from "../../components/DocumentViewer";
import { employmentActiveOn } from "../../utils/staffEmploymentStatus";


function AdminDashboard({ openStudent, onOpenActivity, setPage }) {
  const data = useData();
  const { db } = data;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayInfo = data.classifyAttendanceDay(todayKey);
  // A closure/weekend/break declared for today doesn't erase attendance already on record for
  // it (see AcademicCalendarSettingsModal's own warning) — but this dashboard must stop treating
  // those stale counts as *today's* attendance once the calendar no longer agrees it's a school day.
  const todaysAttendance = todayInfo.available ? db.attendance.filter((a) => a.date === todayKey) : [];
  const present = todaysAttendance.filter((a) => a.status === "Present").length;
  const attendancePct = todaysAttendance.length ? Math.round((present / todaysAttendance.length) * 100) : 0;
  const activeStudents = db.students.filter((s) => s.status !== "WITHDRAWN" && s.status !== "TRANSFERRED" && s.status !== "ARCHIVED");
  const teachers = db.users.filter((u) => u.role === ROLES.TEACHER && u.status !== "INACTIVE" && u.status !== "DISABLED");
  const parents = db.users.filter((u) => u.role === ROLES.PARENT);
  const pendingIssues = db.behaviorRecords.filter((b) => ["Warning", "Fighting", "Disrespect"].includes(b.type) && Date.now() - b.createdAt < 7 * 86400000).length;
  const homeworkToday = db.homework.filter((h) => new Date(h.createdAt).toDateString() === new Date().toDateString()).length;
  const upcomingExamAnnouncements = db.examAnnouncements.filter((a) => new Date(a.examDate) >= new Date(new Date().toDateString())).sort((a, b) => new Date(a.examDate) - new Date(b.examDate));
  const gradeDist = data.gradeOptions().map((g) => ({ label: g, value: db.students.filter((s) => s.grade === g).length }));
  const maxGrade = Math.max(...gradeDist.map((g) => g.value), 1);
  // Payments/Payroll/Expenses are all off-limits to the Educational Director (see role matrix),
  // so Recent Activity here must never surface those entries — they carry raw dollar figures in
  // their display text, not just in the deep-link target.
  const visibleActivities = db.activities.filter((a) => !["payments", "payroll", "expenses"].includes(a.navigation?.page));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Good morning, Administrator</h1>
        <p className="text-sm text-slate-400 mt-0.5">Tilmaan Modern Academy — here's what's happening today, {fmtDate(new Date())}.</p>
      </div>

      <NoSchoolTodayBanner classification={todayInfo} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Total Students" value={activeStudents.length} icon={GraduationCap} tone="sky" />
        <StatCard label="Active Teachers" value={teachers.length} icon={UserCog} tone="indigo" />
        <StatCard label="Parents" value={parents.length} icon={Users} tone="emerald" />
        <StatCard label="Classes" value={db.classes.length} icon={School} tone="sky" />
        <StatCard label="Today's Attendance" value={todayInfo.available ? `${attendancePct}%` : "—"} icon={ClipboardCheck} tone="emerald" sub={todayInfo.available ? `${present}/${todaysAttendance.length} present` : todayInfo.label} />
        <StatCard label="Pending Issues" value={pendingIssues} icon={AlertTriangle} tone="amber" sub="last 7 days" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Attendance Today</h3>
          {!todayInfo.available ? (
            <p className="text-xs text-slate-400">{todayInfo.label}{todayInfo.message ? ` — ${todayInfo.message}` : ""}</p>
          ) : (
          <>
          <SimpleBar segments={[
            { label: "Present", value: todaysAttendance.filter((a) => a.status === "Present").length, color: "bg-emerald-500" },
            { label: "Late", value: todaysAttendance.filter((a) => a.status === "Late").length, color: "bg-amber-400" },
            { label: "Sick", value: todaysAttendance.filter((a) => a.status === "Sick").length, color: "bg-indigo-400" },
            { label: "Permission", value: todaysAttendance.filter((a) => a.status === "Permission").length, color: "bg-sky-400" },
            { label: "Absent", value: todaysAttendance.filter((a) => a.status === "Absent").length, color: "bg-red-400" },
          ]} height={12} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-emerald-500" />Present</span>
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-amber-400" />Late</span>
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-indigo-400" />Sick</span>
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-sky-400" />Permission</span>
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-red-400" />Absent</span>
          </div>
          </>
          )}
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
            <div className="flex justify-between text-xs"><span className="text-slate-500">Homework created today</span><span className="font-semibold text-slate-700">{homeworkToday}</span></div>
            <div className="flex justify-between text-xs"><span className="text-slate-500">Upcoming exams announced</span><span className="font-semibold text-slate-700">{upcomingExamAnnouncements.length}</span></div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Students by Grade</h3>
          <div className="space-y-3">
            {gradeDist.map((g) => (
              <div key={g.label}>
                <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">{g.label}</span><span className="font-medium text-slate-700">{g.value}</span></div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${(g.value / maxGrade) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Upcoming Exams</h3>
          {upcomingExamAnnouncements.length === 0 ? <EmptyState title="No exams announced" description="Announced exams will appear here." /> : (
            <div className="space-y-2.5">
              {upcomingExamAnnouncements.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs">
                  <div>
                    <p className="font-medium text-slate-700">{a.title}</p>
                    <p className="text-slate-400">{a.audience.type === "ALL" ? "Whole school" : a.audience.type === "GRADE" ? a.audience.grade : `${a.audience.grade}${a.audience.section}`}</p>
                  </div>
                  <Badge tone="sky">{fmtDate(a.examDate)}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <TodaysJournalSummaryCard setPage={setPage} />

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Recent Activity</h3>
          <div className="space-y-3.5 max-h-80 overflow-y-auto">
            {visibleActivities.slice(0, 10).map((a) => (
              a.navigation ? (
                <button key={a.id} type="button" onClick={() => onOpenActivity && onOpenActivity(a.navigation)} className="w-full flex gap-3 text-xs text-left hover:bg-slate-50 rounded-lg -mx-1 px-1 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-slate-600 leading-snug hover:text-sky-700">{a.text}</p>
                    <p className="text-slate-300 mt-0.5">{timeAgo(a.createdAt)}</p>
                  </div>
                </button>
              ) : (
                <div key={a.id} className="flex gap-3 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-slate-600 leading-snug">{a.text}</p>
                    <p className="text-slate-300 mt-0.5">{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              )
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Recent Behavior Incidents</h3>
          {db.behaviorRecords.length === 0 ? <EmptyState title="No behavior records" description="Recorded incidents will appear here." /> : (
            <div className="space-y-3">
              {[...db.behaviorRecords].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((b) => {
                const s = data.getStudent(b.studentId);
                return (
                  <button key={b.id} onClick={() => s && openStudent(s.id)} className="w-full flex items-center justify-between text-xs hover:bg-slate-50 rounded-lg px-2 py-1.5 -mx-2">
                    <div className="text-left">
                      <p className="font-medium text-slate-700">{s ? data.studentIdentity(s).display : "Unknown"}</p>
                      <p className="text-slate-400">{b.description.slice(0, 50)}{b.description.length > 50 ? "…" : ""}</p>
                    </div>
                    <Badge tone={b.type === "Positive" ? "green" : b.severity === "High" ? "red" : "amber"}>{b.type}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">Teachers Attendance Today</h3>
          <Badge tone="sky">{teachers.filter((t) => { const sr = db.staff.find((s) => s.userId === t.id); return sr && db.staffAttendance.some((a) => a.staffId === sr.id && a.date === todayKey && a.status === "Present"); }).length}/{teachers.length} present</Badge>
        </div>
        {teachers.length === 0 ? <EmptyState title="No teaching staff yet" description="Teacher attendance will appear here once staff are added." /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {teachers.map((t) => {
              const sr = db.staff.find((s) => s.userId === t.id);
              const att = sr && db.staffAttendance.find((a) => a.staffId === sr.id && a.date === todayKey);
              return (
                <div key={t.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-600 truncate pr-2">{t.name}</span>
                  {att ? <Badge tone={statusTone(att.status)}>{att.status}{att.status === "Late" && att.arrivalTime ? ` · ${to12Hour(att.arrivalTime)}` : ""}</Badge> : <Badge tone="slate">Not marked</Badge>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}


// A student roster as of a given academic year: for the current year this reads the students'
// live/current fields (exactly as before); for a past year it's reconstructed from that year's
// `enrollments` rows instead, so grade/section/status shown reflect what was true THEN, not now.
function rosterForYear(db, yearId) {
  const year = yearId ? db.academicYears.find((y) => y.id === yearId) : null;
  if (!year || year.isCurrent) {
    return db.students.map((s) => ({ student: s, grade: s.grade, section: s.section, status: s.status }));
  }
  return db.enrollments
    .filter((e) => e.academicYearId === yearId)
    .map((e) => {
      const student = db.students.find((s) => s.id === e.studentId);
      return student ? { student, grade: e.grade, section: e.section, status: e.status } : null;
    })
    .filter(Boolean);
}

function StudentsPage({ onOpen }) {
  const data = useData();
  const toast = useToast();
  const { db } = data;
  const currentYear = currentAcademicYear(db.academicYears);
  const [q, setQ] = useState("");
  const [grade, setGrade] = useState("");
  const [status, setStatus] = useState("ACTIVE"); // default view: active students, per spec §19 — not a mix of every status
  const [gender, setGender] = useState("");
  const [academicYearId, setAcademicYearId] = useState(currentYear ? currentYear.id : "");
  const [addOpen, setAddOpen] = useState(false);

  const sortedYears = [...(db.academicYears || [])].sort((a, b) => (b.yearStart || "").localeCompare(a.yearStart || ""));
  const roster = rosterForYear(db, academicYearId);

  const filtered = roster.filter(({ student: s, grade: g, section: sec, status: st }) => {
    const name = data.studentFullName(s).toLowerCase();
    if (q && !name.includes(q.toLowerCase()) && !s.studentId.toLowerCase().includes(q.toLowerCase())) return false;
    if (grade && g !== grade) return false;
    if (status && st !== status) return false;
    if (gender && s.gender !== gender) return false;
    return true;
  });

  const headline = status ? `${filtered.length} ${status === "ACTIVE" ? "Active" : status[0] + status.slice(1).toLowerCase()} Student${filtered.length === 1 ? "" : "s"}` : `${filtered.length} Student${filtered.length === 1 ? "" : "s"}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Students</h1>
        <PrimaryButton onClick={() => setAddOpen(true)}>Add Student</PrimaryButton>
      </div>
      <p className="text-sm text-slate-400 mb-4">{headline} across {db.classes.length} classes{sortedYears.length > 1 ? ` — ${formatAcademicYearLabel(db.academicYears.find((y) => y.id === academicYearId)) || "all years"}` : ""}.</p>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search name or student ID…" />
        <Select value={grade} onChange={setGrade} options={data.gradeOptions()} placeholder="All grades" />
        <Select value={status} onChange={setStatus} options={STUDENT_STATUS} placeholder="All statuses" />
        <Select value={gender} onChange={setGender} options={["Male", "Female"]} placeholder="All genders" />
        {sortedYears.length > 1 && (
          <select className={inputCls + " sm:w-64"} value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
            <option value="">All Years</option>
            {sortedYears.map((y) => <option key={y.id} value={y.id}>{formatAcademicYearLabel(y)}</option>)}
          </select>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No students found" description="Try adjusting your filters, or add a new student to get started." action={<PrimaryButton onClick={() => setAddOpen(true)}>Add Student</PrimaryButton>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">#</th>
                  <th className="text-left font-medium px-4 py-2.5">Student</th>
                  <th className="text-left font-medium px-4 py-2.5">Student ID</th>
                  <th className="text-left font-medium px-4 py-2.5">Class</th>
                  <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Gender</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const s = row.student;
                  return (
                    <tr key={s.id} onClick={() => onOpen(s.id)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                      <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={data.studentFullName(s)} photo={s.photo} size={30} />
                          <span className="font-medium text-slate-700">{data.studentFullName(s)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          <span>{s.studentId}</span>
                          <CopyIdChip id={s.studentId} label="" />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{row.grade}{row.section}</td>
                      <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell">{s.gender}</td>
                      <td className="px-4 py-2.5"><Badge tone={statusTone(row.status)}>{row.status}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

const RELATIONSHIP_OPTIONS = ["Father", "Mother", "Guardian", "Sibling", "Other"];

// Shared by AddStudentModal and EditStudentModal so Edit always has exactly the same fields as
// Add (previously Edit was missing middleName/gender/dob/admissionDate/photo entirely — spec §5).
// `mode` toggles the couple of fields that only make sense once a student already exists
// (Status — Add always creates ACTIVE students via the dedicated flow, not a free status picker;
// photo — handled by the dedicated Change Profile Photo action, see ChangePhotoModal).
function StudentFormFields({ form, set, fieldCls, errors, mode, gradeOptions, onPickPhoto }) {
  const isEdit = mode === "edit";
  return (
    <div className="grid sm:grid-cols-2 gap-x-4">
      {isEdit && (
        <Field label="Profile photo">
          <div className="flex items-center gap-3">
            <Avatar name={`${form.firstName || ""} ${form.lastName || ""}`} photo={form.photo} size={44} />
            <button type="button" onClick={onPickPhoto} className="text-xs text-sky-600 font-medium border border-sky-100 rounded-lg px-3 py-2 hover:bg-sky-50">Change Photo</button>
          </div>
        </Field>
      )}
      <Field label="First name" required error={errors.firstName}><input className={fieldCls("firstName")} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
      <Field label="Middle name" required error={errors.middleName}><input className={fieldCls("middleName")} value={form.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
      <Field label="Last name" required error={errors.lastName}><input className={fieldCls("lastName")} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
      <Field label="Gender">
        <select className={inputCls} value={form.gender || ""} onChange={(e) => set("gender", e.target.value)}>
          <option value="">Select gender</option>
          <option>Male</option>
          <option>Female</option>
        </select>
      </Field>
      <Field label="Date of birth"><input type="date" className={inputCls} value={form.dob || ""} onChange={(e) => set("dob", e.target.value)} /></Field>
      <Field label="Enrollment / start date"><input type="date" className={inputCls} value={form.admissionDate || ""} onChange={(e) => set("admissionDate", e.target.value)} /></Field>
      <Field label="Grade" required error={errors.grade}>
        <select className={fieldCls("grade")} value={form.grade} onChange={(e) => set("grade", e.target.value)}>
          <option value="">Select grade</option>
          {gradeOptions.map((g) => <option key={g}>{g}</option>)}
        </select>
      </Field>
      <Field label="Section">
        <select className={inputCls} value={form.section || ""} onChange={(e) => set("section", e.target.value)}>
          <option value="">Select section</option>
          {SECTIONS.filter(Boolean).map((s) => <option key={s} value={s}>{sectionLabel(s)}</option>)}
        </select>
      </Field>
      {isEdit && (
        <Field label="Status"><select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>{STUDENT_STATUS.map((st) => <option key={st}>{st}</option>)}</select></Field>
      )}
      <div className="sm:col-span-2 mt-1 mb-1.5">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Parent / Emergency Contact</h4>
      </div>
      <Field label="Name"><input className={inputCls} value={form.emergencyContactName || ""} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Mohamed Hassan" /></Field>
      <Field label="Phone number"><input className={inputCls} value={form.emergencyContact || ""} onChange={(e) => set("emergencyContact", e.target.value)} placeholder="+251 61..." /></Field>
      <Field label="Relationship">
        <select className={inputCls} value={form.emergencyContactRelationship || ""} onChange={(e) => set("emergencyContactRelationship", e.target.value)}>
          <option value="">Select relationship</option>
          {RELATIONSHIP_OPTIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="Bus fee">
        <label className="flex items-center gap-2 text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2">
          <input type="checkbox" checked={!!form.usesBus} onChange={(e) => set("usesBus", e.target.checked)} className="rounded border-slate-300 text-sky-600" /> Uses the school bus
        </label>
      </Field>
      {!isEdit && (
        <Field label="Student photo">
          <div className="flex items-center gap-3">
            {form.photo && <img src={form.photo} alt="Student preview" className="w-12 h-12 rounded-full object-cover border border-slate-200 shrink-0" />}
            <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-400 cursor-pointer hover:border-sky-300">
              <Camera size={15} /> {form.photo ? "Change photo" : "Upload photo (optional)"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader(); reader.onload = () => set("photo", reader.result); reader.readAsDataURL(file);
              }} />
            </label>
          </div>
        </Field>
      )}
    </div>
  );
}

function AddStudentModal({ open, onClose }) {
  const data = useData();
  const toast = useToast();
  const empty = { firstName: "", middleName: "", lastName: "", gender: "", dob: "", grade: "", section: "", admissionDate: new Date().toISOString().slice(0, 10), emergencyContactName: "", emergencyContact: "", emergencyContactRelationship: "", usesBus: false, photo: null };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [createdId, setCreatedId] = useState(null);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }
  function fieldCls(k) {
    return errors[k]
      ? inputCls.replace("border-slate-200", "border-red-400").replace("focus:ring-sky-500/40", "focus:ring-red-400/40").replace("focus:border-sky-400", "focus:border-red-400")
      : inputCls;
  }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    const nextErrors = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!form.middleName.trim()) nextErrors.middleName = "Middle name is required.";
    if (!form.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!form.grade) nextErrors.grade = "Please select a grade.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast("Please complete the required fields.", "error");
      return;
    }
    const id = data.createStudent({
      ...form,
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim(),
      lastName: form.lastName.trim(),
    });
    setCreatedId(id);
    toast("Student added successfully.", "success");
  }
  function close() { setForm(empty); setErrors({}); setCreatedId(null); onClose(); }
  const currentYear = currentAcademicYear(data.db.academicYears);

  return (
    <Modal open={open} onClose={close} title={createdId ? "Student added" : "Add Student"} wide>
      {createdId ? (
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
          <p className="font-medium text-slate-700 mb-1">Student added successfully.</p>
          <p className="text-xs text-slate-400 mb-4">The parent will use this ID to connect their account.</p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between max-w-xs mx-auto">
            <span className="font-mono text-sm font-semibold text-slate-700">{createdId}</span>
            <button onClick={async () => { const ok = await copyText(createdId); toast(ok ? "Student ID copied." : "Couldn't copy automatically — please select and copy the ID manually.", ok ? "info" : "error"); }} className="text-sky-600 hover:text-sky-700"><Copy size={15} /></button>
          </div>
          <button onClick={close} className="mt-5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium">Done</button>
        </div>
      ) : (
        <div>
          <StudentFormFields form={form} set={set} fieldCls={fieldCls} errors={errors} mode="add" gradeOptions={data.gradeOptions()} />
          <p className="text-xs text-slate-400 mb-3">A unique Student ID (e.g. {data.generateStudentId()}) will be generated automatically for {formatAcademicYearLabel(currentYear)}.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <PrimaryButton type="button" onClick={submit} icon={Check}>Create Student</PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Upload/replace/remove/preview — spec §6. Reuses the same FileReader→data-URL pattern as
// AddStudentModal's photo field; saves immediately via updateStudent (no separate photo storage).
function ChangePhotoModal({ open, onClose, student }) {
  const data = useData();
  const toast = useToast();
  const [preview, setPreview] = useState(student?.photo || null);
  useEffect(() => { setPreview(student?.photo || null); }, [student?.id, open]);
  function onFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  }
  function save() {
    data.updateStudent(student.id, { photo: preview });
    toast(preview ? "Profile photo updated." : "Profile photo removed.", "success");
    onClose();
  }
  if (!student) return null;
  return (
    <Modal open={open} onClose={onClose} title="Change Profile Photo">
      <div className="flex flex-col items-center gap-4 py-2">
        <Avatar name={`${student.firstName} ${student.lastName}`} photo={preview} size={96} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-500 cursor-pointer hover:border-sky-300">
            <Camera size={15} /> {preview ? "Replace photo" : "Upload photo"}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} />
          </label>
          {preview && <button type="button" onClick={() => setPreview(null)} className="text-xs text-red-600 font-medium px-3 py-2 hover:bg-red-50 rounded-lg">Remove photo</button>}
        </div>
        <div className="flex justify-end gap-2 w-full pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={save} icon={Check}>Save Photo</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function monthKeyOf(dateStr) { return (dateStr || "").slice(0, 7); }
function shiftMonthKey(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// A student's month-based Attendance/Homework tabs — latest month first, navigable backward.
// `minMonthKey` is optional (e.g. the class monthly register bounds navigation to the academic
// year's configured start) — omitted call sites keep navigating back indefinitely, unchanged.
function MonthNav({ monthKey, onChange, maxMonthKey, minMonthKey }) {
  const atMax = !!maxMonthKey && monthKey >= maxMonthKey;
  const atMin = !!minMonthKey && monthKey <= minMonthKey;
  return (
    <div className="flex items-center gap-2 mb-3">
      <button type="button" disabled={atMin} onClick={() => !atMin && onChange(shiftMonthKey(monthKey, -1))} className={`p-1.5 rounded-lg border ${atMin ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}><ChevronLeft size={16} /></button>
      <span className="text-sm font-medium text-slate-700 min-w-[9.5rem] text-center">{monthLabel(monthKey)}</span>
      <button type="button" disabled={atMax} onClick={() => !atMax && onChange(shiftMonthKey(monthKey, 1))} className={`p-1.5 rounded-lg border ${atMax ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}><ChevronRight size={16} /></button>
    </div>
  );
}
// Whether a {startDate,endDate} range (e.g. a suspension) overlaps a "YYYY-MM" month.
function overlapsMonth(range, monthKey) {
  if (!range || !range.startDate) return false;
  const start = range.startDate, end = range.endDate || range.startDate;
  return start <= `${monthKey}-31` && end >= `${monthKey}-01`;
}

const DOCUMENT_CATEGORIES = ["Report Cards", "ID Documents", "Other Documents"];
const TAB_LABELS = { overview: "Overview", attendance: "Attendance", homework: "Homework", exams: "Results", behavior: "Behavior", documents: "Documents", payments: "Payments" };

function UploadDocumentModal({ open, onClose, studentId }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const empty = { category: DOCUMENT_CATEGORIES[0], title: "", fileDataUrl: null, fileType: "image", fileName: "" };
  const [form, setForm] = useState(empty);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function onFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setForm((f) => ({ ...f, fileDataUrl: dataUrl, fileType: inferFileType(dataUrl), fileName: file.name, title: f.title || file.name.replace(/\.[^.]+$/, "") }));
    };
    reader.readAsDataURL(file);
  }
  function submit() {
    if (!form.fileDataUrl) { toast("Please choose a file to upload.", "error"); return; }
    if (!form.title.trim()) { toast("Please give the document a title.", "error"); return; }
    data.createStudentDocument(studentId, { category: form.category, title: form.title.trim(), fileDataUrl: form.fileDataUrl, fileType: form.fileType, fileName: form.fileName }, auth.currentUser.id);
    toast("Document uploaded.", "success");
    setForm(empty); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="Upload Document">
      <Field label="Category">
        <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
          {DOCUMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Title" required><input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Midterm Report Card" /></Field>
      <Field label="File">
        <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-500 cursor-pointer hover:border-sky-300">
          <FileText size={15} /> {form.fileName || "Choose an image or PDF"}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
        </label>
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton type="button" onClick={submit} icon={Check}>Upload</PrimaryButton>
      </div>
    </Modal>
  );
}

// Creates the student's enrollment for a chosen (usually newly-created) academic year without
// touching anything from prior years — spec §2/§21. Grade/section default to their current ones
// but are editable, since promoting is also how a student moves up a grade.
function PromoteStudentModal({ open, onClose, student }) {
  const data = useData();
  const toast = useToast();
  const years = [...data.db.academicYears].sort((a, b) => (b.yearStart || "").localeCompare(a.yearStart || ""));
  const defaultYear = currentAcademicYear(data.db.academicYears);
  const [academicYearId, setAcademicYearId] = useState(defaultYear ? defaultYear.id : "");
  const [grade, setGrade] = useState(student?.grade || "");
  const [section, setSection] = useState(student?.section || "");
  useEffect(() => {
    if (open) { setAcademicYearId(defaultYear ? defaultYear.id : ""); setGrade(student?.grade || ""); setSection(student?.section || ""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);
  function submit() {
    if (!academicYearId || !grade) { toast("Please choose an academic year and grade.", "error"); return; }
    const res = data.promoteStudent(student.id, { academicYearId, grade, section });
    if (!res.ok) { toast(res.message, "error"); return; }
    toast("Student promoted/re-enrolled.", "success");
    onClose();
  }
  if (!student) return null;
  return (
    <Modal open={open} onClose={onClose} title="Promote / Re-enroll Student">
      <p className="text-xs text-slate-500 mb-3">This creates a new enrollment for {data.studentFullName(student)} without touching their previous years' attendance, homework, results, or documents.</p>
      <Field label="Academic year" required>
        <select className={inputCls} value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
          <option value="">Select academic year</option>
          {years.map((y) => <option key={y.id} value={y.id}>{formatAcademicYearLabel(y)}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Grade" required>
          <select className={inputCls} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">Select grade</option>
            {data.gradeOptions().map((g) => <option key={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Section">
          <select className={inputCls} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">Select section</option>
            {SECTIONS.filter(Boolean).map((sec) => <option key={sec} value={sec}>{sectionLabel(sec)}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton type="button" onClick={submit} icon={Check}>Promote / Re-enroll</PrimaryButton>
      </div>
    </Modal>
  );
}

function StudentProfilePage({ studentId, onBack, focus, onMessage }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const s = data.getStudent(studentId);
  const isTeacher = auth.currentUser.role === ROLES.TEACHER;
  const canEdit = canEditStudent(auth.currentUser);
  const canDelete = canDeleteStudent(auth.currentUser);
  const canSuspend = canSuspendStudent(auth.currentUser);
  const canPhoto = canChangeStudentPhoto(auth.currentUser);
  const canBehavior = canAddBehavior(auth.currentUser);
  const canPayments = canViewStudentPayments(auth.currentUser);
  const canVoid = canVoidPayment(auth.currentUser);
  const canYears = canManageAcademicYears(auth.currentUser);

  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [uploadDocOpen, setUploadDocOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [docViewer, setDocViewer] = useState(null);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [receiptPaymentId, setReceiptPaymentId] = useState(null);
  const [attMonth, setAttMonth] = useState(todayKeyStr().slice(0, 7));
  const [hwMonth, setHwMonth] = useState(todayKeyStr().slice(0, 7));

  const enrollments = s ? data.enrollmentsForStudent(s.id) : [];
  const defaultYear = currentAcademicYear(data.db.academicYears);
  const [selectedYearId, setSelectedYearId] = useState(defaultYear ? defaultYear.id : "");
  useEffect(() => { setSelectedYearId(defaultYear ? defaultYear.id : ""); /* reset when opening a different student */ }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link from a Recent Activity item (e.g. "payment recorded for X") — jump straight to
  // the relevant tab, and open the receipt if one was named.
  useEffect(() => {
    if (!focus) return;
    if (focus.tab) setTab(focus.tab);
    if (focus.paymentId) setReceiptPaymentId(focus.paymentId);
  }, [studentId, focus]);

  if (!s) return <EmptyState title="Student not found" action={<GhostButton onClick={onBack} icon={ArrowLeft}>Back</GhostButton>} />;

  const selectedYear = data.db.academicYears.find((y) => y.id === selectedYearId) || defaultYear;
  const selectedEnrollment = enrollments.find((e) => e.academicYearId === (selectedYear ? selectedYear.id : null));
  const isViewingCurrentYear = !!selectedYear && !!selectedYear.isCurrent;
  const displayGrade = selectedEnrollment ? selectedEnrollment.grade : s.grade;
  const displaySection = selectedEnrollment ? selectedEnrollment.section : s.section;
  const displayStatus = selectedEnrollment ? selectedEnrollment.status : s.status;
  const displaySuspension = selectedEnrollment ? selectedEnrollment.suspension : s.suspension;
  const displayClassId = selectedEnrollment ? selectedEnrollment.classId : s.classId;

  const attendance = data.db.attendance.filter((a) => a.studentId === s.id && (!selectedYear || (a.date >= selectedYear.yearStart && a.date <= selectedYear.yearEnd)));
  const homework = data.db.homework.filter((h) => h.classId === displayClassId && (!selectedYear || !h.academicYearId || h.academicYearId === selectedYear.id));
  const results = data.db.results.filter((r) => r.studentId === s.id && (!selectedYear || !r.academicYearId || r.academicYearId === selectedYear.id));
  const resultsWithTotals = results
    .map((r) => ({ ...r, totals: resultTotals(r) }))
    .filter((r) => r.totals.count > 0)
    .sort((a, b) => a.semester.localeCompare(b.semester) || a.subject.localeCompare(b.subject));
  const behavior = data.db.behaviorRecords.filter((b) => b.studentId === s.id && (!selectedYear || (b.date >= selectedYear.yearStart && b.date <= selectedYear.yearEnd)));
  const documents = data.db.studentDocuments.filter((doc) => doc.studentId === s.id && (!selectedYear || !doc.academicYearId || doc.academicYearId === selectedYear.id));
  const parents = data.db.users.filter((u) => s.parentIds.includes(u.id));

  const attendancePct = data.studentAttendanceRate(s.id, selectedYear ? selectedYear.id : undefined);
  const avgPct = data.studentResultsAverage(s.id, selectedYear ? selectedYear.id : undefined);
  const hwStats = data.studentHomeworkStats(s.id, selectedYear ? selectedYear.id : undefined);

  // Class Rank is staff-only: a subject-scoped teacher must not be able to infer a student's
  // standing across every other teacher's subject (canViewResult never grants that).
  const rankSemester = SEMESTERS[0];
  const classRank = !isTeacher && displayClassId ? data.classSemesterResults(displayClassId, rankSemester, selectedYear ? selectedYear.id : undefined) : null;
  const classRankRow = classRank ? classRank.rows.find((r) => r.studentId === s.id) : null;

  const paymentSummary = data.studentPaymentSummary(s, selectedYear?.id);
  const paymentHistory = data.paymentsForStudents([s.id]).sort((a, b) => b.createdAt - a.createdAt);
  const installmentStatus = data.installmentStatusForStudent(s, selectedYear?.id);
  const busSchedule = data.busScheduleForStudent(s, selectedYear?.id);
  const busBalance = busSchedule.feeType ? data.balanceFor(s, busSchedule.feeType, selectedYear?.id) : null;
  const priorYearsOwed = selectedYear ? data.priorYearsOutstanding(s, selectedYear.id) : 0;
  const studentReceipt = receiptPaymentId ? receiptForPayment(data, receiptPaymentId, null) : null;

  const tabs = ["overview", "attendance", "homework", "exams", "behavior", "documents", ...(canPayments ? ["payments"] : [])];

  function confirmDelete() {
    const res = data.deleteStudent(s.id);
    setDeleteConfirmOpen(false);
    if (res.ok) { toast("Student deleted.", "success"); onBack(); }
    else toast(res.message, "error");
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to Students</button>

      <Card className="p-5 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={data.studentFullName(s)} photo={s.photo} size={64} />
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{data.studentFullName(s)}</h1>
              {!isTeacher && (
                <>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-slate-500 font-mono bg-slate-100 rounded px-1.5 py-0.5">{s.studentId}</span>
                    <CopyIdChip id={s.studentId} label="Copy" />
                  </div>
                  <p className="text-[10px] text-slate-300 mt-0.5">Share this ID with the parent to connect their account.</p>
                </>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge tone="sky">{displayGrade}{displaySection}</Badge>
                <Badge tone={statusTone(displayStatus)}>{displayStatus}</Badge>
                <span className="text-xs text-slate-400">{formatAcademicYearLabel(selectedYear)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPhoto && <GhostButton icon={Camera} onClick={() => setPhotoOpen(true)}>Change Photo</GhostButton>}
            {canEdit && <GhostButton icon={Edit2} onClick={() => setEditOpen(true)}>Edit</GhostButton>}
            {canBehavior && <GhostButton icon={AlertTriangle} onClick={() => setBehaviorOpen(true)}>Add Behavior</GhostButton>}
            {canPayments && <GhostButton icon={Wallet} onClick={() => setRecordPaymentOpen(true)}>Record Payment</GhostButton>}
            {canSuspend && isViewingCurrentYear && (s.status !== "SUSPENDED" ? (
              <GhostButton icon={ShieldAlert} danger onClick={() => setSuspendOpen(true)}>Suspend</GhostButton>
            ) : (
              <GhostButton icon={Check} onClick={() => data.archiveStudent(s.id, "ACTIVE")}>Reinstate</GhostButton>
            ))}
            {canYears && isViewingCurrentYear && data.db.academicYears.length > 1 && (
              <GhostButton icon={ArrowRightLeft} onClick={() => setPromoteOpen(true)}>Promote / Re-enroll</GhostButton>
            )}
            {canDelete && <GhostButton icon={Trash2} danger onClick={() => setDeleteConfirmOpen(true)}>Delete</GhostButton>}
          </div>
        </div>

        {enrollments.length > 1 && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
            <label className="text-xs text-slate-400 shrink-0">Academic Year</label>
            <select className={inputCls + " sm:w-80"} value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}>
              {enrollments.map((en) => {
                const y = data.db.academicYears.find((yy) => yy.id === en.academicYearId);
                return <option key={en.id} value={en.academicYearId}>{formatAcademicYearLabel(y)} — {en.grade}{en.section}</option>;
              })}
            </select>
            {!isViewingCurrentYear && <span className="text-xs text-amber-600">Viewing a past year — historical, read-only</span>}
          </div>
        )}
      </Card>

      {isTeacher && studentStatusNotice(s) && (() => {
        const notice = studentStatusNotice(s);
        const suspended = s.status === "SUSPENDED";
        return (
          <Card className={`p-4 mb-4 border ${suspended ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            <div className={`flex items-center gap-2 font-semibold text-sm mb-1 ${suspended ? "text-red-700" : "text-amber-800"}`}>
              <ShieldAlert size={16} /> {notice.title}
            </div>
            <p className={`text-sm ${suspended ? "text-red-600" : "text-amber-700"}`}>{notice.message}</p>
            {notice.dateRange && (
              <p className="text-xs text-red-500 mt-1">{fmtDate(notice.dateRange.start)} – {fmtDate(notice.dateRange.end)}</p>
            )}
          </Card>
        );
      })()}

      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t ? "border-sky-600 text-sky-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}>{TAB_LABELS[t] || t}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard label="Attendance" value={attendancePct !== null ? `${attendancePct}%` : "—"} icon={ClipboardCheck} tone="emerald" />
          <StatCard label="Average Grade" value={avgPct !== null ? `${avgPct}%` : "—"} icon={FileBarChart} tone="sky" />
          <StatCard label="Homework" value={hwStats.assigned} sub={`${hwStats.completed} completed • ${hwStats.pending} pending`} icon={ClipboardList} tone="indigo" />
          <StatCard label="Behavior Records" value={behavior.length} icon={AlertTriangle} tone="amber" />
          {classRank && <StatCard label={`Class Rank (${SEMESTER_LABEL[rankSemester]})`} value={classRankRow?.rank ? classRankRow.rankLabel : "—"} sub={`of ${classRank.studentsAllComplete} ranked`} icon={Trophy} tone="amber" />}
        </div>
      )}

      {tab === "overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Class — {formatAcademicYearLabel(selectedYear)}</h3>
            <p className="text-sm text-slate-600">{displayGrade}{displaySection || ""}</p>
            <p className="text-xs text-slate-400 mt-1">Enrolled {fmtDate(selectedEnrollment?.enrollmentDate || s.admissionDate)}</p>
            {displaySuspension && (
              <div className="mt-3 bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-700">
                <p className="font-semibold uppercase tracking-wide">Suspended</p>
                <p className="text-red-600 mt-1">{fmtDate(displaySuspension.startDate)} – {fmtDate(displaySuspension.endDate)}</p>
                <p className="font-medium mt-1.5">{displaySuspension.reason}</p>
                {displaySuspension.notes && <p className="text-red-500 mt-1">{displaySuspension.notes}</p>}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Parent / Guardian</h3>
              {canEdit && <button type="button" onClick={() => setEditOpen(true)} className="text-xs text-sky-600 font-medium">Edit relationship</button>}
            </div>
            {parents.length === 0 ? (
              s.emergencyContactName || s.emergencyContact ? (
                <div>
                  <p className="text-sm text-slate-700">{s.emergencyContactName || "No parent account connected yet."}</p>
                  <p className="text-xs text-slate-400">{s.emergencyContact || "No phone on file"}{s.emergencyContactRelationship ? ` • ${s.emergencyContactRelationship}` : ""}</p>
                </div>
              ) : <p className="text-xs text-slate-400">No parent account connected yet.</p>
            ) : parents.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 mb-2">
                <Avatar name={p.name} photo={p.photo} size={30} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">{p.name}</p>
                  <p className="text-xs text-slate-400">{s.emergencyContactName && s.emergencyContactName !== p.name ? `${s.emergencyContactName} — ` : ""}{s.emergencyContact || p.phone || "No phone on file"}{s.emergencyContactRelationship ? ` • ${s.emergencyContactRelationship}` : ""}</p>
                </div>
                {onMessage && <button type="button" onClick={() => onMessage(p.id)} className="text-xs text-sky-600 font-medium flex items-center gap-1 border border-sky-100 rounded-lg px-2 py-1 hover:bg-sky-50 shrink-0"><MessageSquare size={12} /> Message</button>}
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === "attendance" && (
        <div>
          <MonthNav monthKey={attMonth} onChange={setAttMonth} maxMonthKey={todayKeyStr().slice(0, 7)} />
          {overlapsMonth(displaySuspension, attMonth) && (
            <div className="mb-3 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5 text-xs text-red-700">
              Suspended {fmtDate(displaySuspension.startDate)} – {fmtDate(displaySuspension.endDate)}: {displaySuspension.reason}. These days aren't counted as ordinary absences.
            </div>
          )}
          {(() => {
            const monthRecords = attendance.filter((a) => monthKeyOf(a.date) === attMonth);
            const counts = {};
            ATTENDANCE_STATUSES.forEach((st) => { counts[st] = monthRecords.filter((a) => a.status === st).length; });
            return (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                  {ATTENDANCE_STATUSES.map((st) => (
                    <div key={st} className="bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 text-center">
                      <p className="text-lg font-semibold text-slate-700">{counts[st]}</p>
                      <p className="text-[10px] text-slate-400">{st}</p>
                    </div>
                  ))}
                </div>
                {monthRecords.length === 0 ? <EmptyState title="No attendance records" description="No attendance was recorded for this student this month." /> : (
                  <Card className="divide-y divide-slate-100">
                    {[...monthRecords].sort((a, b) => b.date.localeCompare(a.date)).map((a) => (
                      <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-slate-600">{fmtDate(a.date)}</span>
                        <div className="flex items-center gap-3">
                          {a.note && <span className="text-xs text-slate-400">{a.note}</span>}
                          <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
              </>
            );
          })()}
        </div>
      )}

      {tab === "homework" && (
        <div>
          <MonthNav monthKey={hwMonth} onChange={setHwMonth} />
          {(() => {
            const monthHw = [...homework].filter((h) => monthKeyOf(h.dueDate) === hwMonth).sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || ""));
            if (monthHw.length === 0) return <EmptyState title="No homework this month" description="Homework assigned to this student's class will appear here." />;
            const todayKey = todayKeyStr();
            return (
              <Card className="divide-y divide-slate-100">
                {monthHw.map((h) => (
                  <div key={h.id} className="px-4 py-3">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400 mb-0.5">{fmtDate(h.dueDate)}</p>
                        <p className="text-sm font-medium text-slate-700">{h.subject} — {h.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">Due {fmtDate(h.dueDate)}</p>
                      </div>
                      <Badge tone={h.dueDate >= todayKey ? "amber" : "slate"}>{h.dueDate >= todayKey ? "Pending" : "Past Due"}</Badge>
                    </div>
                  </div>
                ))}
              </Card>
            );
          })()}
        </div>
      )}

      {tab === "exams" && (
        resultsWithTotals.length === 0 ? <EmptyState title="No results yet" description="Midterm, Student Book, and Final marks will appear here once entered by the assigned teacher." /> : (
          <Card className="divide-y divide-slate-100">
            {resultsWithTotals.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-700">{r.subject} <span className="text-slate-400 font-normal">• {SEMESTER_LABEL[r.semester]}</span></p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-700">{r.totals.total}%</p>
                    <Badge tone={r.publishStatus === "LOCKED" ? "red" : r.publishStatus === "PUBLISHED" ? "green" : "slate"}>{r.publishStatus}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                  {ASSESSMENT_COMPONENTS.map((c) => {
                    const comp = r.components?.[c];
                    const pages = data.resultEvidenceFor(r.id, c);
                    return (
                      <span key={c} className="inline-flex items-center gap-1">
                        {ASSESSMENT_COMPONENT_LABEL[c]}: {comp?.score != null ? `${comp.score}/${ASSESSMENT_COMPONENT_WEIGHT[c]}` : "—"}
                        {pages.length > 0 && (
                          <button type="button" onClick={() => setDocViewer({ title: `${r.subject} — ${ASSESSMENT_COMPONENT_LABEL[c]}`, files: pages })} className="text-sky-600 hover:text-sky-700"><FileText size={12} /></button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        )
      )}

      {tab === "behavior" && (
        behavior.length === 0 ? <EmptyState title="No behavior records" description="Positive notes and incidents will appear here." action={canBehavior ? <PrimaryButton icon={Plus} onClick={() => setBehaviorOpen(true)}>Add Behavior Record</PrimaryButton> : undefined} /> : (
          <Card className="divide-y divide-slate-100">
            {[...behavior].sort((a, b) => b.createdAt - a.createdAt).map((b) => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={b.type === "Positive" ? "green" : b.severity === "High" ? "red" : "amber"}>{b.type}</Badge>
                    <span className="text-xs text-slate-400">{b.severity}</span>
                  </div>
                  <span className="text-xs text-slate-400">{fmtDate(b.date)}</span>
                </div>
                <p className="text-sm text-slate-600">{b.description}</p>
                <p className="text-xs text-slate-400 mt-1">Action: {b.action || "—"} • Recorded by {b.staff}</p>
                <p className={b.parentNotified ? "text-xs mt-1 text-emerald-600" : "text-xs mt-1 text-slate-300"}>{b.parentNotified ? "Parent notified ✓" : "Parent not notified"}</p>
              </div>
            ))}
          </Card>
        )
      )}

      {tab === "documents" && (
        <div>
          {canEdit && (
            <div className="flex justify-end mb-3">
              <GhostButton icon={Plus} onClick={() => setUploadDocOpen(true)}>Upload Document</GhostButton>
            </div>
          )}
          {documents.length === 0 ? (
            <EmptyState icon={FileText} title="No documents uploaded" description="Report cards, ID copies, and other files will appear here." />
          ) : (
            <div className="space-y-4">
              {DOCUMENT_CATEGORIES.map((cat) => {
                const items = documents.filter((doc) => doc.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{cat}</p>
                    <Card className="divide-y divide-slate-100">
                      {items.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between px-4 py-3 text-sm">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText size={16} className="text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-slate-700 font-medium truncate">{doc.title}</p>
                              <p className="text-xs text-slate-400">{fmtDate(new Date(doc.uploadedAt).toISOString().slice(0, 10))}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <GhostButton icon={Eye} onClick={() => setDocViewer({ title: doc.title, fileDataUrl: doc.fileDataUrl, fileType: doc.fileType, fileName: doc.fileName })}>View</GhostButton>
                            {canEdit && <button type="button" onClick={() => data.deleteStudentDocument(doc.id)} className="text-slate-300 hover:text-red-600"><Trash2 size={15} /></button>}
                          </div>
                        </div>
                      ))}
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "payments" && canPayments && (
        paymentSummary.balances.length === 0 ? <EmptyState icon={Wallet} title="No fees apply to this student" description="Set up fee types in Payments → Fee Settings." /> : (
          <div className="space-y-4">
            {/* Locked Principle #7: a prior-year balance is never silently merged into the current
                year's figures below — it gets its own, clearly separate card. */}
            {priorYearsOwed > 0 && (
              <Card className="p-4 border border-red-200 bg-red-50">
                <p className="text-sm font-medium text-red-800">Prior-Year Balance (not included below): {formatMoney(priorYearsOwed)}</p>
              </Card>
            )}
            {installmentStatus.feeType && (
              <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">School Fee Schedule</h3>
                <FeeScheduleList rows={installmentStatus.rows.map((r) => ({ label: `${installmentStatus.feeType.name} ${r.installment.label}`, dueLabel: `Due ${fmtDateLong(r.installment.dueDate)}`, amountDue: r.amountDue, paid: r.paid, remaining: r.remaining, status: r.status, current: r.isCurrent }))} />
              </Card>
            )}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">Bus</h3>
                {!s.usesBus && <Badge tone="slate">No Bus</Badge>}
                {s.usesBus && busBalance && <Badge tone="sky">{formatMoney(busSchedule.feeType.unitAmount)}/month</Badge>}
              </div>
              {s.usesBus ? <FeeScheduleList rows={busSchedule.rows.map((r) => ({ label: r.label, amountDue: r.amountDue, paid: r.paid, remaining: r.remaining, status: r.status, current: r.isCurrent }))} /> : <p className="text-xs text-slate-400">This student does not use the school bus.</p>}
            </Card>
            <div className="grid sm:grid-cols-2 gap-3">
              {paymentSummary.balances.map((b) => {
                const coverage = feeCoverage(b.paid, b.feeType, activeYearStartDate(data.db.academicYears));
                const due = data.dueStatusForFeeType(s, b.feeType, selectedYear?.id);
                return (
                  <Card key={b.feeType.id} className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-slate-700">{b.feeType.name}</p>
                      {paymentStatusBadge(due.status)}
                    </div>
                    <p className="text-xs text-slate-400">Paid {b.paid} of {b.feeType.unitsPerYear} cycles</p>
                    {coverage.coveredThrough ? (
                      <p className="text-xs text-emerald-700 mt-1">Paid through {fmtDateLong(coverage.coveredThrough)}</p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1">No payment made yet this year</p>
                    )}
                    {coverage.remainingMonths > 0 && coverage.remainingTo && (
                      <p className="text-xs text-amber-700">{Math.round(coverage.remainingMonths * 10) / 10} months remaining ({fmtDateLong(coverage.remainingFrom)} – {fmtDateLong(coverage.remainingTo)})</p>
                    )}
                    {b.amountOwed > 0 && <p className="text-sm font-semibold text-slate-700 mt-1">{formatMoney(b.amountOwed)} remaining</p>}
                  </Card>
                );
              })}
            </div>
            {paymentHistory.length === 0 ? <EmptyState title="No payments recorded yet" description="Record this student's first payment above." /> : (
              <Card className="divide-y divide-slate-100">
                {paymentHistory.map((p) => {
                  const voided = p.status === "VOIDED";
                  return (
                    <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className={`font-medium ${voided ? "text-slate-400 line-through" : "text-slate-700"}`}>{data.describePayment(p)}</p>
                        <p className="text-xs text-slate-400">{data.paymentMethodName(p)} • {fmtDate(p.date)}{p.receiptNo ? ` • Receipt #${p.receiptNo}` : ""}</p>
                        {voided && (
                          <p className="text-xs text-red-600 mt-0.5">
                            Voided {fmtDate(new Date(p.voidedAt).toISOString().slice(0, 10))} by {data.getUser(p.voidedBy)?.name || "Unknown"} — {p.voidReason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <p className={`font-semibold ${voided ? "text-slate-400 line-through" : "text-slate-700"}`}>{formatMoney(p.amountTotal)}</p>
                        {voided ? <Badge tone="red">Voided</Badge> : canVoid && <GhostButton icon={Ban} danger onClick={() => setVoidTarget(p)}>Void</GhostButton>}
                        <GhostButton icon={ReceiptIcon} onClick={() => setReceiptPaymentId(p.id)}>View Receipt</GhostButton>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )
      )}

      <EditStudentModal open={editOpen} onClose={() => setEditOpen(false)} student={s} />
      <ChangePhotoModal open={photoOpen} onClose={() => setPhotoOpen(false)} student={s} />
      <BehaviorModal open={behaviorOpen} onClose={() => setBehaviorOpen(false)} studentId={s.id} />
      <SuspendModal open={suspendOpen} onClose={() => setSuspendOpen(false)} studentId={s.id} />
      <PromoteStudentModal open={promoteOpen} onClose={() => setPromoteOpen(false)} student={s} />
      <UploadDocumentModal open={uploadDocOpen} onClose={() => setUploadDocOpen(false)} studentId={s.id} />
      {canPayments && <RecordPaymentModal open={recordPaymentOpen} onClose={() => setRecordPaymentOpen(false)} student={s} />}
      {canVoid && <VoidPaymentModal open={!!voidTarget} onClose={() => setVoidTarget(null)} payment={voidTarget} />}
      <DocumentViewerModal open={!!docViewer} onClose={() => setDocViewer(null)} title={docViewer?.title} fileDataUrl={docViewer?.fileDataUrl} fileType={docViewer?.fileType} fileName={docViewer?.fileName} files={docViewer?.files} initialIndex={docViewer?.initialIndex} />
      <ConfirmDialog
        open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} danger confirmLabel="Delete Permanently"
        title="Delete Student Permanently?"
        description="This will permanently delete this student's information and associated records — enrollment history, attendance, homework, behavior, results, documents, and payments. This action cannot be undone."
        onConfirm={confirmDelete}
      />
      {canPayments && (
        <CashReceiptModal
          open={!!studentReceipt}
          onClose={() => setReceiptPaymentId(null)}
          pages={studentReceipt?.pages || []}
          receiptNo={studentReceipt?.receiptNo || ""}
          date={studentReceipt ? fmtDate(studentReceipt.date) : ""}
          method={studentReceipt?.method || ""}
          cashierName={studentReceipt?.cashierName || ""}
          voidedLines={studentReceipt?.voidedLines || []}
          allVoided={studentReceipt?.allVoided || false}
          copyType="paid"
        />
      )}
    </div>
  );
}

function EditStudentModal({ open, onClose, student }) {
  const data = useData();
  const toast = useToast();
  const [form, setForm] = useState(student);
  const [photoOpen, setPhotoOpen] = useState(false);
  useEffect(() => { setForm(student); }, [student]);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    data.updateStudent(student.id, form);
    toast("Student profile updated.", "success");
    onClose();
  }
  if (!form) return null;
  const enrollment = data.enrollmentsForStudent(student.id).find((en) => en.academicYearId === (currentAcademicYear(data.db.academicYears) || {}).id);
  const year = enrollment ? data.db.academicYears.find((y) => y.id === enrollment.academicYearId) : currentAcademicYear(data.db.academicYears);
  return (
    <>
      <Modal open={open} onClose={onClose} title="Edit Student" wide>
        <div>
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3 text-xs">
            <span className="text-slate-500 font-mono">{student.studentId}</span>
            <span className="text-slate-500">{formatAcademicYearLabel(year)}</span>
          </div>
          <StudentFormFields form={form} set={set} fieldCls={() => inputCls} errors={{}} mode="edit" gradeOptions={data.gradeOptions()} onPickPhoto={() => setPhotoOpen(true)} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <PrimaryButton type="button" onClick={submit} icon={Check}>Save Changes</PrimaryButton>
          </div>
        </div>
      </Modal>
      <ChangePhotoModal open={photoOpen} onClose={() => setPhotoOpen(false)} student={student} />
    </>
  );
}

function BehaviorModal({ open, onClose, studentId }) {
  const data = useData();
  const toast = useToast();
  const auth = useAuth();
  const empty = { type: "Positive", severity: "Low", description: "", action: "", staff: auth.currentUser?.name || "School Administrator", parentNotified: true, date: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(empty);
  useEffect(() => { if (open) setForm(empty); }, [open]);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!form.description.trim()) { toast("Please describe what happened.", "error"); return; }
    // form.date is already an ISO "YYYY-MM-DD" string from the <input type="date">. Storing it
    // as-is (not fmtDate()'d) matches every other date field in the DB — fmtDate is a display-only
    // formatter; wrapping it here used to persist a "24 Aug 2026"-style string into
    // behaviorRecords, which broke every ISO string-range date comparison against it (e.g. the
    // student profile's "Behavior Records" stat, which filters by selectedYear.yearStart/yearEnd).
    data.createBehaviorRecord({ studentId, ...form });
    toast("Behavior record added.", "success");
    setForm(empty); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="Add Behavior Record">
      <div>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Type"><select className={inputCls} value={form.type} onChange={(e) => set("type", e.target.value)}>{BEHAVIOR_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Severity"><select className={inputCls} value={form.severity} onChange={(e) => set("severity", e.target.value)}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Description" required><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Action taken"><input className={inputCls} value={form.action} onChange={(e) => set("action", e.target.value)} /></Field>
        <Field label="Staff member"><input className={inputCls} value={form.staff} onChange={(e) => set("staff", e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
          <input type="checkbox" checked={form.parentNotified} onChange={(e) => set("parentNotified", e.target.checked)} className="rounded border-slate-300 text-sky-600" /> Notify parent
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>Save Record</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function SuspendModal({ open, onClose, studentId }) {
  const data = useData();
  const toast = useToast();
  const [form, setForm] = useState({ reason: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", notes: "" });
  const [confirming, setConfirming] = useState(false);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  return (
    <>
      <Modal open={open && !confirming} onClose={onClose} title="Suspend Student">
        <div>
          <Field label="Reason" required><textarea className={inputCls} rows={2} value={form.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Start date"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
            <Field label="End date"><input type="date" className={inputCls} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          </div>
          <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="button" onClick={() => { if (!form.reason.trim()) { toast("Please provide a reason for suspension.", "error"); return; } setConfirming(true); }} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700">Continue</button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} danger confirmLabel="Suspend Student"
        title="Confirm suspension" description="This will change the student's status to Suspended and notify the parent. Their academic history will be preserved."
        onConfirm={() => { data.suspendStudent(studentId, form); toast("Student suspended.", "success"); onClose(); setConfirming(false); }} />
    </>
  );
}

function ParentsPage({ onOpen, onMessage }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const [q, setQ] = useState("");
  const [recordFor, setRecordFor] = useState(null);
  const canPayments = canViewStudentPayments(auth.currentUser);
  const parents = db.users.filter((u) => u.role === ROLES.PARENT);
  const filtered = parents.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.phone || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Parents</h1>
      <p className="text-sm text-slate-400 mb-4">{parents.length} parent accounts connected.</p>
      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search parent name or phone…" /></Toolbar>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => {
          const children = db.students.filter((s) => (p.childIds || []).includes(s.id));
          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={p.name} photo={p.photo} size={40} />
                <div className="min-w-0"><p className="text-sm font-semibold text-slate-700 truncate">{p.name}</p><p className="text-xs text-slate-400 truncate">{p.phone || "No phone on file"}</p></div>
              </div>
              <div className="mt-2 space-y-1.5">
                {children.length === 0 ? <p className="text-xs text-slate-300">No children connected</p> : children.map((c) => {
                  const summary = canPayments ? data.studentPaymentSummary(c) : null;
                  return (
                    <div key={c.id} className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <button onClick={() => onOpen(c.id)} className="w-full flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-600 font-medium">{data.studentFullName(c)}</span>
                        <span className="text-slate-400">{c.grade}{c.section}</span>
                      </button>
                      {canPayments && (
                        <div className="flex items-center justify-between">
                          {paymentStatusBadge(summary.status)}
                          {summary.status !== "PAID" ? (
                            <button onClick={() => setRecordFor(c)} className="text-[11px] text-sky-600 font-medium">Record Payment</button>
                          ) : (
                            <span className="text-[11px] text-slate-300">Up to date</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button onClick={() => onMessage(p.id)} className="mt-3 w-full text-xs text-sky-600 font-medium flex items-center justify-center gap-1 border border-sky-100 rounded-lg py-1.5 hover:bg-sky-50"><MessageSquare size={13} /> Message</button>
            </Card>
          );
        })}
      </div>
      {canPayments && <RecordPaymentModal open={!!recordFor} onClose={() => setRecordFor(null)} student={recordFor} />}
    </div>
  );
}

function TeachersPage({ onMessage }) {
  const data = useData();
  const toast = useToast();
  const { db } = data;
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editTeacher, setEditTeacher] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [endEmploymentTarget, setEndEmploymentTarget] = useState(null); // staff record
  const teachers = db.users.filter((u) => u.role === ROLES.TEACHER);
  const filtered = teachers.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  function confirmDelete() {
    if (!deleteTarget) return;
    const res = data.deleteTeacher(deleteTarget.id);
    toast(res.ok ? `${deleteTarget.name} was deleted.` : res.message, res.ok ? "success" : "error");
    setDeleteTarget(null);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Teachers</h1>
      <p className="text-sm text-slate-400 mb-4">{teachers.length} teachers on staff.</p>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search teacher name…" />
        <PrimaryButton onClick={() => setAddOpen(true)}>Add Teacher</PrimaryButton>
      </Toolbar>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((t) => {
          const classes = db.classes.filter((c) => c.subjectTeacherIds.includes(t.id) || c.headTeacherId === t.id);
          const subjects = data.teacherSubjects(t.id);
          const staffRec = db.staff.find((s) => s.userId === t.id);
          const employmentEnded = staffRec?.employmentStatus === "ENDED";
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Avatar name={t.name} photo={t.photo} size={40} />
                  <div><p className="text-sm font-semibold text-slate-700">{t.name}</p><p className="text-xs text-slate-400">{t.email}</p></div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
                  <Badge tone={t.status === "ACTIVE" ? "green" : "slate"}>{t.status || "ACTIVE"}</Badge>
                  {employmentEnded && <p className="mt-1"><Badge tone="red">Employment Ended</Badge></p>}
                </div>
              </div>
              <div className="mb-2">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Subjects</p>
                <div className="flex flex-wrap gap-1">
                  {subjects.length === 0 ? <span className="text-xs text-slate-300">No subjects assigned yet</span> : subjects.map((s) => <Badge key={s} tone="indigo">{s}</Badge>)}
                </div>
              </div>
              <div className="mb-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Classes</p>
                <div className="flex flex-wrap gap-1">
                  {classes.length === 0 ? <span className="text-xs text-slate-300">No classes assigned yet</span> : classes.map((c) => <Badge key={c.id} tone="sky">{c.grade}{c.section}</Badge>)}
                </div>
              </div>
              <div className="flex gap-2 mb-2">
                <button onClick={() => setEditTeacher(t)} className="flex-1 text-xs text-slate-500 font-medium flex items-center justify-center gap-1 border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50"><Edit2 size={13} /> Edit</button>
                <button onClick={() => onMessage(t.id)} className="flex-1 text-xs text-sky-600 font-medium flex items-center justify-center gap-1 border border-sky-100 rounded-lg py-1.5 hover:bg-sky-50"><MessageSquare size={13} /> Message</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { data.setAccountStatus(t.id, t.status === "ACTIVE" ? "DISABLED" : "ACTIVE"); toast(`${t.name}'s account access is now ${t.status === "ACTIVE" ? "disabled" : "active"}.`, "info"); }} className="flex-1 text-xs text-slate-500 font-medium border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50">{t.status === "ACTIVE" ? "Disable" : "Enable"}</button>
                <button onClick={() => setDeleteTarget(t)} className="flex-1 text-xs text-red-500 font-medium flex items-center justify-center gap-1 border border-red-100 rounded-lg py-1.5 hover:bg-red-50"><Trash2 size={13} /> Delete</button>
              </div>
              {staffRec && (
                <div className="flex gap-2 mt-2">
                  {employmentEnded ? (
                    <button onClick={() => { data.reactivateEmployment(staffRec.id); toast(`${t.name}'s employment was reactivated.`, "success"); }} className="flex-1 text-xs text-emerald-600 font-medium border border-emerald-200 rounded-lg py-1.5 hover:bg-emerald-50">Reactivate Employment</button>
                  ) : (
                    <button onClick={() => setEndEmploymentTarget(staffRec)} className="flex-1 text-xs text-red-500 font-medium border border-red-100 rounded-lg py-1.5 hover:bg-red-50">End Employment</button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <TeacherFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      <TeacherFormModal open={!!editTeacher} onClose={() => setEditTeacher(null)} teacher={editTeacher} />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} danger confirmLabel="Delete Teacher Permanently"
        title="Delete this teacher permanently?"
        description={deleteTarget ? `This permanently removes ${deleteTarget.name}'s login, staff/payroll record, and class/subject assignments. Homework, results, and behavior records they already entered stay on students' history. This can't be undone.` : ""}
        onConfirm={confirmDelete} />
      <EndEmploymentModal staff={endEmploymentTarget} onClose={() => setEndEmploymentTarget(null)} />
    </div>
  );
}

// Ending employment (Blocker 3) is deliberately separate from Delete above — it stops future
// payroll/assignment eligibility and disables login, but keeps every historical record intact.
// Shared shape with OwnerPages.jsx's own EndEmploymentModal (Staff/StaffProfile) — not extracted
// into a common component since each host page's surrounding permission/data wiring differs.
function EndEmploymentModal({ staff, onClose }) {
  const data = useData();
  const toast = useToast();
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { if (staff) setEndDate(new Date().toISOString().slice(0, 10)); }, [staff]);

  if (!staff) return null;

  function submit() {
    if (!endDate) { toast("Please choose the last employed day.", "error"); return; }
    data.endEmployment(staff.id, endDate);
    toast(`${staff.name}'s employment ended effective ${fmtDate(endDate)}.`, "success");
    onClose();
  }

  return (
    <Modal open={!!staff} onClose={onClose} title={`End Employment — ${staff.name}`}>
      <p className="text-xs text-slate-400 mb-3">This stops future payroll and removes {staff.name} from new class/subject assignments. Their attendance, payroll, and assignment history stay on record — this is not a delete. Their login is disabled as part of this.</p>
      <Field label="Last employed day" required><input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton onClick={submit} icon={Check}>End Employment</PrimaryButton>
      </div>
    </Modal>
  );
}

// Key for tracking a single Class+Subject cell in the assignment breakdown / reassignment set.
function pairKey(classId, subject) { return `${classId}|${subject}`; }

function TeacherFormModal({ open, onClose, teacher }) {
  const data = useData();
  const toast = useToast();
  const isEdit = !!teacher;
  const empty = { firstName: "", middleName: "", lastName: "", email: "", phone: "", classIds: [], subjects: [], password: "", photo: null, bankAccount: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [reassignments, setReassignments] = useState(new Set()); // Set of "classId|subject" the director chose to move onto this teacher
  const [showPw, setShowPw] = useState(false);
  const [createdCreds, setCreatedCreds] = useState(null); // one-time reveal after creating a teacher
  const [resetReveal, setResetReveal] = useState(null); // one-time reveal after resetting a password
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCreatedCreds(null);
    setResetReveal(null);
    setShowPw(false);
    setErrors({});
    setReassignments(new Set());
    if (teacher) {
      const classIds = data.teacherClassIds(teacher.id);
      const subjects = data.teacherSubjects(teacher.id);
      const staffRec = data.db.staff.find((s) => s.userId === teacher.id);
      setForm({ firstName: teacher.firstName || "", middleName: teacher.middleName || "", lastName: teacher.lastName || "", email: teacher.email, phone: teacher.phone || "", classIds, subjects, password: "", photo: teacher.photo || null, bankAccount: staffRec?.bankAccount || "" });
    } else {
      setForm({ ...empty, password: generatePassword() });
    }
  }, [teacher, open]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }
  function uploadPhoto(file) {
    const reader = new FileReader();
    reader.onload = () => set("photo", reader.result);
    reader.readAsDataURL(file);
  }
  function fieldCls(k) {
    return errors[k]
      ? inputCls.replace("border-slate-200", "border-red-400").replace("focus:ring-sky-500/40", "focus:ring-red-400/40").replace("focus:border-sky-400", "focus:border-red-400")
      : inputCls;
  }
  function toggleClass(id) {
    setForm((f) => ({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id] }));
    setErrors((e) => (e.classIds ? { ...e, classIds: undefined } : e));
  }

  // For every subject, the per-selected-class availability: whether it's not part of that
  // class's curriculum at all, free, already this teacher's own assignment (edit mode), or
  // locked to someone else — so the picker can show exactly which class+subject combinations
  // are possible instead of a single all-or-nothing toggle.
  const availability = useMemo(() => {
    const map = {};
    data.db.subjects.forEach((s) => {
      map[s.name] = form.classIds.map((cid) => {
        const cls = data.getClass(cid);
        const className = cls ? `${cls.grade}${cls.section}` : "";
        const offered = data.requiredSubjectsForClass(cid).includes(s.name);
        if (!offered) return { classId: cid, className, status: "not_offered" };
        const owner = data.subjectAssignmentOwner(cid, s.name);
        if (!owner) return { classId: cid, className, status: "available" };
        if (isEdit && owner.teacherId === teacher.id) return { classId: cid, className, status: "own" };
        return { classId: cid, className, status: "locked", ownerId: owner.teacherId, ownerName: owner.teacherName };
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.classIds, data.db.teacherAssignments, data.db.subjects, data.db.classSubjects, isEdit, teacher]);

  function subjectSelectable(subjectName) {
    if (form.classIds.length === 0) return true;
    const rows = availability[subjectName] || [];
    return rows.some((r) => (r.status !== "locked" && r.status !== "not_offered") || (r.status === "locked" && reassignments.has(pairKey(r.classId, subjectName))));
  }
  function toggleSubject(subjectName) {
    setForm((f) => {
      if (f.subjects.includes(subjectName)) {
        return { ...f, subjects: f.subjects.filter((s) => s !== subjectName) };
      }
      if (!subjectSelectable(subjectName)) return f;
      return { ...f, subjects: [...f.subjects, subjectName] };
    });
    setErrors((e) => (e.subjects ? { ...e, subjects: undefined } : e));
  }
  function toggleReassign(classId, subjectName) {
    setReassignments((prev) => {
      const key = pairKey(classId, subjectName);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setForm((f) => (f.subjects.includes(subjectName) ? f : { ...f, subjects: [...f.subjects, subjectName] }));
  }

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    const nextErrors = {};
    if (!form.firstName.trim()) nextErrors.firstName = "Please enter the teacher's first name.";
    if (!form.middleName.trim()) nextErrors.middleName = "Please enter the teacher's middle name.";
    if (!form.lastName.trim()) nextErrors.lastName = "Please enter the teacher's last name.";
    if (!form.email.trim()) nextErrors.email = "Please enter the teacher's email address.";
    if (!form.phone.trim()) nextErrors.phone = "Please provide the teacher's phone number.";
    if (form.classIds.length === 0) nextErrors.classIds = "Please select at least one class.";
    if (form.subjects.length === 0) nextErrors.subjects = "Please select at least one subject.";
    if (!isEdit && !form.password.trim()) nextErrors.password = "Please set a temporary password, or generate one.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast("Please complete the required fields.", "error");
      return;
    }
    setErrors({});

    const reassignPairs = [...reassignments]
      .map((k) => { const i = k.indexOf("|"); return { classId: k.slice(0, i), subject: k.slice(i + 1) }; })
      .filter((r) => form.subjects.includes(r.subject) && form.classIds.includes(r.classId));

    if (isEdit) {
      data.updateTeacher(teacher.id, {
        firstName: form.firstName.trim(), middleName: form.middleName.trim(), lastName: form.lastName.trim(),
        name: fullName(form.firstName, form.middleName, form.lastName),
        email: form.email.trim(), phone: form.phone.trim(), photo: form.photo,
        bankAccount: form.bankAccount.trim() || null,
      });
      const res = data.updateTeacherAssignments(teacher.id, form.subjects, form.classIds, reassignPairs);
      if (!res.ok) { setErrors({ subjects: res.message }); toast(res.message, "error"); return; }
      toast("Teacher updated.", "success");
      onClose();
    } else {
      const res = data.createTeacher({
        firstName: form.firstName.trim(), middleName: form.middleName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim(), phone: form.phone.trim(), subjects: form.subjects, classIds: form.classIds, password: form.password,
        reassignments: reassignPairs, photo: form.photo, bankAccount: form.bankAccount.trim() || null,
      });
      if (!res.ok) {
        if (res.message.includes("email already exists")) setErrors({ email: res.message });
        else setErrors({ subjects: res.message });
        toast(res.message, "error");
        return;
      }
      toast("Teacher added successfully.", "success");
      setCreatedCreds({
        email: form.email.trim(), password: form.password,
        name: fullName(form.firstName, form.middleName, form.lastName),
        subjects: form.subjects, classIds: form.classIds,
      });
    }
  }
  function doResetPassword() {
    const newPw = generatePassword();
    data.resetTeacherPassword(teacher.id, newPw);
    setResetReveal(newPw);
    toast("Password reset. Share the new password privately with the teacher.", "success");
  }
  function close() { setForm(empty); setErrors({}); setReassignments(new Set()); setCreatedCreds(null); setResetReveal(null); onClose(); }

  if (createdCreds) {
    return (
      <Modal open={open} onClose={close} title="Teacher added">
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
          <p className="font-medium text-slate-700 mb-1">Teacher added successfully.</p>
          <p className="text-xs text-slate-400 mb-4">Share these sign-in details with the teacher privately. The password will not be shown again — the teacher should change it after their first sign-in.</p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 max-w-xs mx-auto text-left space-y-2">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Name</p>
              <span className="text-sm text-slate-700">{createdCreds.name}</span>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Email</p>
              <div className="flex items-center justify-between"><span className="font-mono text-sm text-slate-700">{createdCreds.email}</span><button onClick={async () => { const ok = await copyText(createdCreds.email); toast(ok ? "Email copied." : "Couldn't copy — please copy manually.", ok ? "info" : "error"); }} className="text-sky-600 hover:text-sky-700"><Copy size={14} /></button></div>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Temporary password</p>
              <div className="flex items-center justify-between"><span className="font-mono text-sm font-semibold text-slate-700">{createdCreds.password}</span><button onClick={async () => { const ok = await copyText(createdCreds.password); toast(ok ? "Password copied." : "Couldn't copy — please copy manually.", ok ? "info" : "error"); }} className="text-sky-600 hover:text-sky-700"><Copy size={14} /></button></div>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Subjects</p>
              <div className="flex flex-wrap gap-1 mt-0.5">{createdCreds.subjects.map((s) => <Badge key={s} tone="indigo">{s}</Badge>)}</div>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Classes</p>
              <div className="flex flex-wrap gap-1 mt-0.5">{createdCreds.classIds.map((cid) => { const c = data.getClass(cid); return c ? <Badge key={cid} tone="sky">{c.grade}{c.section}</Badge> : null; })}</div>
            </div>
          </div>
          <button onClick={close} className="mt-5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title={isEdit ? "Edit Teacher" : "Add Teacher"} wide>
      <div>
        <Field label="Photo (optional)">
          <div className="flex items-center gap-3">
            <Avatar name={fullName(form.firstName, form.middleName, form.lastName) || "?"} photo={form.photo} size={44} />
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 border border-sky-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-sky-50">
              <ImagePlus size={13} /> {form.photo ? "Replace photo" : "Add photo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadPhoto(e.target.files[0])} />
            </label>
            {form.photo && <button type="button" onClick={() => set("photo", null)} className="text-xs text-red-500 font-medium">Remove</button>}
          </div>
        </Field>
        <div className="grid sm:grid-cols-3 gap-x-4">
          <Field label="First name" required error={errors.firstName}><input className={fieldCls("firstName")} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Middle name" required error={errors.middleName}><input className={fieldCls("middleName")} value={form.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
          <Field label="Last name" required error={errors.lastName}><input className={fieldCls("lastName")} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Email" required error={errors.email}><input type="email" className={fieldCls("email")} value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone" required error={errors.phone}><input className={fieldCls("phone")} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. +252 61 234 5678" /></Field>
        </div>
        <Field label="Bank account number (optional)"><input className={inputCls} placeholder="Can be added later" value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>

        {!isEdit && (
          <Field label="Temporary password" required error={errors.password}>
            <div className="relative">
              <input type={showPw ? "text" : "password"} className={fieldCls("password") + " pr-16 font-mono"} value={form.password} onChange={(e) => set("password", e.target.value)} />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <button type="button" onClick={() => setShowPw((s) => !s)} className="text-slate-400 hover:text-slate-600" title={showPw ? "Hide" : "Show"}>{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button type="button" onClick={() => set("password", generatePassword())} className="text-slate-400 hover:text-sky-600" title="Generate new password"><RefreshCw size={14} /></button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Share this with the teacher privately — it will only be shown once, right after you create the account.</p>
          </Field>
        )}

        {isEdit && (
          <div className="mb-4 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-600">Password</p>
                <p className="text-[11px] text-slate-400">Private to the teacher — not visible here. Reset it to issue a new temporary password.</p>
              </div>
              <GhostButton icon={RefreshCw} onClick={() => setConfirmReset(true)}>Reset Password</GhostButton>
            </div>
            {resetReveal && (
              <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">New temporary password</p>
                  <span className="font-mono text-sm font-semibold text-slate-700">{resetReveal}</span>
                </div>
                <button onClick={async () => { const ok = await copyText(resetReveal); toast(ok ? "Password copied." : "Couldn't copy — please copy manually.", ok ? "info" : "error"); }} className="text-sky-600 hover:text-sky-700"><Copy size={15} /></button>
              </div>
            )}
            {resetReveal && <p className="text-[11px] text-amber-600 mt-2">Share this privately with the teacher now — it won't be shown again.</p>}
          </div>
        )}

        <div className="mb-4">
          <span className="block text-xs font-medium text-slate-500 mb-1.5">Classes {form.classIds.length === 0 && <span className="text-red-500">*</span>}</span>
          <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-lg p-3 ${errors.classIds ? "border-red-400" : "border-slate-200"}`}>
            {data.db.classes.length === 0 ? <p className="text-xs text-slate-400 col-span-full">No classes yet — add a class first.</p> : data.db.classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} className="rounded border-slate-300 text-sky-600" />
                {c.grade}{c.section}
              </label>
            ))}
          </div>
          {errors.classIds && <span className="block text-xs text-red-500 mt-1">{errors.classIds}</span>}
        </div>

        <div className="mb-1.5">
          <span className="block text-xs font-medium text-slate-500 mb-1.5">Subjects {form.subjects.length === 0 && <span className="text-red-500">*</span>}</span>
          <div className={`max-h-64 overflow-y-auto border rounded-lg p-3 ${errors.subjects ? "border-red-400" : "border-slate-200"}`}>
            {data.db.subjects.length === 0 ? <p className="text-xs text-slate-400">No subjects yet — add a subject first.</p> : data.db.subjects.map((s) => {
              const rows = availability[s.name] || [];
              const selectable = subjectSelectable(s.name);
              const checked = form.subjects.includes(s.name);
              const hasIssue = rows.some((r) => r.status === "locked" || r.status === "not_offered");
              return (
                <div key={s.id} className="py-1.5 border-b border-slate-100 last:border-0">
                  <label className={`flex items-center gap-2 text-sm ${selectable ? "text-slate-700 cursor-pointer" : "text-slate-400 cursor-not-allowed"}`}>
                    <input type="checkbox" disabled={!checked && !selectable} checked={checked} onChange={() => toggleSubject(s.name)} className="rounded border-slate-300 text-sky-600" />
                    {!selectable && <Lock size={12} />}
                    {s.name}
                  </label>
                  {form.classIds.length > 0 && (checked || hasIssue) && (
                    <div className="ml-6 mt-1 space-y-0.5">
                      {rows.map((r) => {
                        const reassigned = reassignments.has(pairKey(r.classId, s.name));
                        return (
                          <div key={r.classId} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className={r.status === "not_offered" || (r.status === "locked" && !reassigned) ? "text-red-500" : "text-emerald-600"}>
                              {r.status === "own" && `✓ ${r.className} — currently assigned to this teacher`}
                              {r.status === "available" && `✓ ${r.className} — available`}
                              {r.status === "not_offered" && `— ${r.className} — not part of this class's subjects`}
                              {r.status === "locked" && !reassigned && `🔒 ${r.className} — assigned to ${r.ownerName}`}
                              {r.status === "locked" && reassigned && `↺ ${r.className} — will move here from ${r.ownerName}`}
                            </span>
                            {r.status === "locked" && (
                              <button type="button" onClick={() => toggleReassign(r.classId, s.name)} className="inline-flex items-center gap-1 text-sky-600 hover:underline shrink-0">
                                <ArrowRightLeft size={11} />{reassigned ? "Undo" : "Reassign"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {errors.subjects && <span className="block text-xs text-red-500 mt-1">{errors.subjects}</span>}
          {!errors.subjects && form.classIds.length === 0 && <p className="text-xs text-slate-400 mt-1.5">Select classes above to see which subjects are already taken.</p>}
        </div>

        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>{isEdit ? "Save Changes" : "Add Teacher"}</PrimaryButton>
        </div>
      </div>
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} confirmLabel="Reset Password"
        title="Reset this teacher's password?" description="This immediately replaces their current password with a new temporary one. They'll need the new password to sign in."
        onConfirm={doResetPassword} />
    </Modal>
  );
}

function ClassesPage() {
  const data = useData();
  const { db } = data;
  const [addOpen, setAddOpen] = useState(false);
  const [editClass, setEditClass] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const toast = useToast();
  const gradeCount = new Set(db.classes.map((c) => c.grade)).size;

  function confirmDelete() {
    if (!deleteTarget) return;
    const res = data.deleteClass(deleteTarget.id);
    toast(res.message || (res.ok ? "Class deleted." : "Couldn't delete this class."), res.ok ? "info" : "error");
    setDeleteTarget(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Classes</h1>
        <PrimaryButton onClick={() => setAddOpen(true)}>Add Class</PrimaryButton>
      </div>
      <p className="text-sm text-slate-400 mb-4">{db.classes.length} classes across {gradeCount} grade{gradeCount !== 1 ? "s" : ""}.</p>
      {db.classes.length === 0 ? <EmptyState icon={School} title="No classes yet" description="Add a class to start enrolling students and assigning teachers." action={<PrimaryButton onClick={() => setAddOpen(true)}>Add Class</PrimaryButton>} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {db.classes.map((c) => {
            const students = db.students.filter((s) => s.classId === c.id);
            const head = data.getUser(c.headTeacherId);
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-700">{c.grade}{c.section}</h3>
                  <Badge tone="sky">{students.length} students</Badge>
                </div>
                {head ? (
                  <p className="text-xs text-slate-400 mb-3">Head Teacher · <span className="text-slate-600 font-medium">{head.name}</span></p>
                ) : (
                  <p className="text-xs text-amber-600 font-medium mb-3 flex items-center gap-1"><AlertTriangle size={12} /> No head teacher assigned</p>
                )}
                <div className="flex flex-wrap gap-1 mb-3">
                  {c.subjectTeacherIds.length === 0 ? <span className="text-xs text-slate-300">No teachers assigned yet</span> : c.subjectTeacherIds.map((tid) => {
                    const t = data.getUser(tid);
                    if (!t) return null;
                    const subjectsHere = db.teacherAssignments.filter((ta) => ta.classId === c.id && ta.teacherId === tid).map((ta) => ta.subject);
                    return <Badge key={tid} tone="slate">{t.name}{subjectsHere.length ? ` — ${subjectsHere.join(", ")}` : ""}</Badge>;
                  })}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditClass(c)} className="flex-1 text-xs text-slate-500 font-medium flex items-center justify-center gap-1 border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50"><Edit2 size={13} /> Edit</button>
                  <button onClick={() => setDeleteTarget(c)} className="flex-1 text-xs text-red-500 font-medium flex items-center justify-center gap-1 border border-red-100 rounded-lg py-1.5 hover:bg-red-50"><Trash2 size={13} /> Delete</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ClassFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ClassFormModal open={!!editClass} onClose={() => setEditClass(null)} cls={editClass} />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} danger confirmLabel="Delete Class"
        title="Delete this class?" description={deleteTarget ? `This removes ${deleteTarget.grade}${deleteTarget.section} entirely. Classes with enrolled students can't be deleted — move or archive those students first.` : ""}
        onConfirm={confirmDelete} />
    </div>
  );
}

function ClassFormModal({ open, onClose, cls }) {
  const data = useData();
  const toast = useToast();
  const isEdit = !!cls;
  const empty = { gradeLabel: "", section: "", headTeacherId: "", subjects: [] };
  const [form, setForm] = useState(empty);
  const [newSubject, setNewSubject] = useState("");
  const [renameTarget, setRenameTarget] = useState(null); // subject being renamed { id, name }
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setNewSubject("");
    setRenameTarget(null);
    if (cls) {
      setForm({ gradeLabel: cls.grade, section: cls.section || "", headTeacherId: cls.headTeacherId || "", subjects: data.requiredSubjectsForClass(cls.id) });
    } else {
      setForm(empty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cls, open]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function toggleSubject(name) {
    setForm((f) => (f.subjects.includes(name) ? { ...f, subjects: f.subjects.filter((s) => s !== name) } : { ...f, subjects: [...f.subjects, name] }));
  }

  function addNewSubject() {
    const trimmed = newSubject.trim();
    if (!trimmed) return;
    if (data.db.subjects.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) { toast("This subject already exists.", "error"); return; }
    data.createSubject(trimmed);
    setForm((f) => (f.subjects.includes(trimmed) ? f : { ...f, subjects: [...f.subjects, trimmed] }));
    setNewSubject("");
  }

  function submitRename() {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { toast("Please enter a subject name.", "error"); return; }
    const res = data.updateSubject(renameTarget.id, trimmed);
    if (!res.ok) { toast(res.message, "error"); return; }
    setForm((f) => ({ ...f, subjects: f.subjects.map((s) => (s === renameTarget.name ? trimmed : s)) }));
    setRenameTarget(null);
  }

  function deleteGlobalSubject(subj) {
    const res = data.deleteSubject(subj.id);
    if (!res.ok) { toast(res.message, "error"); return; }
    setForm((f) => ({ ...f, subjects: f.subjects.filter((s) => s !== subj.name) }));
    toast("Subject deleted.", "info");
  }

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!GRADES.includes(form.gradeLabel)) {
      toast("Please select a grade.", "error");
      return;
    }
    const grade = form.gradeLabel;
    if (isEdit) {
      const res = data.updateClass(cls.id, { grade, section: form.section, headTeacherId: form.headTeacherId, subjects: form.subjects });
      if (!res.ok) { toast(res.message, "error"); return; }
    } else {
      const exists = data.db.classes.some((c) => c.grade === grade && c.section === form.section);
      if (exists) { toast(`${grade}${form.section} already exists.`, "error"); return; }
      data.createClass({ grade, section: form.section, headTeacherId: form.headTeacherId, subjects: form.subjects });
    }
    toast(isEdit ? "Class updated." : "Class created.", "success");
    onClose();
  }

  // New-assignment picker (Blocker 3): a teacher whose employment has ended shouldn't be pickable
  // for a class going forward — but if they're already this class's head teacher, keep them
  // selectable so the admin sees who it is and can explicitly reassign, rather than the value
  // silently vanishing from the list.
  const employedTeachers = data.db.users.filter((u) => {
    if (u.role !== ROLES.TEACHER) return false;
    const staffRec = data.db.staff.find((s) => s.userId === u.id);
    return !staffRec || employmentActiveOn(staffRec, todayKeyStr());
  });
  const currentHead = form.headTeacherId && !employedTeachers.some((t) => t.id === form.headTeacherId)
    ? data.db.users.find((u) => u.id === form.headTeacherId)
    : null;
  const teachers = currentHead ? [...employedTeachers, currentHead] : employedTeachers;
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Class" : "Add Class"}>
      <div>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Grade" required>
            <select className={inputCls} value={form.gradeLabel} onChange={(e) => set("gradeLabel", e.target.value)}>
              <option value="">Select grade</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Section">
            <select className={inputCls} value={form.section} onChange={(e) => set("section", e.target.value)}>
              {SECTIONS.map((s) => <option key={s || "none"} value={s}>{sectionLabel(s)}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-slate-400 -mt-2 mb-3">Leave the section as "None" if this school doesn't split this grade into sections.</p>
        <Field label="Head teacher">
          <select className={inputCls} value={form.headTeacherId} onChange={(e) => set("headTeacherId", e.target.value)}>
            <option value="">Unassigned</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="mb-1.5">
          <span className="block text-xs font-medium text-slate-500 mb-1.5">Subjects</span>
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg p-3">
            {data.db.subjects.length === 0 ? <p className="text-xs text-slate-400">No subjects yet — add one below.</p> : data.db.subjects.map((s) => (
              renameTarget?.id === s.id ? (
                <div key={s.id} className="flex items-center gap-1.5 py-1">
                  <input autoFocus className={inputCls + " py-1 text-sm"} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitRename()} />
                  <button type="button" onClick={submitRename} className="text-emerald-600 hover:text-emerald-700 shrink-0"><Check size={15} /></button>
                  <button type="button" onClick={() => setRenameTarget(null)} className="text-slate-400 hover:text-slate-600 shrink-0"><X size={15} /></button>
                </div>
              ) : (
                <div key={s.id} className="flex items-center justify-between gap-2 py-1">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer min-w-0">
                    <input type="checkbox" checked={form.subjects.includes(s.name)} onChange={() => toggleSubject(s.name)} className="rounded border-slate-300 text-sky-600 shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </label>
                  <div className="flex items-center gap-2 shrink-0 text-slate-400">
                    <button type="button" onClick={() => { setRenameTarget(s); setRenameValue(s.name); }} className="hover:text-slate-600" title="Rename subject"><Edit2 size={12} /></button>
                    <button type="button" onClick={() => deleteGlobalSubject(s)} className="hover:text-red-500" title="Delete subject"><Trash2 size={12} /></button>
                  </div>
                </div>
              )
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <input className={inputCls + " py-1.5 text-sm"} placeholder="New subject name" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNewSubject())} />
            <button type="button" onClick={addNewSubject} className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 border border-sky-200 rounded-lg px-3 py-2 whitespace-nowrap hover:bg-sky-50"><Plus size={13} /> Add</button>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">Check the subjects this class teaches. Add a new one if it's not in the list yet.</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>{isEdit ? "Save Changes" : "Create Class"}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function AdminTimetablePage() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const [classId, setClassId] = useState(db.classes[0]?.id || null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null); // { day, period } | null
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [subEntry, setSubEntry] = useState(null); // timetable entry to assign a substitute for
  const [attendanceFor, setAttendanceFor] = useState(null); // timetable entry the ED is covering attendance for

  const cls = db.classes.find((c) => c.id === classId);
  const entries = cls ? db.timetableEntries.filter((e) => e.classId === cls.id) : [];
  const schedule = data.periodSchedule();
  const todayName = todayDayName();
  const todayInfo = data.classifyAttendanceDay(todayKeyStr());

  function entryFor(day, period) { return entries.find((e) => e.day === day && e.period === period); }
  function logFor(entry) { return entry ? db.periodLogs.find((l) => l.timetableEntryId === entry.id && l.date === todayKeyStr()) : null; }
  function subFor(entry) { return entry ? db.substitutions.find((s) => s.timetableEntryId === entry.id && s.date === todayKeyStr()) : null; }

  function confirmDelete() {
    if (!deleteTarget) return;
    data.deleteTimetableEntry(deleteTarget.id);
    toast("Period removed from the timetable.", "info");
    setDeleteTarget(null);
  }

  const homeworkToday = db.homework.filter((h) => h.classId === classId && new Date(h.createdAt).toDateString() === new Date().toDateString());

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Timetable</h1>
        <PrimaryButton onClick={() => setSettingsOpen(true)} icon={Settings}>Timetable Settings</PrimaryButton>
      </div>
      <p className="text-sm text-slate-400 mb-4">Build the weekly schedule for each class. The teacher shown for a subject comes from that class's assigned teachers.</p>

      <NoSchoolTodayBanner classification={todayInfo} />

      {db.classes.length === 0 ? (
        <EmptyState icon={School} title="No classes yet" description="Add a class first." />
      ) : (
        <>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {db.classes.map((c) => (
              <button key={c.id} onClick={() => setClassId(c.id)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border ${classId === c.id ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{c.grade}{c.section}</button>
            ))}
          </div>

          {cls && (
            <>
              <Card className="overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-sky-50 text-sky-700 text-xs">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2.5 w-24">Period</th>
                        {SCHOOL_DAYS.map((d) => <th key={d} className={`text-left font-medium px-3 py-2.5 ${d === todayName ? "font-bold text-sky-800" : ""}`}>{d}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.periods.map((p) => (
                        <React.Fragment key={p.period}>
                          <tr className="border-t border-slate-100">
                            <td className="px-3 py-2.5 align-top bg-sky-50/60">
                              <p className="font-semibold text-sky-700">Period {p.period}</p>
                              <p className="text-[11px] text-sky-600">{p.startLabel} – {p.endLabel}</p>
                            </td>
                            {SCHOOL_DAYS.map((day) => {
                              const entry = entryFor(day, p.period);
                              const log = logFor(entry);
                              const sub = day === todayName ? subFor(entry) : null;
                              return (
                                <td key={day} className={`px-3 py-2.5 align-top ${day === todayName ? "bg-sky-50/40" : ""}`}>
                                  {entry ? (
                                    <div className="relative pr-4">
                                      <p className="text-xs font-medium text-slate-700">{entry.subject}</p>
                                      <p className="text-[11px] text-slate-400">{sub ? <span className="text-sky-600">{data.getUser(sub.substituteTeacherId)?.name} (sub)</span> : data.getUser(entry.teacherId)?.name || "Unassigned"}</p>
                                      {day === todayName && log?.status === "done" && <Badge tone="green">Done</Badge>}
                                      <button onClick={() => setDeleteTarget(entry)} className="absolute -top-1 -right-1 text-slate-300 hover:text-red-500 transition-colors" title="Remove period"><X size={15} /></button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setPickerTarget({ day, period: p.period })} className="w-full flex items-center justify-center py-1.5 rounded-lg border border-dashed border-slate-200 text-slate-300 hover:border-sky-300 hover:text-sky-500 hover:bg-sky-50/40 transition-colors" title="Assign a subject">
                                      <Plus size={15} />
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                          {schedule.breakAfterPeriod === p.period && (
                            <tr className="bg-sky-50 border-y border-sky-100">
                              <td colSpan={SCHOOL_DAYS.length + 1} className="text-center text-xs font-medium text-sky-700 py-1.5">
                                Break • {schedule.breakStartLabel} – {schedule.breakEndLabel}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Today's Journal — {cls.grade}{cls.section}</h3>
                <p className="text-xs text-slate-400 mb-2">{homeworkToday.length} homework item{homeworkToday.length === 1 ? "" : "s"} sent today for this class.</p>
                {!todayInfo.available ? <p className="text-xs text-slate-400">{todayInfo.label}{todayInfo.message ? ` — ${todayInfo.message}` : ""}</p> : entries.filter((e) => e.day === todayName).length === 0 ? (
                  <p className="text-xs text-slate-400">No periods scheduled today for this class.</p>
                ) : (
                  <div className="space-y-1.5">
                    {entries.filter((e) => e.day === todayName).sort((a, b) => a.period - b.period).map((e) => {
                      const log = logFor(e);
                      const teacher = data.getUser(e.teacherId);
                      const sub = subFor(e);
                      const teacherStaffRec = db.staff.find((s) => s.userId === e.teacherId);
                      const teacherAbsentToday = teacherStaffRec && db.staffAttendance.find((a) => a.staffId === teacherStaffRec.id && a.date === todayKeyStr() && TEACHER_UNAVAILABLE_STATUSES.includes(a.status));
                      const covererCandidate = !sub && log?.completedBy && log.completedBy !== e.teacherId ? data.getUser(log.completedBy) : null;
                      const directCovererUser = covererCandidate && (covererCandidate.role === ROLES.OWNER || covererCandidate.role === ROLES.ADMIN) ? covererCandidate : null;
                      const covererRoleLabel = directCovererUser ? ROLE_LABEL[directCovererUser.role] : null;
                      return (
                        <div key={e.id} className="flex items-center justify-between gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                          <span className="text-slate-600">Period {e.period} • {e.subject} • {teacher?.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {sub ? (
                              <>
                                <Badge tone="sky">Covered by {data.getUser(sub.substituteTeacherId)?.name}</Badge>
                                {/* Once the substitute has actually recorded attendance, that's the historical
                                    record of who taught this period — changing/removing the assignment afterward
                                    would relabel history, not just fix a mistake, so both actions are only
                                    offered while the period is still pending. */}
                                {!log?.attendance && (
                                  <>
                                    <GhostButton onClick={() => setSubEntry(e)}>Change</GhostButton>
                                    <GhostButton onClick={() => data.removeSubstitute(e.id, todayKeyStr())}>Remove</GhostButton>
                                  </>
                                )}
                              </>
                            ) : directCovererUser ? (
                              <>
                                <Badge tone="sky">Covered by {directCovererUser.name}{covererRoleLabel ? ` (${covererRoleLabel})` : ""}</Badge>
                                {log?.attendance && (
                                  <button onClick={() => setAttendanceFor(e)}><Badge tone="green">{log.attendance.filter((a) => a.status === "Present").length}/{log.attendance.length} present · Edit</Badge></button>
                                )}
                              </>
                            ) : teacherAbsentToday ? (
                              <>
                                <Badge tone={statusTone(teacherAbsentToday.status)}>{teacherAbsentToday.status}</Badge>
                                <GhostButton onClick={() => setSubEntry(e)}>Assign Substitute</GhostButton>
                                {data.canTakePeriodAttendance(e, todayKeyStr(), auth.currentUser) && (
                                  log?.attendance ? (
                                    <button onClick={() => setAttendanceFor(e)}><Badge tone="green">{log.attendance.filter((a) => a.status === "Present").length}/{log.attendance.length} present · Edit</Badge></button>
                                  ) : (
                                    <GhostButton onClick={() => setAttendanceFor(e)}>Take Attendance</GhostButton>
                                  )
                                )}
                              </>
                            ) : data.canTakePeriodAttendance(e, todayKeyStr(), auth.currentUser) ? (
                              log?.attendance ? (
                                <button onClick={() => setAttendanceFor(e)}><Badge tone="green">{log.attendance.filter((a) => a.status === "Present").length}/{log.attendance.length} present · Edit</Badge></button>
                              ) : (
                                <GhostButton onClick={() => setAttendanceFor(e)}>Take Attendance</GhostButton>
                              )
                            ) : (
                              <>
                                <Badge tone={log?.status === "done" ? "green" : "slate"}>{log?.status === "done" ? "Done" : "Pending"}</Badge>
                                {log?.attendance && <span className="text-[11px] text-slate-400">{log.attendance.filter((a) => a.status === "Present").length}/{log.attendance.length} present</span>}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
      {cls && <SelectSubjectModal open={!!pickerTarget} onClose={() => setPickerTarget(null)} cls={cls} day={pickerTarget?.day} period={pickerTarget?.period} />}
      <TimetableSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AssignSubstituteModal open={!!subEntry} onClose={() => setSubEntry(null)} entry={subEntry} />
      <PeriodAttendanceModal entry={attendanceFor} date={todayKeyStr()} onClose={() => setAttendanceFor(null)} />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} danger confirmLabel="Remove Period"
        title="Remove this period?" description={deleteTarget ? `This removes ${deleteTarget.subject} from ${deleteTarget.day}, period ${deleteTarget.period}.` : ""}
        onConfirm={confirmDelete} />
    </div>
  );
}

// School-wide rollup of today's periods, for the Owner and Educational Director dashboards —
// the per-class Today's Journal card on the Timetable page totalled across every class, via
// data.todaysJournalSummary(). Kept here (not per-dashboard) so Owner and ED never drift apart.
function TodaysJournalSummaryCard({ setPage }) {
  const data = useData();
  const summary = data.todaysJournalSummary();
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">Today's Journal — School-Wide</h3>
        {setPage && <button onClick={() => setPage("timetable")} className="text-xs font-medium text-sky-600 hover:text-sky-700">Open Timetable →</button>}
      </div>
      {!summary.available ? (
        <p className="text-xs text-slate-400">{summary.label}</p>
      ) : summary.scheduled === 0 ? (
        <p className="text-xs text-slate-400">No periods scheduled today.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Scheduled</p><p className="text-lg font-semibold text-slate-800">{summary.scheduled}</p></div>
            <div className="bg-emerald-50 rounded-lg p-3"><p className="text-xs text-emerald-600 mb-1">Completed</p><p className="text-lg font-semibold text-emerald-700">{summary.completed}</p></div>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Pending</p><p className="text-lg font-semibold text-slate-700">{summary.pending}</p></div>
            <div className="bg-amber-50 rounded-lg p-3"><p className="text-xs text-amber-600 mb-1">Teacher Absent</p><p className="text-lg font-semibold text-amber-700">{summary.teacherAbsent}</p></div>
          </div>
          {summary.substituted > 0 && <p className="text-xs text-slate-400 mt-3">{summary.substituted} period{summary.substituted === 1 ? "" : "s"} covered by a substitute today.</p>}
        </>
      )}
    </Card>
  );
}

function AssignSubstituteModal({ open, onClose, entry }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const [substituteId, setSubstituteId] = useState("");

  useEffect(() => { if (open) setSubstituteId(""); }, [open, entry]);

  if (!entry) return null;
  const cls = data.getClass(entry.classId);
  const options = data.substituteCandidates(entry, todayKeyStr());
  const slot = data.periodSchedule().periods.find((p) => p.period === entry.period);

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!substituteId) { toast("Please choose a substitute teacher.", "error"); return; }
    const res = data.assignSubstitute(entry.id, todayKeyStr(), substituteId, auth.currentUser.id);
    if (!res.ok) { toast(res.message, "error"); return; }
    toast("Substitute assigned. Parents and the substitute teacher have been notified.", "success");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign Substitute Teacher">
      <div>
        <p className="text-xs text-slate-400 mb-3">{entry.subject} • {cls ? data.classLabel(cls) : ""} • Period {entry.period}{slot ? ` (${slot.startLabel}–${slot.endLabel})` : ""}</p>
        <Field label="Substitute teacher" required>
          <select className={inputCls} value={substituteId} onChange={(e) => setSubstituteId(e.target.value)}>
            <option value="">Select a teacher…</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.name} — {data.teacherSubjects(t.id).join(", ") || "No subject"}</option>)}
          </select>
        </Field>
        <p className="text-xs text-slate-400 mb-3">Parents of {cls ? data.classLabel(cls) : "this class"} and the substitute teacher will be notified immediately.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>Assign Substitute</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function SelectSubjectModal({ open, onClose, cls, day, period }) {
  const data = useData();
  const toast = useToast();
  const options = open && cls && day && period ? data.availableSubjectsForSlot(cls.id, day, period) : [];
  const hasAnyAssignment = cls ? data.db.teacherAssignments.some((ta) => ta.classId === cls.id) : false;
  const [subject, setSubject] = useState("");

  useEffect(() => { if (open) setSubject(options[0] || ""); }, [open, cls?.id, day, period]);

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!subject) { toast("Choose a subject to assign.", "error"); return; }
    const res = data.createTimetableEntry({ classId: cls.id, day, period, subject });
    if (!res.ok) { toast(res.message, "error"); return; }
    toast("Subject added to the timetable.", "success");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={cls && day && period ? `${cls.grade}${cls.section} — ${day}, Period ${period}` : "Select Subject"}>
      <div>
        {options.length === 0 ? (
          <p className="text-xs text-slate-400 mb-3">
            {hasAnyAssignment
              ? "All of this class's assignable subjects have a teacher already booked elsewhere at this day and period."
              : "No subjects have a teacher assigned to this class yet. Assign one from the Teachers page first."}
          </p>
        ) : (
          <Field label="Subject" required>
            <select className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}>
              {options.map((s) => {
                const ta = data.db.teacherAssignments.find((t) => t.classId === cls.id && t.subject === s);
                return <option key={s} value={s}>{s} — {ta ? data.getUser(ta.teacherId)?.name : "—"}</option>;
              })}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          {options.length > 0 && <PrimaryButton type="button" onClick={submit} icon={Check}>Add Subject</PrimaryButton>}
        </div>
      </div>
    </Modal>
  );
}

function TimetableSettingsModal({ open, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const [form, setForm] = useState(db.timetableConfig);

  useEffect(() => { if (open) setForm(db.timetableConfig); }, [open]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  const periodsCount = Number(form.periodsCount) || 0;
  const preview = computePeriodSchedule({ ...form, periodsCount });
  const orphaned = open ? data.entriesBeyondPeriodCount(periodsCount) : [];

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    const res = data.updateTimetableConfig({
      periodsCount, startTime: form.startTime, periodDurationMins: Number(form.periodDurationMins), breakDurationMins: Number(form.breakDurationMins), breakAfterPeriod: form.breakAfterPeriod ? Number(form.breakAfterPeriod) : null,
    }, auth.currentUser.id);
    if (!res.ok) { toast(res.message, "error"); return; }
    toast("Timetable settings updated.", "success");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Timetable Settings" wide>
      <div>
        <p className="text-xs text-slate-400 mb-3">These settings apply to every class's timetable. Period times are calculated automatically.</p>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Number of periods" required>
            <input type="number" min={MIN_PERIODS} max={MAX_PERIODS} className={inputCls} value={form.periodsCount} onChange={(e) => set("periodsCount", e.target.value)} />
          </Field>
          <Field label="School start time" required>
            <input type="time" className={inputCls} value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Period duration (mins)" required>
            <input type="number" min={1} className={inputCls} value={form.periodDurationMins} onChange={(e) => set("periodDurationMins", e.target.value)} />
          </Field>
          <Field label="Break duration (mins)">
            <input type="number" min={0} className={inputCls} value={form.breakDurationMins} onChange={(e) => set("breakDurationMins", e.target.value)} />
          </Field>
        </div>
        <Field label="Break after period">
          <select className={inputCls} value={form.breakAfterPeriod ?? ""} onChange={(e) => set("breakAfterPeriod", e.target.value || null)}>
            <option value="">No break</option>
            {Array.from({ length: periodsCount }, (_, i) => i + 1).map((p) => <option key={p} value={p}>After period {p}</option>)}
          </select>
        </Field>

        {orphaned.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-800">
            Reducing to {periodsCount} period{periodsCount === 1 ? "" : "s"} would remove periods still scheduled: {orphaned.slice(0, 5).map((e) => `${e.classLabel} (${e.day}, P${e.period})`).join(", ")}{orphaned.length > 5 ? `, and ${orphaned.length - 5} more` : ""}. Remove those periods from each class's grid first.
          </div>
        )}

        <div className="bg-sky-50 border border-sky-100 rounded-lg p-3 mb-3">
          <p className="text-xs font-semibold text-sky-700 mb-2">Preview</p>
          <div className="space-y-1">
            {preview.periods.map((p) => (
              <React.Fragment key={p.period}>
                <p className="text-xs text-sky-700">Period {p.period} — {p.startLabel} – {p.endLabel}</p>
                {preview.breakAfterPeriod === p.period && <p className="text-xs font-medium text-sky-800">Break — {preview.breakStartLabel} – {preview.breakEndLabel}</p>}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>Save timetable configuration</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function AttendanceOverviewPage({ focus, clearFocus }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const bounds = data.attendanceDateBounds();
  // Only cap the upper bound (e.g. the year already ended) — if today is earlier than the
  // configured start, we deliberately show today so the "attendance hasn't started yet" notice
  // has the right context, rather than jumping the view forward to a date that hasn't happened.
  const [dateKey, setDateKey] = useState(() => { const t = todayKeyStr(); return t > bounds.max ? bounds.max : t; });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editor, setEditor] = useState(null); // { classId, dateKey, mode: "edit" | "view" } | null
  const [registerFor, setRegisterFor] = useState(null); // classId | null
  const [registerMonth, setRegisterMonth] = useState(() => bounds.max.slice(0, 7));

  // Deep-link from a Recent Activity item — jump to the date and class that were recorded.
  useEffect(() => {
    if (!focus?.classId) return;
    if (focus.date) setDateKey(focus.date);
    setEditor({ classId: focus.classId, dateKey: focus.date || dateKey, mode: "view" });
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const classification = data.classifyAttendanceDay(dateKey);
  const dayRecords = db.attendance.filter((a) => a.date === dateKey);
  const dayCounts = ATTENDANCE_STATUSES.map((status) => ({ status, n: dayRecords.filter((r) => r.status === status).length }));

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 mb-1">Student Attendance</h1>
          <p className="text-sm text-slate-400">School-wide attendance by class.</p>
        </div>
        <GhostButton icon={Settings} onClick={() => setSettingsOpen(true)}>Academic Calendar & Settings</GhostButton>
      </div>

      <DateNav date={dateKey} onChange={setDateKey} minDate={bounds.min} maxDate={bounds.max} skipDates={(d) => !data.classifyAttendanceDay(d).available} />
      <AttendanceCalendarNotice classification={classification} />
      {classification.available && <DayStatusBanner dateKey={dateKey} todayKey={todayKeyStr()} counts={dayCounts} />}

      {db.classes.length === 0 ? <EmptyState title="No classes yet" description="Add a class first to record attendance." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {db.classes.map((c) => {
            const students = data.attendanceRosterForClass(c.id);
            const records = db.attendance.filter((a) => a.classId === c.id && a.date === dateKey);
            const head = data.getUser(c.headTeacherId);
            const canTake = classification.available && students.length > 0 && data.canTakeClassAttendance(c, auth.currentUser);
            const summary = ATTENDANCE_STATUSES
              .map((st) => ({ st, n: records.filter((r) => r.status === st).length }))
              .filter((x) => x.n > 0)
              .map((x) => `${x.n} ${x.st}`)
              .join(" · ");
            return (
              <Card key={c.id} className="p-4 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-slate-700">{c.grade}{c.section}</h3>
                  <Badge tone="sky">{students.length} student{students.length === 1 ? "" : "s"}</Badge>
                </div>
                {head ? (
                  <p className="text-xs text-slate-400 mb-2">Head Teacher · <span className="text-slate-600 font-medium">{head.name}</span></p>
                ) : (
                  <p className="text-xs text-amber-600 font-medium mb-2 flex items-center gap-1"><AlertTriangle size={12} /> No head teacher assigned</p>
                )}
                <p className="text-xs text-slate-500 mb-3 flex-1">
                  {!classification.available ? "Attendance unavailable for this date." : students.length === 0 ? "No students in this class." : summary || "Not taken"}
                </p>
                <div className="flex gap-2">
                  {classification.available && students.length > 0 && canTake ? (
                    <button onClick={() => setEditor({ classId: c.id, dateKey, mode: "edit" })} className="flex-1 text-xs text-white font-medium bg-sky-600 rounded-lg py-1.5 hover:bg-sky-700">{records.length > 0 ? "View & Edit" : "Take Attendance"}</button>
                  ) : (
                    <button onClick={() => setEditor({ classId: c.id, dateKey, mode: "view" })} className="flex-1 text-xs text-slate-500 font-medium border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50">View</button>
                  )}
                  {students.length > 0 && (
                    <button onClick={() => setRegisterFor(c.id)} className="text-xs text-slate-500 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50" title="Monthly Register"><CalendarDays size={14} /></button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ClassMonthlyRegisterModal
        classId={registerFor}
        monthKey={registerMonth}
        onMonthChange={setRegisterMonth}
        onClose={() => setRegisterFor(null)}
        onOpenDay={(day, mode) => setEditor({ classId: registerFor, dateKey: day, mode })}
        canManage={(() => { const c = db.classes.find((x) => x.id === registerFor); return c ? data.canTakeClassAttendance(c, auth.currentUser) : false; })()}
      />
      <AttendanceEditorModal classId={editor?.classId} dateKey={editor?.dateKey} mode={editor?.mode} onClose={() => setEditor(null)} />
      <AcademicCalendarSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// Shared take/edit/view modal for a single class's attendance on a single day. Used by the
// Owner/Educational Director overview (AttendanceOverviewPage) and by head/subject teachers
// (TeacherAttendancePage) so the editor only needs to exist once. Saving closes the modal —
// the caller's list re-renders from the same `db` state, no extra plumbing needed.
function AttendanceEditorModal({ classId, dateKey, mode, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const cls = db.classes.find((c) => c.id === classId) || null;
  const students = cls ? data.attendanceRosterForClass(cls.id) : [];
  const readOnly = mode === "view";
  const [draft, setDraft] = useState({});
  const dayRecords = cls ? db.attendance.filter((a) => a.classId === cls.id && a.date === dateKey) : [];
  const latestRecord = dayRecords.reduce((latest, r) => (!latest || (r.markedAt || 0) > (latest.markedAt || 0)) ? r : latest, null);

  useEffect(() => {
    if (!cls) return;
    const initial = {};
    students.forEach((s) => {
      const existing = db.attendance.find((a) => a.studentId === s.id && a.date === dateKey);
      initial[s.id] = { status: existing?.status || null, note: existing?.note || "" };
    });
    setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, dateKey, mode]);

  function setStatus(id, status) { setDraft((d) => ({ ...d, [id]: { ...d[id], status } })); }
  function markAll(status) { const next = {}; students.forEach((s) => { next[s.id] = { ...draft[s.id], status }; }); setDraft(next); }
  function save() {
    if (!cls) return;
    if (students.some((s) => !draft[s.id]?.status)) { toast("Mark every student before saving — attendance never defaults to Present.", "error"); return; }
    const records = students.map((s) => ({ studentId: s.id, status: draft[s.id].status, note: draft[s.id]?.note || "" }));
    data.saveAttendance(cls.id, dateKey, records, auth.currentUser.id);
    toast(`Attendance saved for ${dateKeyLabel(dateKey)}.`, "success");
    onClose();
  }

  return (
    <Modal open={!!classId} onClose={onClose} title={cls ? `${readOnly ? "Attendance" : "Take Attendance"} · ${cls.grade}${cls.section}` : ""} wide>
      {cls && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <p className="text-xs text-slate-400">{dateKeyLabel(dateKey)}</p>
            {latestRecord && (
              <p className="text-xs text-slate-400">Recorded by <span className="text-slate-600 font-medium">{data.userIdentity(latestRecord.markedBy).display}</span>{latestRecord.markedAt ? ` · ${fmtDate(latestRecord.markedAt)} · ${fmtTime(latestRecord.markedAt)}` : ""}</p>
            )}
          </div>
          {students.length === 0 ? <p className="text-xs text-slate-300 py-2">No students in this class.</p> : (
            <>
              {!readOnly && (
                <Toolbar>
                  <GhostButton icon={Check} onClick={() => markAll("Present")}>Mark all present</GhostButton>
                  <GhostButton icon={AlertTriangle} onClick={() => markAll("Absent")}>Mark all absent</GhostButton>
                </Toolbar>
              )}
              <div className="divide-y divide-slate-100 border-t border-slate-100 max-h-[55vh] overflow-y-auto">
                {students.map((s, i) => (
                  <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0"><span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}.</span><Avatar name={data.studentFullName(s)} photo={s.photo} size={30} /><span className="text-sm font-medium text-slate-700 truncate">{data.studentFullName(s)}</span></div>
                    {readOnly ? (
                      <Badge tone={statusTone(draft[s.id]?.status)}>{draft[s.id]?.status || "Not marked"}</Badge>
                    ) : (
                      <AttendanceStatusPicker value={draft[s.id]?.status} onChange={(st) => setStatus(s.id, st)} />
                    )}
                  </div>
                ))}
              </div>
              {!readOnly && (
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                  <PrimaryButton icon={Check} onClick={save}>Save Attendance</PrimaryButton>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

const ATTENDANCE_STATUS_CODE = { Present: "P", Late: "L", Sick: "S", Permission: "PER", Excused: "E", Absent: "A" };
const ATTENDANCE_CODE_TEXT_TONE = { green: "text-emerald-600", amber: "text-amber-600", indigo: "text-indigo-600", sky: "text-sky-600", red: "text-red-600", slate: "text-slate-300" };

// A whole-class monthly attendance history — one row per student, one column per day the day was
// available for attendance (per classifyAttendanceDay) or already has a record. Shared by the
// Owner/Educational Director overview and by TeacherAttendancePage so the register only exists
// once. Clicking a day column opens the existing AttendanceEditorModal for that exact date via
// `onOpenDay` — this component never creates or edits records itself.
function ClassMonthlyRegisterModal({ classId, monthKey, onMonthChange, onClose, onOpenDay, canManage, blockedForDate }) {
  const data = useData();
  const { db } = data;
  const cls = db.classes.find((c) => c.id === classId) || null;
  const students = cls ? data.attendanceRosterForClass(cls.id) : [];
  const head = cls ? data.getUser(cls.headTeacherId) : null;
  const bounds = data.attendanceDateBounds();

  const days = useMemo(() => {
    if (!monthKey) return [];
    const [y, m] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const list = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const classification = data.classifyAttendanceDay(dateKey);
      const hasRecord = db.attendance.some((a) => a.classId === classId && a.date === dateKey);
      if (classification.available || hasRecord) list.push({ dateKey, day: d, available: classification.available });
    }
    return list;
  }, [monthKey, classId, db.attendance, data]);

  function openDay(dateKey, available) {
    const editable = canManage && available && !(blockedForDate && blockedForDate(dateKey));
    onOpenDay(dateKey, editable ? "edit" : "view");
  }

  return (
    <Modal open={!!classId} onClose={onClose} title={cls ? `Monthly Register · ${cls.grade}${cls.section}` : ""} wide>
      {cls && (
        <div>
          <p className="text-xs text-slate-400 mb-3">{head ? <>Head Teacher · <span className="text-slate-600 font-medium">{head.name}</span></> : "No head teacher assigned"}</p>
          <MonthNav monthKey={monthKey} onChange={onMonthChange} maxMonthKey={bounds.max.slice(0, 7)} minMonthKey={bounds.min.slice(0, 7)} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[11px] text-slate-500">
            {ATTENDANCE_STATUSES.map((st) => (
              <span key={st} className="flex items-center gap-1">
                <span className={`font-semibold ${ATTENDANCE_CODE_TEXT_TONE[statusTone(st) || "slate"]}`}>{ATTENDANCE_STATUS_CODE[st]}</span>
                <span>= {st}</span>
              </span>
            ))}
          </div>
          {students.length === 0 ? <EmptyState title="No students in this class" description="Nothing to register yet." /> : days.length === 0 ? (
            <EmptyState title="No school days this month" description="Attendance wasn't available on any date in this month." />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-[11px] border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white px-1.5 py-1 text-left font-medium text-slate-400 w-6">#</th>
                    <th className="sticky left-6 bg-white px-2 py-1 text-left font-medium text-slate-400 min-w-[9rem]">Student</th>
                    {days.map((d) => {
                      const blocked = canManage && d.available && !!(blockedForDate && blockedForDate(d.dateKey));
                      return (
                        <th key={d.dateKey} onClick={() => openDay(d.dateKey, d.available)}
                          title={blocked ? `${dateKeyLabel(d.dateKey)} — editing unavailable, view only` : dateKeyLabel(d.dateKey)}
                          className={`px-1 py-1 text-center font-medium cursor-pointer hover:bg-slate-50 rounded ${blocked ? "text-amber-500" : "text-slate-500"}`}>
                          {d.day}
                        </th>
                      );
                    })}
                    {ATTENDANCE_STATUSES.map((st) => (
                      <th key={st} className="px-1.5 py-1 text-center font-semibold text-slate-500">{ATTENDANCE_STATUS_CODE[st]}</th>
                    ))}
                    <th className="px-1.5 py-1 text-center font-semibold text-slate-500">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {students.map((s, i) => {
                    const totals = {};
                    ATTENDANCE_STATUSES.forEach((st) => { totals[st] = 0; });
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/60">
                        <td className="sticky left-0 bg-white px-1.5 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="sticky left-6 bg-white px-2 py-1.5 text-slate-700 font-medium whitespace-nowrap">{data.studentFullName(s)}</td>
                        {days.map((d) => {
                          const rec = db.attendance.find((a) => a.studentId === s.id && a.date === d.dateKey);
                          if (rec) totals[rec.status] = (totals[rec.status] || 0) + 1;
                          const code = rec ? ATTENDANCE_STATUS_CODE[rec.status] : "—";
                          const tone = rec ? (statusTone(rec.status) || "slate") : "slate";
                          return (
                            <td key={d.dateKey} onClick={() => openDay(d.dateKey, d.available)}
                              title={rec ? `${dateKeyLabel(d.dateKey)} — ${rec.status}` : `${dateKeyLabel(d.dateKey)} — Not taken`}
                              className={`px-1 py-1.5 text-center cursor-pointer hover:bg-slate-100 font-medium ${ATTENDANCE_CODE_TEXT_TONE[tone]}`}>
                              {code}
                            </td>
                          );
                        })}
                        {ATTENDANCE_STATUSES.map((st) => (
                          <td key={st} className="px-1.5 py-1.5 text-center text-slate-500">{totals[st] || 0}</td>
                        ))}
                        {(() => {
                          const recorded = Object.values(totals).reduce((sum, n) => sum + n, 0);
                          // Present + Late count toward the percentage — matches data.studentAttendanceRate
                          // (Overview tab / Students list), so the same student's rate never disagrees
                          // between the register and every other page that shows it.
                          const presentLike = (totals.Present || 0) + (totals.Late || 0);
                          const pct = recorded > 0 ? Math.round((presentLike / recorded) * 100) : null;
                          return <td className="px-1.5 py-1.5 text-center font-semibold text-slate-700">{pct === null ? "—" : `${pct}%`}</td>;
                        })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Lets the Owner/Educational Director define the school year's semesters and break, which the
// shared attendance-calendar rules (src/utils/academicCalendar.js) then use everywhere attendance
// is recorded or viewed. Never touches existing attendance records — only the availability rules.
function AcademicCalendarSettingsModal({ open, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const cal = data.db.academicCalendar;
  const [form, setForm] = useState(cal);

  useEffect(() => { if (open) setForm(cal); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  // Semester 2's start date is never entered by hand — it's always the day after the break
  // ends, so the chain (year start → sem1 → break → sem2 → year end) can't be broken by an
  // admin typing a start date that disagrees with the break. Only the end date is editable.
  const { breakStart, breakEnd } = computeBreakRange(form);
  const sem2Start = addDays(breakEnd, 1);

  function suggestSemester2End() {
    setForm((f) => ({ ...f, sem2End: suggestSemester2(f).sem2End }));
  }

  function save() {
    if (!form.yearName.trim()) { toast("Please give the academic year a name.", "error"); return; }
    if (!(form.yearStart < form.yearEnd)) { toast("The academic year's start date must be before its end date.", "error"); return; }
    if (!(form.sem1Start >= form.yearStart)) { toast("Semester 1 can't start before the academic year begins.", "error"); return; }
    if (!(form.sem1Start < form.sem1End)) { toast("Semester 1's start date must be before its end date.", "error"); return; }
    if (!(form.sem1End <= form.yearEnd)) { toast("Semester 1 must end on or before the academic year ends.", "error"); return; }
    if (!(form.sem2End > sem2Start)) { toast("Semester 2's end date must be after the school break ends.", "error"); return; }
    if (!(form.sem2End <= form.yearEnd)) { toast("Semester 2 must end on or before the academic year ends.", "error"); return; }
    data.saveAcademicCalendar({
      yearName: form.yearName.trim(), yearStart: form.yearStart, yearEnd: form.yearEnd,
      sem1Start: form.sem1Start, sem1End: form.sem1End, breakDays: Number(form.breakDays) || 0,
      sem2Start, sem2End: form.sem2End,
      resultFinalizationGraceDays: Math.max(0, parseInt(form.resultFinalizationGraceDays, 10) || 0),
    }, auth.currentUser.id);
    toast("Academic calendar updated.", "success");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Academic Calendar & Attendance" wide>
      <div className="rounded-lg bg-sky-50 border border-sky-200 px-3.5 py-2.5 text-xs text-sky-800 mb-4">
        Changing the academic calendar may affect which dates are available for attendance. Existing attendance records will not be deleted.
      </div>

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Academic Year</p>
      <Field label="Academic year name" required>
        <input className={inputCls} value={form.yearName} onChange={(e) => set("yearName", e.target.value)} placeholder="e.g. 2026/2027" />
      </Field>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Academic year start" required><input type="date" className={inputCls} value={form.yearStart} onChange={(e) => set("yearStart", e.target.value)} /></Field>
        <Field label="Academic year end" required><input type="date" className={inputCls} value={form.yearEnd} onChange={(e) => set("yearEnd", e.target.value)} /></Field>
      </div>

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-1">Semester 1</p>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Semester 1 start date" required><input type="date" className={inputCls} value={form.sem1Start} onChange={(e) => set("sem1Start", e.target.value)} /></Field>
        <Field label="Semester 1 end date" required><input type="date" className={inputCls} value={form.sem1End} onChange={(e) => set("sem1End", e.target.value)} /></Field>
      </div>

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-1">Semester Break</p>
      <Field label="Break duration in days" required>
        <input type="number" min={0} className={inputCls} value={form.breakDays} onChange={(e) => set("breakDays", Math.max(0, parseInt(e.target.value, 10) || 0))} />
      </Field>
      <p className="text-xs text-slate-400 -mt-2 mb-3">The break starts automatically the day after Semester 1 ends.</p>

      <div className="flex items-center justify-between mb-2 mt-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Semester 2</p>
        <button type="button" onClick={suggestSemester2End} className="text-xs text-sky-600 font-medium">Suggest end date</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Semester 2 start date">
          <div className={`${inputCls} bg-slate-100 text-slate-500 flex items-center`}>{fmtDate(sem2Start)}</div>
        </Field>
        <Field label="Semester 2 end date" required><input type="date" className={inputCls} value={form.sem2End} onChange={(e) => set("sem2End", e.target.value)} /></Field>
      </div>
      <p className="text-xs text-slate-400 -mt-2 mb-3">Calculated automatically — the day after the school break ends.</p>

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-1">Result Finalization</p>
      <Field label="Grace period after a semester ends (days)" required>
        <input type="number" min={0} className={inputCls} value={form.resultFinalizationGraceDays} onChange={(e) => set("resultFinalizationGraceDays", Math.max(0, parseInt(e.target.value, 10) || 0))} />
      </Field>
      <p className="text-xs text-slate-400 -mt-2 mb-3">Teachers can still enter or edit results for this many days after a semester ends — or, for Semester 1, until Semester 2 begins, whichever comes first.</p>

      <Card className="p-4 mt-1 bg-slate-50">
        <p className="text-sm font-semibold text-slate-700 mb-2">{form.yearName || "Academic Calendar"} Preview</p>
        <div className="space-y-2 text-xs text-slate-600">
          <div><span className="font-medium text-slate-700">Academic Year</span><br />{fmtDate(form.yearStart)} — {fmtDate(form.yearEnd)}</div>
          <div><span className="font-medium text-slate-700">Semester 1</span><br />{fmtDate(form.sem1Start)} — {fmtDate(form.sem1End)}</div>
          <div><span className="font-medium text-amber-700">School Break</span><br />{fmtDate(breakStart)} — {fmtDate(breakEnd)} ({form.breakDays} days)</div>
          <div><span className="font-medium text-slate-700">Semester 2</span><br />{fmtDate(sem2Start)} — {fmtDate(form.sem2End)}</div>
        </div>
      </Card>

      <div className="flex justify-end gap-2 mt-5 mb-5">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton icon={Check} onClick={save}>Save Calendar</PrimaryButton>
      </div>

      <div className="border-t border-slate-100 pt-4 mb-4">
        <AcademicYearsPanel />
      </div>

      <div className="border-t border-slate-100 pt-4">
        <SchoolClosuresPanel />
      </div>
    </Modal>
  );
}

function addYearToDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Real, id'd, multi-year academic years (spec §1/§2) — the school moves on to a new one here
// without losing the previous one; every student's enrollment history stays keyed to whichever
// year was current when it happened.
function AcademicYearsPanel() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  if (!canManageAcademicYears(auth.currentUser)) return null;
  const years = [...data.db.academicYears].sort((a, b) => (b.yearStart || "").localeCompare(a.yearStart || ""));
  const latest = years[0];
  const [creating, setCreating] = useState(false);
  const [newStart, setNewStart] = useState(latest ? addYearToDateStr(latest.yearStart) : new Date().toISOString().slice(0, 10));
  const preview = defaultAcademicCalendar(new Date(newStart + "T00:00:00"));

  function create() {
    data.createAcademicYear({ yearStart: newStart }, auth.currentUser.id);
    toast(`${formatAcademicYearLabel(preview)} was created.`, "success");
    setCreating(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Academic Years</p>
        {!creating && <button type="button" onClick={() => setCreating(true)} className="text-xs text-sky-600 font-medium">+ Create New Academic Year</button>}
      </div>
      {creating && (
        <Card className="p-3.5 mb-3 bg-slate-50">
          <Field label="New academic year starts"><input type="date" className={inputCls} value={newStart} onChange={(e) => setNewStart(e.target.value)} /></Field>
          <p className="text-xs text-slate-500 mb-3">Will be created as <span className="font-medium text-slate-700">{formatAcademicYearLabel(preview)}</span>.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <PrimaryButton icon={Check} onClick={create}>Create Year</PrimaryButton>
          </div>
        </Card>
      )}
      <div className="space-y-1.5">
        {years.map((y) => (
          <div key={y.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-slate-100">
            <span className="text-slate-700">{formatAcademicYearLabel(y)}</span>
            {y.isCurrent ? <Badge tone="sky">Current</Badge> : <button type="button" onClick={() => { data.setCurrentAcademicYear(y.id); toast(`${formatAcademicYearLabel(y)} is now current.`, "success"); }} className="text-xs text-sky-600 font-medium">Set as Current</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Special, one-off non-school days (holidays, emergency closures) — separate from the
// recurring Semester 1 / Break / Semester 2 configuration above. A closure overrides the
// timetable and attendance for that single date everywhere in the app (see classifyAttendanceDay).
function SchoolClosuresPanel() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const closures = [...data.db.schoolClosures].sort((a, b) => a.date.localeCompare(b.date));
  const [date, setDate] = useState(todayKeyStr());
  const [reason, setReason] = useState(CLOSURE_REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");

  function addClosure() {
    const finalReason = reason === "Other" ? customReason.trim() : reason;
    if (!date) { toast("Pick a date for the closure.", "error"); return; }
    if (!finalReason) { toast("Give the closure a reason.", "error"); return; }
    const result = data.createSchoolClosure({ date, reason: finalReason }, auth.currentUser.id);
    if (!result.ok) { toast(result.message, "error"); return; }
    toast(`${fmtDate(date)} marked as a school closure.`, "success");
    setCustomReason("");
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Special School Closures</p>
      <p className="text-xs text-slate-400 mb-3">
        A one-off non-school day — a holiday, a national celebration, an emergency closure. Overrides the
        timetable and attendance for that date only, everywhere in the app.
      </p>
      <Card className="p-4 mb-3">
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Date" required><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reason" required>
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              {CLOSURE_REASON_PRESETS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        {reason === "Other" && (
          <Field label="Describe the reason" required>
            <input className={inputCls} value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="e.g. Heavy flooding" />
          </Field>
        )}
        <div className="flex justify-end"><PrimaryButton icon={Plus} onClick={addClosure}>Save School Closure</PrimaryButton></div>
      </Card>

      {closures.length === 0 ? <p className="text-xs text-slate-300">No school closures recorded.</p> : (
        <Card className="divide-y divide-slate-100">
          {closures.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <School size={14} className="text-red-500 shrink-0" />
                <span className="text-slate-600">{fmtDate(c.date)}</span>
                <span className="text-xs text-slate-400">{c.reason}</span>
              </div>
              <button onClick={() => data.deleteSchoolClosure(c.id)} className="text-slate-400 hover:text-red-500 p-1" title="Remove closure"><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// Shared by everyone who can see Staff Attendance — which groups even appear is scoped per role
// via data.staffAttendanceGroupsFor (the Owner sees and edits all three groups; the Educational
// Director sees and edits Teachers only; Finance & Operations Director sees and edits Other Staff
// only — a group a role can't edit simply doesn't appear for them at all), and edit rights within
// whatever groups a role does see are per-row via data.canEditStaffAttendanceFor.
function StaffAttendancePage() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const isEducationalDirector = auth.currentUser?.role === ROLES.ADMIN;
  // Employment-based, not login-based (Blocker 3, Decision 3): a disabled login doesn't mean the
  // person stopped working, so they still belong on today's attendance sheet. Only employment
  // actually ending removes them from this list going forward.
  const staffList = db.staff.filter((s) => employmentActiveOn(s, todayKeyStr()));
  const [dateKey, setDateKey] = useState(todayKeyStr());
  const [draft, setDraft] = useState({});
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [subEntry, setSubEntry] = useState(null); // timetableEntry | null — "Assign Substitute" from an affected period below
  const classification = data.classifyStaffAttendanceDay(dateKey);
  const dayEditable = classification.available;

  function periodsFor(s) { return s.hasShifts ? STAFF_SHIFT_PERIODS : ["FULL_DAY"]; }

  // Which of a Teacher's periods today have nobody covering them, so the ED can spot and fix
  // coverage gaps right where they mark the absence — instead of it being discoverable only by
  // separately browsing the timetable. Scoped to today because assignSubstitute/
  // AssignSubstituteModal are themselves today-only by existing design.
  function affectedPeriodsFor(s) {
    if (dateKey !== todayKeyStr() || staffGroupLabel(s.position) !== "Teachers") return [];
    const savedRec = db.staffAttendance.find((a) => a.staffId === s.id && a.date === dateKey);
    if (!savedRec || !TEACHER_UNAVAILABLE_STATUSES.includes(savedRec.status)) return [];
    const dayName = todayDayName();
    return db.timetableEntries
      .filter((e) => e.teacherId === s.userId && e.day === dayName)
      .filter((e) => !db.substitutions.some((sub) => sub.timetableEntryId === e.id && sub.date === dateKey));
  }

  useEffect(() => {
    const initial = {};
    staffList.forEach((s) => {
      initial[s.id] = {};
      periodsFor(s).forEach((period) => {
        const existing = db.staffAttendance.find((a) => a.staffId === s.id && a.date === dateKey && (a.period || "FULL_DAY") === period);
        initial[s.id][period] = { status: existing?.status || "Present", arrivalTime: existing?.arrivalTime || "" };
      });
    });
    setDraft(initial);
    setSelectedGroup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  function setStatus(id, period, status) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [period]: { status, arrivalTime: status === "Late" ? (d[id]?.[period]?.arrivalTime || "") : "" } } }));
  }
  function setArrival(id, period, val) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [period]: { ...d[id]?.[period], arrivalTime: val } } }));
  }
  function markAll(status, groupItems) {
    const next = { ...draft };
    groupItems.forEach((s) => {
      if (!data.canEditStaffAttendanceFor(s, auth.currentUser)) return;
      next[s.id] = { ...draft[s.id] };
      periodsFor(s).forEach((period) => {
        next[s.id][period] = { status, arrivalTime: status === "Late" ? (draft[s.id]?.[period]?.arrivalTime || "") : "" };
      });
    });
    setDraft(next);
  }
  function save(groupItems) {
    const editableStaff = groupItems.filter((s) => data.canEditStaffAttendanceFor(s, auth.currentUser));
    const records = [];
    editableStaff.forEach((s) => {
      periodsFor(s).forEach((period) => {
        records.push({ staffId: s.id, period, status: draft[s.id]?.[period]?.status || "Present", arrivalTime: draft[s.id]?.[period]?.arrivalTime || "" });
      });
    });
    data.saveStaffAttendance(dateKey, records, auth.currentUser.id);
    toast(`Staff attendance saved for ${dateKeyLabel(dateKey)}.`, "success");
  }
  function roleSubtext(s) {
    if (s.position !== "Teacher") return s.position;
    const headOf = db.classes.find((c) => c.headTeacherId === s.userId);
    return headOf ? `Teacher · ${headOf.grade}${headOf.section} Head Teacher` : "Teacher";
  }

  const groups = data.staffAttendanceGroupsFor(auth.currentUser)
    .map((label) => ({ label, items: staffList.filter((s) => staffGroupLabel(s.position) === label) }))
    .filter((g) => g.items.length > 0);
  const visibleStaffIds = new Set(groups.flatMap((g) => g.items.map((s) => s.id)));
  const dayRecords = db.staffAttendance.filter((a) => a.date === dateKey && visibleStaffIds.has(a.staffId));
  const dayCounts = ATTENDANCE_STATUSES.map((status) => ({ status, n: dayRecords.filter((r) => r.status === status).length }));

  function groupStats(g) {
    const records = db.staffAttendance.filter((a) => a.date === dateKey && g.items.some((s) => s.id === a.staffId));
    const countOf = (st) => records.filter((r) => r.status === st).length;
    const other = ["Sick", "Permission", "Excused"].map((st) => ({ st, n: countOf(st) })).filter((x) => x.n > 0);
    const canEdit = g.items.some((s) => data.canEditStaffAttendanceFor(s, auth.currentUser));
    const latestRecord = records.reduce((latest, r) => (!latest || (r.markedAt || 0) > (latest.markedAt || 0)) ? r : latest, null);
    return { present: countOf("Present"), late: countOf("Late"), absent: countOf("Absent"), other, recorded: records.length > 0, canEdit, latestRecord };
  }

  const activeGroup = selectedGroup ? groups.find((g) => g.label === selectedGroup) : null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">{isEducationalDirector ? "Teachers Attendance" : "Staff Attendance"}</h1>
      <p className="text-sm text-slate-400 mb-3">
        {isEducationalDirector
          ? "Record attendance for Teachers."
          : auth.currentUser?.role === ROLES.OWNER
            ? "Record attendance for Directors, Teachers, and other staff."
            : "Record attendance for other staff."}
      </p>
      <DateNav date={dateKey} onChange={setDateKey} maxDate={todayKeyStr()} skipDates={(d) => data.classifyStaffAttendanceDay(d).phase === "closed"} />
      <AttendanceCalendarNotice classification={classification} />
      {dayEditable && <DayStatusBanner dateKey={dateKey} todayKey={todayKeyStr()} counts={dayCounts} />}
      {staffList.length === 0 ? <EmptyState icon={UserCog} title="No staff yet" description="Add staff first to record their attendance." /> : groups.length === 0 ? (
        <EmptyState icon={UserCog} title="No staff in your groups" description={
          isEducationalDirector ? "Add a teacher first to record their attendance."
            : auth.currentUser?.role === ROLES.OWNER ? "Add a director, teacher, or other staff member first to record their attendance."
              : "Add another staff member first to record their attendance."
        } />
      ) : !dayEditable ? null : activeGroup ? (
        <div>
          <button onClick={() => setSelectedGroup(null)} className="flex items-center gap-1 text-xs text-slate-500 font-medium mb-3 hover:text-slate-700">
            <ArrowLeft size={14} /> Back to {isEducationalDirector ? "Teachers Attendance" : "Staff Attendance"}
          </button>
          {(() => {
            const stats = groupStats(activeGroup);
            const canEditGroup = stats.canEdit;
            return (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <h2 className="text-sm font-semibold text-slate-700">{activeGroup.label} · {dateKeyLabel(dateKey)}</h2>
                  {stats.latestRecord && (
                    <p className="text-xs text-slate-400">Recorded by <span className="text-slate-600 font-medium">{data.userIdentity(stats.latestRecord.markedBy).display}</span>{stats.latestRecord.markedAt ? ` · ${fmtDate(stats.latestRecord.markedAt)} · ${fmtTime(stats.latestRecord.markedAt)}` : ""}</p>
                  )}
                </div>
                {canEditGroup && (
                  <Toolbar>
                    <GhostButton icon={Check} onClick={() => markAll("Present", activeGroup.items)}>Mark all present</GhostButton>
                  </Toolbar>
                )}
                <Card className="divide-y divide-slate-100">
                  {activeGroup.items.map((s) => {
                    const canEdit = data.canEditStaffAttendanceFor(s, auth.currentUser);
                    const affected = affectedPeriodsFor(s);
                    return (
                      <div key={s.id} className="px-4 py-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={s.name} photo={s.photo} size={32} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-700 truncate">{s.name}</p>
                              <p className="text-xs text-slate-400">{roleSubtext(s)}</p>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            {periodsFor(s).map((period) => (
                              <div key={period} className="flex flex-wrap items-center gap-2">
                                {STAFF_SHIFT_PERIOD_LABEL[period] && <span className="text-xs text-slate-400 w-16">{STAFF_SHIFT_PERIOD_LABEL[period]}</span>}
                                {canEdit ? (
                                  <>
                                    <AttendanceStatusPicker value={draft[s.id]?.[period]?.status} onChange={(st) => setStatus(s.id, period, st)} />
                                    {draft[s.id]?.[period]?.status === "Late" && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-slate-400">Arrived</span>
                                        <input type="time" value={draft[s.id]?.[period]?.arrivalTime || ""} onChange={(e) => setArrival(s.id, period, e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <Badge tone={statusTone(draft[s.id]?.[period]?.status)}>{draft[s.id]?.[period]?.status || "Not marked"}{draft[s.id]?.[period]?.status === "Late" && draft[s.id]?.[period]?.arrivalTime ? ` · ${to12Hour(draft[s.id][period].arrivalTime)}` : ""}</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        {affected.length > 0 && (
                          <div className="mt-2.5 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                            <p className="text-xs font-medium text-amber-800 mb-1.5">{affected.length} period{affected.length === 1 ? "" : "s"} today need coverage</p>
                            <div className="space-y-1">
                              {affected.map((e) => {
                                const cls = db.classes.find((c) => c.id === e.classId);
                                return (
                                  <div key={e.id} className="flex items-center justify-between gap-2 text-xs text-amber-700">
                                    <span>Period {e.period} • {e.subject} • {cls ? data.classLabel(cls) : ""}</span>
                                    <button onClick={() => setSubEntry(e)} className="text-sky-600 font-medium hover:underline shrink-0">Assign Substitute</button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Card>
                {canEditGroup && <div className="mt-4 flex justify-end"><PrimaryButton icon={Check} onClick={() => save(activeGroup.items)}>Save Attendance</PrimaryButton></div>}
              </>
            );
          })()}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Group</th>
                  <th className="text-left font-medium px-3 py-2.5">Present</th>
                  <th className="text-left font-medium px-3 py-2.5">Late</th>
                  <th className="text-left font-medium px-3 py-2.5">Absent</th>
                  <th className="text-right font-medium px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const stats = groupStats(g);
                  const actionLabel = !stats.canEdit ? "View" : stats.recorded ? "View & Edit" : "Take Attendance";
                  return (
                    <tr key={g.label} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-700">{g.label}</p>
                        <p className="text-xs text-slate-400">
                          {g.items.length} {g.items.length === 1 ? "person" : "people"}
                          {stats.other.length > 0 ? ` · ${stats.other.map((x) => `${x.n} ${x.st}`).join(" · ")}` : ""}
                        </p>
                        {stats.latestRecord && <p className="text-[11px] text-slate-400 mt-0.5">Recorded by {data.userIdentity(stats.latestRecord.markedBy).display}</p>}
                      </td>
                      <td className="px-3 py-3">{stats.recorded ? <span className="text-emerald-700 font-medium">{stats.present}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3">{stats.recorded ? <span className="text-amber-700 font-medium">{stats.late}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3">{stats.recorded ? <span className="text-rose-700 font-medium">{stats.absent}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelectedGroup(g.label)}
                          className={stats.canEdit ? "text-xs text-white font-medium bg-sky-600 rounded-lg px-3 py-1.5 hover:bg-sky-700" : "text-xs text-slate-500 font-medium border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50"}
                        >
                          {actionLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <AssignSubstituteModal open={!!subEntry} entry={subEntry} onClose={() => setSubEntry(null)} />
    </div>
  );
}

// Reusable "request my own leave" form — used by teachers (TeacherPages.StaffLeaveRequestPage)
// and by the Educational Director's "My Requests" tab below. Where the request routes for
// approval (Owner-only vs Owner-or-ED) is derived from the requester's staff position, not
// chosen here — see canDecideLeaveRequest in DataContext.
function StaffLeaveRequestForm({ staffId, requestedBy, onSubmitted }) {
  const data = useData();
  const toast = useToast();
  const [form, setForm] = useState({ status: "Sick", fromDate: todayKeyStr(), toDate: todayKeyStr(), note: "" });
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit() {
    if (form.fromDate > form.toDate) { toast("The start date must be before the end date.", "error"); return; }
    data.createLeaveRequest({ kind: "STAFF", subjectId: staffId, requestedBy, status: form.status, fromDate: form.fromDate, toDate: form.toDate, note: form.note });
    toast("Leave request submitted.", "success");
    setForm({ status: "Sick", fromDate: todayKeyStr(), toDate: todayKeyStr(), note: "" });
    onSubmitted && onSubmitted();
  }
  return (
    <Card className="p-4 mb-5">
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label="Reason" required>
          <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
            {LEAVE_REQUEST_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <div />
        <Field label="From" required><input type="date" className={inputCls} value={form.fromDate} onChange={(e) => set("fromDate", e.target.value)} /></Field>
        <Field label="To" required><input type="date" className={inputCls} value={form.toDate} onChange={(e) => set("toDate", e.target.value)} /></Field>
      </div>
      <Field label="Note"><textarea className={inputCls} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional details for whoever decides this" /></Field>
      <div className="flex justify-end"><PrimaryButton icon={Check} onClick={submit}>Submit Request</PrimaryButton></div>
    </Card>
  );
}

// The Owner sits above everyone else, so their own leave has no approver — this just logs it and
// notifies the Educational Director for transparency. See data.logOwnerLeave.
function OwnerLeavePanel() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const log = data.db.ownerLeaveLog || [];
  const [form, setForm] = useState({ status: "Sick", fromDate: todayKeyStr(), toDate: todayKeyStr(), note: "" });
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit() {
    if (form.fromDate > form.toDate) { toast("The start date must be before the end date.", "error"); return; }
    data.logOwnerLeave(form, auth.currentUser.id);
    toast("Leave logged — the Educational Director has been notified.", "success");
    setForm({ status: "Sick", fromDate: todayKeyStr(), toDate: todayKeyStr(), note: "" });
  }
  return (
    <div>
      <p className="text-sm text-slate-400 mb-4">As Owner, your leave doesn't need approval — this just lets the Educational Director know you'll be away.</p>
      <Card className="p-4 mb-5">
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Reason" required>
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {LEAVE_REQUEST_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <div />
          <Field label="From" required><input type="date" className={inputCls} value={form.fromDate} onChange={(e) => set("fromDate", e.target.value)} /></Field>
          <Field label="To" required><input type="date" className={inputCls} value={form.toDate} onChange={(e) => set("toDate", e.target.value)} /></Field>
        </div>
        <Field label="Note"><textarea className={inputCls} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional details" /></Field>
        <div className="flex justify-end"><PrimaryButton icon={Check} onClick={submit}>Log Leave</PrimaryButton></div>
      </Card>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your leave history</p>
      {log.length === 0 ? <EmptyState title="No leave logged yet" /> : (
        <Card className="divide-y divide-slate-100">
          {log.map((r) => (
            <div key={r.id} className="px-4 py-2.5 text-sm">
              <span className="text-slate-600">{r.status} · {fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</span>
              {r.note && <p className="text-xs text-slate-400 mt-0.5">{r.note}</p>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// Owner/Educational Director approval queue for both student and staff leave requests, plus each
// role's own self-service leave submission (Owner → OwnerLeavePanel, ED → StaffLeaveRequestForm).
// Approving auto-applies the request's status to every school day in range via
// data.decideLeaveRequest — see that function for how weekends/holidays/closures are skipped.
// Pending/decided lists are filtered through canDecideLeaveRequest so an ED never sees another
// Director's leave here — only the Owner can act on (or see) Directors-group requests.
function LeaveApprovalsPage() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const role = auth.currentUser.role;
  const [section, setSection] = useState("approvals"); // "approvals" | "mine"
  const [tab, setTab] = useState(role === ROLES.FINANCE ? "STAFF" : "STUDENT");
  const [rejectTarget, setRejectTarget] = useState(null);

  const pendingStudent = data.pendingLeaveRequests("STUDENT").filter((r) => data.canDecideLeaveRequest(r, auth.currentUser));
  const pendingStaff = data.pendingLeaveRequests("STAFF").filter((r) => data.canDecideLeaveRequest(r, auth.currentUser));
  const pending = tab === "STUDENT" ? pendingStudent : pendingStaff;
  const decided = [...db.leaveRequests]
    .filter((r) => r.kind === tab && r.approvalStatus !== "PENDING" && data.canDecideLeaveRequest(r, auth.currentUser))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);

  function subjectName(r) { return data.leaveSubjectIdentity(r.kind, r.subjectId); }
  function requesterName(r) { return data.userIdentity(r.requestedBy).display; }
  function decide(id, approvalStatus) {
    data.decideLeaveRequest(id, approvalStatus, auth.currentUser.id);
    toast(`Leave request ${approvalStatus === "APPROVED" ? "approved" : "rejected"}.`, approvalStatus === "APPROVED" ? "success" : "info");
  }
  function confirmReject(reason) {
    data.decideLeaveRequest(rejectTarget.id, "REJECTED", auth.currentUser.id, reason);
    toast("Leave request rejected.", "info");
    setRejectTarget(null);
  }

  const myStaffRec = (role === ROLES.ADMIN || role === ROLES.FINANCE) ? db.staff.find((s) => s.userId === auth.currentUser.id) : null;
  const myRequests = myStaffRec ? data.leaveRequestsFor("STAFF", myStaffRec.id) : [];

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Leave & Permission Requests</h1>
      <p className="text-sm text-slate-400 mb-4">Approve or reject leave requests. Approving marks every school day in the date range automatically — weekends and non-school days are skipped.</p>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setSection("approvals")} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border ${section === "approvals" ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>Approvals</button>
        <button onClick={() => setSection("mine")} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border ${section === "mine" ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{role === ROLES.OWNER ? "My Leave" : "My Requests"}</button>
      </div>

      {section === "mine" ? (
        role === ROLES.OWNER ? <OwnerLeavePanel /> : (
          <div>
            <p className="text-sm text-slate-400 mb-4">Request your own leave — the Owner reviews it, and once approved it's applied to your attendance automatically.</p>
            {myStaffRec ? (
              <>
                <StaffLeaveRequestForm staffId={myStaffRec.id} requestedBy={auth.currentUser.id} />
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your requests</p>
                <LeaveRequestHistoryList requests={myRequests} />
              </>
            ) : (
              <EmptyState icon={ShieldAlert} title="No staff record found" description="Ask the Owner to add you to staff before requesting leave." />
            )}
          </div>
        )
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {role !== ROLES.FINANCE && (
              <button onClick={() => setTab("STUDENT")} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border ${tab === "STUDENT" ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>Student Requests{pendingStudent.length > 0 ? ` (${pendingStudent.length})` : ""}</button>
            )}
            <button onClick={() => setTab("STAFF")} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border ${tab === "STAFF" ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>Staff Requests{pendingStaff.length > 0 ? ` (${pendingStaff.length})` : ""}</button>
          </div>

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pending</p>
          {pending.length === 0 ? <EmptyState title="No pending requests" /> : (
            <Card className="divide-y divide-slate-100 mb-5">
              {pending.map((r) => (
                <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{subjectName(r)}</p>
                    <p className="text-xs text-slate-400">{r.status} · {leaveDurationLabel(r.fromDate, r.toDate)} · {fmtDate(r.fromDate)} – {fmtDate(r.toDate)} · requested by {requesterName(r)}</p>
                    {r.note && <p className="text-xs text-slate-400 mt-0.5">{r.note}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setRejectTarget(r)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"><X size={13} /> Reject</button>
                    <PrimaryButton icon={Check} onClick={() => decide(r.id, "APPROVED")}>Approve</PrimaryButton>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recently decided</p>
          {decided.length === 0 ? <p className="text-xs text-slate-300">None yet.</p> : (
            <Card className="divide-y divide-slate-100">
              {decided.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="text-slate-600">{subjectName(r)}</span>
                    <span className="text-xs text-slate-400 ml-2">{r.status} · {leaveDurationLabel(r.fromDate, r.toDate)} · {fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</span>
                    {r.approvalStatus === "REJECTED" && r.rejectionReason && <p className="text-xs text-red-500 mt-0.5">Reason: {r.rejectionReason}</p>}
                  </div>
                  <Badge tone={r.approvalStatus === "APPROVED" ? "green" : "red"}>{r.approvalStatus === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
      <RejectLeaveModal request={rejectTarget} onClose={() => setRejectTarget(null)} onConfirm={confirmReject} />
    </div>
  );
}

function HomeworkAdminPage({ focus, clearFocus }) {
  const data = useData();
  const { db } = data;
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null); // homework | null

  // Deep-link from a Recent Activity item — open the exact homework that was published.
  useEffect(() => {
    if (!focus?.homeworkId) return;
    const hw = db.homework.find((h) => h.id === focus.homeworkId);
    if (hw) setOpen(hw);
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const classOptions = [...db.classes].sort(gradeSectionCompare).map((c) => data.classLabel(c));
  const subjectOptions = db.subjects.map((s) => s.name);
  const teacherIdsWithHomework = new Set(db.homework.map((h) => h.teacherId));
  const teacherOptions = db.users.filter((u) => teacherIdsWithHomework.has(u.id)).map((u) => u.name).sort();

  const filtered = [...db.homework].filter((h) => {
    if (classFilter && `${h.grade}${h.section}` !== classFilter) return false;
    if (subjectFilter && h.subject !== subjectFilter) return false;
    if (teacherFilter && data.getUser(h.teacherId)?.name !== teacherFilter) return false;
    if (q.trim() && !h.title.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.createdAt - a.createdAt);

  const summary = homeworkSummary(db.homework);
  const openTeacher = open ? data.getUser(open.teacherId) : null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Homework</h1>
      <p className="text-sm text-slate-400 mb-4">Track, assign, and manage homework across the school.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Published Today" value={summary.publishedToday} icon={ClipboardList} tone="sky" />
        <StatCard label="Due Soon" value={summary.dueSoon} icon={CalendarDays} tone="amber" />
        <StatCard label="Overdue" value={summary.overdue} icon={AlertTriangle} tone="red" />
        <StatCard label="Total Published" value={summary.total} icon={CheckCircle2} tone="indigo" />
      </div>

      <Toolbar>
        <Select value={classFilter} onChange={setClassFilter} options={classOptions} placeholder="All Classes" />
        <Select value={subjectFilter} onChange={setSubjectFilter} options={subjectOptions} placeholder="All Subjects" />
        <Select value={teacherFilter} onChange={setTeacherFilter} options={teacherOptions} placeholder="All Teachers" />
        <SearchInput value={q} onChange={setQ} placeholder="Search homework..." />
      </Toolbar>

      <HomeworkList
        list={filtered}
        getTeacherName={(h) => data.getUser(h.teacherId)?.name}
        onOpen={setOpen}
        emptyTitle={db.homework.length === 0 ? "No homework yet" : "No homework matches these filters"}
        emptyDescription={db.homework.length === 0 ? "Homework created by teachers will appear here." : "Try clearing a filter or search term."}
      />

      <HomeworkDetailsModal homework={open} teacherName={openTeacher?.name} classLabel={open ? `${open.grade}${open.section}` : ""} onClose={() => setOpen(null)} />
    </div>
  );
}

function ResultsPage({ role, focus, clearFocus }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [selected, setSelected] = useState(null); // { classId, subject, semester } | null
  const [semester, setSemester] = useState(SEMESTERS[0]);

  const isStaff = role === ROLES.OWNER || role === ROLES.ADMIN;
  // Subject-level ownership (teacherAssignments), not headTeacherId — a head teacher doesn't
  // automatically gain access to every subject in their class, only the ones they're assigned.
  const browsableClasses = isStaff
    ? db.classes
    : db.classes.filter((c) => db.teacherAssignments.some((ta) => ta.classId === c.id && ta.teacherId === auth.currentUser.id));
  const [classTab, setClassTab] = useState(browsableClasses[0]?.id || null);
  const cls = db.classes.find((c) => c.id === classTab) || browsableClasses[0] || null;

  // Deep-link from a Recent Activity item — jump straight into the class/subject/semester editor.
  useEffect(() => {
    if (!focus?.classId) return;
    setClassTab(focus.classId);
    if (focus.subject && focus.semester) setSelected({ classId: focus.classId, subject: focus.subject, semester: focus.semester });
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selected) {
    return (
      <SubjectSemesterResultsEditor
        classId={selected.classId}
        subject={selected.subject}
        semester={selected.semester}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (!isStaff && browsableClasses.length === 0) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Results</h1>
        <p className="text-sm text-slate-400 mb-4">You'll see Results once you're assigned to teach a subject in a class.</p>
        <EmptyState icon={ShieldAlert} title="No subjects assigned yet" description="Ask the school administrator to assign you a subject to teach, from the Teachers page." />
      </div>
    );
  }

  // Staff see every subject in the class's curriculum (even one with no teacher assigned yet —
  // it just shows as incomplete); a teacher only sees the subjects they're personally assigned
  // to teach in this class.
  const subjectsForClass = cls
    ? (isStaff
      ? data.requiredSubjectsForClass(cls.id)
      : [...new Set(db.teacherAssignments.filter((ta) => ta.classId === cls.id).map((ta) => ta.subject))]
        .filter((subject) => isAssignedSubjectTeacher(auth.currentUser, cls.id, subject, db.teacherAssignments)))
    : [];
  const studentsInClass = cls ? db.students.filter((s) => s.classId === cls.id) : [];

  const topPerformer = isStaff ? data.schoolTopPerformer(semester) : null;
  const topPerformerStudent = topPerformer ? data.getStudent(topPerformer.studentId) : null;
  const topPerformerClass = topPerformer ? data.getClass(topPerformer.classId) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Results</h1>
        {isStaff && <PrimaryButton icon={Megaphone} onClick={() => setAnnounceOpen(true)}>Announce Exam</PrimaryButton>}
      </div>
      <p className="text-sm text-slate-400 mb-4">
        {isStaff
          ? "The school administers exams on paper — this app only records results. Announce an upcoming exam to notify parents and teachers once it's scheduled."
          : "Enter Midterm, Student Book, and Final marks for each subject you teach, then publish so parents can see them."}
      </p>

      {!isStaff && !data.canTeacherPerformAcademicAction(auth.currentUser, todayKeyStr()) && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">
            You're marked {data.myAcademicActionStatusFor(auth.currentUser, todayKeyStr())?.status?.toLowerCase()} today — saving results is unavailable until this is corrected or a substitute is assigned.
          </p>
        </Card>
      )}

      {isStaff && (
        <Card className="p-4 mb-4">
          {topPerformerStudent ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-amber-50 flex items-center justify-center"><Trophy size={18} className="text-amber-500" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400">School Top Performer — {SEMESTER_LABEL[semester]}</p>
                <p className="text-sm font-semibold text-slate-800 truncate">{data.studentFullName(topPerformerStudent)} <span className="font-normal text-slate-400">· {topPerformerClass ? data.classLabel(topPerformerClass) : ""}</span></p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-slate-800">{topPerformer.average}%</p>
                <p className="text-xs text-slate-400">{topPerformer.rankLabel} Overall · Total {topPerformer.total}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No eligible top performer yet for {SEMESTER_LABEL[semester]} — results need to be complete for at least one student.</p>
          )}
        </Card>
      )}

      {isStaff && db.examAnnouncements.length > 0 && (
        <Card className="p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Recent Exam Announcements</h3>
          <div className="space-y-2">
            {[...db.examAnnouncements].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                <div><span className="font-medium text-slate-700">{a.title}</span><span className="text-slate-400"> — {a.audience.type === "ALL" ? "Whole school" : a.audience.type === "GRADE" ? a.audience.grade : `${a.audience.grade}${a.audience.section}`}</span></div>
                <span className="text-slate-400">{fmtDate(a.examDate)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {browsableClasses.length === 0 ? (
        <EmptyState icon={School} title="No classes yet" description="Add a class first." />
      ) : (
        <>
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            {browsableClasses.map((c) => (
              <button key={c.id} onClick={() => setClassTab(c.id)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border ${(cls && cls.id) === c.id ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
                {c.grade}{c.section}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 mb-4">
            {SEMESTERS.map((s) => (
              <button key={s} onClick={() => setSemester(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${semester === s ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>{SEMESTER_LABEL[s]}</button>
            ))}
          </div>

          {cls && subjectsForClass.length === 0 ? (
            isStaff
              ? <EmptyState title="This class doesn't have any subjects yet" description="Add subjects to this class from Classes → Edit Class." />
              : <EmptyState title="No subjects assigned to this class yet" description="Assign a teacher to a subject for this class first, from the Teachers page." />
          ) : cls && isStaff ? (
            <ResultsGridOverview classId={cls.id} semester={semester} onOpenSubject={(subject) => setSelected({ classId: cls.id, subject, semester })} />
          ) : cls && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {subjectsForClass.map((subject) => {
                const records = db.results.filter((r) => r.classId === cls.id && r.subject === subject && r.semester === semester);
                const recorded = records.filter((r) => resultTotals(r).count > 0).length;
                return (
                  <button key={subject} onClick={() => setSelected({ classId: cls.id, subject, semester })} className="text-left">
                    <Card className="p-4 hover:border-sky-300 transition-colors h-full">
                      <p className="text-sm font-medium text-slate-700 mb-1">{subject}</p>
                      <p className="text-xs text-slate-400">{recorded}/{studentsInClass.length} students have a result</p>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {isStaff && <AnnounceExamModal open={announceOpen} onClose={() => setAnnounceOpen(false)} />}
    </div>
  );
}

// The Owner/Director overview: every subject taught in the class as a column, so results can be
// scanned across a whole class at a glance instead of clicking into one subject at a time.
// Clicking a subject's header opens the full 20/20/10/50 entry screen for it. Total/Average/Rank
// and the summary strip all come from the shared resultsEngine (via data.classSemesterResults) so
// this never disagrees with Student Profile's Class Rank or any other consumer of the same numbers.
function ResultsGridOverview({ classId, semester, onOpenSubject }) {
  const data = useData();
  const { subjects, rows, studentsTotal, studentsAllComplete, classAverage, topStudents, subjectAverages } = data.classSemesterResults(classId, semester);
  const topStudent = topStudents[0] || null;
  const topStudentUser = topStudent ? data.getStudent(topStudent.studentId) : null;

  return (
    <>
      <Card className="p-4 mb-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Students</p>
            <p className="font-semibold text-slate-800">{studentsTotal}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Results Entered</p>
            <p className="font-semibold text-slate-800">{studentsAllComplete}/{studentsTotal} complete</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Class Average</p>
            <p className="font-semibold text-slate-800">{classAverage != null ? `${classAverage}%` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Top Student</p>
            {topStudentUser ? (
              <p className="font-semibold text-slate-800 truncate">{data.studentFullName(topStudentUser)} <span className="text-xs font-normal text-slate-400">· {topStudent.rankLabel} · {topStudent.average}%</span></p>
            ) : <p className="text-slate-300">—</p>}
          </div>
        </div>
        {subjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-100">
            {subjects.map((subject) => (
              <span key={subject} className="text-xs bg-slate-50 text-slate-500 rounded-full px-2.5 py-1 whitespace-nowrap">
                {subject}: <span className="font-medium text-slate-700">{subjectAverages[subject] != null ? `${subjectAverages[subject]}%` : "—"}</span>
              </span>
            ))}
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left font-medium px-3 py-2.5 w-10">#</th>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Student</th>
                {subjects.map((subject) => (
                  <th key={subject} className="text-left font-medium px-3 py-2.5">
                    <button onClick={() => onOpenSubject(subject)} className="hover:text-sky-600 whitespace-nowrap">{subject}</button>
                  </th>
                ))}
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Total</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Average</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Rank</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={subjects.length + 5} className="px-4 py-6 text-center text-slate-400 text-sm">No students in this class.</td></tr>
              ) : rows.map((r, i) => {
                const s = data.getStudent(r.studentId);
                return (
                  <tr key={r.studentId} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{s ? data.studentFullName(s) : "—"}</td>
                    {subjects.map((subject) => (
                      <td key={subject} className="px-3 py-2 text-slate-600">{r.bySubject[subject] != null ? `${r.bySubject[subject]}%` : <span className="text-slate-300">—</span>}</td>
                    ))}
                    <td className="px-3 py-2 text-slate-600">{r.total != null ? r.total : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{r.average != null ? `${r.average}%` : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{rankBadge(r.rank, r.rankLabel)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function rankBadge(rank, rankLabel) {
  if (rank === 1) return <span>🥇 {rankLabel}</span>;
  if (rank === 2) return <span>🥈 {rankLabel}</span>;
  if (rank === 3) return <span>🥉 {rankLabel}</span>;
  return <span className={rank ? "" : "text-slate-300"}>{rankLabel}</span>;
}

function AnnounceExamModal({ open, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const empty = { title: "Midterm Exams", audienceType: "GRADE", grade: "Grade 1", section: "A", date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), message: "", priority: "Important" };
  const [form, setForm] = useState(empty);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!form.title.trim()) { toast("Please give the exam a name.", "error"); return; }
    let audience = { type: form.audienceType };
    if (form.audienceType === "GRADE") audience.grade = form.grade;
    if (form.audienceType === "SECTION") { audience.grade = form.grade; audience.section = form.section; }
    const message = form.message.trim() || `${form.title} is coming up. Please make sure your child is prepared.`;
    data.announceExam({ title: form.title, audience, date: form.date, message, priority: form.priority }, auth.currentUser.id);
    toast("Exam announced to parents and the head teacher.", "success");
    setForm(empty); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="Announce Exam" wide>
      <div>
        <Field label="Exam name" required><input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Midterm Exams" /></Field>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Audience">
            <select className={inputCls} value={form.audienceType} onChange={(e) => set("audienceType", e.target.value)}>
              <option value="ALL">Whole school</option>
              <option value="GRADE">One grade</option>
              <option value="SECTION">One section</option>
            </select>
          </Field>
          <Field label="Date" required><input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
        </div>
        {(form.audienceType === "GRADE" || form.audienceType === "SECTION") && (
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Grade"><select className={inputCls} value={form.grade} onChange={(e) => set("grade", e.target.value)}>{data.gradeOptions().map((g) => <option key={g}>{g}</option>)}</select></Field>
            {form.audienceType === "SECTION" && <Field label="Section"><select className={inputCls} value={form.section} onChange={(e) => set("section", e.target.value)}>{SECTIONS.map((s) => <option key={s || "none"} value={s}>{sectionLabel(s)}</option>)}</select></Field>}
          </div>
        )}
        <Field label="Message"><textarea className={inputCls} rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder={`${form.title} is coming up. Please make sure your child is prepared.`} /></Field>
        <Field label="Priority"><select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}><option>Normal</option><option>Important</option><option>Urgent</option></select></Field>
        <p className="text-xs text-slate-400 mb-3">This notifies matching parents immediately, and appears on their dashboard until the exam date. The class's head teacher is also notified to enter results once it's complete.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Megaphone}>Announce Exam</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function SubjectSemesterResultsEditor({ classId, subject, semester, onBack }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const cls = data.getClass(classId);
  const students = db.students.filter((s) => s.classId === classId);
  const [selectedIds, setSelectedIds] = useState([]);
  const [historyFor, setHistoryFor] = useState(null); // studentId | null
  const [docViewer, setDocViewer] = useState(null); // { title, files, initialIndex } | null
  const [cameraChooserFor, setCameraChooserFor] = useState(null); // { studentId, component } | null
  const [unlockTarget, setUnlockTarget] = useState(null); // { mode: "manual"|"auto", record, studentId, lockMessage } | null
  // Score edits are kept as a local, unsaved draft (`studentId::component` -> raw input string)
  // instead of writing on every keystroke or blur — nothing reaches saveResultComponent until the
  // teacher explicitly clicks Save, and Save is blocked while any edited score is out of range.
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);

  const ctx = { classId, subject, teacherAssignments: db.teacherAssignments };

  function recordFor(studentId) {
    return data.getResult(studentId, classId, subject, semester);
  }
  function draftKey(studentId, component) { return `${studentId}::${component}`; }
  function savedScoreStr(studentId, component) {
    const score = recordFor(studentId)?.components?.[component]?.score;
    return score != null ? String(score) : "";
  }
  function scoreValue(studentId, component) {
    const key = draftKey(studentId, component);
    return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : savedScoreStr(studentId, component);
  }
  function isScoreDirty(studentId, component) {
    const key = draftKey(studentId, component);
    return Object.prototype.hasOwnProperty.call(drafts, key) && drafts[key] !== savedScoreStr(studentId, component);
  }
  function scoreError(studentId, component) {
    const val = scoreValue(studentId, component);
    if (val === "") return null;
    const max = ASSESSMENT_COMPONENT_WEIGHT[component];
    const num = Number(val);
    if (Number.isNaN(num)) return `Enter a number from 0 to ${max}.`;
    if (num < 0 || num > max) return `Maximum score is ${max}. Enter a score from 0 to ${max}.`;
    return null;
  }
  function setDraftScore(studentId, component, value) {
    setDrafts((d) => ({ ...d, [draftKey(studentId, component)]: value }));
  }
  const dirtyKeys = Object.keys(drafts).filter((key) => { const [sid, c] = key.split("::"); return isScoreDirty(sid, c); });
  const invalidKey = dirtyKeys.find((key) => { const [sid, c] = key.split("::"); return !!scoreError(sid, c); });
  function saveAllScores() {
    if (dirtyKeys.length === 0) return;
    if (invalidKey) {
      const [sid, c] = invalidKey.split("::");
      const student = students.find((s) => s.id === sid);
      toast(`${data.studentFullName(student)}'s ${ASSESSMENT_COMPONENT_LABEL[c]} score is invalid — ${scoreError(sid, c)}`, "error");
      return;
    }
    setSaving(true);
    const savedKeys = [];
    let firstError = null;
    dirtyKeys.forEach((key) => {
      const [sid, c] = key.split("::");
      const val = drafts[key];
      const res = data.saveResultComponent({ studentId: sid, classId, subject, semester, component: c, score: val === "" ? null : Number(val) }, auth.realUser.id, auth.realUser.role);
      if (res.ok) savedKeys.push(key);
      else if (!firstError) firstError = res.message;
    });
    setSaving(false);
    setDrafts((d) => { const next = { ...d }; savedKeys.forEach((k) => delete next[k]); return next; });
    if (firstError) toast(firstError, "error");
    else toast("Results saved.", "success");
  }
  async function uploadEvidencePages(studentId, component, fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    let added = 0;
    let firstError = null;
    for (const file of files) {
      const dataUrl = await readFileAsDataURL(file);
      const res = data.addResultEvidencePage({ studentId, classId, subject, semester, component, fileDataUrl: dataUrl, fileType: inferFileType(dataUrl), fileName: file.name }, auth.realUser.id, auth.realUser.role);
      if (res.ok) added += 1; else if (!firstError) firstError = res.message;
    }
    if (added > 0) toast(`${added} evidence page${added === 1 ? "" : "s"} attached.`, "success");
    if (firstError) toast(firstError, "error");
  }
  function removeEvidencePage(evidenceId) {
    const res = data.removeResultEvidencePage(evidenceId, auth.realUser.id, auth.realUser.role);
    if (!res.ok) toast(res.message, "error");
  }
  function reorderPage(record, component, pages, fromIdx, toIdx) {
    const ids = pages.map((p) => p.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    data.reorderResultEvidencePages(record.id, component, ids, auth.realUser.id, auth.realUser.role);
  }
  function toggleShare(studentId, component, current) {
    data.saveResultComponent({ studentId, classId, subject, semester, component, sharedWithParents: !current }, auth.realUser.id, auth.realUser.role);
  }
  function toggleSelect(studentId) {
    setSelectedIds((ids) => (ids.includes(studentId) ? ids.filter((id) => id !== studentId) : [...ids, studentId]));
  }
  const selectableIds = students.filter((s) => recordFor(s.id)?.publishStatus !== "LOCKED").map((s) => s.id);
  function publishSelected() {
    if (selectedIds.length === 0) { toast("Select at least one student to publish.", "error"); return; }
    if (dirtyKeys.length > 0) { toast("You have unsaved score changes — click Save before publishing.", "error"); return; }
    const res = data.publishResults(classId, subject, semester, selectedIds, auth.realUser.id, auth.realUser.role);
    toast(res.ok ? "Results published — parents have been notified." : res.message, res.ok ? "success" : "error");
    if (res.ok) setSelectedIds([]);
  }
  function requestLock(record) {
    const res = data.lockResult(record.id, auth.realUser.id, auth.realUser.role);
    toast(res.ok ? "Result locked." : res.message, res.ok ? "success" : "error");
  }
  function requestUnlock(record, studentId, rowLock) {
    setUnlockTarget({ mode: rowLock.source === "manual" ? "manual" : "auto", record, studentId, lockMessage: rowLock.message });
  }
  function confirmUnlock(reason) {
    if (!unlockTarget) return;
    const { mode, record, studentId } = unlockTarget;
    const res = mode === "manual"
      ? data.unlockResult(record.id, auth.realUser.id, auth.realUser.role, reason)
      : data.overrideAutoLock({ studentId, classId, subject, semester }, auth.realUser.id, auth.realUser.role, reason);
    toast(res.ok ? "Result unlocked." : res.message, res.ok ? "success" : "error");
    setUnlockTarget(null);
  }
  function reLock(record) {
    const res = data.reinstateAutoLock(record.id, auth.realUser.id, auth.realUser.role);
    toast(res.ok ? "Result re-locked." : res.message, res.ok ? "success" : "error");
  }

  const canPublish = canPublishResult(auth.currentUser);
  const canLock = canLockResult(auth.currentUser);
  const canUnlock = canUnlockResult(auth.currentUser);
  const canAudit = canViewResultAudit(auth.currentUser, ctx);
  const historyRecord = historyFor ? recordFor(historyFor) : null;
  const semesterLock = data.semesterResultLockInfo(semester);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to Results</button>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-800">{subject}</h1>
          <Badge tone="sky">{SEMESTER_LABEL[semester]}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={dirtyKeys.length === 0 || !!invalidKey || saving} onClick={saveAllScores}
            className={`text-sm font-medium rounded-lg px-4 py-2 flex items-center gap-1.5 transition-colors ${dirtyKeys.length > 0 && !invalidKey ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}>
            <Check size={15} /> {saving ? "Saving…" : dirtyKeys.length > 0 ? `Save (${dirtyKeys.length} unsaved)` : "Save"}
          </button>
          {canPublish && <PrimaryButton icon={Send} onClick={publishSelected}>Publish selected ({selectedIds.length})</PrimaryButton>}
        </div>
      </div>
      <p className="text-sm text-slate-400 mb-4">{cls ? data.classLabel(cls) : ""} • Midterm 1 (20), Midterm 2 (20), Student Book (10), Final Exam (50) — total out of 100, calculated automatically.</p>

      <SemesterLockBanner lockInfo={semesterLock} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                {canPublish && (
                  <th className="px-4 py-2.5">
                    <input type="checkbox" checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length} onChange={(e) => setSelectedIds(e.target.checked ? selectableIds : [])} />
                  </th>
                )}
                <th className="text-left font-medium px-3 py-2.5 w-10">#</th>
                <th className="text-left font-medium px-4 py-2.5">Student</th>
                {ASSESSMENT_COMPONENTS.map((c) => (
                  <th key={c} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{ASSESSMENT_COMPONENT_LABEL[c]} ({ASSESSMENT_COMPONENT_WEIGHT[c]})</th>
                ))}
                <th className="text-left font-medium px-3 py-2.5">Total /100</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
                <th className="text-right font-medium px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const record = recordFor(s.id);
                const totals = resultTotals(record);
                const rowLock = data.resultLockFor(record, semester, record?.academicYearId);
                const canEdit = canEditResultComponent(auth.currentUser, ctx, record) && data.canTeacherPerformAcademicAction(auth.currentUser, todayKeyStr()) && !rowLock.locked;
                const locked = record?.publishStatus === "LOCKED";
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    {canPublish && (
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggleSelect(s.id)} disabled={locked} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{data.studentFullName(s)}</td>
                    {ASSESSMENT_COMPONENTS.map((c) => {
                      const comp = record?.components?.[c];
                      const err = canEdit ? scoreError(s.id, c) : null;
                      const pages = record ? data.resultEvidenceFor(record.id, c) : [];
                      return (
                        <td key={c} className="px-3 py-2 align-top">
                          <div className="flex items-start gap-1.5">
                            {canEdit ? (
                              <div className="flex flex-col">
                                <input type="number" min={0} max={ASSESSMENT_COMPONENT_WEIGHT[c]} step="0.1" value={scoreValue(s.id, c)} placeholder={`/${ASSESSMENT_COMPONENT_WEIGHT[c]}`}
                                  onChange={(e) => setDraftScore(s.id, c, e.target.value)}
                                  className={`w-14 rounded-lg border px-2 py-1 text-sm ${err ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200"}`} />
                                {err && <span className="text-[10px] text-red-600 mt-0.5 leading-tight max-w-[7rem]">{err}</span>}
                              </div>
                            ) : (
                              <span className={comp?.score != null ? "text-slate-700 font-medium" : "text-slate-300"}>{comp?.score != null ? comp.score : "—"}</span>
                            )}
                            <div className="flex flex-col gap-1">
                              {pages.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap max-w-[6.5rem]">
                                  {pages.map((p, idx) => (
                                    <div key={p.id} className="flex flex-col items-center">
                                      <button type="button" onClick={() => setDocViewer({ title: `${data.studentFullName(s)} — ${ASSESSMENT_COMPONENT_LABEL[c]}`, files: pages, initialIndex: idx })}>
                                        <img src={p.fileDataUrl} alt="" className="w-6 h-6 rounded object-cover border border-slate-200 hover:border-sky-400" />
                                      </button>
                                      {canEdit && (
                                        <div className="flex items-center gap-0.5">
                                          <button type="button" disabled={idx === 0} onClick={() => reorderPage(record, c, pages, idx, idx - 1)} className="text-[8px] leading-none text-slate-400 hover:text-slate-700 disabled:opacity-20">▲</button>
                                          <button type="button" disabled={idx === pages.length - 1} onClick={() => reorderPage(record, c, pages, idx, idx + 1)} className="text-[8px] leading-none text-slate-400 hover:text-slate-700 disabled:opacity-20">▼</button>
                                          <button type="button" onClick={() => removeEvidencePage(p.id)} className="text-red-500"><X size={9} /></button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                {canEdit && (
                                  <button type="button" onClick={() => setCameraChooserFor({ studentId: s.id, component: c })} className="text-slate-400 hover:text-sky-600" title="Add evidence page">
                                    <Camera size={14} />
                                  </button>
                                )}
                                {pages.length > 0 && canEdit && (
                                  <button onClick={() => toggleShare(s.id, c, comp?.sharedWithParents)} title="Toggle visibility to parent" className={`text-[9px] font-semibold px-1 py-0.5 rounded whitespace-nowrap ${comp?.sharedWithParents ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                                    {comp?.sharedWithParents ? "Shared" : "Share?"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-slate-600 font-medium">{totals.count > 0 ? totals.total : "—"}</td>
                    <td className="px-3 py-2"><Badge tone={record?.publishStatus === "LOCKED" ? "red" : record?.publishStatus === "PUBLISHED" ? "green" : "slate"}>{record?.publishStatus || "DRAFT"}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {canAudit && <GhostButton icon={History} onClick={() => setHistoryFor(s.id)}>History</GhostButton>}
                        {canLock && !rowLock.locked && rowLock.source === "none" && record?.publishStatus === "PUBLISHED" && (
                          <GhostButton icon={Lock} onClick={() => requestLock(record)}>Lock</GhostButton>
                        )}
                        {canUnlock && rowLock.locked && (rowLock.source === "manual" || rowLock.source === "auto") && (
                          <GhostButton danger icon={Lock} onClick={() => requestUnlock(record, s.id, rowLock)}>Unlock</GhostButton>
                        )}
                        {canLock && rowLock.source === "override" && record && (
                          <GhostButton icon={Lock} onClick={() => reLock(record)}>Re-lock</GhostButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-400 mt-3">Attach one or more photos of the marked paper to any component if you'd like — evidence is separate from the score, and the parent only sees it once you mark it as shared.</p>

      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title="Change History" wide>
        <ResultAuditTrail entries={historyRecord ? db.resultAuditLog.filter((e) => e.entityId === historyRecord.id) : []} viewerRole={auth.currentUser.role} />
      </Modal>
      <DocumentViewerModal open={!!docViewer} onClose={() => setDocViewer(null)} title={docViewer?.title} files={docViewer?.files} initialIndex={docViewer?.initialIndex} />
      <UnlockReasonModal open={!!unlockTarget} onClose={() => setUnlockTarget(null)} lockMessage={unlockTarget?.lockMessage} onConfirm={confirmUnlock} />
      <Modal open={!!cameraChooserFor} onClose={() => setCameraChooserFor(null)} title="Attach exam photo">
        <div className="space-y-2">
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
            <Camera size={18} className="text-sky-600" />
            <span className="text-sm font-medium text-slate-700">Take Photo</span>
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const target = cameraChooserFor; setCameraChooserFor(null); if (e.target.files[0] && target) uploadEvidencePages(target.studentId, target.component, e.target.files); }} />
          </label>
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
            <ImageIcon size={18} className="text-sky-600" />
            <span className="text-sm font-medium text-slate-700">Choose from Gallery</span>
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { const target = cameraChooserFor; setCameraChooserFor(null); if (e.target.files.length > 0 && target) uploadEvidencePages(target.studentId, target.component, e.target.files); }} />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function ReportCardsPage() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const [classId, setClassId] = useState(db.classes[0]?.id || null);
  const [viewCard, setViewCard] = useState(null);
  const [promotionFor, setPromotionFor] = useState(null); // student | null
  const students = db.students.filter((s) => s.classId === classId);

  function statusFor(studentId) { return data.getReportCard(studentId, classId)?.status || null; }

  function handleGenerate(studentId) {
    const res = data.generateReportCard(studentId, classId, auth.realUser.id);
    toast(res.ok ? "Report card generated." : res.message, res.ok ? "success" : "error");
  }
  function handlePublish(studentId) {
    const rc = data.getReportCard(studentId, classId);
    if (!rc) return;
    const res = data.publishReportCard(rc.id, auth.realUser.id);
    toast(res.ok ? "Report card published — the parent can now view it." : res.message, res.ok ? "success" : "error");
  }
  function handleLock(studentId) {
    const rc = data.getReportCard(studentId, classId);
    if (!rc) return;
    data.lockReportCard(rc.id, auth.realUser.id);
    toast("Report card locked. Results can no longer be edited.", "success");
  }
  function handleReopen(studentId) {
    const rc = data.getReportCard(studentId, classId);
    if (!rc) return;
    data.reopenReportCard(rc.id, auth.realUser.id);
    toast("Report card reopened for editing.", "info");
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Report Cards</h1>
      <p className="text-sm text-slate-400 mb-4">One report card per student per year — it becomes available once every subject's Semester 2 result is complete. Generate → set the promotion decision → Publish → Lock to prevent further changes.</p>
      {db.classes.length === 0 ? <EmptyState icon={School} title="No classes yet" /> : (
        <>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {db.classes.map((c) => (
              <button key={c.id} onClick={() => setClassId(c.id)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border ${classId === c.id ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{c.grade}{c.section}</button>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
                  <th className="text-left font-medium px-4 py-2.5 w-10">#</th>
                  <th className="text-left font-medium px-4 py-2.5">Student</th>
                  <th className="text-left font-medium px-4 py-2.5">Semester 2 Readiness</th>
                  <th className="text-left font-medium px-4 py-2.5">Promotion</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="text-right font-medium px-4 py-2.5">Actions</th>
                </tr></thead>
                <tbody>
                  {students.map((s, i) => {
                    const readiness = data.computeReportReadiness(s.id, classId);
                    const status = statusFor(s.id);
                    const rc = data.getReportCard(s.id, classId);
                    const promotionSet = rc && rc.promoted !== null && rc.promoted !== undefined;
                    return (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-2.5 text-slate-700 font-medium whitespace-nowrap">{data.studentFullName(s)}</td>
                        <td className="px-4 py-2.5"><Badge tone={readiness.complete ? "green" : "amber"}>{readiness.completedCount}/{readiness.requiredCount} subjects</Badge></td>
                        <td className="px-4 py-2.5">
                          {!rc ? <span className="text-slate-300 text-xs">—</span> : promotionSet ? <Badge tone={rc.promoted ? "green" : "slate"}>{rc.promoted ? "Promoted" : "Retained"}</Badge> : <Badge tone="amber">Not set</Badge>}
                        </td>
                        <td className="px-4 py-2.5"><Badge tone={status === "PUBLISHED" || status === "LOCKED" ? "green" : status === "GENERATED" ? "sky" : "slate"}>{status || "Not generated"}</Badge></td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1.5 justify-end">
                            {!status && (readiness.complete ? <GhostButton onClick={() => handleGenerate(s.id)}>Generate</GhostButton> : <span className="text-xs text-slate-300">Not ready</span>)}
                            {status === "GENERATED" && <>
                              <GhostButton onClick={() => setViewCard(s)}>Preview</GhostButton>
                              <GhostButton onClick={() => setPromotionFor(s)}>{promotionSet ? "Edit Promotion" : "Set Promotion"}</GhostButton>
                              {promotionSet && <GhostButton onClick={() => handlePublish(s.id)}>Publish</GhostButton>}
                            </>}
                            {status === "PUBLISHED" && <><GhostButton onClick={() => setViewCard(s)}>View</GhostButton><GhostButton onClick={() => handleLock(s.id)}>Lock</GhostButton></>}
                            {status === "LOCKED" && <><GhostButton onClick={() => setViewCard(s)}>View</GhostButton><GhostButton danger onClick={() => handleReopen(s.id)}>Reopen</GhostButton></>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <ReportCardModal student={viewCard} classId={classId} onClose={() => setViewCard(null)} />
      <PromotionModal student={promotionFor} classId={classId} onClose={() => setPromotionFor(null)} />
    </div>
  );
}

// Promotion is a manual decision by Owner/Director, not an automatic pass-mark — the Semester 2
// average is shown only as reference. Required before a report card can be published (see
// DataContext.publishReportCard), so it's never silently skipped.
function PromotionModal({ student, classId, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const rc = student ? data.getReportCard(student.id, classId) : null;
  const [promoted, setPromoted] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (rc) { setPromoted(rc.promoted !== false); setNote(rc.promotionNote || ""); }
  }, [rc?.id, student?.id]);

  if (!student || !rc) return null;
  const cls = data.getClass(classId);
  const readiness = data.computeReportReadiness(student.id, classId);
  const s2Pcts = readiness.required
    .map((subject) => resultTotals(data.db.results.find((r) => r.studentId === student.id && r.classId === classId && r.subject === subject && r.semester === "S2")).pct)
    .filter((pct) => pct !== null);
  const avg = s2Pcts.length ? Math.round(s2Pcts.reduce((a, b) => a + b, 0) / s2Pcts.length) : null;

  function save() {
    const res = data.setReportCardPromotion(rc.id, promoted, note, auth.realUser.id);
    toast(res.ok ? "Promotion decision saved." : res.message, res.ok ? "success" : "error");
    if (res.ok) onClose();
  }

  return (
    <Modal open={!!student} onClose={onClose} title={`Promotion — ${data.studentFullName(student)}`}>
      <p className="text-xs text-slate-400 mb-3">Semester 2 average: <span className="font-medium text-slate-600">{avg !== null ? `${avg}%` : "—"}</span> ({cls ? cls.grade : "current grade"}) — shown for reference only; the decision is yours.</p>
      <div className="flex gap-2 mb-3">
        <button type="button" onClick={() => setPromoted(true)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${promoted ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"}`}>Promoted</button>
        <button type="button" onClick={() => setPromoted(false)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${!promoted ? "bg-amber-600 text-white border-amber-600" : "bg-white text-slate-600 border-slate-200"}`}>Retained</button>
      </div>
      <Field label="Note (optional)"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to the parent on the report card." /></Field>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <PrimaryButton type="button" onClick={save} icon={Check}>Save</PrimaryButton>
      </div>
    </Modal>
  );
}

function BehaviorAdminPage({ onOpen }) {
  const data = useData();
  const { db } = data;
  const [typeF, setTypeF] = useState("");
  const [sevF, setSevF] = useState("");
  const filtered = [...db.behaviorRecords].filter((b) => (!typeF || b.type === typeF) && (!sevF || b.severity === sevF)).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Behavior &amp; Discipline</h1>
      <p className="text-sm text-slate-400 mb-4">All recorded behavior incidents and positive notes.</p>
      <Toolbar>
        <Select value={typeF} onChange={setTypeF} options={BEHAVIOR_TYPES} placeholder="All types" />
        <Select value={sevF} onChange={setSevF} options={SEVERITIES} placeholder="All severities" />
      </Toolbar>
      {filtered.length === 0 ? <EmptyState icon={AlertTriangle} title="No behavior records" description="Add a record from any student's profile." /> : (
        <Card className="divide-y divide-slate-100">
          {filtered.map((b) => {
            const s = data.getStudent(b.studentId);
            return (
              <button key={b.id} onClick={() => s && onOpen(s.id)} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1"><Badge tone={b.type === "Positive" ? "green" : b.severity === "High" ? "red" : "amber"}>{b.type}</Badge><span className="text-xs text-slate-400">{fmtDate(b.date)}</span></div>
                  <p className="text-sm font-medium text-slate-700">{s ? data.studentIdentity(s).display : "Unknown"}</p>
                  <p className="text-xs text-slate-400 truncate">{b.description}</p>
                </div>
                <ChevronRight size={16} className="text-slate-300 shrink-0" />
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function AnnouncementsPage({ role }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const now = Date.now();
  const visible = role === ROLES.ADMIN ? db.announcements : db.announcements.filter((a) => {
    const isAuthor = a.authorId === auth.currentUser.id;
    // Finance always sees what it published itself, even scheduled/expired or audiences (All
    // Parents/Grade/Section/All Teachers) it can't otherwise see as a plain recipient.
    if (isAuthor) return true;
    if (!isAnnouncementLive(a, now)) return false;
    if (a.audience.type === "ALL") return true;
    if (role === ROLES.PARENT && a.audience.type === "ALL_PARENTS") return true;
    if (role === ROLES.TEACHER && a.audience.type === "ALL_TEACHERS") return true;
    if (role === ROLES.FINANCE && a.audience.type === "DIRECTORS") return true;
    if (role === ROLES.PARENT) {
      if (a.audience.type === "GRADE") return (auth.currentUser.childIds || []).some((cid) => db.students.find((s) => s.id === cid)?.grade === a.audience.grade);
      if (a.audience.type === "SECTION") return (auth.currentUser.childIds || []).some((cid) => { const s = db.students.find((x) => x.id === cid); return s?.grade === a.audience.grade && s?.section === a.audience.section; });
    }
    if (a.audience.type === "USER" && a.audience.userId === auth.currentUser.id) return true;
    return false;
  });

  const canManage = role === ROLES.ADMIN || role === ROLES.FINANCE;
  function canPin(a) { return role === ROLES.ADMIN || a.authorId === auth.currentUser.id; }
  function isUnread(a) {
    return db.notifications.some((n) => n.userId === auth.currentUser.id && n.type === "ANNOUNCEMENT" && n.announcementId === a.id && !n.read);
  }
  function openAnnouncement(a) {
    const n = db.notifications.find((x) => x.userId === auth.currentUser.id && x.type === "ANNOUNCEMENT" && x.announcementId === a.id && !x.read);
    if (n) data.markNotificationRead(n.id);
    setDetail(a);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Announcements</h1>
        {canManage && <PrimaryButton onClick={() => setCreateOpen(true)}>New Announcement</PrimaryButton>}
      </div>
      <p className="text-sm text-slate-400 mb-4">School-wide and targeted announcements.</p>
      {visible.length === 0 ? <EmptyState icon={Megaphone} title="No announcements" description="Announcements from the school will appear here." /> : (
        <div className="space-y-3">
          {[...visible].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt).map((a) => {
            const unread = isUnread(a);
            const stats = canManage ? announcementReadStats(db, a.id) : null;
            return (
              <Card key={a.id} className={`p-0 overflow-hidden relative ${unread ? "ring-1 ring-sky-200" : ""}`}>
                {canPin(a) && (
                  <button
                    type="button" onClick={() => data.toggleAnnouncementPinned(a.id)}
                    title={a.pinned ? "Unpin" : "Pin to top"}
                    className={`absolute top-3 right-3 p-1.5 rounded-lg z-10 ${a.pinned ? "text-amber-500 bg-amber-50" : "text-slate-300 hover:text-slate-500 hover:bg-slate-100"}`}
                  >
                    {a.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                  </button>
                )}
                <button type="button" onClick={() => openAnnouncement(a)} className={`w-full text-left p-4 hover:bg-slate-50 ${unread ? "bg-sky-50/40" : ""}`}>
                  <div className="flex items-start justify-between gap-3 mb-1.5 pr-8">
                    <h3 className={`text-sm flex items-center gap-2 ${unread ? "font-semibold text-slate-800" : "font-semibold text-slate-700"}`}>
                      {unread && <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />}
                      {a.pinned && <Pin size={13} className="text-amber-500 shrink-0" />}
                      {a.title}
                    </h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.publishAt && a.publishAt > now && <Badge tone="indigo">Scheduled · {fmtDate(a.publishAt)}</Badge>}
                      {a.expiresAt && a.expiresAt < now && <Badge tone="slate">Expired · {fmtDate(a.expiresAt)}</Badge>}
                      <Badge tone={a.priority === "Urgent" ? "red" : a.priority === "Important" ? "amber" : "slate"}>{a.priority}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mb-1.5">From: {data.announcementSenderLabel(a.authorId)} · Audience: {audienceLabel(a.audience)}</p>
                  <p className="text-sm text-slate-600 mb-2 line-clamp-2">{a.message}</p>
                  {a.attachment && <div className="mb-2"><AnnouncementAttachmentChip attachment={a.attachment} /></div>}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">{timeAgo(a.createdAt)}{stats && stats.total > 0 ? ` · ${stats.read}/${stats.total} read` : ""}</span>
                    <span className="text-sky-600 font-medium">Read announcement →</span>
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
      )}
      <CreateAnnouncementModal open={createOpen} onClose={() => setCreateOpen(false)} role={role} />
      <AnnouncementDetailModal announcement={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// Finance's operational announcements (salary notices, bus updates) are scoped to Parents +
// Teachers — "All users", Directors, and direct-user targeting stay Owner/Educational-Director-only.
function CreateAnnouncementModal({ open, onClose, role }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const isFinance = role === ROLES.FINANCE;
  const empty = { title: "", message: "", audienceType: isFinance ? "ALL_PARENTS" : "ALL", grade: "Grade 1", section: "A", priority: "Normal", attachment: null, pinned: false, publishMode: "NOW", scheduleAt: "", expiresAt: "" };
  const [form, setForm] = useState(empty);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) { toast("Please add a title and message.", "error"); return; }
    let audience = { type: form.audienceType };
    if (form.audienceType === "GRADE") audience.grade = form.grade;
    if (form.audienceType === "SECTION") { audience.grade = form.grade; audience.section = form.section; }
    let publishAt = null;
    if (form.publishMode === "SCHEDULE") {
      if (!form.scheduleAt) { toast("Pick a date and time to schedule for.", "error"); return; }
      publishAt = new Date(form.scheduleAt).getTime();
      if (publishAt <= Date.now()) { toast("Scheduled time must be in the future.", "error"); return; }
    }
    let expiresAt = null;
    if (form.expiresAt) {
      expiresAt = new Date(`${form.expiresAt}T23:59:59`).getTime();
      if (expiresAt <= (publishAt || Date.now())) { toast("Expiry date must be after the publish date.", "error"); return; }
    }
    data.createAnnouncement({ title: form.title, message: form.message, audience, priority: form.priority, authorId: auth.currentUser.id, attachment: form.attachment, pinned: form.pinned, publishAt, expiresAt });
    toast(publishAt ? "Announcement scheduled." : "Announcement published.", "success");
    setForm(empty); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="New Announcement" wide>
      <div>
        <Field label="Title" required><input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Message" required><AutoGrowTextarea value={form.message} onChange={(e) => set("message", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Audience">
            <select className={inputCls} value={form.audienceType} onChange={(e) => set("audienceType", e.target.value)}>
              {!isFinance && <option value="ALL">All users</option>}
              <option value="ALL_PARENTS">All parents</option>
              <option value="ALL_TEACHERS">All teachers</option>
              {!isFinance && <option value="DIRECTORS">Directors</option>}
              <option value="GRADE">One grade</option><option value="SECTION">One section</option>
            </select>
          </Field>
          <Field label="Priority"><select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}><option>Normal</option><option>Important</option><option>Urgent</option></select></Field>
        </div>
        {(form.audienceType === "GRADE" || form.audienceType === "SECTION") && (
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Grade"><select className={inputCls} value={form.grade} onChange={(e) => set("grade", e.target.value)}>{data.gradeOptions().map((g) => <option key={g}>{g}</option>)}</select></Field>
            {form.audienceType === "SECTION" && <Field label="Section"><select className={inputCls} value={form.section} onChange={(e) => set("section", e.target.value)}>{SECTIONS.map((s) => <option key={s || "none"} value={s}>{sectionLabel(s)}</option>)}</select></Field>}
          </div>
        )}
        <AnnouncementAttachmentField attachment={form.attachment} onChange={(a) => set("attachment", a)} />
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Publish">
            <select className={inputCls} value={form.publishMode} onChange={(e) => set("publishMode", e.target.value)}>
              <option value="NOW">Now</option>
              <option value="SCHEDULE">Schedule for later</option>
            </select>
          </Field>
          {form.publishMode === "SCHEDULE" && (
            <Field label="Publish at" required><input type="datetime-local" className={inputCls} value={form.scheduleAt} onChange={(e) => set("scheduleAt", e.target.value)} /></Field>
          )}
        </div>
        <Field label="Expires on (optional)"><input type="date" className={inputCls} value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-3 cursor-pointer">
          <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} className="rounded border-slate-300" />
          Pin this announcement to the top of the list
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>{form.publishMode === "SCHEDULE" ? "Schedule" : "Publish"}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ============================== PAYMENTS ============================== */

// 4 fixed tuition installments, count locked per school policy — only the dates are configurable.
function defaultInstallments() {
  return Array.from({ length: 4 }, (_, i) => ({ id: uid("inst"), label: `Quarter ${i + 1}`, dueDate: "" }));
}

function paymentStatusBadge(status) {
  if (status === "PAID") return <Badge tone="green">Paid in full</Badge>;
  if (status === "PARTIAL") return <Badge tone="amber">Partially paid</Badge>;
  return <Badge tone="red">Unpaid</Badge>;
}

// Rolls a family's children's balances up into one tuition/bus/total figure for the family
// card header — real per-child detail still comes from dueStatusForStudent/installmentStatus
// when the card is expanded, this is only the at-a-glance summary. Uses dueStatusForStudent (what
// each child owes as of *today's* installment/bus period), not the whole-year balance, so a
// family that's caught up on what's currently due shows Paid instead of Unpaid just because they
// haven't prepaid installments/months that aren't due yet.
function familyFinancials(children, data) {
  let tuitionOwed = 0, busOwed = 0, worst = "PAID";
  children.forEach((c) => {
    const due = data.dueStatusForStudent(c);
    tuitionOwed += due.tuitionRemaining;
    busOwed += due.busRemaining + due.otherRemaining;
    if (due.status === "UNPAID") worst = "UNPAID";
    else if (due.status === "PARTIAL" && worst !== "UNPAID") worst = "PARTIAL";
  });
  return { tuitionOwed, busOwed, totalOwed: tuitionOwed + busOwed, status: worst };
}

// Groups a family's payments into receipt rows for the expanded family card's Payment History —
// one row per receipt (a payments row already IS the receipt/batch now, see Blocker 2), newest
// first, each reopening the exact original receipt. Void is whole-receipt (a payments row has one
// status), so there's no more partial-void case to flag.
function familyPaymentBatches(children, data) {
  const ids = children.map((c) => c.id);
  const familyObligationIds = new Set(data.db.studentFeeObligations.filter((o) => ids.includes(o.studentId)).map((o) => o.id));
  return data.paymentsForStudents(ids).map((p) => ({
    paymentId: p.id, receiptNo: p.receiptNo, date: p.date, createdAt: p.createdAt,
    total: data.db.paymentAllocations.filter((a) => a.paymentId === p.id && familyObligationIds.has(a.obligationId)).reduce((s, a) => s + a.amount, 0),
    voided: p.status === "VOIDED",
  })).sort((a, b) => b.createdAt - a.createdAt);
}

const PAYMENT_SECTIONS = [
  { key: "UNPAID", label: "Unpaid", tone: "red" },
  { key: "PARTIAL", label: "Partial", tone: "amber" },
  { key: "PAID", label: "Paid", tone: "green" },
];

function PaymentsPage({ onOpenStudent }) {
  const data = useData();
  const { db } = data;
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [feeSettingsOpen, setFeeSettingsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [payFamily, setPayFamily] = useState(null);
  const [reminderTarget, setReminderTarget] = useState(null); // single student, or "ALL" for bulk
  const [receiptPaymentId, setReceiptPaymentId] = useState(null);

  const activeStudents = db.students.filter((s) => s.status !== "WITHDRAWN" && s.status !== "TRANSFERRED" && s.status !== "GRADUATED" && s.status !== "ARCHIVED");
  const families = data.familyGroups().map((fam) => ({ ...fam, financials: familyFinancials(fam.children, data) }));

  const filtered = families.filter((fam) => {
    if (statusFilter && fam.financials.status !== statusFilter) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    const parentMatch = fam.parent && fam.parent.name.toLowerCase().includes(needle);
    const childMatch = fam.children.some((c) => data.studentFullName(c).toLowerCase().includes(needle) || c.studentId.toLowerCase().includes(needle));
    return parentMatch || childMatch;
  });
  const sections = PAYMENT_SECTIONS.map((sec) => ({ ...sec, families: filtered.filter((f) => f.financials.status === sec.key) }));

  const totalCollected = db.payments.filter((p) => p.status !== "VOIDED").reduce((sum, p) => sum + p.amountTotal, 0);
  const totalOutstanding = activeStudents.reduce((sum, s) => sum + data.dueStatusForStudent(s).totalRemaining, 0);
  const unpaidCount = activeStudents.filter((s) => data.dueStatusForStudent(s).status !== "PAID").length;

  function unpaidParentIds() {
    const ids = new Set();
    families.forEach((fam) => { if (fam.parent && fam.financials.status !== "PAID") ids.add(fam.parent.id); });
    return [...ids];
  }

  const receipt = receiptPaymentId ? receiptForPayment(data, receiptPaymentId, null) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Fees & Payments</h1>
        <div className="flex gap-2">
          <GhostButton icon={Settings} onClick={() => setFeeSettingsOpen(true)}>Fee Settings</GhostButton>
          <PrimaryButton icon={BellRing} onClick={() => setReminderTarget("ALL")}>Remind All Unpaid</PrimaryButton>
        </div>
      </div>
      <p className="text-sm text-slate-400 mb-4">Grouped by family — see what a parent owes for the current payment period before recording a payment.</p>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <StatCard label="Collected (all time)" value={formatMoney(totalCollected)} icon={Wallet} tone="emerald" />
        <StatCard label="Outstanding Balance (due now)" value={formatMoney(totalOutstanding)} icon={CircleAlert} tone="amber" />
        <StatCard label="Students With a Balance" value={unpaidCount} icon={Users} tone="red" />
      </div>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search parent or student name/ID…" />
        <Select value={statusFilter} onChange={setStatusFilter} options={["PAID", "PARTIAL", "UNPAID"]} placeholder="All statuses" />
      </Toolbar>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={Wallet} title="No families found" description="Try adjusting your search or filters." /></Card>
      ) : (
        <div className="space-y-6">
          {sections.filter((sec) => sec.families.length > 0).map((sec) => (
            <div key={sec.key}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold text-slate-700">{sec.label}</h2>
                <Badge tone={sec.tone}>{sec.families.length}</Badge>
              </div>
              <div className="space-y-2.5">
                {sec.families.map((fam, famIndex) => {
                  const expanded = expandedId === fam.id;
                  const history = expanded ? familyPaymentBatches(fam.children, data) : [];
                  return (
                    <Card key={fam.id} className="overflow-hidden">
                      <button type="button" onClick={() => setExpandedId(expanded ? null : fam.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-semibold text-slate-400 w-5 shrink-0 text-right">{famIndex + 1}.</span>
                          <Avatar name={fam.parent ? fam.parent.name : data.studentFullName(fam.children[0])} size={34} />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-700 truncate">{fam.parent ? fam.parent.name : data.studentFullName(fam.children[0])}</p>
                            <p className="text-xs text-slate-400">{fam.children.length} {fam.children.length === 1 ? "child" : "children"} enrolled{!fam.parent && " • no parent account linked"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-sm font-semibold text-slate-700">{fam.financials.totalOwed > 0 ? formatMoney(fam.financials.totalOwed) : "—"}</p>
                            <p className="text-[10px] text-slate-400">School Fee {formatMoney(fam.financials.tuitionOwed)} • Bus {formatMoney(fam.financials.busOwed)}</p>
                          </div>
                          {paymentStatusBadge(fam.financials.status)}
                          <ChevronDown size={16} className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                          {fam.children.map((c) => {
                            const due = data.dueStatusForStudent(c);
                            return (
                              <div key={c.id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-lg px-3 py-2">
                                <button type="button" onClick={() => onOpenStudent(c.id)} className="flex items-center gap-2.5 min-w-0 text-left">
                                  <Avatar name={data.studentFullName(c)} photo={c.photo} size={28} />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-700 truncate">{data.studentFullName(c)}</p>
                                    <p className="text-xs text-slate-400">{c.grade}{c.section} • {c.usesBus ? "Uses Bus" : "No Bus"}</p>
                                  </div>
                                </button>
                                <div className="flex items-center gap-2 shrink-0">
                                  <p className="text-sm font-medium text-slate-700">{due.totalRemaining > 0 ? formatMoney(due.totalRemaining) : "—"}</p>
                                  {paymentStatusBadge(due.status)}
                                  {due.status !== "PAID" && <GhostButton icon={BellRing} onClick={() => setReminderTarget(c)}>Remind</GhostButton>}
                                </div>
                              </div>
                            );
                          })}

                          <div>
                            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-2 mb-1.5">Payment History</h3>
                            {history.length === 0 ? (
                              <p className="text-xs text-slate-400 py-1.5">No payments recorded yet for this family.</p>
                            ) : (
                              <Card className="divide-y divide-slate-100">
                                {history.map((b) => (
                                  <div key={b.paymentId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                                    <div className="min-w-0">
                                      <p className="font-medium text-slate-700">Receipt #{b.receiptNo}</p>
                                      <p className="text-xs text-slate-400">{fmtDate(b.date)}</p>
                                    </div>
                                    <div className="flex items-center gap-2.5 shrink-0">
                                      <p className="font-semibold text-slate-700">{formatMoney(b.total)}</p>
                                      {b.voided ? <Badge tone="red">Voided</Badge> : <Badge tone="green">Paid</Badge>}
                                      <GhostButton icon={ReceiptIcon} onClick={() => setReceiptPaymentId(b.paymentId)}>View Receipt</GhostButton>
                                    </div>
                                  </div>
                                ))}
                              </Card>
                            )}
                          </div>

                          <div className="flex justify-end pt-1">
                            <PrimaryButton icon={Wallet} onClick={() => setPayFamily(fam)}>
                              {fam.parent ? `Record Family Payment — ${fam.parent.name}` : "Record Payment"}
                            </PrimaryButton>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <FeeSettingsModal open={feeSettingsOpen} onClose={() => setFeeSettingsOpen(false)} />
      <RecordPaymentModal open={!!payFamily} onClose={() => setPayFamily(null)} students={payFamily?.children || []} />
      <ReminderModal
        open={!!reminderTarget}
        onClose={() => setReminderTarget(null)}
        mode={reminderTarget === "ALL" ? "bulk" : "single"}
        student={reminderTarget !== "ALL" ? reminderTarget : null}
        bulkParentIds={reminderTarget === "ALL" ? unpaidParentIds() : []}
        bulkCount={reminderTarget === "ALL" ? unpaidParentIds().length : 0}
      />
      <CashReceiptModal
        open={!!receipt}
        onClose={() => setReceiptPaymentId(null)}
        pages={receipt?.pages || []}
        receiptNo={receipt?.receiptNo || ""}
        date={receipt ? fmtDate(receipt.date) : ""}
        method={receipt?.method || ""}
        cashierName={receipt?.cashierName || ""}
        voidedLines={receipt?.voidedLines || []}
        allVoided={receipt?.allVoided || false}
        copyType="paid"
      />
    </div>
  );
}

// Fee types are a reusable catalog entity (Locked Principle #2) — this modal only edits
// name/category/description/default* template fields, never pricing or due dates. Pricing lives
// on a per-year feeSchedule instead, set via the separate "Roll Out for Year" action below.
function FeeSettingsModal({ open, onClose }) {
  const data = useData();
  const toast = useToast();
  const { db } = data;
  const [editing, setEditing] = useState(null); // catalog fee type object or "new"
  const [rollingOut, setRollingOut] = useState(null); // catalog fee type object
  const [deleteTarget, setDeleteTarget] = useState(null);
  const empty = { name: "", category: "TUITION", description: "", defaultUnitAmount: "", defaultUnitMonths: "1", defaultUnitsPerYear: "" };
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (editing && editing !== "new") {
      setForm({
        name: editing.name, category: editing.category, description: editing.description || "",
        defaultUnitAmount: String(editing.defaultUnitAmount || ""), defaultUnitMonths: String(editing.defaultUnitMonths || "1"), defaultUnitsPerYear: String(editing.defaultUnitsPerYear || ""),
      });
    } else if (editing === "new") {
      setForm(empty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    const isTuition = form.category === "TUITION";
    if (!form.name.trim() || !form.defaultUnitAmount) { toast("Please fill in all fee fields.", "error"); return; }
    if (!isTuition && (!form.defaultUnitMonths || !form.defaultUnitsPerYear)) { toast("Please fill in all fee fields.", "error"); return; }
    const payload = { ...form, defaultUnitMonths: isTuition ? 2.5 : form.defaultUnitMonths, defaultUnitsPerYear: isTuition ? 4 : form.defaultUnitsPerYear };
    if (editing === "new") {
      data.createFeeType(payload);
      toast("Fee type added.", "success");
    } else {
      data.updateFeeType(editing.id, payload);
      toast("Fee type updated.", "success");
    }
    setEditing(null);
  }
  function confirmDelete() {
    if (!deleteTarget) return;
    const res = data.deleteFeeType(deleteTarget.id);
    toast(res.message || (res.ok ? "Fee type deleted." : "Couldn't delete this fee type."), res.ok ? "info" : "error");
    setDeleteTarget(null);
  }

  if (editing) {
    return (
      <Modal open={open} onClose={() => setEditing(null)} title={editing === "new" ? "Add Fee Type" : "Edit Fee Type"}>
        <div>
          <Field label="Name" required><input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. School Fee" /></Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)} disabled={editing !== "new"}>
              <option value="TUITION">School Fee</option>
              <option value="TRANSPORT">Bus / Transport (only charged to students using the bus)</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <p className="text-xs text-slate-400 -mt-1 mb-2">These are just defaults, prefilled when this fee type is rolled out for an academic year — they don't set what's actually owed by themselves.</p>
          {form.category === "TUITION" ? (
            <Field label={`Default amount per quarter (${CURRENCY})`} required><input type="number" min="0" className={inputCls} value={form.defaultUnitAmount} onChange={(e) => set("defaultUnitAmount", e.target.value)} /></Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-3">
                <Field label="Default months per cycle" required><input type="number" step="0.5" min="0.5" className={inputCls} value={form.defaultUnitMonths} onChange={(e) => set("defaultUnitMonths", e.target.value)} placeholder="e.g. 1" /></Field>
                <Field label={`Default amount per cycle (${CURRENCY})`} required><input type="number" min="0" className={inputCls} value={form.defaultUnitAmount} onChange={(e) => set("defaultUnitAmount", e.target.value)} /></Field>
              </div>
              <Field label="Default cycles per school year" required><input type="number" min="1" className={inputCls} value={form.defaultUnitsPerYear} onChange={(e) => set("defaultUnitsPerYear", e.target.value)} /></Field>
            </>
          )}
          <Field label="Description"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <PrimaryButton type="button" onClick={submit} icon={Check}>{editing === "new" ? "Add Fee Type" : "Save Changes"}</PrimaryButton>
          </div>
        </div>
      </Modal>
    );
  }

  const currentYear = currentAcademicYear(db.academicYears);

  return (
    <>
      <Modal open={open && !rollingOut} onClose={onClose} title="Fee Settings" wide>
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-400">Fee types are a reusable catalog — roll each one out for an academic year to set its actual pricing and due dates.</p>
            <PrimaryButton icon={Plus} onClick={() => setEditing("new")}>Add Fee Type</PrimaryButton>
          </div>
          <div className="space-y-2">
            {db.feeTypes.filter((ft) => !ft.archivedAt).map((ft) => {
              const schedule = currentYear && db.feeSchedules.find((s) => s.feeTypeId === ft.id && s.academicYearId === currentYear.id);
              return (
                <div key={ft.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-700">{ft.name}</p>
                      <Badge tone={ft.category === "TRANSPORT" ? "indigo" : "sky"}>{ft.category === "TRANSPORT" ? "Bus only" : ft.category === "TUITION" ? "School Fee" : "Other"}</Badge>
                      {currentYear && (schedule ? <Badge tone="green">Rolled out for {formatAcademicYearLabel(currentYear)}</Badge> : <Badge tone="amber">Not yet rolled out for {formatAcademicYearLabel(currentYear)}</Badge>)}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">Default {formatMoney(ft.defaultUnitAmount)} per {ft.defaultUnitMonths}-month cycle • {ft.defaultUnitsPerYear} cycles/year</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <GhostButton icon={CalendarDays} onClick={() => setRollingOut(ft)}>Roll Out for Year</GhostButton>
                    <GhostButton icon={Edit2} onClick={() => setEditing(ft)}>Edit</GhostButton>
                    <GhostButton icon={Trash2} danger onClick={() => setDeleteTarget(ft)}>Delete</GhostButton>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
          </div>
        </div>
        <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} danger confirmLabel="Delete Fee Type"
          title="Delete this fee type?" description={deleteTarget ? `This removes "${deleteTarget.name}" from the fee list. Fee types with any fee schedule are archived instead of deleted, to keep financial history intact.` : ""}
          onConfirm={confirmDelete} />
      </Modal>
      {rollingOut && <RolloutFeeTypeModal open={!!rollingOut} onClose={() => setRollingOut(null)} feeType={rollingOut} />}
    </>
  );
}

// Creates/refreshes ONE academic year's schedule + installments for a fee type. Already-rolled-out
// years show read-only (installments already billed to a student can only be corrected via an
// adjustment on that student's own balance, never edited out from under them here).
function RolloutFeeTypeModal({ open, onClose, feeType }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const currentYear = currentAcademicYear(db.academicYears);
  const existingSchedule = currentYear ? db.feeSchedules.find((s) => s.feeTypeId === feeType.id && s.academicYearId === currentYear.id) : null;
  const isTuition = feeType.category === "TUITION";
  const [unitAmount, setUnitAmount] = useState(String(feeType.defaultUnitAmount || ""));
  const [unitMonths, setUnitMonths] = useState(String(feeType.defaultUnitMonths || "1"));
  const [unitsPerYear, setUnitsPerYear] = useState(String(feeType.defaultUnitsPerYear || ""));
  const [installments, setInstallments] = useState(isTuition ? defaultInstallments() : []);

  useEffect(() => {
    if (!open) return;
    setUnitAmount(String(feeType.defaultUnitAmount || ""));
    setUnitMonths(String(feeType.defaultUnitMonths || "1"));
    setUnitsPerYear(String(feeType.defaultUnitsPerYear || ""));
    if (isTuition) setInstallments(defaultInstallments());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feeType.id]);

  if (!currentYear) return null;

  if (existingSchedule) {
    const rows = db.feeInstallments.filter((i) => i.feeScheduleId === existingSchedule.id).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    return (
      <Modal open={open} onClose={onClose} title={`${feeType.name} — ${formatAcademicYearLabel(currentYear)}`}>
        <div>
          <p className="text-xs text-slate-400 mb-3">Already rolled out for this year. An installment already billed to a student can only be corrected through an adjustment on that student's own balance, not edited here.</p>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-700">{r.label}</span>
                <span className="text-slate-500">Due {fmtDateLong(r.dueDate)} • {formatMoney(r.amount)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
          </div>
        </div>
      </Modal>
    );
  }

  function setInstallmentDate(i, dueDate) {
    setInstallments((rows) => rows.map((inst, xi) => (xi === i ? { ...inst, dueDate } : inst)));
  }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!unitAmount) { toast("Please fill in the amount.", "error"); return; }
    if (isTuition) {
      if (installments.some((inst) => !inst.dueDate)) { toast("Please set all 4 installment dates.", "error"); return; }
    } else if (!unitMonths || !unitsPerYear) {
      toast("Please fill in all fields.", "error"); return;
    }
    const res = data.rolloutFeeTypeForYear(feeType.id, currentYear.id, {
      unitAmount: Number(unitAmount), unitMonths: isTuition ? 2.5 : Number(unitMonths), unitsPerYear: isTuition ? 4 : Number(unitsPerYear),
      installments: isTuition ? installments : undefined,
    }, auth.currentUser.id);
    toast(res.message || "Fee type rolled out for this year.", res.ok ? "success" : "error");
    if (res.ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Roll Out ${feeType.name} — ${formatAcademicYearLabel(currentYear)}`}>
      <div>
        {isTuition ? (
          <>
            <p className="text-xs text-slate-400 -mt-1 mb-2">4 quarters a year, split equally. Set each quarter's exact due date.</p>
            <div className="grid grid-cols-2 gap-x-3">
              {installments.map((inst, i) => (
                <Field key={inst.id} label={inst.label} required>
                  <input type="date" className={inputCls} value={inst.dueDate} onChange={(e) => setInstallmentDate(i, e.target.value)} />
                </Field>
              ))}
            </div>
            <Field label={`Amount per quarter (${CURRENCY})`} required><input type="number" min="0" className={inputCls} value={unitAmount} onChange={(e) => setUnitAmount(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="Months per cycle" required><input type="number" step="0.5" min="0.5" className={inputCls} value={unitMonths} onChange={(e) => setUnitMonths(e.target.value)} placeholder="e.g. 1" /></Field>
              <Field label={`Amount per cycle (${CURRENCY})`} required><input type="number" min="0" className={inputCls} value={unitAmount} onChange={(e) => setUnitAmount(e.target.value)} /></Field>
            </div>
            <Field label="Cycles per school year" required><input type="number" min="1" className={inputCls} value={unitsPerYear} onChange={(e) => setUnitsPerYear(e.target.value)} /></Field>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check}>Roll Out</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Turns the flat list of {studentId, studentName, grade, amount, isBus, label} lines a payment
// batch produced (one line per fee — a tuition installment, each bus month, etc.) into one row
// per STUDENT, so a student paying tuition plus three bus months still prints as a single row,
// not four. Bus lines are kept separate from `feeLines` (school-fee-type lines only) because the
// voucher prints bus detail in its own section rather than under each student's name.
// `hasSchool`/`hasBus` flag what that student actually paid in *this* batch (not what fees they're
// enrolled in) — a student with bus service who didn't pay a bus fee this time must not show one.
function groupLinesByStudent(lines) {
  const order = [];
  const byStudent = new Map();
  lines.forEach((l) => {
    if (!byStudent.has(l.studentId)) { byStudent.set(l.studentId, []); order.push(l.studentId); }
    byStudent.get(l.studentId).push(l);
  });
  return order.map((studentId) => {
    const studentLines = byStudent.get(studentId);
    const first = studentLines[0];
    const busLines = studentLines.filter((l) => l.isBus);
    const feeLines = studentLines.filter((l) => !l.isBus).map((l) => l.label);
    const busMonths = busLines.length > 0 ? busLines.map((b) => b.label.split(" – ").slice(1).join(" – ")).join(", ") : null;
    return {
      studentId,
      studentName: first.studentName,
      grade: first.grade,
      amount: studentLines.reduce((s, l) => s + l.amount, 0),
      feeLines,
      hasSchool: feeLines.length > 0,
      hasBus: busLines.length > 0,
      busMonths,
    };
  });
}
// Builds the single receipt page for a payment batch: one numbered "Received From" row per
// student (no 5-row cap — a 6th, 7th, ... student just continues the numbering on the same
// voucher), a separate "Bus Fee" line naming only the students who actually paid a bus fee this
// time, and a short generic "Purpose of Payment" summary — never student names/grades/installment
// detail, which belong in the per-student rows and the Bus Fee line instead.
function buildReceiptPages(lines) {
  const students = groupLinesByStudent(lines);
  const total = students.reduce((s, r) => s + r.amount, 0);
  const hasSchool = students.some((r) => r.hasSchool);
  const hasBus = students.some((r) => r.hasBus);
  const purpose = hasSchool && hasBus ? "School Fee & Bus Fee" : hasBus ? "Bus Fee" : hasSchool ? "School Fee" : "";
  const busFeeLines = students.filter((r) => r.hasBus).map((r) => `${r.studentName} — ${r.busMonths}`);
  return [{
    entries: students.map((r) => ({ name: r.studentName, grade: r.grade, feeLines: r.feeLines })),
    amount: Math.round(total).toLocaleString(),
    amountWords: amountInWords(total),
    purpose,
    busFeeLines,
  }];
}

// Resolves one paymentAllocation to its {studentId, studentName, grade, isBus, label} shape —
// the per-line detail receiptForPayment needs, mirroring DataContext's describeAllocation exactly
// (including its TRANSPORT " – <month>" separator, which groupLinesByStudent's busMonths parsing
// depends on).
function allocationDetail(data, allocation) {
  const ob = data.db.studentFeeObligations.find((o) => o.id === allocation.obligationId);
  const inst = ob && data.db.feeInstallments.find((i) => i.id === ob.feeInstallmentId);
  const schedule = inst && data.db.feeSchedules.find((s) => s.id === inst.feeScheduleId);
  const feeType = schedule && data.db.feeTypes.find((f) => f.id === schedule.feeTypeId);
  const stu = ob && data.getStudent(ob.studentId);
  const isBus = feeType?.category === "TRANSPORT";
  const label = feeType && inst ? (isBus ? `${feeType.name} – ${inst.label}` : `${feeType.name} ${inst.label}`) : "Fee";
  return { studentId: ob?.studentId, studentName: stu ? data.studentFullName(stu) : "Unknown student", grade: data.classLabel(data.getClass(stu?.classId)), isBus, label };
}

// Rebuilds the exact saved receipt for a previously recorded payment — the single place every
// "View Receipt" entry point (family Payment History, a student's payment history, a parent's
// payment history, a payment notification) goes through, so reopening a receipt always shows the
// same receipt number it was issued with instead of generating a new one.
// `restrictToStudentIds` (a Set): when given, only that family's own children's lines from the
// payment are included — used for parent-facing views so a shared cashier transaction never leaks
// another family's child. Owner/Finance callers omit it and see the complete original receipt.
function receiptForPayment(data, paymentId, restrictToStudentIds) {
  if (!paymentId) return null;
  const payment = data.db.payments.find((p) => p.id === paymentId);
  if (!payment) return null;
  let allocs = data.db.paymentAllocations.filter((a) => a.paymentId === paymentId);
  if (restrictToStudentIds) {
    allocs = allocs.filter((a) => {
      const ob = data.db.studentFeeObligations.find((o) => o.id === a.obligationId);
      return ob && restrictToStudentIds.has(ob.studentId);
    });
  }
  if (allocs.length === 0) return null;
  const pages = buildReceiptPages(allocs.map((a) => ({ ...allocationDetail(data, a), amount: a.amount })));
  const pm = data.db.paymentMethods.find((m) => m.id === payment.paymentMethodId);
  // Blocker 2: void is whole-receipt now (a payments row has one status, not one per line) — a
  // direct, structural consequence of paymentAllocations carrying no per-line void field. Every
  // line in a voided receipt is voided together, so voidedLines is always either every line or
  // none — the CashReceiptModal prop contract (voidedLines/allVoided) itself is unchanged.
  const voidedLines = payment.status === "VOIDED" ? allocs.map((a) => {
    const detail = allocationDetail(data, a);
    return {
      studentName: detail.studentName, description: detail.label, amount: a.amount,
      voidedAt: payment.voidedAt, voidedBy: data.getUser(payment.voidedBy)?.name || "Unknown", voidReason: payment.voidReason,
    };
  }) : [];
  return {
    pages, receiptNo: payment.receiptNo, date: payment.date, method: pm?.name || "", cashierName: data.getUser(payment.recordedBy)?.name || "",
    voidedLines, allVoided: payment.status === "VOIDED",
  };
}

// Single-student callers (student profile page) pass `student`; the family Fees & Payments
// screen passes `students` (a parent's whole child list, still individually checkable/editable
// below) so several children can be paid for and receipted in one transaction.
function RecordPaymentModal({ open, onClose, student, students }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const candidates = students && students.length ? students : (student ? [student] : []);
  const [selectedIds, setSelectedIds] = useState([]);
  const [drafts, setDrafts] = useState({}); // studentId -> { installmentId, tuitionAmount, busLines: [{key, installmentId, amount}] }
  const [method, setMethod] = useState("");
  const [customMethod, setCustomMethod] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [receiptPages, setReceiptPages] = useState(null);
  const [receiptNo, setReceiptNo] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedIds(candidates.map((c) => c.id));
    const nextDrafts = {};
    candidates.forEach((c) => {
      const inst = data.installmentStatusForStudent(c);
      const firstUnpaid = inst.rows.find((r) => r.status !== "PAID") || inst.rows[0];
      const bus = c.usesBus ? data.busScheduleForStudent(c) : null;
      const firstBusUnpaid = bus ? bus.rows.find((r) => r.status !== "PAID") : null;
      nextDrafts[c.id] = {
        installmentId: firstUnpaid ? firstUnpaid.installment.id : "",
        tuitionAmount: firstUnpaid ? firstUnpaid.remaining : 0,
        busLines: firstBusUnpaid ? [{ key: uid("busln"), installmentId: firstBusUnpaid.installmentId, amount: firstBusUnpaid.remaining }] : [],
      };
    });
    setDrafts(nextDrafts);
    setMethod(data.db.paymentMethods.find((m) => m.active)?.name || "Cash");
    setCustomMethod("");
    setDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setReceiptPages(null);
    setReceiptNo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student, students]);

  if (candidates.length === 0) return null;
  const finalMethod = method === "__custom__" ? customMethod.trim() : method;

  function setDraft(studentId, patch) {
    setDrafts((d) => ({ ...d, [studentId]: { ...d[studentId], ...patch } }));
  }
  function addBusLine(studentId, busSchedule) {
    setDrafts((d) => {
      const draft = d[studentId] || {};
      const usedIds = new Set((draft.busLines || []).map((bl) => bl.installmentId));
      const next = busSchedule.rows.find((r) => r.status !== "PAID" && !usedIds.has(r.installmentId));
      if (!next) return d;
      return { ...d, [studentId]: { ...draft, busLines: [...(draft.busLines || []), { key: uid("busln"), installmentId: next.installmentId, amount: next.remaining }] } };
    });
  }
  function updateBusLine(studentId, key, patch) {
    setDrafts((d) => ({ ...d, [studentId]: { ...d[studentId], busLines: (d[studentId]?.busLines || []).map((bl) => (bl.key === key ? { ...bl, ...patch } : bl)) } }));
  }
  function removeBusLine(studentId, key) {
    setDrafts((d) => ({ ...d, [studentId]: { ...d[studentId], busLines: (d[studentId]?.busLines || []).filter((bl) => bl.key !== key) } }));
  }

  function buildLines() {
    const lines = [];
    selectedIds.forEach((studentId) => {
      const stu = candidates.find((c) => c.id === studentId);
      const draft = drafts[studentId];
      if (!stu || !draft) return;
      const inst = data.installmentStatusForStudent(stu);
      const row = inst.rows.find((r) => r.installment.id === draft.installmentId);
      // Capped at this installment's own remaining balance — a payment tagged to one quarter's
      // installmentId only ever counts toward that quarter (installmentStatusForStudent looks up
      // payments by installmentId, not by date or overall balance), so letting the entered amount
      // exceed what's due here would make that quarter's row disagree with the family's aggregate
      // balance: the aggregate (balanceFor) would show "paid in full" from the total amount received
      // while this quarter and the untouched later quarters still show unpaid.
      const tuitionAmount = row ? Math.min(Number(draft.tuitionAmount) || 0, row.remaining) : 0;
      if (inst.feeType && draft.installmentId && tuitionAmount > 0) {
        lines.push({ studentId, installmentId: draft.installmentId, amount: tuitionAmount, method: finalMethod, date, note });
      }
      if (stu.usesBus) {
        const bus = data.busScheduleForStudent(stu);
        (draft.busLines || []).forEach((bl) => {
          const busRow = bus.rows.find((r) => r.installmentId === bl.installmentId);
          const amount = busRow ? Math.min(Number(bl.amount) || 0, busRow.remaining) : 0;
          if (bl.installmentId && amount > 0) lines.push({ studentId, installmentId: bl.installmentId, amount, method: finalMethod, date, note });
        });
      }
    });
    return lines;
  }

  const previewTotal = buildLines().reduce((s, l) => s + l.amount, 0);

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!finalMethod) { toast("Please choose or enter a payment method.", "error"); return; }
    const lines = buildLines();
    if (lines.length === 0) { toast("Enter at least one amount to record.", "error"); return; }
    const result = data.recordPaymentBatch(lines, auth.currentUser.id);
    if (!result.receiptNo) { toast("Couldn't record this payment.", "error"); return; }
    const rows = result.entries.map((entry) => ({ studentId: entry.studentId, studentName: entry.studentName, grade: entry.grade, amount: entry.amount, isBus: entry.isBus, label: entry.description }));
    setReceiptPages(buildReceiptPages(rows));
    setReceiptNo(result.receiptNo);
    toast("Payment recorded.", "success");
  }

  function closeAll() {
    setReceiptPages(null);
    onClose();
  }

  return (
    <>
      <Modal open={open && !receiptPages} onClose={closeAll} wide title={candidates.length > 1 ? "Record Family Payment" : `Record Payment — ${data.studentFullName(candidates[0])}`}>
        <div>
          {candidates.length > 1 && (
            <Field label="Children included in this payment">
              <CheckboxList
                items={candidates.map((c) => ({ id: c.id, label: data.studentFullName(c), sublabel: `${c.grade}${c.section}` }))}
                selectedIds={selectedIds}
                onChange={setSelectedIds}
              />
            </Field>
          )}

          <div className="space-y-3 mb-3">
            {selectedIds.map((studentId) => {
              const stu = candidates.find((c) => c.id === studentId);
              const draft = drafts[studentId];
              if (!stu || !draft) return null;
              const inst = data.installmentStatusForStudent(stu);
              const busSchedule = data.busScheduleForStudent(stu);
              const tuitionNow = draft.installmentId ? (Number(draft.tuitionAmount) || 0) : 0;
              const busNow = (draft.busLines || []).reduce((s, bl) => s + (Number(bl.amount) || 0), 0);
              return (
                <Card key={studentId} className="p-3.5">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <Avatar name={data.studentFullName(stu)} photo={stu.photo} size={30} />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{data.studentFullName(stu)}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge tone="sky">{stu.grade}{stu.section}</Badge>
                        <Badge tone={stu.usesBus ? "indigo" : "slate"}>{stu.usesBus ? "Uses Bus" : "No Bus"}</Badge>
                      </div>
                    </div>
                  </div>

                  {inst.feeType && (
                    <div className="grid sm:grid-cols-2 gap-x-3">
                      <Field label="School Fee quarter">
                        <select className={inputCls} value={draft.installmentId} onChange={(e) => {
                          const row = inst.rows.find((r) => r.installment.id === e.target.value);
                          setDraft(studentId, { installmentId: e.target.value, tuitionAmount: row ? row.remaining : 0 });
                        }}>
                          <option value="">— Don't pay school fee now —</option>
                          {inst.rows.map((r) => (
                            <option key={r.installment.id} value={r.installment.id}>{inst.feeType.name} {r.installment.label}{r.isCurrent ? " — Current" : ""} (Due {fmtDateLong(r.installment.dueDate)}) — {r.status === "PAID" ? "Paid" : `${formatMoney(r.remaining)} owed`}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="School Fee amount now">
                        <input type="number" min="0" max={inst.rows.find((r) => r.installment.id === draft.installmentId)?.remaining || 0}
                          className={inputCls} value={draft.installmentId ? draft.tuitionAmount : 0} disabled={!draft.installmentId}
                          onChange={(e) => {
                            const row = inst.rows.find((r) => r.installment.id === draft.installmentId);
                            const capped = row ? Math.min(Number(e.target.value) || 0, row.remaining) : 0;
                            setDraft(studentId, { tuitionAmount: capped });
                          }} />
                      </Field>
                    </div>
                  )}

                  {stu.usesBus && busSchedule.feeType && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="text-xs text-slate-500 mb-1.5">Bus months ({formatMoney(busSchedule.feeType.unitAmount)}/mo)</p>
                      {(draft.busLines || []).length === 0 && <p className="text-xs text-slate-400 mb-1.5">No bus month selected — this student's bus fee won't be included in this payment.</p>}
                      <div className="space-y-2">
                        {(draft.busLines || []).map((bl) => {
                          const busRow = busSchedule.rows.find((r) => r.installmentId === bl.installmentId);
                          return (
                            <div key={bl.key} className="grid sm:grid-cols-[1fr,120px,auto] gap-x-2 items-end">
                              <Field label="Month">
                                <select className={inputCls} value={bl.installmentId} onChange={(e) => {
                                  const row = busSchedule.rows.find((r) => r.installmentId === e.target.value);
                                  updateBusLine(studentId, bl.key, { installmentId: e.target.value, amount: row ? row.remaining : 0 });
                                }}>
                                  {busSchedule.rows.map((r) => (
                                    <option key={r.installmentId} value={r.installmentId}>{r.label}{r.isCurrent ? " — Current" : ""} — {r.status === "PAID" ? "Paid" : `${formatMoney(r.remaining)} owed`}</option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Amount">
                                <input type="number" min="0" max={busRow?.remaining || 0} className={inputCls} value={bl.amount}
                                  onChange={(e) => { const capped = busRow ? Math.min(Number(e.target.value) || 0, busRow.remaining) : 0; updateBusLine(studentId, bl.key, { amount: capped }); }} />
                              </Field>
                              <button type="button" onClick={() => removeBusLine(studentId, bl.key)} className="h-9 px-2 text-xs text-red-500 font-medium">Remove</button>
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" onClick={() => addBusLine(studentId, busSchedule)} className="mt-1.5 text-xs font-medium text-sky-600 hover:text-sky-700">+ Add another bus month</button>
                    </div>
                  )}

                  <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-0.5">
                    {inst.feeType && <span>School Fee due: {formatMoney(inst.rows.find((r) => r.installment.id === draft.installmentId)?.remaining || 0)}</span>}
                    {stu.usesBus && <span>Bus due now: {formatMoney(busNow)}</span>}
                    <span className="font-medium text-slate-700">Paying now: {formatMoney(tuitionNow + busNow)}</span>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-x-3">
            <Field label="Payment method" required>
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                {data.db.paymentMethods.filter((m) => m.active).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                <option value="__custom__">Other (type below)…</option>
              </select>
            </Field>
            <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {method === "__custom__" && (
            <Field label="Method name" required><input className={inputCls} value={customMethod} onChange={(e) => setCustomMethod(e.target.value)} placeholder="e.g. Sahal Pay" /></Field>
          )}
          <Field label="Note"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-700">Total: {formatMoney(previewTotal)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <PrimaryButton type="button" onClick={submit} icon={Check}>Record Payment</PrimaryButton>
            </div>
          </div>
        </div>
      </Modal>

      <CashReceiptModal
        open={!!receiptPages}
        onClose={closeAll}
        pages={receiptPages || []}
        receiptNo={receiptNo}
        date={fmtDate(date)}
        method={finalMethod}
        cashierName={auth.currentUser.name}
        copyType="customer"
      />
    </>
  );
}

function ReminderModal({ open, onClose, mode, student, bulkParentIds, bulkCount }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "single" && student) {
      const summary = data.studentPaymentSummary(student);
      const owedList = summary.balances.filter((b) => b.status !== "PAID").map((b) => `${b.feeType.name}: ${formatMoney(b.amountOwed)}`).join(", ");
      setMessage(`Dear parent, this is a friendly reminder that ${student.firstName}'s school fees are outstanding (${owedList}). Please arrange payment at your earliest convenience. Thank you.`);
    } else {
      setMessage("Dear parent, this is a friendly reminder that your child's school fees are currently outstanding. Please arrange payment at your earliest convenience. Thank you for your support.");
    }
    setImage(null);
  }, [open, mode, student]);

  function submit() {
    if (!message.trim()) { toast("Please write a reminder message.", "error"); return; }
    if (mode === "single") {
      const parentIds = data.parentsOfStudent(student.id);
      if (parentIds.length === 0) { toast("This student has no connected parent account yet.", "error"); return; }
      data.sendPaymentReminder({ parentIds, message, image, feeTypeName: null }, auth.currentUser.id);
      toast("Reminder sent.", "success");
    } else {
      if (bulkParentIds.length === 0) { toast("No parents currently have an outstanding balance.", "info"); onClose(); return; }
      data.sendPaymentReminder({ parentIds: bulkParentIds, message, image, feeTypeName: null }, auth.currentUser.id);
      toast(`Reminder sent to ${bulkParentIds.length} parent${bulkParentIds.length === 1 ? "" : "s"}.`, "success");
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === "single" ? "Send Payment Reminder" : "Remind All Unpaid Parents"} wide>
      <div>
        {mode === "bulk" && <p className="text-xs text-slate-400 mb-3">This will notify {bulkCount} parent{bulkCount === 1 ? "" : "s"} whose children currently have an outstanding balance.</p>}
        <Field label="Message" required><textarea className={inputCls} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <Field label="Attach an image (optional)">
          {image ? (
            <div className="flex items-center gap-3">
              <img src={image} alt="Attachment" className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
              <button type="button" onClick={() => setImage(null)} className="text-xs text-red-500 font-medium">Remove image</button>
            </div>
          ) : (
            <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-400 cursor-pointer hover:border-sky-300 w-fit">
              <ImagePlus size={15} /> Upload payment details (e.g. account number / QR code)
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader(); reader.onload = () => setImage(reader.result); reader.readAsDataURL(file);
              }} />
            </label>
          )}
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={BellRing}>Send Reminder</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Blocker 4: the only way a recorded payment can ever change — voids it (with a required reason)
// instead of editing or deleting it, so the original receipt data is never touched. Shows exactly
// what's about to be voided before asking for confirmation, per the approved policy.
function VoidPaymentModal({ open, onClose, payment }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { if (open) { setReason(""); setConfirming(false); } }, [open, payment?.id]);

  if (!payment) return null;
  // Blocker 2: a payment can span several students in one receipt — void is whole-receipt, so
  // this lists every student/line it covers rather than assuming a single owner.
  const allocations = data.db.paymentAllocations.filter((a) => a.paymentId === payment.id);
  const studentIds = [...new Set(allocations.map((a) => {
    const ob = data.db.studentFeeObligations.find((o) => o.id === a.obligationId);
    return ob ? ob.studentId : null;
  }).filter(Boolean))];
  const studentNames = studentIds.map((id) => { const s = data.getStudent(id); return s ? data.studentFullName(s) : null; }).filter(Boolean).join(", ") || "Unknown student";
  const description = data.describePayment(payment);
  const methodName = data.paymentMethodName(payment);

  function confirmVoid() {
    const res = data.voidPayment(payment.id, reason, auth.realUser.id, auth.realUser.role);
    if (res.ok) {
      toast("Payment voided.", "success");
      onClose();
    } else {
      toast(res.message || "Couldn't void this payment.", "error");
    }
    setConfirming(false);
  }

  return (
    <>
      <Modal open={open && !confirming} onClose={onClose} title="Void Payment">
        <div>
          <Card className="p-3 mb-3 bg-slate-50">
            <p className="text-sm font-medium text-slate-700">{studentNames} — {description}</p>
            <p className="text-xs text-slate-400 mt-0.5">{methodName} • {fmtDate(payment.date)}{payment.receiptNo ? ` • Receipt #${payment.receiptNo}` : ""}</p>
            <p className="text-sm font-semibold text-slate-700 mt-1">{formatMoney(payment.amountTotal)}</p>
          </Card>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            This voids the entire receipt{allocations.length > 1 ? ` (all ${allocations.length} lines)` : ""} — it will remain visible in payment history, clearly marked as VOIDED, and will stop counting toward the balance of every student it covered. This cannot be undone or re-posted — record a new payment instead if a correction is needed.
          </p>
          <Field label="Reason for voiding" required>
            <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded against the wrong student" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="button" onClick={() => { if (!reason.trim()) { toast("Please provide a reason for voiding this payment.", "error"); return; } setConfirming(true); }} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700">Continue</button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} danger confirmLabel="Void Payment"
        title="Confirm void" description={`This will mark the ${formatMoney(payment.amountTotal)} payment (receipt #${payment.receiptNo || "—"}) as VOIDED. It will remain in history but no longer count toward the balance.`}
        onConfirm={confirmVoid} />
    </>
  );
}

function ParentPaymentsPage({ activeChildId, setActiveChildId }) {
  const data = useData();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  const [receiptPaymentId, setReceiptPaymentId] = useState(null);
  const defaultYear = currentAcademicYear(data.db.academicYears);
  const [selectedYearId, setSelectedYearId] = useState(defaultYear ? defaultYear.id : "");
  useEffect(() => { setSelectedYearId(defaultYear ? defaultYear.id : ""); /* reset when switching children */ }, [child?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!child) return <EmptyState title="No children connected" description="Connect a child from Settings to view payments." />;
  const enrollments = data.enrollmentsForStudent(child.id);
  const selectedYear = data.db.academicYears.find((y) => y.id === selectedYearId) || defaultYear;
  const summary = data.studentPaymentSummary(child, selectedYear?.id);
  const due = data.dueStatusForStudent(child, selectedYear?.id);
  const priorYearsOwed = selectedYear ? data.priorYearsOutstanding(child, selectedYear.id) : 0;
  const history = data.paymentsForStudents([child.id]).sort((a, b) => b.createdAt - a.createdAt);
  const installmentStatus = data.installmentStatusForStudent(child, selectedYear?.id);
  const busSchedule = data.busScheduleForStudent(child, selectedYear?.id);

  // Privacy: a receipt may include siblings paid for in the same transaction, but a parent
  // viewing it here only ever sees lines belonging to their own connected children — never
  // another family's child that happened to share the same cashier transaction.
  const familyChildIds = new Set(children.map((c) => c.id));
  const receipt = receiptPaymentId ? receiptForPayment(data, receiptPaymentId, familyChildIds) : null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Payments</h1>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      {enrollments.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <label className="text-xs text-slate-400 shrink-0">Academic Year</label>
          <select className={inputCls + " sm:w-72"} value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}>
            {enrollments.map((en) => {
              const y = data.db.academicYears.find((yy) => yy.id === en.academicYearId);
              return <option key={en.id} value={en.academicYearId}>{formatAcademicYearLabel(y)}</option>;
            })}
          </select>
        </div>
      )}

      {/* Locked Principle #7: a prior-year balance is never silently merged into this year's
          "due now" figure — it gets its own, clearly separate card. */}
      {priorYearsOwed > 0 && (
        <Card className="p-4 mb-4 border border-red-200 bg-red-50">
          <p className="text-sm font-medium text-red-800">Prior-Year Balance (not included below): {formatMoney(priorYearsOwed)}</p>
        </Card>
      )}

      {due.totalRemaining > 0 && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">Outstanding balance (due now): {formatMoney(due.totalRemaining)}</p>
        </Card>
      )}

      {installmentStatus.feeType && (
        <Card className="p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">School Fee Schedule</h3>
          <FeeScheduleList rows={installmentStatus.rows.map((r) => ({ label: `${installmentStatus.feeType.name} ${r.installment.label}`, dueLabel: `Due ${fmtDateLong(r.installment.dueDate)}`, amountDue: r.amountDue, paid: r.paid, remaining: r.remaining, status: r.status, current: r.isCurrent }))} />
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700">Bus</h3>
          {!child.usesBus && <Badge tone="slate">No Bus</Badge>}
          {child.usesBus && busSchedule.feeType && <Badge tone="sky">{formatMoney(busSchedule.feeType.unitAmount)}/month</Badge>}
        </div>
        {child.usesBus ? <FeeScheduleList rows={busSchedule.rows.map((r) => ({ label: r.label, amountDue: r.amountDue, paid: r.paid, remaining: r.remaining, status: r.status, current: r.isCurrent }))} /> : <p className="text-xs text-slate-400">This child does not use the school bus.</p>}
      </Card>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        {summary.balances.map((b) => {
          const coverage = feeCoverage(b.paid, b.feeType, activeYearStartDate(data.db.academicYears));
          const feeDue = data.dueStatusForFeeType(child, b.feeType, selectedYear?.id);
          return (
            <Card key={b.feeType.id} className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-700">{b.feeType.name}</p>
                {paymentStatusBadge(feeDue.status)}
              </div>
              <p className="text-xs text-slate-400">Paid {b.paid} of {b.feeType.unitsPerYear} cycles ({b.feeType.unitMonths}-month cycles)</p>
              {coverage.coveredThrough ? (
                <p className="text-xs text-emerald-700 mt-1">Paid through {fmtDateLong(coverage.coveredThrough)}</p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">No payment made yet this year</p>
              )}
              {coverage.remainingMonths > 0 && coverage.remainingTo && (
                <p className="text-xs text-amber-700">{Math.round(coverage.remainingMonths * 10) / 10} months remaining ({fmtDateLong(coverage.remainingFrom)} – {fmtDateLong(coverage.remainingTo)})</p>
              )}
              {b.amountOwed > 0 && <p className="text-sm font-semibold text-slate-700 mt-1">{formatMoney(b.amountOwed)} remaining</p>}
            </Card>
          );
        })}
      </div>

      <h3 className="text-sm font-semibold text-slate-700 mb-2">Payment History</h3>
      {history.length === 0 ? <EmptyState title="No payments recorded yet" description="Payments the school records will appear here." /> : (
        <Card className="divide-y divide-slate-100">
          {history.map((p) => {
            const voided = p.status === "VOIDED";
            return (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className={`font-medium ${voided ? "text-slate-400 line-through" : "text-slate-700"}`}>{data.describePayment(p)}</p>
                  <p className="text-xs text-slate-400">{data.paymentMethodName(p)} • {fmtDate(p.date)}{p.receiptNo ? ` • Receipt #${p.receiptNo}` : ""}</p>
                  {voided && <p className="text-xs text-red-600 mt-0.5">This payment was voided and does not count toward the balance.</p>}
                </div>
                <div className="flex items-center gap-2.5">
                  <p className={`font-semibold ${voided ? "text-slate-400 line-through" : "text-slate-700"}`}>{formatMoney(p.amountTotal)}</p>
                  {voided && <Badge tone="red">Voided</Badge>}
                  <GhostButton icon={ReceiptIcon} onClick={() => setReceiptPaymentId(p.id)}>Receipt</GhostButton>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <CashReceiptModal
        open={!!receipt}
        onClose={() => setReceiptPaymentId(null)}
        pages={receipt?.pages || []}
        receiptNo={receipt?.receiptNo || ""}
        date={receipt ? fmtDate(receipt.date) : ""}
        method={receipt?.method || ""}
        cashierName={receipt?.cashierName || ""}
        voidedLines={receipt?.voidedLines || []}
        allVoided={receipt?.allVoided || false}
        copyType="paid"
      />
    </div>
  );
}

function MessagesPage({ target, clearTarget }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myId = auth.currentUser.id;
  const myConvos = db.conversations.filter((c) => c.participantIds.includes(myId));
  const [activeConv, setActiveConv] = useState(null);
  const [text, setText] = useState("");
  const bottomRef = useRef(null);
  const presenceMap = usePresenceMap();
  const otherTypingId = useOtherTyping(activeConv, myId);
  const { notifyTyping, notifyStopTyping } = useTypingBroadcaster(activeConv, myId);

  useEffect(() => {
    if (target) {
      const convId = data.getOrCreateConversation(myId, target);
      setActiveConv(convId);
      clearTarget();
    }
  }, [target]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [activeConv, db.messages.length]);
  useEffect(() => { if (activeConv) data.markMessagesRead(activeConv, myId); }, [activeConv, db.messages.length]);

  const conv = myConvos.find((c) => c.id === activeConv);
  const otherId = conv?.participantIds.find((id) => id !== myId);
  const other = otherId ? data.getUser(otherId) : null;
  const msgs = activeConv ? db.messages.filter((m) => m.conversationId === activeConv).sort((a, b) => a.createdAt - b.createdAt) : [];

  function send(e) {
    e && e.preventDefault && e.preventDefault();
    if (!text.trim() || !activeConv) return;
    data.sendMessage(activeConv, myId, text.trim());
    setText("");
    notifyStopTyping();
  }

  // Directory to start new conversations
  const directory = db.users.filter((u) => u.id !== myId && (
    auth.currentUser.role === ROLES.ADMIN ||
    (auth.currentUser.role === ROLES.PARENT && u.role === ROLES.TEACHER) ||
    (auth.currentUser.role === ROLES.TEACHER && u.role === ROLES.PARENT)
  ));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-3">Messages</h1>
      <Card className="overflow-hidden flex flex-col" style={{ height: "calc(100vh - 150px)", minHeight: 520 }}>
        <div className="flex flex-1 min-h-0">
          <div className={`w-full sm:w-72 border-r border-slate-100 flex-col ${activeConv ? "hidden sm:flex" : "flex"}`}>
            <div className="px-3 py-2.5 border-b border-slate-100"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Conversations</p></div>
            <div className="overflow-y-auto flex-1">
              {myConvos.length === 0 && <div className="p-4"><EmptyState title="No conversations" description="Start a conversation from the directory below." /></div>}
              {myConvos.map((c) => {
                const oid = c.participantIds.find((id) => id !== myId);
                const ou = data.getUser(oid);
                const cmsgs = db.messages.filter((m) => m.conversationId === c.id).sort((a, b) => b.createdAt - a.createdAt);
                const last = cmsgs[0];
                const unread = cmsgs.filter((m) => m.senderId !== myId && !m.read).length;
                if (!ou) return null;
                const ouOnline = isOnline(presenceMap[ou.id]);
                return (
                  <button key={c.id} onClick={() => setActiveConv(c.id)} className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 ${activeConv === c.id ? "bg-sky-50" : ""}`}>
                    <div className="relative shrink-0">
                      <Avatar name={ou.name} photo={ou.photo} size={34} />
                      {ouOnline && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-700 truncate">{ou.name}</p>{unread > 0 && <span className="w-4 h-4 rounded-full bg-sky-600 text-white text-[9px] flex items-center justify-center">{unread}</span>}</div>
                      <p className="text-xs text-slate-400 truncate">{last?.text || "No messages yet"}</p>
                    </div>
                  </button>
                );
              })}
              <div className="px-3 py-2 border-t border-slate-100 mt-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Start new</p>
                {directory.filter((u) => !myConvos.some((c) => c.participantIds.includes(u.id))).slice(0, 6).map((u) => (
                  <button key={u.id} onClick={() => setActiveConv(data.getOrCreateConversation(myId, u.id))} className="w-full flex items-center gap-2 px-1 py-1.5 text-left hover:bg-slate-50 rounded-lg">
                    <Avatar name={u.name} photo={u.photo} size={26} /><span className="text-xs text-slate-600">{u.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={`flex-1 flex-col ${activeConv ? "flex" : "hidden sm:flex"}`}>
            {!other ? <div className="flex-1 flex items-center justify-center"><EmptyState icon={MessageSquare} title="Select a conversation" description="Choose a conversation to start messaging." /></div> : (
              <>
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2.5">
                  <button className="sm:hidden text-slate-400" onClick={() => setActiveConv(null)}><ChevronLeft size={18} /></button>
                  <div className="relative shrink-0">
                    <Avatar name={other.name} photo={other.photo} size={32} />
                    {isOnline(presenceMap[other.id]) && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{other.name}</p>
                    <p className="text-xs text-slate-400">
                      <span className="capitalize">{other.role.toLowerCase()}</span>
                      {isOnline(presenceMap[other.id]) ? " • Online" : presenceMap[other.id] ? ` • Last seen ${timeAgo(presenceMap[other.id])}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                  {msgs.map((m) => {
                    const mine = m.senderId === myId;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-sky-600 text-white rounded-br-sm" : "bg-slate-100 text-slate-700 rounded-bl-sm"}`}>
                          <p>{m.text}</p>
                          <p className={`text-[10px] mt-1 flex items-center gap-1 justify-end ${mine ? "text-sky-100" : "text-slate-400"}`}>
                            {fmtTime(m.createdAt)}
                            {mine && (m.read ? <CheckCheck size={12} /> : <Check size={12} />)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {otherTypingId === other.id && (
                    <div className="flex justify-start"><div className="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm bg-slate-100 text-slate-400 italic rounded-bl-sm">{other.name.split(" ")[0]} is typing…</div></div>
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="p-3 border-t border-slate-100 flex items-center gap-2">
                  <input value={text} onChange={(e) => { setText(e.target.value); notifyTyping(); }} onKeyDown={(e) => { if (e.key === "Enter") send(e); }} placeholder="Type a message…" className={inputCls} />
                  <button type="button" onClick={send} className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg p-2.5 shrink-0"><Send size={16} /></button>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// Rebuilds a payslip from a recorded payroll payment — the entry point for a Salary Paid
// notification's "View Payslip" link. Re-derives that month's PAID/PARTIAL status and running
// total from staffSalarySummary rather than freezing it at send time, so the payslip still
// reflects reality if another payment was recorded against the same month afterwards.
function payslipFor(data, paymentId) {
  const payment = data.db.payrollPayments.find((p) => p.id === paymentId);
  if (!payment) return null;
  const staff = data.db.staff.find((s) => s.id === payment.staffId);
  if (!staff) return null;
  const summary = data.staffSalarySummary(staff.id);
  const row = summary?.rows.find((r) => r.month === payment.month);
  return {
    payment, staff,
    monthLabel: monthLabel(payment.month),
    status: row?.status || "PARTIAL",
    remaining: row?.remaining ?? 0,
    recordedByName: data.userIdentity(payment.recordedBy).display,
  };
}

function PayslipRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium text-right">{value}</span>
    </div>
  );
}

function PayslipModal({ paymentId, onClose }) {
  const data = useData();
  const slip = paymentId ? payslipFor(data, paymentId) : null;
  const printRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!printRef.current || !slip) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(printRef.current, `Payslip-${slip.staff.name}-${slip.monthLabel}.pdf`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal open={!!paymentId} onClose={onClose} title="Salary Payslip">
      {!slip ? (
        <p className="text-sm text-slate-400">This payslip is no longer available.</p>
      ) : (
        <div className="payslip-print" ref={printRef}>
          <div className="flex flex-col items-center text-center mb-4">
            <Logo size={44} />
            <p className="text-sm font-semibold text-slate-800 mt-1">Tilmaan Modern Academy</p>
            <p className="text-xs text-slate-400">Salary Payslip — {slip.monthLabel}</p>
          </div>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4">
            <PayslipRow label="Employee" value={data.staffIdentity(slip.staff).display} />
            <PayslipRow label="Position" value={slip.staff.position} />
            <PayslipRow label="Pay Period" value={slip.monthLabel} />
            <PayslipRow label="Payment Date" value={fmtDate(slip.payment.date)} />
            <PayslipRow label="Payment Method" value={slip.payment.method} />
            {slip.payment.allowances > 0 && <PayslipRow label="Allowances" value={formatMoney(slip.payment.allowances)} />}
            {slip.payment.deductions > 0 && <PayslipRow label="Deductions" value={`-${formatMoney(slip.payment.deductions)}`} />}
            {slip.payment.advanceApplied > 0 && <PayslipRow label="Advance Applied" value={`-${formatMoney(slip.payment.advanceApplied)}`} />}
            {slip.payment.note && <PayslipRow label="Note" value={slip.payment.note} />}
            {slip.payment.reference && <PayslipRow label="Reference" value={slip.payment.reference} />}
            <PayslipRow label="Recorded by" value={slip.recordedByName} />
          </div>
          <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-600">Amount Paid</span>
            <span className="text-lg font-bold text-emerald-700">{formatMoney(slip.payment.amount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Status for {slip.monthLabel}</span>
            <PaymentStatusBadge status={slip.status} />
          </div>
          {slip.status === "PARTIAL" && <p className="text-xs text-amber-600 mt-1">{formatMoney(slip.remaining)} still outstanding for this month.</p>}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4 no-print">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
        {slip && (
          <button onClick={handleDownload} disabled={downloading} className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-60">
            <Printer size={15} /> {downloading ? "Preparing…" : "Download Payslip"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// Every navigable type's row hint — shown only when the notification actually carries a
// destination (an announcementId, a navigation payload, or the payment/payroll special fields).
// A type with no destination (e.g. a teacher's own "you were marked late") simply gets no hint —
// it still marks read on click, it just doesn't pretend to go anywhere.
const NOTIFICATION_NAV_HINT = {
  MESSAGE: "Open conversation", HOMEWORK: "View Homework", ATTENDANCE: "View Attendance",
  BEHAVIOR: "View Record", RESULT: "View Results", EXAM: "View Details",
  LEAVE: "View Request", SCHEDULE: "View Timetable",
};

function NotificationsPage({ onOpen }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const [receiptPaymentId, setReceiptPaymentId] = useState(null);
  const [payslipPaymentId, setPayslipPaymentId] = useState(null);
  const [announcementDetail, setAnnouncementDetail] = useState(null);
  const mine = db.notifications.filter((n) => n.userId === auth.currentUser.id).sort((a, b) => b.createdAt - a.createdAt);
  const unread = mine.filter((n) => !n.read).length;
  const typeIcon = { HOMEWORK: ClipboardList, ATTENDANCE: ClipboardCheck, RESULT: FileBarChart, BEHAVIOR: AlertTriangle, ANNOUNCEMENT: Megaphone, MESSAGE: MessageSquare, SCHEDULE: CalendarDays, PAYMENT: Wallet, PAYROLL: Banknote, LEAVE: ShieldCheck, EXAM: FileBarChart };

  // A parent only ever sees their own connected children's lines from the receipt, even though
  // the underlying payment may include another sibling paid for in the same transaction; Owner/
  // Finance (who don't currently receive PAYMENT notifications, but may in future) see the
  // complete original receipt.
  const isParent = auth.currentUser.role === ROLES.PARENT;
  const receipt = receiptPaymentId ? receiptForPayment(data, receiptPaymentId, isParent ? new Set(auth.currentUser.childIds || []) : null) : null;

  function navHintFor(n) {
    if (n.type === "PAYMENT" && n.paymentId) return "View Receipt";
    if (n.type === "PAYROLL" && n.paymentId) return "View Payslip";
    if (n.type === "ANNOUNCEMENT" && n.announcementId) return "View Announcement";
    if (n.navigation) return NOTIFICATION_NAV_HINT[n.type] || null;
    return null;
  }

  function openNotification(n) {
    data.markNotificationRead(n.id);
    if (n.type === "PAYMENT" && n.paymentId) { setReceiptPaymentId(n.paymentId); return; }
    if (n.type === "PAYROLL" && n.paymentId) { setPayslipPaymentId(n.paymentId); return; }
    if (n.type === "ANNOUNCEMENT" && n.announcementId) {
      const ann = db.announcements.find((a) => a.id === n.announcementId);
      if (ann) setAnnouncementDetail(ann);
      return;
    }
    if (n.navigation && onOpen) onOpen(n.navigation);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Notifications</h1>
        {unread > 0 && <GhostButton icon={Check} onClick={() => data.markAllNotificationsRead(auth.currentUser.id)}>Mark all as read</GhostButton>}
      </div>
      <p className="text-sm text-slate-400 mb-4">{unread} unread notification{unread !== 1 ? "s" : ""}.</p>
      {mine.length === 0 ? <EmptyState icon={Bell} title="No notifications yet" description="You're all caught up. Updates will appear here." /> : (
        <Card className="divide-y divide-slate-100">
          {mine.map((n) => {
            const Icon = typeIcon[n.type] || Bell;
            const hint = navHintFor(n);
            return (
              <button key={n.id} onClick={() => openNotification(n)} className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${!n.read ? "bg-sky-50/40" : ""}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${!n.read ? "bg-sky-100 text-sky-600" : "bg-slate-100 text-slate-400"}`}><Icon size={15} /></div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read ? "font-semibold text-slate-800" : "text-slate-600"}`}>{n.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
                  {n.image && <img src={n.image} alt="Payment details" className="mt-2 w-32 h-32 object-cover rounded-lg border border-slate-200" />}
                  {hint && <p className="text-xs font-medium text-sky-600 mt-1">{hint} →</p>}
                  <p className="text-[11px] text-slate-300 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-sky-500 mt-1.5 shrink-0" />}
              </button>
            );
          })}
        </Card>
      )}

      <CashReceiptModal
        open={!!receipt}
        onClose={() => setReceiptPaymentId(null)}
        pages={receipt?.pages || []}
        receiptNo={receipt?.receiptNo || ""}
        date={receipt ? fmtDate(receipt.date) : ""}
        method={receipt?.method || ""}
        cashierName={receipt?.cashierName || ""}
        voidedLines={receipt?.voidedLines || []}
        allVoided={receipt?.allVoided || false}
        copyType="paid"
      />
      <PayslipModal paymentId={payslipPaymentId} onClose={() => setPayslipPaymentId(null)} />
      <AnnouncementDetailModal announcement={announcementDetail} onClose={() => setAnnouncementDetail(null)} />
    </div>
  );
}

function ReportsPage() {
  const data = useData();
  const { db } = data;
  const todayKey = new Date().toISOString().slice(0, 10);
  const attendanceRate = (() => {
    const t = db.attendance.filter((a) => a.date === todayKey);
    return t.length ? Math.round((t.filter((a) => a.status === "Present").length / t.length) * 100) : 0;
  })();
  const avgResult = (() => {
    const withTotals = db.results.map((r) => resultTotals(r)).filter((t) => t.count > 0 && t.pct !== null);
    if (!withTotals.length) return null;
    return Math.round(withTotals.reduce((a, t) => a + t.pct, 0) / withTotals.length);
  })();
  const homeworkCompletion = 87; // configurable metric placeholder derived from mock engagement
  const behaviorByType = BEHAVIOR_TYPES.map((t) => ({ label: t, value: db.behaviorRecords.filter((b) => b.type === t).length })).filter((x) => x.value > 0);
  const maxB = Math.max(...behaviorByType.map((b) => b.value), 1);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Reports</h1>
      <p className="text-sm text-slate-400 mb-4">School-wide performance and activity summaries.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Attendance Today" value={`${attendanceRate}%`} icon={ClipboardCheck} tone="emerald" />
        <StatCard label="Average Academic Result" value={avgResult !== null ? `${avgResult}%` : "—"} icon={FileBarChart} tone="sky" />
        <StatCard label="Homework Completion" value={`${homeworkCompletion}%`} icon={ClipboardList} tone="indigo" />
        <StatCard label="Behavior Incidents" value={db.behaviorRecords.length} icon={AlertTriangle} tone="amber" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Class Attendance</h3>
          <div className="space-y-3">
            {db.classes.map((c) => {
              const students = db.students.filter((s) => s.classId === c.id);
              const att = db.attendance.filter((a) => a.classId === c.id && a.date === todayKey);
              const pct = att.length ? Math.round((att.filter((a) => a.status === "Present").length / att.length) * 100) : 0;
              return (
                <div key={c.id}>
                  <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">{c.grade}{c.section} ({students.length} students)</span><span className="font-medium text-slate-700">{pct}%</span></div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Behavior Incidents by Type</h3>
          {behaviorByType.length === 0 ? <EmptyState title="No records yet" /> : (
            <div className="space-y-3">
              {behaviorByType.map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">{b.label}</span><span className="font-medium text-slate-700">{b.value}</span></div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${(b.value / maxB) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SettingsPage({ role, connectChild }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [connectId, setConnectId] = useState("");
  const [connectMsg, setConnectMsg] = useState(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const [name, setName] = useState(auth.currentUser.name);
  const [phone, setPhone] = useState(auth.currentUser.phone || "");
  const [profileError, setProfileError] = useState("");

  useEffect(() => { setName(auth.currentUser.name); setPhone(auth.currentUser.phone || ""); }, [auth.currentUser.id]);

  function onPickPhoto(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      data.updateOwnProfile(auth.currentUser.id, { photo: reader.result });
      toast("Profile photo updated.", "success");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function removePhoto() {
    data.updateOwnProfile(auth.currentUser.id, { photo: null });
    toast("Profile photo removed.", "success");
  }

  function saveProfile(e) {
    e && e.preventDefault && e.preventDefault();
    setProfileError("");
    const res = data.updateOwnProfile(auth.currentUser.id, { name, phone });
    if (!res.ok) { setProfileError(res.message); return; }
    toast("Profile updated.", "success");
  }

  function doConnect(e) {
    e && e.preventDefault && e.preventDefault();
    const res = data.connectChild(auth.currentUser.id, connectId);
    setConnectMsg(res);
    if (res.ok) { setConnectId(""); toast(res.message, "success"); }
  }

  function submitPasswordChange(e) {
    e && e.preventDefault && e.preventDefault();
    setPwError("");
    if (!currentPw || !newPw || !confirmPw) { setPwError("Please fill in all three fields."); return; }
    if (newPw !== confirmPw) { setPwError("New password and confirmation don't match."); return; }
    const res = data.changePassword(auth.currentUser.id, currentPw, newPw);
    if (!res.ok) { setPwError(res.message); return; }
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setShowCurrentPw(false); setShowNewPw(false); setShowConfirmPw(false);
    toast("Password changed successfully.", "success");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Settings</h1>

      <Card className="p-5 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Profile</h3>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={auth.currentUser.name} photo={auth.currentUser.photo} size={56} />
          <div>
            <p className="text-sm font-semibold text-slate-700">{auth.currentUser.name}</p>
            <p className="text-xs text-slate-400">{auth.currentUser.email}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <label className="text-xs text-sky-600 font-medium cursor-pointer flex items-center gap-1.5">
                <Camera size={14} /> {auth.currentUser.photo ? "Replace photo" : "Change photo"}
                <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
              </label>
              {auth.currentUser.photo && <button type="button" onClick={removePhoto} className="text-xs text-red-500 font-medium">Remove photo</button>}
            </div>
          </div>
        </div>
        <div>
          <Field label="Full name" required><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+252 61..." /></Field>
          {profileError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{profileError}</p>}
          <PrimaryButton type="button" onClick={saveProfile} icon={Check}>Save Profile</PrimaryButton>
        </div>
      </Card>

      <Card className={`p-5 mb-4 ${auth.currentUser.mustChangePassword ? "border-amber-300 bg-amber-50" : ""}`}>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Change Password</h3>
        {auth.currentUser.mustChangePassword ? (
          <p className="text-xs text-amber-700 mb-3">This is a temporary password set by the administrator. Please choose a new password only you know.</p>
        ) : (
          <p className="text-xs text-slate-400 mb-3">Update your password. You'll need your current password to confirm it's you.</p>
        )}
        <div>
          <Field label="Current password" required>
            <div className="relative">
              <input type={showCurrentPw ? "text" : "password"} className={inputCls + " pr-9"} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
              <button type="button" onClick={() => setShowCurrentPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title={showCurrentPw ? "Hide" : "Show"}>
                {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          <Field label="New password" required>
            <div className="relative">
              <input type={showNewPw ? "text" : "password"} className={inputCls + " pr-9"} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="At least 6 characters" />
              <button type="button" onClick={() => setShowNewPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title={showNewPw ? "Hide" : "Show"}>
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          <Field label="Confirm new password" required>
            <div className="relative">
              <input type={showConfirmPw ? "text" : "password"} className={inputCls + " pr-9"} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
              <button type="button" onClick={() => setShowConfirmPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title={showConfirmPw ? "Hide" : "Show"}>
                {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          {pwError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{pwError}</p>}
          <PrimaryButton type="button" onClick={submitPasswordChange} icon={Check}>Update Password</PrimaryButton>
        </div>
      </Card>

      {connectChild && (
        <Card className="p-5 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5"><UserPlus size={15} /> Connect a Child</h3>
          <p className="text-xs text-slate-400 mb-3">Enter the Student ID given to you by the school to link another child.</p>
          <div className="flex gap-2">
            <input value={connectId} onChange={(e) => setConnectId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doConnect(e); }} placeholder="e.g. TMA-2026-00031" className={inputCls} />
            <PrimaryButton type="button" onClick={doConnect} icon={Plus}>Connect</PrimaryButton>
          </div>
          {connectMsg && <p className={`text-xs mt-2 ${connectMsg.ok ? "text-emerald-600" : "text-red-600"}`}>{connectMsg.message}</p>}
        </Card>
      )}

      <Card className="p-5 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Notification Preferences</h3>
        {["Homework updates", "Attendance alerts", "Exam results", "Announcements", "Messages"].map((p) => (
          <label key={p} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
            <span className="text-sm text-slate-600">{p}</span>
            <input type="checkbox" defaultChecked className="rounded border-slate-300 text-sky-600" />
          </label>
        ))}
      </Card>

      {role === ROLES.ADMIN && (
        <Card className="p-5 border-amber-100">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Developer / Demo</h3>
          <p className="text-xs text-slate-400 mb-3">Restore the original demo dataset. This cannot be undone.</p>
          <GhostButton icon={RefreshCw} danger onClick={() => setConfirmReset(true)}>Reset Demo Data</GhostButton>
        </Card>
      )}
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} danger confirmLabel="Reset Data"
        title="Reset demo data?" description="This restores all students, teachers, parents, homework, and records to the original demo state."
        onConfirm={() => { data.resetDemoData(); toast("Demo data has been reset.", "info"); }} />
    </div>
  );
}


export {
  AdminDashboard, StudentsPage, AddStudentModal, StudentProfilePage, EditStudentModal,
  BehaviorModal, SuspendModal, ParentsPage, TeachersPage, TeacherFormModal, ClassesPage,
  ClassFormModal, AdminTimetablePage, AssignSubstituteModal, TodaysJournalSummaryCard,
  SelectSubjectModal, TimetableSettingsModal, AttendanceOverviewPage, AttendanceEditorModal, ClassMonthlyRegisterModal, StaffAttendancePage, LeaveApprovalsPage,
  StaffLeaveRequestForm, LeaveRequestHistoryList, HomeworkAdminPage, ResultsPage,
  AnnounceExamModal, SubjectSemesterResultsEditor, BehaviorAdminPage, AnnouncementsPage,
  CreateAnnouncementModal, PaymentsPage, FeeSettingsModal, RecordPaymentModal, ReminderModal,
  ParentPaymentsPage, MessagesPage, NotificationsPage, ReportsPage, SettingsPage, ReportCardsPage,
  PayslipModal,
};
