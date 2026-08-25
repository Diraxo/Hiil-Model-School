import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info, UserPlus,
  Wallet, Bus, ImagePlus, BellRing, Crown, ShieldCheck, Banknote, Receipt, History, ArrowLeftRight, Award, CreditCard, FileText,
} from "lucide-react";
import {
  ROLES, ROLE_LABEL, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, SCHOOL_DAYS,
  todayDayName, academicYearStart, addMonthsFloat, feeCoverage,
  SUBJECTS, GRADES, SECTIONS, sectionLabel,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI,
} from "../utils/constants";
import {
  inputCls, Logo, Badge, statusTone, resultTotals, Avatar, Modal, ConfirmDialog, EmptyState,
  CopyIdChip, Field, Card, StatCard, SimpleBar, todayKeyStr, shiftDateKey, dateKeyLabel, DateNav,
  Toolbar, SearchInput, Select, PrimaryButton, GhostButton,
} from "../components/ui";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { notificationPageKey } from "../utils/notifications";
import { canViewStudentPayments } from "../utils/studentPermissions";
import { canViewPayroll } from "../utils/payrollPermissions";
import { LoginScreen, RegisterScreen } from "../pages/auth/AuthPages";
import { StudentProfilePage } from "../pages/admin/AdminPages";
import {
  AdminDashboard, StudentsPage, ParentsPage, TeachersPage, ClassesPage,
  AdminTimetablePage, AttendanceOverviewPage, StaffAttendancePage, LeaveApprovalsPage, HomeworkAdminPage,
  ResultsPage, BehaviorAdminPage, AnnouncementsPage, PaymentsPage, MessagesPage,
  NotificationsPage, ReportsPage, SettingsPage, ParentPaymentsPage, ReportCardsPage,
} from "../pages/admin/AdminPages";
import {
  TeacherDashboard, TeacherClassesPage, TeacherTimetablePage, TeacherHomeworkPage, TeacherAttendancePage, StaffLeaveRequestPage, MySalaryPage,
} from "../pages/teacher/TeacherPages";
import {
  ParentDashboard, ParentHomeworkPage, ParentAttendancePage, StudentLeaveRequestPage, ParentResultsPage, ParentBehaviorPage, ParentTimetablePage, ParentDocumentsPage,
} from "../pages/parent/ParentPages";
import {
  OwnerDashboard, AccountsPage, StaffPage, PayrollPage, ExpensesPage, AuditLogPage,
  StaffProfilePage, PaymentMethodsPage,
} from "../pages/owner/OwnerPages";
import { FinanceDashboard } from "../pages/finance/FinancePages";


const NAV = {
  OWNER: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "students", label: "Students", icon: GraduationCap },
    { key: "parents", label: "Parents", icon: Users },
    { key: "teachers", label: "Teachers", icon: UserCog },
    { key: "classes", label: "Classes", icon: School },
    { key: "timetable", label: "Timetable", icon: CalendarDays },
    { key: "attendance", label: "Student Attendance", icon: ClipboardCheck },
    { key: "staffAttendance", label: "Staff Attendance", icon: ClipboardEdit },
    { key: "leaveRequests", label: "Leave & Permission", icon: ShieldCheck },
    { key: "homework", label: "Homework", icon: ClipboardList },
    { key: "exams", label: "Results", icon: FileBarChart },
    { key: "reportCards", label: "Report Cards", icon: Award },
    { key: "behavior", label: "Behavior & Discipline", icon: AlertTriangle },
    { key: "announcements", label: "Announcements", icon: Megaphone },
    { key: "payments", label: "Fees", icon: Wallet },
    { key: "staff", label: "Staff", icon: UserCog },
    { key: "payroll", label: "Payroll", icon: Banknote },
    { key: "expenses", label: "Expenses", icon: Receipt },
    { key: "paymentMethods", label: "Payment Methods", icon: CreditCard },
    { key: "accounts", label: "Accounts & Access", icon: Crown },
    { key: "auditLog", label: "Audit Log", icon: History },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "reports", label: "Reports", icon: TrendingUp },
    { key: "settings", label: "Settings", icon: Settings },
  ],
  FINANCE: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "payments", label: "Fees", icon: Wallet },
    { key: "staff", label: "Staff", icon: UserCog },
    { key: "payroll", label: "Payroll", icon: Banknote },
    { key: "expenses", label: "Expenses", icon: Receipt },
    { key: "paymentMethods", label: "Payment Methods", icon: CreditCard },
    { key: "staffAttendance", label: "Staff Attendance", icon: ClipboardEdit },
    { key: "leaveRequests", label: "Leave & Permission", icon: ShieldCheck },
    { key: "announcements", label: "Announcements", icon: Megaphone },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "settings", label: "Settings", icon: Settings },
  ],
  ADMIN: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "students", label: "Students", icon: GraduationCap },
    { key: "parents", label: "Parents", icon: Users },
    { key: "teachers", label: "Teachers", icon: UserCog },
    { key: "classes", label: "Classes", icon: School },
    { key: "timetable", label: "Timetable", icon: CalendarDays },
    { key: "attendance", label: "Student Attendance", icon: ClipboardCheck },
    { key: "staffAttendance", label: "Teachers Attendance", icon: ClipboardEdit },
    { key: "leaveRequests", label: "Leave & Permission", icon: ShieldCheck },
    { key: "homework", label: "Homework", icon: ClipboardList },
    { key: "exams", label: "Results", icon: FileBarChart },
    { key: "reportCards", label: "Report Cards", icon: Award },
    { key: "behavior", label: "Behavior & Discipline", icon: AlertTriangle },
    { key: "announcements", label: "Announcements", icon: Megaphone },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "reports", label: "Reports", icon: TrendingUp },
    { key: "settings", label: "Settings", icon: Settings },
  ],
  TEACHER: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "classes", label: "My Classes", icon: School },
    { key: "timetable", label: "Timetable", icon: CalendarDays },
    { key: "homework", label: "Homework", icon: ClipboardList },
    { key: "attendance", label: "Attendance", icon: ClipboardCheck },
    { key: "leaveRequests", label: "Leave Requests", icon: ShieldCheck },
    { key: "exams", label: "Results", icon: FileBarChart },
    { key: "announcements", label: "Announcements", icon: Megaphone },
    { key: "mySalary", label: "My Salary", icon: Banknote },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "settings", label: "Settings", icon: Settings },
  ],
  PARENT: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "timetable", label: "Timetable", icon: CalendarDays },
    { key: "homework", label: "Homework", icon: ClipboardList },
    { key: "attendance", label: "Attendance", icon: ClipboardCheck },
    { key: "leaveRequests", label: "Leave Requests", icon: ShieldCheck },
    { key: "exams", label: "Results", icon: FileBarChart },
    { key: "behavior", label: "Behavior", icon: AlertTriangle },
    { key: "announcements", label: "Announcements", icon: Megaphone },
    { key: "payments", label: "Payments", icon: Wallet },
    { key: "documents", label: "Documents", icon: FileText },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "settings", label: "Settings", icon: Settings },
  ],
};



function AppShell() {
  const auth = useAuth();
  const data = useData();
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const role = auth.currentUser.role;
  const nav = NAV[role];
  const myId = auth.currentUser.id;
  const unreadNotifs = data.db.notifications.filter((n) => n.userId === myId && !n.read).length;
  const unreadAnnouncements = new Set(
    data.db.notifications
      .filter((n) => n.userId === myId && !n.read && n.type === "ANNOUNCEMENT" && n.announcementId)
      .map((n) => n.announcementId)
  ).size;
  const unreadMsgs = data.db.messages.filter((m) => {
    const conv = data.db.conversations.find((c) => c.id === m.conversationId);
    return conv?.participantIds.includes(myId) && m.senderId !== myId && !m.read;
  }).length;
  const pendingLeave = (role === ROLES.OWNER || role === ROLES.ADMIN || role === ROLES.FINANCE) ? data.pendingDecidableLeaveCount(auth.currentUser) : 0;
  const needsPasswordChange = !!auth.currentUser.mustChangePassword;

  // Per-section sidebar badges: every other nav item (Homework, Results, Behavior, Attendance,
  // Payments, My Salary, Timetable, Leave Requests for Teacher/Parent, ...) reads its unread
  // count straight off the same notifications list, grouped by notificationPageKey — Messages,
  // Announcements and (for Owner/Admin/Finance) Leave & Permission keep the more precise counts above,
  // since those already track read state (or pending decisions) more accurately than a raw
  // notification tally would.
  const unreadByPage = useMemo(() => {
    const map = {};
    data.db.notifications.forEach((n) => {
      if (n.userId !== myId || n.read) return;
      const key = notificationPageKey(n);
      if (!key || key === "announcements" || key === "messages") return;
      map[key] = (map[key] || 0) + 1;
    });
    map.announcements = unreadAnnouncements;
    map.messages = unreadMsgs;
    map.notifications = unreadNotifs;
    if (role === ROLES.OWNER || role === ROLES.ADMIN) map.leaveRequests = pendingLeave;
    return map;
  }, [data.db.notifications, myId, unreadAnnouncements, unreadMsgs, unreadNotifs, role, pendingLeave]);

  useEffect(() => {
    setSidebarOpen(false);
    // Dismiss any lingering on-screen keyboard / mobile search bar so it doesn't overlap the new screen.
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
  }, [page]);

  // Reset to the dashboard whenever the effective account changes (login, or an Owner
  // starting/ending "View as") so the previous role's page key can't leak into a nav that
  // doesn't have it.
  useEffect(() => { setPage("dashboard"); }, [auth.currentUser.id]);

  // Opening a section clears its own badge immediately — Messages and Announcements already have
  // their own finer-grained per-item read tracking (see markNotificationsForPageRead), and
  // Notifications has its own "mark all as read" control, so none of those three are bulk-cleared
  // just by visiting them.
  useEffect(() => {
    if (page === "messages" || page === "announcements" || page === "notifications") return;
    data.markNotificationsForPageRead(myId, page);
  }, [page, myId]);

  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);

  function openSidebar() {
    // Blur whatever field is focused first, so a mobile keyboard or search suggestion bar
    // doesn't stay pinned on screen and cover the menu we're about to open.
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
    setSidebarOpen(true);
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {auth.viewingAsUser && (
        <div className="bg-red-600 text-white text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-2 sticky top-0 z-50 shrink-0">
          <ArrowLeftRight size={14} />
          <span>Viewing as <strong>{auth.viewingAsUser.name}</strong> ({ROLE_LABEL[auth.viewingAsUser.role]})</span>
          <button onClick={auth.returnToSelf} className="ml-2 underline font-semibold hover:text-red-100">Return to Owner Account</button>
        </div>
      )}
    <div className="min-h-0 flex-1 bg-slate-50 flex">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-slate-200 bg-white flex-col h-screen sticky top-0">
        <SidebarContent nav={nav} page={page} setPage={setPage} unreadByPage={unreadByPage} needsPasswordChange={needsPasswordChange} />
      </aside>

      {/* Sidebar - mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white flex flex-col">
            <SidebarContent nav={nav} page={page} setPage={setPage} unreadByPage={unreadByPage} needsPasswordChange={needsPasswordChange} onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button className="lg:hidden text-slate-500" onClick={openSidebar}><Menu size={22} /></button>
            <div className="lg:hidden"><Logo size={30} /></div>
            <div className="hidden lg:block">
              <p className="text-sm font-semibold text-slate-800 capitalize">{NAV[role].find((n) => n.key === page)?.label || "Dashboard"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setPage("notifications")} className="relative text-slate-500 hover:text-slate-700 p-2 hover:bg-slate-50 rounded-lg">
              <Bell size={19} />
              {unreadNotifs > 0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-semibold">{unreadNotifs > 9 ? "9+" : unreadNotifs}</span>}
            </button>
            <div className="w-px h-6 bg-slate-200 hidden sm:block" />
            <div className="flex items-center gap-2">
              <Avatar name={auth.currentUser.name} photo={auth.currentUser.photo} size={32} />
              <div className="hidden sm:block leading-tight">
                <p className="text-xs font-semibold text-slate-700">{auth.currentUser.name}</p>
                <p className="text-[10px] text-slate-400">{ROLE_LABEL[role] || role}</p>
              </div>
            </div>
            <button onClick={() => setConfirmLogoutOpen(true)} title="Sign out" className="text-slate-400 hover:text-red-500 p-2 hover:bg-slate-50 rounded-lg"><LogOut size={18} /></button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto">
          <PageRouter role={role} page={page} setPage={setPage} />
        </main>
      </div>
    </div>
    </div>
    <ConfirmDialog
      open={confirmLogoutOpen}
      onClose={() => setConfirmLogoutOpen(false)}
      onConfirm={auth.logout}
      title="Sign out?"
      description="Are you sure you want to sign out of your account?"
      confirmLabel="Sign Out"
      danger
    />
    </>
  );
}

function SidebarContent({ nav, page, setPage, unreadByPage, needsPasswordChange, onNavigate }) {
  return (
    <>
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-100 shrink-0">
        <Logo size={34} />
        <div className="leading-tight">
          <p className="text-[13px] font-semibold text-slate-800 tracking-tight">Tilmaan Modern</p>
          <p className="text-[10px] text-slate-400 -mt-0.5">Academy Portal</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = page === item.key;
          const badge = unreadByPage[item.key] || 0;
          const showPwDot = item.key === "settings" && needsPasswordChange;
          return (
            <button key={item.key} onClick={() => { setPage(item.key); onNavigate && onNavigate(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium mb-0.5 transition-colors ${active ? "bg-sky-50 text-sky-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>
              <Icon size={16} className={active ? "text-sky-600" : "text-slate-400"} />
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span className="min-w-[18px] h-[18px] px-[5px] inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shrink-0">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
              {showPwDot && <span className="w-2 h-2 rounded-full bg-amber-500" title="Change your password" />}
            </button>
          );
        })}
      </nav>
      <div className="p-3 border-t border-slate-100">
        <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
          <p className="text-[11px] font-medium text-emerald-800">Quality Education</p>
          <p className="text-[10px] text-emerald-600">and Personal Excellence</p>
        </div>
      </div>
    </>
  );
}

function PageRouter({ role, page, setPage }) {
  const [studentDetailId, setStudentDetailId] = useState(null);
  const [studentDetailFocus, setStudentDetailFocus] = useState(null); // { tab, paymentId } | null — deep-link into a profile tab
  const [staffDetailId, setStaffDetailId] = useState(null);
  const [activeChildId, setActiveChildId] = useState(null); // parent context
  const [messageTarget, setMessageTarget] = useState(null);
  const [activityFocus, setActivityFocus] = useState(null); // { page, ...ids } — consumed once by the target page, see openActivity below

  // A student/staff profile is opened as an overlay on top of whatever `page` is active,
  // without changing `page` itself (e.g. Students list -> a student, still page="students").
  // If the user then navigates to a *different* page (sidebar, header bell, a dashboard
  // quick link), `page` changes but this overlay previously stayed open, so the header
  // showed the new page while the old profile kept rendering underneath. Clearing the
  // overlay whenever `page` changes keeps the two in sync everywhere it's used.
  useEffect(() => {
    setStudentDetailId(null);
    setStudentDetailFocus(null);
    setStaffDetailId(null);
    window.scrollTo(0, 0);
  }, [page]);
  // A student/staff profile overlay is its own "page" from the user's point of view even though
  // it doesn't change `page` — scroll to top when one opens (or closes back to the list) too.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [studentDetailId, staffDetailId]);

  const goToMessages = (userId) => { setMessageTarget(userId); setPage("messages"); };

  if (studentDetailId) {
    return <StudentProfilePage studentId={studentDetailId} focus={studentDetailFocus} onBack={() => { setStudentDetailId(null); setStudentDetailFocus(null); }} onMessage={goToMessages} />;
  }
  if (staffDetailId) {
    return <StaffProfilePage staffId={staffDetailId} onBack={() => setStaffDetailId(null)} />;
  }

  // Recent Activity items carry a structured `navigation` payload (see the activity creation
  // sites in DataContext) instead of relying on parsing their display text. Payment/salary
  // activities open the relevant profile directly (the overlay above); everything else
  // switches page and hands the target page a one-shot `focus` it consumes and clears itself.
  function openActivity(nav) {
    if (!nav || !nav.page) return;
    if (nav.page === "payments" && nav.studentId) {
      if (!canViewStudentPayments(auth.currentUser)) return;
      setStudentDetailId(nav.studentId);
      setStudentDetailFocus({ tab: "payments", paymentId: nav.paymentId || null });
      return;
    }
    if (nav.page === "payroll" && nav.staffId) {
      if (!canViewPayroll(auth.currentUser)) return;
      setStaffDetailId(nav.staffId);
      return;
    }
    setActivityFocus(nav);
    setPage(nav.page);
  }
  const clearActivityFocus = () => setActivityFocus(null);

  // Notifications carry the same kind of structured `navigation` payload as activities (see
  // DataContext notification creation sites), but resolve differently: a Parent has no student
  // profile overlay, so a student-scoped notification instead switches their active child and
  // sends them to their own (child-scoped) page; every other role opens the student profile
  // overlay directly at the right tab — which is also why this works for roles (e.g. Teacher)
  // that don't have a standalone sidebar page for that tab, since it never calls setPage for it.
  function openNotification(nav) {
    if (!nav || !nav.page) return;
    if (nav.page === "messages") {
      goToMessages(nav.userId);
      return;
    }
    if (role === ROLES.PARENT) {
      if (nav.studentId) setActiveChildId(nav.studentId);
      setActivityFocus(nav);
      setPage(nav.page);
      return;
    }
    if (nav.studentId && ["attendance", "homework", "behavior", "exams", "documents"].includes(nav.page)) {
      setStudentDetailId(nav.studentId);
      setStudentDetailFocus({ tab: nav.page });
      return;
    }
    setActivityFocus(nav);
    setPage(nav.page);
  }

  if (role === ROLES.OWNER) {
    switch (page) {
      case "dashboard": return <OwnerDashboard setPage={setPage} onOpenActivity={openActivity} />;
      case "students": return <StudentsPage onOpen={setStudentDetailId} />;
      case "parents": return <ParentsPage onOpen={setStudentDetailId} onMessage={goToMessages} />;
      case "teachers": return <TeachersPage onMessage={goToMessages} />;
      case "classes": return <ClassesPage />;
      case "timetable": return <AdminTimetablePage />;
      case "attendance": return <AttendanceOverviewPage focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "staffAttendance": return <StaffAttendancePage />;
      case "leaveRequests": return <LeaveApprovalsPage />;
      case "homework": return <HomeworkAdminPage focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "exams": return <ResultsPage role={ROLES.ADMIN} focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "reportCards": return <ReportCardsPage />;
      case "behavior": return <BehaviorAdminPage onOpen={setStudentDetailId} />;
      case "announcements": return <AnnouncementsPage role={ROLES.ADMIN} />;
      case "payments": return <PaymentsPage onOpenStudent={setStudentDetailId} />;
      case "staff": return <StaffPage onOpen={setStaffDetailId} />;
      case "payroll": return <PayrollPage onOpen={setStaffDetailId} />;
      case "expenses": return <ExpensesPage focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "paymentMethods": return <PaymentMethodsPage />;
      case "accounts": return <AccountsPage />;
      case "auditLog": return <AuditLogPage />;
      case "messages": return <MessagesPage target={messageTarget} clearTarget={() => setMessageTarget(null)} />;
      case "notifications": return <NotificationsPage onOpen={openNotification} />;
      case "reports": return <ReportsPage />;
      case "settings": return <SettingsPage role={ROLES.ADMIN} />;
      default: return null;
    }
  }
  if (role === ROLES.FINANCE) {
    switch (page) {
      case "dashboard": return <FinanceDashboard setPage={setPage} onOpenActivity={openActivity} />;
      case "payments": return <PaymentsPage onOpenStudent={setStudentDetailId} />;
      case "staff": return <StaffPage onOpen={setStaffDetailId} />;
      case "payroll": return <PayrollPage onOpen={setStaffDetailId} />;
      case "expenses": return <ExpensesPage focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "paymentMethods": return <PaymentMethodsPage />;
      case "staffAttendance": return <StaffAttendancePage />;
      case "leaveRequests": return <LeaveApprovalsPage />;
      case "announcements": return <AnnouncementsPage role={role} />;
      case "messages": return <MessagesPage target={messageTarget} clearTarget={() => setMessageTarget(null)} />;
      case "notifications": return <NotificationsPage onOpen={openNotification} />;
      case "settings": return <SettingsPage role={role} />;
      default: return null;
    }
  }
  if (role === ROLES.ADMIN) {
    switch (page) {
      case "dashboard": return <AdminDashboard openStudent={setStudentDetailId} onOpenActivity={openActivity} setPage={setPage} />;
      case "students": return <StudentsPage onOpen={setStudentDetailId} />;
      case "parents": return <ParentsPage onOpen={setStudentDetailId} onMessage={goToMessages} />;
      case "teachers": return <TeachersPage onMessage={goToMessages} />;
      case "classes": return <ClassesPage />;
      case "timetable": return <AdminTimetablePage />;
      case "attendance": return <AttendanceOverviewPage focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "staffAttendance": return <StaffAttendancePage />;
      case "leaveRequests": return <LeaveApprovalsPage />;
      case "homework": return <HomeworkAdminPage focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "exams": return <ResultsPage role={role} focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "reportCards": return <ReportCardsPage />;
      case "behavior": return <BehaviorAdminPage onOpen={setStudentDetailId} />;
      case "announcements": return <AnnouncementsPage role={role} />;
      case "messages": return <MessagesPage target={messageTarget} clearTarget={() => setMessageTarget(null)} />;
      case "notifications": return <NotificationsPage onOpen={openNotification} />;
      case "reports": return <ReportsPage />;
      case "settings": return <SettingsPage role={role} />;
      default: return null;
    }
  }
  if (role === ROLES.TEACHER) {
    switch (page) {
      case "dashboard": return <TeacherDashboard setPage={setPage} openStudent={setStudentDetailId} />;
      case "classes": return <TeacherClassesPage onOpen={setStudentDetailId} onMessage={goToMessages} />;
      case "timetable": return <TeacherTimetablePage />;
      case "homework": return <TeacherHomeworkPage />;
      case "attendance": return <TeacherAttendancePage />;
      case "leaveRequests": return <StaffLeaveRequestPage />;
      case "exams": return <ResultsPage role={role} focus={activityFocus} clearFocus={clearActivityFocus} />;
      case "announcements": return <AnnouncementsPage role={role} />;
      case "mySalary": return <MySalaryPage />;
      case "messages": return <MessagesPage target={messageTarget} clearTarget={() => setMessageTarget(null)} />;
      case "notifications": return <NotificationsPage onOpen={openNotification} />;
      case "settings": return <SettingsPage role={role} />;
      default: return null;
    }
  }
  // PARENT
  switch (page) {
    case "dashboard": return <ParentDashboard activeChildId={activeChildId} setActiveChildId={setActiveChildId} setPage={setPage} />;
    case "timetable": return <ParentTimetablePage activeChildId={activeChildId} setActiveChildId={setActiveChildId} />;
    case "homework": return <ParentHomeworkPage activeChildId={activeChildId} setActiveChildId={setActiveChildId} focus={activityFocus} clearFocus={clearActivityFocus} />;
    case "attendance": return <ParentAttendancePage activeChildId={activeChildId} setActiveChildId={setActiveChildId} focus={activityFocus} clearFocus={clearActivityFocus} />;
    case "leaveRequests": return <StudentLeaveRequestPage activeChildId={activeChildId} setActiveChildId={setActiveChildId} />;
    case "exams": return <ParentResultsPage activeChildId={activeChildId} setActiveChildId={setActiveChildId} focus={activityFocus} clearFocus={clearActivityFocus} />;
    case "behavior": return <ParentBehaviorPage activeChildId={activeChildId} setActiveChildId={setActiveChildId} />;
    case "announcements": return <AnnouncementsPage role={role} />;
    case "payments": return <ParentPaymentsPage activeChildId={activeChildId} setActiveChildId={setActiveChildId} />;
    case "documents": return <ParentDocumentsPage activeChildId={activeChildId} setActiveChildId={setActiveChildId} />;
    case "messages": return <MessagesPage target={messageTarget} clearTarget={() => setMessageTarget(null)} />;
    case "notifications": return <NotificationsPage onOpen={openNotification} />;
    case "settings": return <SettingsPage role={role} connectChild />;
    default: return null;
  }
}


export { AppShell };
