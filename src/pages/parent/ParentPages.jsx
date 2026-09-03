import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, BookOpen, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info,
  Wallet, Bus, ImagePlus, BellRing, FileText
} from "lucide-react";
import {
  ROLES, ROLE_LABEL, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, LEAVE_REQUEST_REASONS, SCHOOL_DAYS,
  todayDayName, dayNameForDate, academicYearStart, addMonthsFloat, feeCoverage,
  SUBJECTS, GRADES, SECTIONS, sectionLabel,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI,
  SEMESTERS, SEMESTER_LABEL, ASSESSMENT_COMPONENTS, ASSESSMENT_COMPONENT_LABEL, ASSESSMENT_COMPONENT_WEIGHT,
} from "../../utils/constants";
import {
  uid, fmtDate, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor,
} from "../../utils/helpers";
import {
  inputCls, Logo, Badge, statusTone, resultTotals, Avatar, Modal, ConfirmDialog, EmptyState,
  CopyIdChip, Field, Card, StatCard, SimpleBar, todayKeyStr, shiftDateKey, dateKeyLabel, DateNav, AttendanceCalendarNotice, NoSchoolTodayBanner,
  Toolbar, SearchInput, Select, PrimaryButton, GhostButton,
} from "../../components/ui";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { ReportCardModal } from "../../components/ReportCard";
import { homeworkSummary, HomeworkList, HomeworkDetailsModal } from "../../components/homework";
import { LeaveRequestHistoryList } from "../../components/leave";
import { AnnouncementsPreviewCard } from "../../components/announcements";
import { DocumentViewerModal } from "../../components/DocumentViewer";
import { useMutationGuard } from "../../hooks/useMutationGuard";

// Mirrors AdminPages.jsx's DOCUMENT_CATEGORIES — the fixed set of categories documents are
// uploaded under, so this read-only parent view groups them the same way the school sees them.
const PARENT_DOCUMENT_CATEGORIES = ["Report Cards", "ID Documents", "Other Documents"];


function useMyChildren() {
  const data = useData();
  const auth = useAuth();
  const myChildIds = data.getUser(auth.currentUser.id)?.childIds || [];
  return data.db.students.filter((s) => myChildIds.includes(s.id));
}

function ChildSwitcher({ children, activeChildId, setActiveChildId }) {
  const data = useData();
  const preferredDefault = children.find((c) => c.status === "ACTIVE") || children[0];
  useEffect(() => { if (!activeChildId && preferredDefault) setActiveChildId(preferredDefault.id); }, [children]);
  if (children.length <= 1) return null;
  return (
    <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
      {children.map((c) => {
        const notActive = c.status !== "ACTIVE";
        return (
          <button key={c.id} onClick={() => setActiveChildId(c.id)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border whitespace-nowrap transition-colors ${activeChildId === c.id ? "bg-sky-600 border-sky-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            <Avatar name={data.studentFullName(c)} photo={c.photo} size={26} />
            <div className="text-left leading-tight">
              <p className="text-xs font-semibold">{data.studentFullName(c)}</p>
              <p className={`text-[10px] ${activeChildId === c.id ? "text-sky-100" : "text-slate-400"}`}>{c.grade}{c.section}</p>
            </div>
            {notActive && <Badge tone={activeChildId === c.id ? "slate" : "amber"}>No longer enrolled</Badge>}
          </button>
        );
      })}
    </div>
  );
}

function useActiveChild(activeChildId, setActiveChildId) {
  const children = useMyChildren();
  const preferredDefault = children.find((c) => c.status === "ACTIVE") || children[0];
  useEffect(() => { if (!activeChildId && preferredDefault) setActiveChildId(preferredDefault.id); }, [children, activeChildId]);
  const child = children.find((c) => c.id === activeChildId) || preferredDefault;
  return { children, child };
}

function announcementMatchesStudent(a, student) {
  if (a.audience.type === "ALL") return true;
  if (a.audience.type === "GRADE") return a.audience.grade === student.grade;
  if (a.audience.type === "SECTION") return a.audience.grade === student.grade && a.audience.section === student.section;
  return false;
}

function ParentDashboard({ activeChildId, setActiveChildId }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);

  if (children.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Welcome, {auth.currentUser.name.split(" ")[0]}</h1>
        <EmptyState icon={GraduationCap} title="No children connected yet" description="Please contact the school administration with your child's Student ID to connect them to your account." />
      </div>
    );
  }
  const hasActiveChild = children.some((c) => c.status === "ACTIVE");
  if (!hasActiveChild) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Welcome, {auth.currentUser.name.split(" ")[0]}</h1>
        <EmptyState icon={GraduationCap} title="No Active Children" description="Your account currently has no active students enrolled at Hiil Model School. Historical records for your children remain available to the school." />
      </div>
    );
  }
  if (!child) return null;

  if (child.status === "SUSPENDED") {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Welcome, {auth.currentUser.name.split(" ")[0]}</h1>
        <ChildSwitcher children={children} activeChildId={activeChildId} setActiveChildId={setActiveChildId} />
        <Card className="p-5 border-red-200 bg-red-50">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-2"><ShieldAlert size={18} /> {data.studentFullName(child)} is currently suspended</div>
          {child.suspension && (
            <>
              <p className="text-sm text-red-700">{fmtDate(child.suspension.startDate)} – {fmtDate(child.suspension.endDate)}</p>
              <p className="text-sm text-red-600 mt-2">{child.suspension.reason}</p>
              {child.suspension.notes && <p className="text-xs text-red-500 mt-1">{child.suspension.notes}</p>}
            </>
          )}
        </Card>
      </div>
    );
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayInfo = data.classifyAttendanceDay(todayKey);
  const att = db.attendance.find((a) => a.studentId === child.id && a.date === todayKey);
  const cls = data.getClass(child.classId);
  const todayName = todayDayName();
  const todaysPeriods = todayInfo.available ? db.timetableEntries.filter((e) => e.classId === child.classId && e.day === todayName).sort((a, b) => a.period - b.period) : [];
  const hw = db.homework.filter((h) => h.classId === child.classId).sort((a, b) => b.createdAt - a.createdAt);
  const newHw = hw.filter((h) => Date.now() - h.createdAt < 3 * 86400000);
  const upcomingExamAnnouncements = db.examAnnouncements.filter((a) => announcementMatchesStudent(a, child) && new Date(a.examDate) >= new Date(new Date().toDateString())).sort((a, b) => new Date(a.examDate) - new Date(b.examDate));
  // Only PUBLISHED/LOCKED results are visible to parents — a still-DRAFT score is never shown.
  // Scoped to the current academic year so a repeating child's prior-year results never show as
  // if they were "recent" — see resultsForStudentSemester.
  const results = data.resultsForStudentSemester(child.id, null).filter((r) => r.publishStatus === "PUBLISHED" || r.publishStatus === "LOCKED");
  const recentResults = results.map((r) => ({ ...r, totals: resultTotals(r) })).filter((r) => r.totals.count > 0).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const announcements = db.announcements.filter((a) => a.audience.type === "ALL" || a.audience.type === "ALL_PARENTS" || (a.audience.type === "GRADE" && a.audience.grade === child.grade) || (a.audience.type === "SECTION" && a.audience.grade === child.grade && a.audience.section === child.section));
  const behavior = db.behaviorRecords.filter((b) => b.studentId === child.id).sort((a, b) => b.createdAt - a.createdAt);
  const unreadMsgs = db.messages.filter((m) => { const c = db.conversations.find((cc) => cc.id === m.conversationId); return c?.participantIds.includes(auth.currentUser.id) && m.senderId !== auth.currentUser.id && !m.read; }).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Welcome, {auth.currentUser.name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-400 mt-0.5">Here's what happened with your {children.length > 1 ? "children" : "child"} today.</p>
      </div>

      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      <NoSchoolTodayBanner classification={todayInfo} />

      {upcomingExamAnnouncements.length > 0 && (
        <div className="space-y-2">
          {upcomingExamAnnouncements.map((a) => (
            <Card key={a.id} className="p-4 border border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><Megaphone size={17} /></div>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Upcoming Exam: {a.title}</p>
                  <p className="text-xs text-amber-700 mt-0.5">{a.message}</p>
                  <p className="text-xs text-amber-600 mt-1 font-medium">{fmtDate(a.examDate)} ({new Date(a.examDate).toLocaleDateString("en-GB", { weekday: "long" })})</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={data.studentFullName(child)} photo={child.photo} size={48} />
          <div><h2 className="font-semibold text-slate-800">{data.studentFullName(child)}</h2><p className="text-xs text-slate-400">{cls ? `${cls.grade}${cls.section}` : ""} • {child.studentId}</p></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">Today's Attendance</p>
            {!todayInfo.available ? <span className="text-xs text-slate-300">{todayInfo.label}</span> : att ? <Badge tone={statusTone(att.status)}>{att.status}</Badge> : <span className="text-xs text-slate-300">Not marked yet</span>}
          </div>
          <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">New Homework</p><p className="text-sm font-semibold text-slate-700">{newHw.length}</p></div>
          <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Upcoming Exams</p><p className="text-sm font-semibold text-slate-700">{upcomingExamAnnouncements.length}</p></div>
          <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400 mb-1">Unread Messages</p><p className="text-sm font-semibold text-slate-700">{unreadMsgs}</p></div>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Today's Classes{todayInfo.available && todayName ? ` — ${todayName}` : ""}</h3>
          {!todayInfo.available ? (
            <div className="flex items-start gap-2.5">
              <School size={16} className="shrink-0 mt-0.5 text-slate-400" />
              <div className="text-xs">
                <p className="font-semibold text-slate-700">{todayInfo.label}</p>
                <p className="text-slate-400 mt-0.5">{new Date(todayKey + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" })}, {fmtDate(todayKey)}</p>
                {todayInfo.message && <p className="text-slate-400 mt-0.5">{todayInfo.message}</p>}
              </div>
            </div>
          ) : todaysPeriods.length === 0 ? (
            <p className="text-xs text-slate-400">No periods scheduled today for {cls ? data.classLabel(cls) : "this class"}.</p>
          ) : (
            <div className="space-y-1.5">
              {todaysPeriods.map((e) => {
                const teacher = data.getUser(e.teacherId);
                const { substituteUser, directCovererUser, teacherAbsent, log } = data.getPeriodCoverage(e, todayKey);
                const covererRoleLabel = directCovererUser ? ROLE_LABEL[directCovererUser.role] : null;
                return (
                  <div key={e.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-slate-700 font-medium">{e.subject}</span>
                      <span className="text-slate-400"> — {teacher?.name}</span>
                      {substituteUser && <span className="text-sky-600"> · 🔄 Substitute: {substituteUser.name}</span>}
                      {directCovererUser && <span className="text-sky-600"> · 🔄 Covered by {directCovererUser.name}{covererRoleLabel ? ` (${covererRoleLabel})` : ""}</span>}
                    </div>
                    {substituteUser || directCovererUser ? (
                      <Badge tone="sky">Covered</Badge>
                    ) : teacherAbsent ? (
                      <Badge tone={teacherAbsent.status === "Late" ? "amber" : "red"}>{teacherAbsent.status}</Badge>
                    ) : (
                      <Badge tone={log?.status === "done" ? "green" : "slate"}>{log?.status === "done" ? "Done" : "Pending"}</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">New Homework</h3>
          {newHw.length === 0 ? <p className="text-xs text-slate-400">No new homework.</p> : newHw.slice(0, 3).map((h) => (
            <div key={h.id} className="flex items-center justify-between text-sm py-1.5"><span className="text-slate-700">{h.title}</span><span className="text-xs text-slate-400">Due {fmtDate(h.dueDate)}</span></div>
          ))}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Results</h3>
          {recentResults.length === 0 ? <p className="text-xs text-slate-400">No published results yet.</p> : recentResults.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1.5"><span className="text-slate-700">{r.subject} <span className="text-slate-400 text-xs">• {SEMESTER_LABEL[r.semester]}</span></span><span className="font-medium text-slate-600">{r.totals.total}%</span></div>
          ))}
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Behavior Updates</h3>
          {behavior.length === 0 ? <p className="text-xs text-slate-400">No records.</p> : behavior.slice(0, 3).map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm py-1.5"><span className="text-slate-700 truncate pr-2">{b.description.slice(0, 40)}{b.description.length > 40 ? "…" : ""}</span><Badge tone={b.type === "Positive" ? "green" : "amber"}>{b.type}</Badge></div>
          ))}
        </Card>
      </div>

      <AnnouncementsPreviewCard announcements={announcements} />
    </div>
  );
}

function ParentHomeworkPage({ activeChildId, setActiveChildId, focus, clearFocus }) {
  const data = useData();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  const [open, setOpen] = useState(null); // homework | null
  if (!child) return <EmptyState title="No children connected" description="Contact the school administration to connect a child before you can view homework." />;
  const hw = [...data.db.homework.filter((h) => h.classId === child.classId)].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.createdAt - a.createdAt);
  const summary = homeworkSummary(hw);
  // Live profile name while teacher_id resolves; teacher_name snapshot once the account is deleted
  // (homework is retained as academic history -- see migration 20260901020000).
  const hwTeacherName = (h) => data.getUser(h.teacherId)?.name || h.teacherName || null;

  // Deep-link from a "New homework" notification — jump straight to that item's detail modal.
  useEffect(() => {
    if (!focus || !focus.homeworkId) return;
    const match = hw.find((h) => h.id === focus.homeworkId);
    if (match) setOpen(match);
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Homework</h1>
      <p className="text-sm text-slate-400 mb-4">{data.studentFullName(child)}'s homework, by due date.</p>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      {hw.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard label="Published Today" value={summary.publishedToday} icon={ClipboardList} tone="sky" />
          <StatCard label="Due Soon" value={summary.dueSoon} icon={CalendarDays} tone="amber" />
          <StatCard label="Overdue" value={summary.overdue} icon={AlertTriangle} tone="red" />
          <StatCard label="Total Published" value={summary.total} icon={CheckCircle2} tone="indigo" />
        </div>
      )}

      <HomeworkList
        list={hw}
        getTeacherName={hwTeacherName}
        onOpen={setOpen}
        emptyTitle="No homework yet"
        emptyDescription="Homework assigned to your child's class will appear here."
      />

      <HomeworkDetailsModal homework={open} teacherName={open ? hwTeacherName(open) : null} classLabel={open ? `${open.grade}${open.section}` : ""} onClose={() => setOpen(null)} />
    </div>
  );
}

function ParentAttendancePage({ activeChildId, setActiveChildId, focus, clearFocus }) {
  const data = useData();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  const bounds = data.attendanceDateBounds();
  const [dateKey, setDateKey] = useState(() => { const t = todayKeyStr(); return t > bounds.max ? bounds.max : t; });

  // Deep-link from an "Attendance update" notification — jump straight to that day.
  useEffect(() => {
    if (!focus || !focus.date) return;
    setDateKey(focus.date);
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!child) return <EmptyState title="No children connected" description="Contact the school administration to connect a child before you can view attendance." />;
  const att = [...data.db.attendance.filter((a) => a.studentId === child.id)].sort((a, b) => b.date.localeCompare(a.date));
  // Same current-academic-year, Present+Late formula as the Overview tab / Students list
  // (data.studentAttendanceRate) — this used to be a separate Present-only, all-time calculation
  // here, which could show a different rate than every other page for the same child.
  const pct = data.studentAttendanceRate(child.id) ?? 0;
  const selectedRecord = att.find((a) => a.date === dateKey);
  const classification = data.classifyAttendanceDay(dateKey);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Attendance</h1>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      <p className="text-sm text-slate-400 mb-2">Check a specific day</p>
      <DateNav date={dateKey} onChange={setDateKey} minDate={bounds.min} maxDate={bounds.max} skipDates={(d) => !data.classifyAttendanceDay(d).available} />
      <AttendanceCalendarNotice classification={classification} />
      {classification.available && (
        <Card className="p-4 mb-4">
          {selectedRecord ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">{dateKeyLabel(dateKey)}</span>
              <Badge tone={statusTone(selectedRecord.status)}>{selectedRecord.status}</Badge>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No attendance recorded for {dateKeyLabel(dateKey)}.</p>
          )}
        </Card>
      )}

      {classification.available && <PeriodAttendanceSection child={child} dateKey={dateKey} />}

      <Card className="p-5 mb-4">
        <p className="text-xs text-slate-400 mb-2">Overall attendance rate</p>
        <p className="text-2xl font-semibold text-slate-800 mb-2">{pct}%</p>
        <SimpleBar segments={[
          { label: "Present", value: att.filter((a) => a.status === "Present").length, color: "bg-emerald-500" },
          { label: "Late", value: att.filter((a) => a.status === "Late").length, color: "bg-amber-400" },
          { label: "Sick", value: att.filter((a) => a.status === "Sick").length, color: "bg-indigo-400" },
          { label: "Permission", value: att.filter((a) => a.status === "Permission").length, color: "bg-sky-400" },
          { label: "Absent", value: att.filter((a) => a.status === "Absent").length, color: "bg-red-400" },
        ]} />
      </Card>
      {att.length === 0 ? <EmptyState title="No attendance recorded" /> : (
        <Card className="divide-y divide-slate-100">
          {att.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="text-slate-600">{fmtDate(a.date)}</span><Badge tone={statusTone(a.status)}>{a.status}</Badge></div>
          ))}
        </Card>
      )}
    </div>
  );
}

// Per-period attendance for the selected date — separate from the daily record above. Reuses
// data.getPeriodCoverage (also proven in ParentDashboard's "Today's Classes" card) so a formally
// assigned substitute and a directly-covering Educational Director/Owner both surface correctly,
// just parameterized by `dateKey` instead of hardcoded to today, plus each period's
// periodLogs.attendance joined down to this specific child.
function PeriodAttendanceSection({ child, dateKey }) {
  const data = useData();
  const { db } = data;
  const dayName = dayNameForDate(dateKey);
  const periods = dayName ? db.timetableEntries.filter((e) => e.classId === child.classId && e.day === dayName).sort((a, b) => a.period - b.period) : [];
  if (periods.length === 0) return null;

  return (
    <>
      <p className="text-sm text-slate-400 mb-2">Period attendance — {dateKeyLabel(dateKey)}</p>
      <Card className="divide-y divide-slate-100 mb-4">
        {periods.map((e) => {
          const teacher = data.getUser(e.teacherId);
          const { substituteUser, directCovererUser, teacherAbsent, log } = data.getPeriodCoverage(e, dateKey);
          const covererRoleLabel = directCovererUser ? ROLE_LABEL[directCovererUser.role] : null;
          const childRecord = log?.attendance?.find((a) => a.studentId === child.id);
          return (
            <div key={e.id} className="flex items-center justify-between text-sm px-4 py-2.5">
              <div>
                <p className="text-slate-700 font-medium">Period {e.period} · {e.subject}</p>
                <p className="text-xs text-slate-400">{substituteUser ? `Teacher: ${teacher?.name}` : directCovererUser ? `Original teacher: ${teacher?.name}` : teacher?.name}</p>
                {substituteUser && <p className="text-xs text-sky-600 mt-0.5">🔄 Substitute: {substituteUser.name}</p>}
                {directCovererUser && <p className="text-xs text-sky-600 mt-0.5">🔄 Covered by {directCovererUser.name}{covererRoleLabel ? ` (${covererRoleLabel})` : ""}</p>}
              </div>
              {childRecord ? (
                <Badge tone={statusTone(childRecord.status)}>{childRecord.status}</Badge>
              ) : substituteUser || directCovererUser ? (
                <Badge tone="sky">Not marked yet</Badge>
              ) : teacherAbsent ? (
                <Badge tone={teacherAbsent.status === "Late" ? "amber" : "red"}>Teacher absent</Badge>
              ) : (
                <Badge tone="slate">Not marked yet</Badge>
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}

// Lets a parent request leave for a child across a date range instead of it being marked
// day-by-day; the Educational Director/Owner approves it in LeaveApprovalsPage, which then
// auto-applies the status to every school day in range via data.decideLeaveRequest.
function StudentLeaveRequestPage({ activeChildId, setActiveChildId }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  const [form, setForm] = useState({ status: "Sick", fromDate: todayKeyStr(), toDate: todayKeyStr(), note: "" });
  const { busy, run } = useMutationGuard();
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  if (!child) return <EmptyState title="No children connected" description="Contact the school administration to connect a child before you can request leave." />;

  const myRequests = data.leaveRequestsFor("STUDENT", child.id);

  function submit() {
    if (form.fromDate > form.toDate) { toast("The start date must be before the end date.", "error"); return; }
    run(async () => {
      const res = await data.createLeaveRequest({ kind: "STUDENT", subjectId: child.id, requestedBy: auth.currentUser.id, status: form.status, fromDate: form.fromDate, toDate: form.toDate, note: form.note });
      if (!res?.ok) { toast(res?.message || "Couldn't submit the leave request.", "error"); return; }
      toast("Leave request submitted.", "success");
      setForm({ status: "Sick", fromDate: todayKeyStr(), toDate: todayKeyStr(), note: "" });
    }, { key: `student-leave-request:${child.id}:${form.fromDate}:${form.toDate}` });
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Leave Requests</h1>
      <p className="text-sm text-slate-400 mb-4">Request leave for {data.studentFullName(child)} across a date range instead of it being marked day by day.</p>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

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
        <Field label="Note"><textarea className={inputCls} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional details for the school" /></Field>
        <div className="flex justify-end"><PrimaryButton icon={Check} onClick={submit} loading={busy} loadingText="Submitting…">Submit Request</PrimaryButton></div>
      </Card>

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Past requests</p>
      <LeaveRequestHistoryList requests={myRequests} />
    </div>
  );
}

function ParentTimetablePage({ activeChildId, setActiveChildId }) {
  const data = useData();
  const { db } = data;
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  if (!child) return <EmptyState icon={CalendarDays} title="No children connected" description="Contact the school administration to connect a child before you can view their timetable." />;

  const cls = data.getClass(child.classId);
  const entries = db.timetableEntries.filter((e) => e.classId === child.classId);
  const schedule = data.periodSchedule();
  const todayName = todayDayName();
  const todayInfo = data.classifyAttendanceDay(todayKeyStr());

  function entryFor(day, period) { return entries.find((e) => e.day === day && e.period === period); }
  function coverageFor(entry) { return entry ? data.getPeriodCoverage(entry, todayKeyStr()) : null; }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Timetable</h1>
      <p className="text-sm text-slate-400 mb-4">{cls ? `Weekly schedule for ${data.classLabel(cls)}` : "Weekly schedule"}</p>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      <NoSchoolTodayBanner classification={todayInfo} />

      {!cls ? (
        <EmptyState icon={School} title="No class assigned" description="This child hasn't been assigned to a class yet." />
      ) : (
        <Card className="overflow-hidden">
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
                        const coverage = day === todayName ? coverageFor(entry) : null;
                        const covererRoleLabel = coverage?.directCovererUser ? ROLE_LABEL[coverage.directCovererUser.role] : null;
                        return (
                          <td key={day} className={`px-3 py-2.5 align-top ${day === todayName ? "bg-sky-50/40" : ""}`}>
                            {entry ? (
                              <div>
                                <p className="text-xs font-medium text-slate-700">{entry.subject}</p>
                                <p className="text-[11px] text-slate-400">{data.getUser(entry.teacherId)?.name || "Unassigned"}</p>
                                {coverage?.substituteUser && <p className="text-[10px] text-sky-600 mt-0.5">🔄 Substitute: {coverage.substituteUser.name}</p>}
                                {coverage?.directCovererUser && <p className="text-[10px] text-sky-600 mt-0.5">🔄 Covered by {coverage.directCovererUser.name}{covererRoleLabel ? ` (${covererRoleLabel})` : ""}</p>}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
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
      )}
    </div>
  );
}

function performanceLabel(pct) {
  if (pct >= 80) return { label: "Strong performance", tone: "green" };
  if (pct >= 60) return { label: "Developing", tone: "amber" };
  return { label: "Needs additional practice", tone: "red" };
}

function ParentResultsPage({ activeChildId, setActiveChildId, focus, clearFocus }) {
  const data = useData();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  const [semester, setSemester] = useState(SEMESTERS[0]);
  const [viewCard, setViewCard] = useState(false);
  const [evidenceView, setEvidenceView] = useState(null); // { title, files, initialIndex } | null

  // Deep-link from a "Results published"/"Report card published" notification.
  useEffect(() => {
    if (!focus) return;
    if (focus.semester) setSemester(focus.semester);
    if (focus.openReportCard) setViewCard(true);
    clearFocus && clearFocus();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!child) return <EmptyState title="No children connected" description="Contact the school administration to connect a child before you can view results." />;

  const reportCard = data.getReportCard(child.id, child.classId);
  const reportCardAvailable = reportCard && (reportCard.status === "PUBLISHED" || reportCard.status === "LOCKED");

  // Only PUBLISHED/LOCKED results are visible to parents — a still-DRAFT score never shows here.
  // Scoped to the current academic year so a repeating child's prior-year results (also
  // PUBLISHED/LOCKED, same semester) never mix into this list — see resultsForStudentSemester.
  const results = data.resultsForStudentSemester(child.id, semester)
    .filter((r) => r.publishStatus === "PUBLISHED" || r.publishStatus === "LOCKED")
    .map((r) => ({ ...r, totals: resultTotals(r) }))
    .filter((r) => r.totals.count > 0);
  const overallPct = results.length ? Math.round(results.reduce((a, r) => a + (r.totals.pct || 0), 0) / results.length) : null;
  const subjectAverages = results.map((r) => ({ subject: r.subject, avg: r.totals.pct }));
  const strongest = subjectAverages.length ? subjectAverages.reduce((a, b) => (a.avg > b.avg ? a : b)) : null;
  const weakest = subjectAverages.length ? subjectAverages.reduce((a, b) => (a.avg < b.avg ? a : b)) : null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Results</h1>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      {reportCardAvailable && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
            <span className="text-slate-600">Annual Report Card</span>
            <GhostButton onClick={() => setViewCard(true)}>View</GhostButton>
          </div>
        </Card>
      )}

      <div className="flex gap-1.5 mb-4">
        {SEMESTERS.map((s) => (
          <button key={s} onClick={() => setSemester(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${semester === s ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>{SEMESTER_LABEL[s]}</button>
        ))}
      </div>

      {results.length === 0 ? <EmptyState title="No published results yet" description="The school administers exams on paper — results appear here once the teacher publishes them." /> : (
        <>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <StatCard label="Overall Average" value={`${overallPct}%`} icon={FileBarChart} tone="sky" />
            {strongest && <StatCard label="Strongest Subject" value={strongest.subject} icon={TrendingUp} tone="emerald" sub={`${strongest.avg}%`} />}
            {weakest && <StatCard label="Focus Area" value={weakest.subject} icon={AlertTriangle} tone="amber" sub={`${weakest.avg}%`} />}
          </div>
          <Card className="divide-y divide-slate-100">
            {results.map((r) => {
              const perf = performanceLabel(r.totals.pct);
              return (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium text-slate-700">{r.subject}</p>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-700">{r.totals.total}%</p>
                      <Badge tone={perf.tone}>{perf.label}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                    {ASSESSMENT_COMPONENTS.map((c) => {
                      const comp = r.components?.[c];
                      const pages = comp?.sharedWithParents ? data.resultEvidenceFor(r.id, c) : [];
                      return (
                        <span key={c} className="inline-flex items-center gap-1">
                          {ASSESSMENT_COMPONENT_LABEL[c]}: {comp?.score != null ? `${comp.score}/${ASSESSMENT_COMPONENT_WEIGHT[c]}` : "Not yet recorded"}
                          {pages.length > 0 && (
                            <button onClick={() => setEvidenceView({ title: `${r.subject} — ${ASSESSMENT_COMPONENT_LABEL[c]}`, files: pages })} className="text-sky-600 hover:text-sky-700"><Eye size={12} /></button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}
      <ReportCardModal student={viewCard ? child : null} classId={child.classId} onClose={() => setViewCard(false)} />
      <DocumentViewerModal open={!!evidenceView} onClose={() => setEvidenceView(null)} title={evidenceView?.title} files={evidenceView?.files} initialIndex={evidenceView?.initialIndex} />
    </div>
  );
}

function ParentBehaviorPage({ activeChildId, setActiveChildId }) {
  const data = useData();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  if (!child) return <EmptyState title="No children connected" description="Contact the school administration to connect a child before you can view behavior records." />;
  const records = [...data.db.behaviorRecords.filter((b) => b.studentId === child.id)].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Behavior</h1>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />
      {records.length === 0 ? <EmptyState title="No behavior records" description="Positive notes and incidents will appear here." /> : (
        <Card className="divide-y divide-slate-100">
          {records.map((b) => (
            <div key={b.id} className="px-4 py-3">
              <div className="flex justify-between items-start mb-1"><Badge tone={b.type === "Positive" ? "green" : b.severity === "High" ? "red" : "amber"}>{b.type}</Badge><span className="text-xs text-slate-400">{fmtDate(b.date)}</span></div>
              <p className="text-sm text-slate-600">{b.description}</p>
              <p className="text-xs text-slate-400 mt-1">Action taken: {b.action}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}


// Read-only: parents view documents (report cards, ID copies, other files) the school has
// uploaded for their child, using the same in-app viewer as everywhere else — never a new tab.
// Uploading/deleting stays school-only (see UploadDocumentModal in AdminPages.jsx).
function ParentDocumentsPage({ activeChildId, setActiveChildId }) {
  const data = useData();
  const { children, child } = useActiveChild(activeChildId, setActiveChildId);
  const [viewDoc, setViewDoc] = useState(null);
  if (!child) return <EmptyState icon={FileText} title="No children connected" description="Contact the school administration to connect a child before you can view documents." />;
  const documents = data.db.studentDocuments.filter((doc) => doc.studentId === child.id);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Documents</h1>
      <p className="text-sm text-slate-400 mb-4">Documents the school has shared for {data.studentFullName(child)}.</p>
      <ChildSwitcher children={children} activeChildId={child.id} setActiveChildId={setActiveChildId} />

      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" description="Report cards, ID copies, and other files the school shares will appear here." />
      ) : (
        <div className="space-y-4">
          {PARENT_DOCUMENT_CATEGORIES.map((cat) => {
            const items = documents.filter((doc) => doc.category === cat).sort((a, b) => b.uploadedAt - a.uploadedAt);
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
                          <p className="text-xs text-slate-400">{fmtDate(doc.uploadedAt)}</p>
                        </div>
                      </div>
                      <GhostButton icon={Eye} onClick={() => setViewDoc(doc)}>View</GhostButton>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <DocumentViewerModal open={!!viewDoc} onClose={() => setViewDoc(null)} title={viewDoc?.title} fileName={viewDoc?.fileName} fileDataUrl={viewDoc?.fileDataUrl} fileType={viewDoc?.fileType} />
    </div>
  );
}


export {
  useMyChildren, ChildSwitcher, useActiveChild, announcementMatchesStudent,
  ParentDashboard, ParentHomeworkPage, ParentAttendancePage, StudentLeaveRequestPage, performanceLabel,
  ParentResultsPage, ParentBehaviorPage, ParentTimetablePage, ParentDocumentsPage,
};
