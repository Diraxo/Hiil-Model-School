import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, BookOpen, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info, UserPlus,
  Wallet, Bus, ImagePlus, BellRing, Banknote
} from "lucide-react";
import {
  ROLES, ROLE_LABEL, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, ATTENDANCE_STATUSES, SCHOOL_DAYS,
  todayDayName, academicYearStart, addMonthsFloat, feeCoverage,
  SUBJECTS, GRADES, SECTIONS, sectionLabel,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI,
} from "../../utils/constants";
import {
  uid, fmtDate, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor, monthLabel,
} from "../../utils/helpers";
import {
  inputCls, Logo, Badge, statusTone, resultTotals, Avatar, Modal, ConfirmDialog, EmptyState,
  CopyIdChip, Field, Card, StatCard, SimpleBar, todayKeyStr, shiftDateKey, dateKeyLabel, DateNav, AttendanceCalendarNotice, NoSchoolTodayBanner,
  Toolbar, SearchInput, Select, PrimaryButton, GhostButton, PaymentStatusBadge, AttendanceStatusPicker,
} from "../../components/ui";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { homeworkSummary, HomeworkList, HomeworkDetailsModal } from "../../components/homework";
import { AttendanceEditorModal, ClassMonthlyRegisterModal, StaffLeaveRequestForm, PayslipModal } from "../admin/AdminPages";
import { AdvanceHistoryList } from "../owner/OwnerPages";
import { LeaveRequestHistoryList } from "../../components/leave";
import { AnnouncementsPreviewCard } from "../../components/announcements";
import { useMutationGuard } from "../../hooks/useMutationGuard";


function TeacherDashboard({ setPage, openStudent }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myId = auth.currentUser.id;
  const myClasses = db.classes.filter((c) => c.subjectTeacherIds.includes(myId) || c.headTeacherId === myId);
  const myHeadClasses = db.classes.filter((c) => c.headTeacherId === myId);
  const myStudentIds = db.students.filter((s) => myClasses.some((c) => c.id === s.classId)).map((s) => s.id);
  const myHeadStudentIds = db.students.filter((s) => myHeadClasses.some((c) => c.id === s.classId)).map((s) => s.id);
  const myHomework = db.homework.filter((h) => h.teacherId === myId);
  const unreadMsgs = db.messages.filter((m) => { const c = db.conversations.find((cc) => cc.id === m.conversationId); return c?.participantIds.includes(myId) && m.senderId !== myId && !m.read; }).length;
  const todayKey = todayKeyStr();
  const todayInfo = data.classifyAttendanceDay(todayKey);
  // Gated on todayInfo.available so a same-day closure/weekend doesn't leave this snapshot
  // showing attendance counts recorded before the calendar override took effect.
  const attToday = todayInfo.available ? db.attendance.filter((a) => myHeadStudentIds.includes(a.studentId) && a.date === todayKey) : [];
  const myStaffRec = db.staff.find((s) => s.userId === myId);
  const myAttendanceToday = myStaffRec && db.staffAttendance.find((a) => a.staffId === myStaffRec.id && a.date === todayKey);
  const todaysPeriods = todayInfo.available ? db.timetableEntries.filter((e) => e.teacherId === myId && e.day === todayDayName()) : [];
  const upcomingExamAnnouncements = db.examAnnouncements.filter((a) =>
    myHeadClasses.some((c) => (a.audience.type === "ALL") || (a.audience.type === "GRADE" && a.audience.grade === c.grade) || (a.audience.type === "SECTION" && a.audience.grade === c.grade && a.audience.section === c.section))
    && new Date(a.examDate) >= new Date(new Date().toDateString())
  ).sort((a, b) => new Date(a.examDate) - new Date(b.examDate));
  const myAnnouncements = db.announcements.filter((a) =>
    a.audience.type === "ALL" || a.audience.type === "ALL_TEACHERS" || (a.audience.type === "USER" && a.audience.userId === myId)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Good morning, {auth.currentUser.name.split(" ")[0] === "Amina" ? "Ms. Amina" : auth.currentUser.name}</h1>
        <p className="text-sm text-slate-400 mt-0.5">{data.teacherSubjects(auth.currentUser.id).join(", ") || "Teacher"} • {fmtDate(new Date())}</p>
      </div>

      {auth.currentUser.mustChangePassword && (
        <Card className="p-4 border border-amber-200 bg-amber-50">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><ShieldAlert size={17} /></div>
              <div>
                <p className="text-sm font-semibold text-amber-800">Please change your password</p>
                <p className="text-xs text-amber-700 mt-0.5">You're still using the temporary password the administrator gave you. Set a new one only you know.</p>
              </div>
            </div>
            <button onClick={() => setPage("settings")} className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-1.5 shrink-0">Change Password</button>
          </div>
        </Card>
      )}

      <NoSchoolTodayBanner classification={todayInfo} />

      {myAttendanceToday && myAttendanceToday.status !== "Present" && (
        <Card className={`p-4 border ${myAttendanceToday.status === "Late" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
          <p className={`text-sm font-medium ${myAttendanceToday.status === "Late" ? "text-amber-800" : "text-red-800"}`}>
            Your attendance today: {myAttendanceToday.status}{myAttendanceToday.status === "Late" && myAttendanceToday.arrivalTime ? ` — arrived at ${to12Hour(myAttendanceToday.arrivalTime)}` : ""}
          </p>
        </Card>
      )}

      {upcomingExamAnnouncements.length > 0 && (
        <div className="space-y-2">
          {upcomingExamAnnouncements.map((a) => (
            <Card key={a.id} className="p-4 border border-sky-200 bg-sky-50">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0"><Megaphone size={17} /></div>
                <div>
                  <p className="text-sm font-semibold text-sky-800">Exam announced: {a.title}</p>
                  <p className="text-xs text-sky-700 mt-0.5">Scheduled {fmtDate(a.examDate)}. Enter results once it's complete.</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Assigned Classes" value={myClasses.length} icon={School} tone="sky" />
        <StatCard label="Students" value={myStudentIds.length} icon={GraduationCap} tone="indigo" />
        <StatCard label="Today's Classes" value={todaysPeriods.length} icon={CalendarDays} tone="sky" />
        <StatCard label="Pending Homework" value={myHomework.length} icon={ClipboardList} tone="emerald" />
        <StatCard label="Upcoming Exams" value={upcomingExamAnnouncements.length} icon={FileBarChart} tone="amber" />
        <StatCard label="Unread Messages" value={unreadMsgs} icon={MessageSquare} tone="red" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-slate-700">My Classes</h3><button onClick={() => setPage("classes")} className="text-xs text-sky-600 font-medium">View all</button></div>
          <div className="space-y-2">
            {myClasses.map((c) => {
              const cs = db.students.filter((s) => s.classId === c.id);
              return (
                <div key={c.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-medium text-slate-700 flex items-center gap-1.5">{c.grade}{c.section}{c.headTeacherId === myId && <Badge tone="sky">Head Teacher</Badge>}</span>
                  <span className="text-xs text-slate-400">{cs.length} students</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Today's Attendance Snapshot</h3>
          {myHeadClasses.length === 0 ? (
            <p className="text-xs text-slate-400">You're not a head teacher of any class, so attendance-taking isn't part of your role here.</p>
          ) : !todayInfo.available ? (
            <p className="text-xs text-slate-400">{todayInfo.label}{todayInfo.message ? ` — ${todayInfo.message}` : ""}</p>
          ) : (
            <>
              <SimpleBar segments={[
                { label: "Present", value: attToday.filter((a) => a.status === "Present").length, color: "bg-emerald-500" },
                { label: "Late", value: attToday.filter((a) => a.status === "Late").length, color: "bg-amber-400" },
                { label: "Sick", value: attToday.filter((a) => a.status === "Sick").length, color: "bg-indigo-400" },
                { label: "Permission", value: attToday.filter((a) => a.status === "Permission").length, color: "bg-sky-400" },
                { label: "Absent", value: attToday.filter((a) => a.status === "Absent").length, color: "bg-red-400" },
              ]} height={12} />
              <p className="text-xs text-slate-400 mt-3">{attToday.filter((a) => a.status === "Present").length} of {myHeadStudentIds.length} students present today in the classes you head.</p>
            </>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Homework</h3>
        {myHomework.length === 0 ? <EmptyState title="No homework yet" description="Homework you create will appear here." /> : (
          <div className="space-y-2">
            {[...myHomework].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((h) => (
              <div key={h.id} className="flex items-center justify-between text-sm px-1 py-1.5">
                <div><p className="text-slate-700">{h.title}</p><p className="text-xs text-slate-400">{h.grade}{h.section} • Due {fmtDate(h.dueDate)}</p></div>
                <Badge tone="sky">{h.subject}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AnnouncementsPreviewCard announcements={myAnnouncements} />
    </div>
  );
}

function TeacherClassesPage({ onOpen, onMessage }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myClasses = db.classes.filter((c) => c.subjectTeacherIds.includes(auth.currentUser.id) || c.headTeacherId === auth.currentUser.id);
  const [selected, setSelected] = useState(myClasses[0]?.id || null);
  const cls = db.classes.find((c) => c.id === selected);
  const students = cls ? data.attendanceRosterForClass(cls.id) : [];

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-4">My Classes</h1>
      <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
        {myClasses.map((c) => (
          <button key={c.id} onClick={() => setSelected(c.id)} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border ${selected === c.id ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {c.grade}{c.section}
            {c.headTeacherId === auth.currentUser.id && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${selected === c.id ? "bg-white/20 text-white" : "bg-sky-50 text-sky-600"}`}>Head Teacher</span>}
          </button>
        ))}
      </div>
      {cls && (
        <p className="text-xs text-slate-400 mb-4">{cls.headTeacherId === auth.currentUser.id ? "You're the head teacher of this class, so you can take its attendance." : "You teach a subject in this class. Only the head teacher can take attendance for it."}</p>
      )}
      {cls && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="text-left font-medium px-4 py-2.5 w-10">#</th><th className="text-left font-medium px-4 py-2.5">Student</th><th className="text-left font-medium px-4 py-2.5">Status</th><th className="px-4 py-2.5"></th></tr></thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 cursor-pointer" onClick={() => onOpen(s.id)}>
                      <div className="flex items-center gap-2.5"><Avatar name={data.studentFullName(s)} photo={s.photo} size={28} /><span className="font-medium text-slate-700">{data.studentFullName(s)}</span></div>
                    </td>
                    <td className="px-4 py-2.5"><Badge tone={statusTone(s.status)}>{s.status}</Badge></td>
                    <td className="px-4 py-2.5 text-right">
                      {s.parentIds[0] && <button onClick={() => onMessage(s.parentIds[0])} className="text-xs text-sky-600 font-medium">Message parent</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function TeacherTimetablePage() {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myId = auth.currentUser.id;
  const myClasses = db.classes.filter((c) => c.subjectTeacherIds.includes(myId) || c.headTeacherId === myId);
  const [hwPreset, setHwPreset] = useState(null); // { classId, subject } | null
  const [attendanceFor, setAttendanceFor] = useState(null); // timetableEntry | null
  // "No school today" (weekend/closure) only means today has no periods — it must not hide the
  // rest of the week's schedule, so the teacher can still browse other days and prepare ahead.
  const [view, setView] = useState("today"); // "today" | "week"
  const todayName = todayDayName();
  const todayInfo = data.classifyAttendanceDay(todayKeyStr());
  const myAttendanceToday = data.myAcademicActionStatusFor(auth.currentUser, todayKeyStr());
  const blockedToday = !data.canTeacherPerformAcademicAction(auth.currentUser, todayKeyStr());

  const todaysPeriods = todayInfo.available
    ? db.timetableEntries.filter((e) => e.teacherId === myId && e.day === todayName).sort((a, b) => {
        const clsA = data.getClass(a.classId), clsB = data.getClass(b.classId);
        return a.period - b.period || (clsA?.grade || "").localeCompare(clsB?.grade || "");
      })
    : [];
  // Periods where I'm covering for an absent colleague today also show up on my schedule.
  const substitutingPeriods = todayInfo.available
    ? db.substitutions.filter((s) => s.substituteTeacherId === myId && s.date === todayKeyStr())
        .map((s) => db.timetableEntries.find((e) => e.id === s.timetableEntryId))
        .filter(Boolean)
    : [];

  const schedule = data.periodSchedule();
  function slotFor(entry) { return schedule.periods.find((p) => p.period === entry.period); }
  function logFor(entry) { return db.periodLogs.find((l) => l.timetableEntryId === entry.id && l.date === todayKeyStr()); }
  function subFor(entry) { return db.substitutions.find((s) => s.timetableEntryId === entry.id && s.date === todayKeyStr()); }

  const myWeekEntries = db.timetableEntries.filter((e) => e.teacherId === myId);
  function weekEntryFor(day, period) { return myWeekEntries.find((e) => e.day === day && e.period === period); }
  function weekSubFor(entry) { return entry && entry.day === todayName ? db.substitutions.find((s) => s.timetableEntryId === entry.id && s.date === todayKeyStr()) : null; }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Timetable</h1>
      <p className="text-sm text-slate-400 mb-4">{todayInfo.available ? `Today's schedule — ${todayName}` : todayInfo.label}</p>

      <div className="flex gap-2 mb-4">
        {[["today", "Today"], ["week", "Full Week"]].map(([key, label]) => (
          <button key={key} onClick={() => setView(key)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border ${view === key ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>

      {view === "week" ? (
        myClasses.length === 0 ? (
          <EmptyState icon={School} title="No classes yet" description="You haven't been assigned to a class." />
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
                          const entry = weekEntryFor(day, p.period);
                          const sub = weekSubFor(entry);
                          const cls = entry ? data.getClass(entry.classId) : null;
                          const coveredByOther = sub && sub.substituteTeacherId !== myId;
                          return (
                            <td key={day} className={`px-3 py-2.5 align-top ${day === todayName ? "bg-sky-50/40" : ""}`}>
                              {entry ? (
                                <div>
                                  <p className="text-xs font-medium text-slate-700">{entry.subject}</p>
                                  <p className="text-[11px] text-slate-400">{cls ? data.classLabel(cls) : ""}</p>
                                  {coveredByOther && <p className="text-[10px] text-sky-600 mt-0.5">Covered by {data.getUser(sub.substituteTeacherId)?.name}</p>}
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
        )
      ) : !todayInfo.available ? (
        <NoSchoolTodayBanner classification={todayInfo} />
      ) : (
      <>
      {blockedToday && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">
            You're marked {myAttendanceToday.status.toLowerCase()} today — homework and marking periods done are unavailable until this is corrected or a substitute is assigned. Contact the Educational Director if this is wrong.
          </p>
        </Card>
      )}

      {substitutingPeriods.length > 0 && (
        <Card className="p-4 mb-4 border border-sky-200 bg-sky-50">
          <p className="text-sm font-medium text-sky-800 mb-1">You're covering {substitutingPeriods.length} period{substitutingPeriods.length === 1 ? "" : "s"} today</p>
          <div className="space-y-1">
            {substitutingPeriods.map((e) => {
              const cls = data.getClass(e.classId);
              const original = data.getUser(e.teacherId);
              return <p key={e.id} className="text-xs text-sky-700">Period {e.period} • {e.subject} • {cls ? data.classLabel(cls) : ""} — covering for {original?.name}</p>;
            })}
          </div>
        </Card>
      )}

      {myClasses.length === 0 ? (
        <EmptyState icon={School} title="No classes yet" description="You haven't been assigned to a class." />
      ) : todaysPeriods.length === 0 && substitutingPeriods.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No periods today" description="Your schedule for today will appear here once the admin builds the timetable." />
      ) : (
        <Card className="divide-y divide-slate-100">
          {[...todaysPeriods, ...substitutingPeriods].map((e) => {
            const cls = data.getClass(e.classId);
            const log = logFor(e);
            const sub = subFor(e);
            const isMyOwnPeriod = e.teacherId === myId;
            const coveredByOther = isMyOwnPeriod && sub && sub.substituteTeacherId !== myId;
            const covererCandidate = isMyOwnPeriod && !sub && log?.completedBy && log.completedBy !== myId ? data.getUser(log.completedBy) : null;
            const directCovererUser = covererCandidate && (covererCandidate.role === ROLES.OWNER || covererCandidate.role === ROLES.ADMIN) ? covererCandidate : null;
            const covererRoleLabel = directCovererUser ? ROLE_LABEL[directCovererUser.role] : null;
            const canTakeAttendance = data.canTakePeriodAttendance(e, todayKeyStr(), auth.currentUser);
            const attendanceTaken = log?.attendance;
            const presentCount = attendanceTaken ? log.attendance.filter((a) => a.status === "Present").length : 0;
            return (
              <div key={e.id + (isMyOwnPeriod ? "" : "-sub")} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Period {e.period} • {e.subject} • {cls ? data.classLabel(cls) : ""}
                    {!isMyOwnPeriod && <span className="text-sky-600"> (substituting)</span>}
                  </p>
                  {slotFor(e) && <p className="text-xs text-slate-400">{slotFor(e).startLabel}–{slotFor(e).endLabel}</p>}
                </div>
                {coveredByOther ? (
                  <Badge tone="sky">Covered by {data.getUser(sub.substituteTeacherId)?.name}</Badge>
                ) : directCovererUser ? (
                  <Badge tone="sky">Covered by {directCovererUser.name}{covererRoleLabel ? ` (${covererRoleLabel})` : ""}</Badge>
                ) : isMyOwnPeriod && blockedToday ? (
                  <Badge tone="amber">Unavailable — you're marked {myAttendanceToday.status.toLowerCase()}</Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <GhostButton icon={ClipboardList} onClick={() => setHwPreset({ classId: e.classId, subject: e.subject })}>Homework</GhostButton>
                    {!canTakeAttendance ? null : attendanceTaken ? (
                      <button onClick={() => setAttendanceFor(e)}><Badge tone="green">{presentCount}/{log.attendance.length} present · Edit</Badge></button>
                    ) : (
                      <PrimaryButton icon={Check} onClick={() => setAttendanceFor(e)}>Take Attendance</PrimaryButton>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
      </>
      )}
      <CreateHomeworkModal open={!!hwPreset} onClose={() => setHwPreset(null)} classes={myClasses} presetClassId={hwPreset?.classId} presetSubject={hwPreset?.subject} />
      <PeriodAttendanceModal entry={attendanceFor} date={todayKeyStr()} onClose={() => setAttendanceFor(null)} />
    </div>
  );
}

// Per-period, per-student attendance for the teacher (or substitute) currently assigned to a
// single timetable entry on a given date — mirrors AttendanceEditorModal's take/validate/save
// pattern (AdminPages.jsx) but scoped to one period instead of a whole class-day, and writes to
// db.periodLogs via data.savePeriodAttendance instead of the daily db.attendance collection.
function PeriodAttendanceModal({ entry, date, onClose }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const cls = entry ? data.getClass(entry.classId) : null;
  const students = cls ? data.attendanceRosterForClass(cls.id) : [];
  const log = entry ? db.periodLogs.find((l) => l.timetableEntryId === entry.id && l.date === date) : null;
  const [draft, setDraft] = useState({});
  const { busy, run } = useMutationGuard();

  useEffect(() => {
    if (!entry) return;
    const initial = {};
    students.forEach((s) => {
      const existing = log?.attendance?.find((a) => a.studentId === s.id);
      initial[s.id] = { status: existing?.status || null, note: existing?.note || "" };
    });
    setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, date]);

  function setStatus(id, status) { setDraft((d) => ({ ...d, [id]: { ...d[id], status } })); }
  function markAll(status) { const next = {}; students.forEach((s) => { next[s.id] = { ...draft[s.id], status }; }); setDraft(next); }
  function save() {
    if (!entry) return;
    if (students.some((s) => !draft[s.id]?.status)) { toast("Mark every student before saving — attendance never defaults to Present.", "error"); return; }
    const records = students.map((s) => ({ studentId: s.id, status: draft[s.id].status, note: draft[s.id]?.note || "" }));
    run(async () => {
      await data.savePeriodAttendance(entry.id, date, records, auth.currentUser.id);
      toast(`Attendance saved for Period ${entry.period} · ${entry.subject}.`, "success");
      onClose();
    }, { key: `save-period-attendance:${entry.id}:${date}` });
  }

  return (
    <Modal open={!!entry} onClose={onClose} title={entry ? `Take Attendance · Period ${entry.period} · ${entry.subject}` : ""} wide>
      {entry && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <p className="text-xs text-slate-400">{cls ? data.classLabel(cls) : ""} · {dateKeyLabel(date)}</p>
            {log?.attendanceMarkedBy && (
              <p className="text-xs text-slate-400">Recorded by <span className="text-slate-600 font-medium">{data.userIdentity(log.attendanceMarkedBy).display}</span>{log.attendanceMarkedAt ? ` · ${fmtDate(log.attendanceMarkedAt)} · ${fmtTime(log.attendanceMarkedAt)}` : ""}</p>
            )}
          </div>
          {students.length === 0 ? <p className="text-xs text-slate-300 py-2">No students in this class.</p> : (
            <>
              <Toolbar>
                <GhostButton icon={Check} onClick={() => markAll("Present")}>Mark all present</GhostButton>
                <GhostButton icon={AlertTriangle} onClick={() => markAll("Absent")}>Mark all absent</GhostButton>
              </Toolbar>
              <div className="divide-y divide-slate-100 border-t border-slate-100 max-h-[55vh] overflow-y-auto">
                {students.map((s, i) => (
                  <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0"><span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}.</span><Avatar name={data.studentFullName(s)} photo={s.photo} size={30} /><span className="text-sm font-medium text-slate-700 truncate">{data.studentFullName(s)}</span></div>
                    <AttendanceStatusPicker value={draft[s.id]?.status} onChange={(st) => setStatus(s.id, st)} />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                <PrimaryButton icon={Check} onClick={save} loading={busy} loadingText="Saving…">Save Attendance</PrimaryButton>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function TeacherHomeworkPage() {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const { db } = data;
  const [createOpen, setCreateOpen] = useState(false);
  const [open, setOpen] = useState(null); // homework | null
  const [editing, setEditing] = useState(null); // homework | null
  const [deleteTarget, setDeleteTarget] = useState(null); // homework | null
  const myClasses = db.classes.filter((c) => c.subjectTeacherIds.includes(auth.currentUser.id) || c.headTeacherId === auth.currentUser.id);
  const mine = [...db.homework.filter((h) => h.teacherId === auth.currentUser.id)].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.createdAt - a.createdAt);
  const summary = homeworkSummary(mine);
  const myAttendanceToday = data.myAcademicActionStatusFor(auth.currentUser, todayKeyStr());
  const todayClassification = data.classifySchoolDay(todayKeyStr());
  const blockedByCalendar = !todayClassification.available;
  const blockedToday = blockedByCalendar || !data.canTeacherPerformAcademicAction(auth.currentUser, todayKeyStr());

  async function confirmDelete() {
    if (!deleteTarget) return;
    const res = await data.deleteHomework(deleteTarget.id);
    setDeleteTarget(null);
    setOpen(null);
    toast(res.ok ? "Homework deleted." : res.message, res.ok ? "info" : "error");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-800">Homework</h1>
        {!blockedToday && <PrimaryButton onClick={() => setCreateOpen(true)}>Create Homework</PrimaryButton>}
      </div>
      <p className="text-sm text-slate-400 mb-4">Homework you've assigned to your classes.</p>

      {blockedToday && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">
            {blockedByCalendar
              ? (todayClassification.message || `${todayClassification.label} — creating homework is unavailable today.`)
              : `You're marked ${myAttendanceToday.status.toLowerCase()} today — creating homework is unavailable until this is corrected or a substitute is assigned.`}
          </p>
        </Card>
      )}

      {mine.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard label="Published Today" value={summary.publishedToday} icon={ClipboardList} tone="sky" />
          <StatCard label="Due Soon" value={summary.dueSoon} icon={CalendarDays} tone="amber" />
          <StatCard label="Overdue" value={summary.overdue} icon={AlertTriangle} tone="red" />
          <StatCard label="Total Published" value={summary.total} icon={CheckCircle2} tone="indigo" />
        </div>
      )}

      <HomeworkList
        list={mine}
        getTeacherName={() => auth.currentUser.name}
        onOpen={setOpen}
        emptyTitle="No homework yet"
        emptyDescription="Create homework for one of your classes to get started."
      />
      {mine.length === 0 && !blockedToday && <div className="mt-4"><PrimaryButton onClick={() => setCreateOpen(true)}>Create Homework</PrimaryButton></div>}

      <CreateHomeworkModal open={createOpen} onClose={() => setCreateOpen(false)} classes={myClasses} />
      <CreateHomeworkModal open={!!editing} onClose={() => setEditing(null)} classes={myClasses} editing={editing} />
      <HomeworkDetailsModal
        homework={open}
        teacherName={auth.currentUser.name}
        classLabel={open ? `${open.grade}${open.section}` : ""}
        onClose={() => setOpen(null)}
        onEdit={() => { setEditing(open); setOpen(null); }}
        onDelete={() => setDeleteTarget(open)}
      />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} danger confirmLabel="Delete Homework"
        title="Delete this homework?"
        description={deleteTarget ? `This removes "${deleteTarget.title}" for ${deleteTarget.grade}${deleteTarget.section}. Parents and students will no longer see it.` : ""}
        onConfirm={confirmDelete} />
    </div>
  );
}

// Also handles editing: pass `editing` (an existing homework record) to prefill the form and
// save via updateHomework instead of createHomework. Used both for the Create flow and, from
// TeacherHomeworkPage, the Edit flow — one modal instead of two nearly-identical ones.
function CreateHomeworkModal({ open, onClose, classes, presetClassId, presetSubject, editing }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const isEdit = !!editing;
  // Only subjects this teacher is actually assigned to teach in this specific class — a teacher
  // must not be able to publish homework for a subject they don't teach there, even if they teach
  // it in a different class or teach other subjects in this one.
  function subjectsForClass(classId) {
    return [...new Set(data.db.teacherAssignments.filter((ta) => ta.teacherId === auth.currentUser.id && ta.classId === classId).map((ta) => ta.subject))];
  }
  function blank() {
    const classId = presetClassId || classes[0]?.id || "";
    return { classId, subject: presetSubject || subjectsForClass(classId)[0] || "", title: "", description: "", dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) };
  }
  const [form, setForm] = useState(blank);
  const { busy, run } = useMutationGuard();
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const cls = classes.find((c) => c.grade === editing.grade && c.section === editing.section);
      setForm({ classId: cls?.id || editing.classId || "", subject: editing.subject, title: editing.title, description: editing.description || "", dueDate: editing.dueDate });
    } else {
      setForm(blank());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetClassId, presetSubject, editing]);
  const availableSubjects = subjectsForClass(form.classId);
  function set(k, v) {
    if (k === "classId") {
      // Changing the class can invalidate the previously-selected subject (a teacher's subject
      // assignments differ per class) — snap to the first subject actually taught in the new class.
      const nextSubjects = subjectsForClass(v);
      setForm((f) => ({ ...f, classId: v, subject: nextSubjects.includes(f.subject) ? f.subject : (nextSubjects[0] || "") }));
      return;
    }
    setForm((f) => ({ ...f, [k]: v }));
  }
  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!form.title.trim()) { toast("Please give the homework a title.", "error"); return; }
    const cls = classes.find((c) => c.id === form.classId);
    if (!cls) { toast("Please select a class.", "error"); return; }
    if (!isEdit && (!form.subject || !availableSubjects.includes(form.subject))) { toast("Please select a subject you teach in this class.", "error"); return; }
    run(async () => {
      if (isEdit) {
        const res = await data.updateHomework(editing.id, { subject: form.subject, grade: cls.grade, section: cls.section, title: form.title, description: form.description, dueDate: form.dueDate });
        toast(res.ok ? "Homework updated." : res.message, res.ok ? "success" : "error");
        if (res.ok) onClose();
      } else {
        const res = await data.createHomework({ subject: form.subject, grade: cls.grade, section: cls.section, title: form.title, description: form.description, dueDate: form.dueDate, teacherId: auth.currentUser.id });
        toast(res.ok ? "Homework published to parents." : res.message, res.ok ? "success" : "error");
        if (res.ok) { setForm(blank()); onClose(); }
      }
    }, { key: isEdit ? `update-homework:${editing.id}` : `create-homework:${form.classId}:${form.subject}:${form.title.trim()}:${form.dueDate}` });
  }
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Homework" : "Create Homework"} wide>
      <div>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Class" required>
            <select className={inputCls} value={form.classId} onChange={(e) => set("classId", e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.grade}{c.section}</option>)}
            </select>
          </Field>
          <Field label="Subject" required>
            {availableSubjects.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1.5">You're not assigned to teach any subject in this class.</p>
            ) : (
              <select className={inputCls} value={form.subject} onChange={(e) => set("subject", e.target.value)}>
                {/* Keep the original subject selectable while editing even if the teacher's assignment has since changed, so editing older homework never silently loses its subject. */}
                {!availableSubjects.includes(form.subject) && form.subject && <option value={form.subject}>{form.subject}</option>}
                {availableSubjects.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Title" required><input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. English Reading — Chapter 4" /></Field>
        <Field label="Description"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Instructions for students…" /></Field>
        <Field label="Due date">
          <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          {form.dueDate && !data.classifySchoolDay(form.dueDate).available && (
            <p className="text-xs text-amber-600 mt-1.5">{data.classifySchoolDay(form.dueDate).message}</p>
          )}
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <PrimaryButton type="button" onClick={submit} icon={Check} loading={busy} loadingText="Saving…">{isEdit ? "Save Changes" : "Publish Homework"}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Attendance is a Head Teacher responsibility, not a subject-teacher one — a teacher only sees
// classes here where they are the head teacher (see [[project_teacher_module_audit]]/screenshot
// bug: a subject-only class like "Grade 3B" must not appear at all, not as a disabled/view-only
// card). Classes taught as a subject teacher still show up elsewhere (My Classes, homework, etc.)
// via data.teacherClassIds — just not on this page. Reuses AttendanceEditorModal and
// ClassMonthlyRegisterModal from AdminPages.jsx so the take/view/register UI only exists once.
function TeacherAttendancePage() {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myId = auth.currentUser.id;
  const myClasses = db.classes.filter((c) => c.headTeacherId === myId);
  const bounds = data.attendanceDateBounds();
  const [dateKey, setDateKey] = useState(() => { const t = todayKeyStr(); return t > bounds.max ? bounds.max : t; });
  const [editor, setEditor] = useState(null); // { classId, dateKey, mode: "edit" | "view" } | null
  const [registerFor, setRegisterFor] = useState(null); // classId | null
  const [registerMonth, setRegisterMonth] = useState(() => bounds.max.slice(0, 7));
  const classification = data.classifyAttendanceDay(dateKey);
  const myAttendanceForDate = data.myAcademicActionStatusFor(auth.currentUser, dateKey);
  const blockedForDate = !data.canTeacherPerformAcademicAction(auth.currentUser, dateKey);

  if (myClasses.length === 0) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Attendance</h1>
        <EmptyState icon={ShieldAlert} title="No classes yet" description="You'll see attendance here once you're assigned as Head Teacher of a class. Subjects you teach in other classes appear under My Classes." />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Attendance</h1>
      <p className="text-sm text-slate-400 mb-3">Your Head Teacher classes. Classes where you only teach a subject aren't shown here — only the head teacher takes attendance for those.</p>
      <DateNav date={dateKey} onChange={setDateKey} minDate={bounds.min} maxDate={bounds.max} skipDates={(d) => !data.classifyAttendanceDay(d).available} />
      <AttendanceCalendarNotice classification={classification} />
      {blockedForDate && (
        <Card className="p-4 mb-3 border border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">
            You were marked {myAttendanceForDate.status.toLowerCase()} on {dateKeyLabel(dateKey)} — editing attendance for this date is unavailable until this is corrected or a substitute is assigned. You can still view what was recorded.
          </p>
        </Card>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {myClasses.map((c) => {
          const students = data.attendanceRosterForClass(c.id);
          const records = db.attendance.filter((a) => a.classId === c.id && a.date === dateKey);
          const summary = ATTENDANCE_STATUSES
            .map((st) => ({ st, n: records.filter((r) => r.status === st).length }))
            .filter((x) => x.n > 0)
            .map((x) => `${x.n} ${x.st}`)
            .join(" · ");
          const canAct = classification.available && students.length > 0 && !blockedForDate;
          return (
            <Card key={c.id} className="p-4 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-slate-700 flex items-center gap-1.5">{c.grade}{c.section}<Badge tone="sky">Head Teacher</Badge></h3>
                <Badge tone="slate">{students.length} student{students.length === 1 ? "" : "s"}</Badge>
              </div>
              <p className="text-xs text-slate-500 mb-3 flex-1">
                {!classification.available ? "Attendance unavailable for this date." : students.length === 0 ? "No students in this class." : summary || "Not taken"}
              </p>
              <div className="flex gap-2">
                {canAct ? (
                  <button onClick={() => setEditor({ classId: c.id, dateKey, mode: "edit" })} className="flex-1 text-xs text-white font-medium bg-sky-600 rounded-lg py-1.5 hover:bg-sky-700">{records.length > 0 ? "View & Edit" : "Take Attendance"}</button>
                ) : blockedForDate && classification.available && students.length > 0 && (
                  <button onClick={() => setEditor({ classId: c.id, dateKey, mode: "view" })} className="flex-1 text-xs text-slate-600 font-medium border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50">View</button>
                )}
                {students.length > 0 && (
                  <button onClick={() => setRegisterFor(c.id)} className="text-xs text-slate-500 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50" title="Monthly Register"><CalendarDays size={14} /></button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <ClassMonthlyRegisterModal
        classId={registerFor}
        monthKey={registerMonth}
        onMonthChange={setRegisterMonth}
        onClose={() => setRegisterFor(null)}
        onOpenDay={(day, mode) => setEditor({ classId: registerFor, dateKey: day, mode })}
        canManage
        blockedForDate={(day) => !data.canTeacherPerformAcademicAction(auth.currentUser, day)}
      />
      <AttendanceEditorModal classId={editor?.classId} dateKey={editor?.dateKey} mode={editor?.mode} onClose={() => setEditor(null)} />
    </div>
  );
}

// Lets a teacher request leave for themselves across a date range instead of it being marked
// day-by-day; the Educational Director/Owner approves it in LeaveApprovalsPage, which then
// auto-applies the status to every school day in range via data.decideLeaveRequest.
function StaffLeaveRequestPage() {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myId = auth.currentUser.id;
  const myStaffRec = db.staff.find((s) => s.userId === myId);

  if (!myStaffRec) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Leave Requests</h1>
        <EmptyState icon={ShieldAlert} title="No staff record found" description="Ask the school administrator to add you to staff before requesting leave." />
      </div>
    );
  }

  const myRequests = data.leaveRequestsFor("STAFF", myStaffRec.id);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Leave Requests</h1>
      <p className="text-sm text-slate-400 mb-4">Request leave for a date range instead of marking each day yourself — once approved, it's applied to your attendance automatically.</p>
      <StaffLeaveRequestForm staffId={myStaffRec.id} requestedBy={myId} />
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your requests</p>
      <LeaveRequestHistoryList requests={myRequests} />
    </div>
  );
}

// Self-service salary history — the same payslip a "Salary Paid" notification links to, but
// reachable any time from the sidebar rather than only from that one notification.
function MySalaryPage() {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const myId = auth.currentUser.id;
  const myStaffRec = db.staff.find((s) => s.userId === myId);
  const [payslipPaymentId, setPayslipPaymentId] = useState(null);

  if (!myStaffRec) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-slate-800 mb-1">My Salary</h1>
        <EmptyState icon={Banknote} title="No staff record found" description="Ask the school administrator to add you to staff to see your salary history." />
      </div>
    );
  }

  const summary = data.staffSalarySummary(myStaffRec.id);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">My Salary</h1>
      <p className="text-sm text-slate-400 mb-4">Your monthly salary and payment history. Tap a paid month to view its payslip.</p>

      <div className={`grid ${summary.advanceBalance > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-3 mb-4`}>
        <Card className="p-3.5"><p className="text-xs text-slate-400 mb-1">Monthly Salary</p><p className="text-sm font-semibold text-slate-800">{formatMoney(myStaffRec.salary)}/mo</p></Card>
        <Card className="p-3.5"><p className="text-xs text-slate-400 mb-1">Total paid</p><p className="text-sm font-semibold text-emerald-700">{formatMoney(summary.totalPaid)}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-slate-400 mb-1">Net Pay</p><p className="text-sm font-semibold text-amber-600">{formatMoney(summary.outstanding)}</p></Card>
        {summary.advanceBalance > 0 && <Card className="p-3.5"><p className="text-xs text-slate-400 mb-1">Advance balance</p><p className="text-sm font-semibold text-indigo-600">{formatMoney(summary.advanceBalance)}</p></Card>}
      </div>
      <Card className="p-3.5 mb-4">
        <p className="text-xs text-slate-400 mb-1">Bank account</p>
        <p className="text-sm font-semibold">{myStaffRec.bankAccount ? <span className="text-slate-800">{myStaffRec.bankAccount}</span> : <span className="text-amber-600">Not provided</span>}</p>
      </Card>
      <AdvanceHistoryList staff={myStaffRec} />

      <Card className="divide-y divide-slate-100">
        {[...summary.rows].reverse().map((r) => {
          const clickable = !!r.payment;
          const Row = clickable ? "button" : "div";
          return (
            <Row
              key={r.month}
              {...(clickable ? { onClick: () => setPayslipPaymentId(r.payment.id) } : {})}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left ${clickable ? "hover:bg-slate-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><Banknote size={15} /></div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{monthLabel(r.month)}</p>
                  <p className="text-xs text-slate-400">{r.payment ? `${fmtDate(r.payment.date)} · ${r.payment.method}` : "No payment recorded yet"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600">{formatMoney(r.paidThisMonth)}</span>
                <PaymentStatusBadge status={r.status} />
                {clickable && <ChevronRight size={15} className="text-slate-300" />}
              </div>
            </Row>
          );
        })}
      </Card>

      <PayslipModal paymentId={payslipPaymentId} onClose={() => setPayslipPaymentId(null)} />
    </div>
  );
}


export {
  TeacherDashboard, TeacherClassesPage, TeacherTimetablePage, TeacherHomeworkPage,
  CreateHomeworkModal, TeacherAttendancePage, StaffLeaveRequestPage, MySalaryPage,
  PeriodAttendanceModal,
};
