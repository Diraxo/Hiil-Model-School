import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  ROLES, ROLE_LABEL, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, SCHOOL_DAYS, TEACHER_UNAVAILABLE_STATUSES,
  todayDayName, addMonthsFloat,
  SUBJECTS, GRADES, SECTIONS, sectionLabel, gradeSectionCompare,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI, MIN_PERIODS, MAX_PERIODS, DEFAULT_TIMETABLE_CONFIG,
  staffGroupLabel, SEMESTERS, ASSESSMENT_COMPONENTS, ASSESSMENT_COMPONENT_LABEL, ASSESSMENT_COMPONENT_WEIGHT,
  computeSemesterResult,
} from "../utils/constants";
import {
  uid, fmtDate, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor, fullName, computePeriodSchedule,
  leaveDurationLabel, joinWithAnd, monthLabel,
} from "../utils/helpers";
import {
  studentIdentity as computeStudentIdentity, staffIdentity as computeStaffIdentity,
  userIdentity as computeUserIdentity, leaveSubjectIdentity as computeLeaveSubjectIdentity,
  announcementSenderLabel as computeAnnouncementSenderLabel,
} from "../utils/identity";
import { buildSeed, migrateDB, loadDB, saveDB } from "../data/seed";
import { createAcademicYearService } from "../services/academicYearService";
import { todayKeyStr } from "../components/ui";
import { computeStudentSemesterAverage, computeClassSemesterResults, findSchoolTopPerformer, rankStudents } from "../utils/resultsEngine";
import { classifyAttendanceDate, classifySemesterResultLock, earliestAttendanceDate, latestAttendanceDate, addDays, defaultAcademicCalendar, currentAcademicYear, activeYearStartDate, formatAcademicYearLabel } from "../utils/academicCalendar";
import { canTakeAttendance as canStudentTakeAttendance } from "../utils/studentPermissions";
import { canTeacherPerformAcademicAction as canTeacherAct } from "../utils/staffPermissions";
import { effectiveResultLock } from "../utils/permissions";
import { useToast } from "../context/ToastContext";
import { notificationPageKey } from "../utils/notifications";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, BookOpen, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info, UserPlus,
  Wallet, Bus, ImagePlus, BellRing,
} from "lucide-react";

const DataCtx = createContext(null);
function useData() { return useContext(DataCtx); }

// A result record's own academic year (never "whatever year is currently active") — falls back to
// the current year only for a not-yet-created record, which is always being created against
// "now". Used by every results mutator that needs to consult the calendar for semester-aware
// locking (see utils/permissions.js `effectiveResultLock`).
function resolveResultCal(d, academicYearId) {
  return (academicYearId && d.academicYears.find((y) => y.id === academicYearId)) || currentAcademicYear(d.academicYears);
}

// Blocker 5: the one authoritative payroll calculation. Called with `db` (the committed state)
// for every read-only display (staffSalarySummary, dashboards, payslips) and with `d` (the live
// draft inside commit()) from recordPayrollPayment so the overpayment cap is checked against the
// true state at commit time, not a value the UI may have computed before another payment landed.
//
// Blocker 5A fix: a month's own PAID/PARTIAL/UNPAID status is derived ONLY from real
// payrollPayments recorded against that specific month — never from silently netting the advance
// ledger's unconsumed balance against whichever month happens to be oldest-unpaid. The previous
// "creditPool" version did exactly that, which meant giving someone an advance today could flip a
// two-year-old month straight to "Paid in full" with no payment record, no date, and no way to
// see it happened. An advance only ever reduces a month's obligation through recordPayrollPayment's
// own `advanceApplied` field, i.e. a real transaction Finance explicitly recorded.
function computeStaffPayrollSummary(dbLike, staffId) {
  const s = dbLike.staff.find((x) => x.id === staffId);
  if (!s) return null;
  const start = new Date(s.employmentDate + "T00:00:00");
  const startMonth = start.getMonth(), startYear = start.getFullYear();
  const today = new Date();
  const employmentCap = s.employmentEndDate ? new Date(s.employmentEndDate + "T00:00:00") : today;
  const end = employmentCap < today ? employmentCap : today;
  const months = [];
  let y = startYear, m = startMonth;
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  const history = dbLike.payrollPayments.filter((p) => p.staffId === staffId).sort((a, b) => b.createdAt - a.createdAt);
  const totalPaid = history.reduce((sum, p) => sum + p.amount, 0);
  const totalExpected = months.length * s.salary;
  const rawAdvances = dbLike.salaryAdvances.filter((a) => a.staffId === staffId).sort((a, b) => a.createdAt - b.createdAt);
  const advanceGiven = rawAdvances.reduce((sum, a) => sum + a.amount, 0);
  const advanceAppliedTotal = history.reduce((sum, p) => sum + (p.advanceApplied || 0), 0);
  const advanceBalance = Math.max(0, advanceGiven - advanceAppliedTotal);
  // Every advance stays a permanent record (never deleted/overwritten when settled). Its own
  // applied/remaining/status is derived, purely for display, by walking the REAL advanceAppliedTotal
  // across the advances oldest-given-first (FIFO) — this never feeds back into a month's status above.
  let recoveryPool = advanceAppliedTotal;
  const advances = rawAdvances.map((a) => {
    const applied = Math.min(recoveryPool, a.amount);
    recoveryPool -= applied;
    const remaining = a.amount - applied;
    const status = remaining <= 0 ? "SETTLED" : applied > 0 ? "PARTIALLY_SETTLED" : "OUTSTANDING";
    return { ...a, applied, remaining, status };
  }).sort((a, b) => b.createdAt - a.createdAt);
  const rows = months.map((mk) => {
    const paymentsForMonth = history.filter((p) => p.month === mk);
    const monthAllowances = paymentsForMonth.reduce((sum, p) => sum + (p.allowances || 0), 0);
    const monthDeductions = paymentsForMonth.reduce((sum, p) => sum + (p.deductions || 0), 0);
    const paidThisMonth = paymentsForMonth.reduce((sum, p) => sum + p.amount + (p.advanceApplied || 0), 0);
    const remaining = Math.max(0, s.salary + monthAllowances - monthDeductions - paidThisMonth);
    const status = remaining <= 0 ? "PAID" : paidThisMonth > 0 ? "PARTIAL" : "UNPAID";
    return { month: mk, payments: paymentsForMonth, payment: paymentsForMonth[0] || null, paidThisMonth, remaining, status };
  });
  // A single flat subtraction, not a sum of the rows — an advance only ever offsets the aggregate
  // obligation once, so this can't double-count across months.
  const outstanding = Math.max(0, totalExpected - totalPaid - advanceGiven);
  // The most recently elapsed month's own unmet obligation — the only base a NEW advance can ever
  // be given against (see recordSalaryAdvance's cap below). A backlog of unpaid older months never
  // enlarges this: an advance is money against upcoming pay, not a loan against arrears.
  const currentMonthAvailable = rows.length ? rows[rows.length - 1].remaining : 0;
  const maxAdvance = Math.max(0, currentMonthAvailable - advanceBalance);
  return { staff: s, months, history, rows, totalPaid, totalExpected, outstanding, advances, advanceGiven, advanceBalance, currentMonthAvailable, maxAdvance };
}

// ---- Blocker 2: fee/payment academic-year schema (catalog → yearly schedule → installments →
// obligations → payments/allocations — see the "Fee Ledger Schema" design doc). These are module-
// level, parameterized by `dbLike` (never closing over the outer `db`), the same convention
// `computeStaffPayrollSummary` above already uses, so they work identically whether called with
// the committed `db` (read-only display) or the live draft `d` inside a commit() mutator.
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
// Net owed is always computed at read time from the obligation's frozen amountDue minus every
// adjustment/allocation against it — never stored, so it can never drift out of sync with them.
function netOwedForObligation(dbLike, obligation) {
  if (!obligation) return 0;
  return Math.max(0, obligation.amountDue - adjustmentsTotal(dbLike, obligation.id) - allocationsTotal(dbLike, obligation.id));
}
// A fee type only "applies" to a student for a given year once it's actually been rolled out
// (has a feeSchedule) for that year — a catalog entry Finance forgot to roll out simply doesn't
// appear, which is the intended consequence of obligations being materialized, not derived live.
function feeTypesForStudentIn(dbLike, student, academicYearId) {
  return dbLike.feeTypes.filter((ft) => !ft.archivedAt && (ft.category !== "TRANSPORT" || student.usesBus) && scheduleForFeeType(dbLike, ft.id, academicYearId));
}
// A catalog feeType row carries no pricing (that lives on the schedule) — this merges in the
// given year's unitAmount/unitMonths/unitsPerYear so every existing call site that reads those
// fields off a "feeType" result (receipts, coverage labels, dashboard cards) keeps working
// unchanged against the new model.
function feeTypeYearView(dbLike, feeType, academicYearId) {
  const schedule = scheduleForFeeType(dbLike, feeType.id, academicYearId);
  return schedule ? { ...feeType, unitAmount: schedule.unitAmount, unitMonths: schedule.unitMonths, unitsPerYear: schedule.unitsPerYear, scheduleId: schedule.id } : feeType;
}
// Shared engine behind installmentStatusForStudent/busScheduleForStudent/balanceFor/
// dueStatusForFeeType: one obligation-backed row per installment in this year's schedule, in
// schedule order. An installment with no obligation for this student (Decision A: a mid-year
// joiner's earlier cycles) is simply absent from `rows` — not marked N/A, not shown at all.
function feeRowsForStudentIn(dbLike, student, feeType, academicYearId) {
  const schedule = scheduleForFeeType(dbLike, feeType.id, academicYearId);
  if (!schedule) return { schedule: null, installments: [], rows: [], currentIndex: -1 };
  const installments = installmentsForSchedule(dbLike, schedule.id);
  const today = todayKeyStr();
  const idx = installments.findIndex((inst) => inst.dueDate && inst.dueDate >= today);
  const currentIndex = idx === -1 ? installments.length - 1 : idx;
  const rows = installments.map((inst, i) => {
    const ob = obligationForInstallment(dbLike, student.id, inst.id);
    if (!ob) return null;
    const remaining = netOwedForObligation(dbLike, ob);
    const paid = ob.amountDue - remaining;
    const status = remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
    return { installment: inst, amountDue: ob.amountDue, paid, remaining, status, isCurrent: i === currentIndex, obligationId: ob.id };
  }).filter(Boolean);
  return { schedule, installments, rows, currentIndex };
}
// Resolves an allocation to its human-readable fee label ("School Fee Quarter 1", "Bus Fee –
// September 2026") by walking allocation → obligation → installment → schedule → feeType — the
// label is a stored, immutable fact on the installment now, no more reconstructing a bus payment's
// covered month from array position/payment order.
function describeAllocation(dbLike, allocation) {
  const obligation = dbLike.studentFeeObligations.find((o) => o.id === allocation.obligationId);
  const installment = obligation && dbLike.feeInstallments.find((i) => i.id === obligation.feeInstallmentId);
  const schedule = installment && dbLike.feeSchedules.find((s) => s.id === installment.feeScheduleId);
  const feeType = schedule && dbLike.feeTypes.find((f) => f.id === schedule.feeTypeId);
  if (!feeType || !installment) return "Fee";
  // TRANSPORT keeps the old " – <month>" separator (not a space) — AdminPages.jsx's
  // groupLinesByStudent parses this exact format to pull just the covered month out for the
  // receipt's dedicated Bus Fee line.
  return feeType.category === "TRANSPORT" ? `${feeType.name} – ${installment.label}` : `${feeType.name} ${installment.label}`;
}
function describePaymentAllocations(dbLike, payment) {
  const labels = dbLike.paymentAllocations.filter((a) => a.paymentId === payment.id).map((a) => describeAllocation(dbLike, a));
  return labels.length ? labels.join(", ") : "Fee";
}

// Finds this student+class+subject+semester's result record for the CURRENT academic year,
// creating a fresh DRAFT one (empty components, no evidence) if none exists yet. Shared by every
// results mutator so "the record doesn't exist yet" and "the record exists but is empty" are the
// same code path. Callers that need to lock-gate creation itself (saveResultComponent,
// addResultEvidencePage) must resolve and check effectiveResultLock BEFORE calling this — it does
// not check locking itself.
//
// `academicYearId` is part of the lookup key (not just a field on the created record) because
// `classId` is a persistent identity, not re-created per year — a repeating/retained student keeps
// the SAME classId next year. Without this, a repeating student's new-year record would silently
// resolve to (and overwrite) their locked/published record from the year they repeated.
function findOrCreateResultRecord(d, { studentId, classId, subject, semester }) {
  const year = currentAcademicYear(d.academicYears);
  const academicYearId = year ? year.id : null;
  let record = d.results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && r.academicYearId === academicYearId);
  if (!record) {
    record = {
      id: uid("res"), studentId, classId, subject, semester, academicYearId,
      components: Object.fromEntries(ASSESSMENT_COMPONENTS.map((c) => [c, { score: null, max: ASSESSMENT_COMPONENT_WEIGHT[c], sharedWithParents: false, updatedAt: null, updatedBy: null }])),
      publishStatus: "DRAFT", publishedAt: null, publishedBy: null, lockedAt: null, lockedBy: null,
      autoLockOverride: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    d.results.push(record);
  }
  return record;
}

function DataProvider({ children }) {
  const [mockDb, setDb] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const lastWriteRef = useRef(0);
  const toast = useToast();

  // Academic years: first domain converted to real Supabase data (see project notes). Lives as
  // its own state, independent of the mock `db`/commit()/localStorage pipeline below -- every
  // other domain still reads/writes the mock db until it's converted in turn.
  const academicYearService = useMemo(() => createAcademicYearService(), []);
  const [academicYears, setAcademicYears] = useState([]);
  const refetchAcademicYears = useCallback(async () => {
    const rows = await academicYearService.list();
    setAcademicYears(rows);
    return rows;
  }, [academicYearService]);
  useEffect(() => { refetchAcademicYears().catch((e) => console.error("Failed to load academic years", e)); }, [refetchAcademicYears]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        let loaded = await loadDB();
        if (!loaded) {
          loaded = buildSeed();
          await saveDB(loaded);
        } else {
          const before = JSON.stringify(loaded);
          loaded = migrateDB(loaded);
          if (JSON.stringify(loaded) !== before) await saveDB(loaded);
        }
        if (mounted) { setDb(loaded); setReady(true); }
      } catch (e) {
        console.error("Failed to initialize school data", e);
        if (mounted) {
          // Fall back to an in-memory seed so the app is still usable even if storage is unavailable.
          try {
            const fallback = buildSeed();
            setDb(fallback);
            setReady(true);
          } catch (e2) {
            setLoadError(String(e2 && e2.message ? e2.message : e2));
          }
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Poll for cross-tab changes (simulated realtime)
  useEffect(() => {
    if (!ready) return;
    const iv = setInterval(async () => {
      let remote = await loadDB();
      if (remote) remote = migrateDB(remote);
      if (remote && remote.updatedAt > lastWriteRef.current) {
        setDb((cur) => (cur && remote.updatedAt <= cur.updatedAt ? cur : remote));
      }
    }, 2200);
    return () => clearInterval(iv);
  }, [ready]);

  const commit = useCallback((mutator) => {
    setDb((cur) => {
      const next = mutator(structuredCloneLite(cur));
      next.updatedAt = Date.now();
      lastWriteRef.current = next.updatedAt;
      saveDB(next);
      return next;
    });
  }, []);

  function structuredCloneLite(obj) {
    return JSON.parse(JSON.stringify(obj));
  }


  function closuresByDateMap(dbLike) {
    const map = {};
    (dbLike.schoolClosures || []).forEach((c) => { map[c.date] = c; });
    return map;
  }

  // Centralizes the "who → what → dates → decision → decider" template so every leave
  // notification (submitted/approved/declined, student or staff) reads consistently.
  // Delegates to the shared identity helper (src/utils/identity.js) so this text always
  // matches what the on-screen leave lists show.
  function leaveSubjectLabel(d, kind, subjectId) {
    return computeLeaveSubjectIdentity(d, kind, subjectId);
  }
  function leaveTitleBase(status) {
    if (status === "Sick") return "Sick leave";
    if (status === "Excused") return "Excused absence";
    return status; // "Permission"
  }
  function leaveDateRangeLabel(req) {
    return req.fromDate === req.toDate ? fmtDate(req.fromDate) : `${fmtDate(req.fromDate)}–${fmtDate(req.toDate)}`;
  }
  function leaveSubmittedNotification(d, req) {
    const base = leaveTitleBase(req.status);
    const who = leaveSubjectLabel(d, req.kind, req.subjectId);
    return {
      title: `${base} request`,
      message: `${who} submitted a ${base.toLowerCase()} request for ${leaveDateRangeLabel(req)}.`,
    };
  }
  function leaveDecidedNotification(d, req, decider) {
    const base = leaveTitleBase(req.status);
    const who = leaveSubjectLabel(d, req.kind, req.subjectId);
    const verb = req.approvalStatus === "APPROVED" ? "approved" : "declined";
    const deciderLabel = decider ? `${ROLE_LABEL[decider.role] || decider.role} — ${decider.name}` : "the school";
    const reasonSuffix = req.approvalStatus === "REJECTED" && req.rejectionReason ? ` Reason: ${req.rejectionReason}` : "";
    return {
      title: `${base} ${verb}`,
      message: `${who}'s ${base.toLowerCase()} request for ${leaveDateRangeLabel(req)} was ${verb} by ${deciderLabel}.${reasonSuffix}`,
    };
  }

  // Shared by createAnnouncement (fires immediately) and checkScheduledAnnouncements (fires once
  // a scheduled announcement's publish time arrives) so the audience → recipient-list mapping
  // can't drift between the two call sites.
  function announcementTargets(d, audience) {
    if (audience.type === "ALL") return d.users.map((u) => u.id);
    if (audience.type === "ALL_PARENTS") return d.users.filter((u) => u.role === ROLES.PARENT).map((u) => u.id);
    if (audience.type === "ALL_TEACHERS") return d.users.filter((u) => u.role === ROLES.TEACHER).map((u) => u.id);
    if (audience.type === "DIRECTORS") return d.staff.filter((s) => staffGroupLabel(s.position) === "Directors").map((s) => s.userId).filter(Boolean);
    if (audience.type === "GRADE") {
      const studentIds = d.students.filter((s) => s.grade === audience.grade && s.status === "ACTIVE").map((s) => s.id);
      return d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).some((cid) => studentIds.includes(cid))).map((u) => u.id);
    }
    if (audience.type === "SECTION") {
      const studentIds = d.students.filter((s) => s.grade === audience.grade && s.section === audience.section && s.status === "ACTIVE").map((s) => s.id);
      return d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).some((cid) => studentIds.includes(cid))).map((u) => u.id);
    }
    if (audience.type === "USER") return [audience.userId];
    return [];
  }
  function dispatchAnnouncementNotifications(d, ann) {
    const senderShortLabel = computeUserIdentity(d, ann.authorId).display;
    announcementTargets(d, ann.audience).forEach((uid_) => {
      d.notifications = [{ id: uid("notif"), userId: uid_, title: "📢 New announcement", message: `${ann.title} — From: ${senderShortLabel}`, read: false, createdAt: Date.now(), type: "ANNOUNCEMENT", announcementId: ann.id }, ...d.notifications];
    });
  }

  /* ---------- derived lookups ---------- */
  const api = useMemo(() => {
    if (!mockDb) return null;
    // Shadows the mock `db` state for the rest of this function: academicYears now comes from
    // Supabase (see refetchAcademicYears above) instead of the seeded/localStorage array. Every
    // read below (`db.academicYears...`) picks this up automatically since it's one closure.
    // academicCalendar is re-derived from the real data too (rather than trusting mockDb's stale
    // seeded copy), since classifyAttendanceDate/etc. read it directly instead of academicYears.
    const db = { ...mockDb, academicYears, academicCalendar: currentAcademicYear(academicYears) || mockDb.academicCalendar };

    const getUser = (id) => db.users.find((u) => u.id === id);
    const getClass = (id) => db.classes.find((c) => c.id === id);
    const classLabel = (c) => (c ? `${c.grade}${c.section}` : "");
    const getStudent = (id) => db.students.find((s) => s.id === id);
    const studentFullName = (s) => fullName(s.firstName, s.middleName, s.lastName);
    const studentIdentity = (student) => computeStudentIdentity(db, student);
    const staffIdentity = (staff) => computeStaffIdentity(db, staff);
    const userIdentity = (userId) => computeUserIdentity(db, userId);
    const leaveSubjectIdentity = (kind, subjectId) => computeLeaveSubjectIdentity(db, kind, subjectId);
    const announcementSenderLabel = (authorId) => computeAnnouncementSenderLabel(db, authorId);

    function addActivity(text) {
      db.activities = [{ id: uid("act"), text, createdAt: Date.now() }, ...db.activities].slice(0, 60);
    }
    function notify(userId, title, message, type) {
      db.notifications = [{ id: uid("notif"), userId, title, message, read: false, createdAt: Date.now(), type }, ...db.notifications];
    }
    function parentsOfClass(classId) {
      const studentIds = db.students.filter((s) => s.classId === classId).map((s) => s.id);
      const parentIds = new Set();
      db.users.filter((u) => u.role === ROLES.PARENT).forEach((p) => {
        if ((p.childIds || []).some((cid) => studentIds.includes(cid))) parentIds.add(p.id);
      });
      return [...parentIds];
    }
    function parentsOfStudent(studentId) {
      return db.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(studentId)).map((u) => u.id);
    }

    function feeTypesForStudent(student, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      return feeTypesForStudentIn(db, student, yearId);
    }
    // Same 4-field shape as before ({paid, remaining, amountOwed, status}) — now sourced from
    // materialized obligations/allocations instead of scanning db.payments, and generalized to
    // every fee category (not just TUITION) via the shared feeRowsForStudentIn engine.
    function balanceFor(student, feeType, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      const { schedule, rows } = feeRowsForStudentIn(db, student, feeType, yearId);
      if (!schedule) return { paid: 0, remaining: 0, amountOwed: 0, status: "PAID" };
      let paidUnitsSum = 0, amountOwed = 0;
      rows.forEach((r) => {
        amountOwed += r.remaining;
        paidUnitsSum += r.amountDue > 0 ? (r.amountDue - r.remaining) / r.amountDue : 0;
      });
      const remaining = Math.max(0, schedule.unitsPerYear - paidUnitsSum);
      const status = amountOwed <= 0 ? "PAID" : paidUnitsSum > 0 ? "PARTIAL" : "UNPAID";
      return { paid: paidUnitsSum, remaining, amountOwed, status };
    }
    function studentPaymentSummary(student, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      const balances = feeTypesForStudent(student, yearId).map((ft) => ({ feeType: feeTypeYearView(db, ft, yearId), ...balanceFor(student, ft, yearId) }));
      const totalOwed = balances.reduce((sum, b) => sum + b.amountOwed, 0);
      const worstStatus = balances.some((b) => b.status === "UNPAID") ? "UNPAID" : balances.some((b) => b.status === "PARTIAL") ? "PARTIAL" : "PAID";
      return { balances, totalOwed, status: balances.length ? worstStatus : "PAID" };
    }
    // Per-installment paid/partial/unpaid breakdown for the student's Tuition fee type this year —
    // same {feeType, rows, currentIndex} shape as before, now backed by feeRowsForStudentIn.
    function installmentStatusForStudent(student, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      const feeType = feeTypesForStudent(student, yearId).find((ft) => ft.category === "TUITION");
      if (!feeType) return { feeType: null, rows: [], currentIndex: -1 };
      const { rows, currentIndex } = feeRowsForStudentIn(db, student, feeType, yearId);
      return { feeType: feeTypeYearView(db, feeType, yearId), rows, currentIndex };
    }

    function busFeeTypeForStudent(student, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      return feeTypesForStudent(student, yearId).find((ft) => ft.category === "TRANSPORT") || null;
    }
    // Bus is now just another installment schedule (real stored rows, generated once at rollout —
    // see rolloutFeeTypeForYear) instead of monthly cycles computed on every read. Same
    // {feeType, rows, currentIndex} shape as before, rows reshaped to the old bus field names
    // (`index`, `label`) that AdminPages.jsx already reads.
    function busScheduleForStudent(student, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      const feeType = busFeeTypeForStudent(student, yearId);
      if (!feeType) return { feeType: null, rows: [], currentIndex: -1 };
      const { rows, currentIndex } = feeRowsForStudentIn(db, student, feeType, yearId);
      const busRows = rows.map((r) => ({ index: r.installment.sequenceIndex, installmentId: r.installment.id, label: r.installment.label, amountDue: r.amountDue, paid: r.paid, remaining: r.remaining, status: r.status, isCurrent: r.isCurrent, obligationId: r.obligationId }));
      return { feeType: feeTypeYearView(db, feeType, yearId), rows: busRows, currentIndex };
    }
    // Per-fee-type "what's actually due as of today" — only counts installments up through the
    // current one (see feeRowsForStudentIn's currentIndex), so a family fully caught up on what's
    // due isn't flagged for periods that haven't arrived yet. Same shape as before, now one
    // unified obligation-based query instead of per-category branches.
    function dueStatusForFeeType(student, feeType, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      const { rows, currentIndex } = feeRowsForStudentIn(db, student, feeType, yearId);
      let owed = 0, paid = 0;
      rows.slice(0, currentIndex + 1).forEach((r) => { owed += r.amountDue; paid += r.paid; });
      const remaining = Math.max(0, owed - paid);
      const status = remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
      return { owed, paid, remaining, status };
    }
    // Rolls dueStatusForFeeType up across a student's fee types — this is what the Fees & Payments
    // family list, its Paid/Partial/Unpaid sections, and bulk reminders read instead of
    // studentPaymentSummary, so "unpaid" there means "behind on what's due now", not "hasn't
    // prepaid the rest of the school year".
    function dueStatusForStudent(student, academicYearId) {
      const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id;
      let tuitionRemaining = 0, busRemaining = 0, otherRemaining = 0, totalPaid = 0, any = false;
      feeTypesForStudent(student, yearId).forEach((ft) => {
        const dstat = dueStatusForFeeType(student, ft, yearId);
        any = true;
        if (ft.category === "TUITION") tuitionRemaining += dstat.remaining;
        else if (ft.category === "TRANSPORT") busRemaining += dstat.remaining;
        else otherRemaining += dstat.remaining;
        totalPaid += dstat.paid;
      });
      const totalRemaining = tuitionRemaining + busRemaining + otherRemaining;
      const status = !any || totalRemaining <= 0 ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
      return { tuitionRemaining, busRemaining, otherRemaining, totalRemaining, status };
    }
    // Locked Principle #7: prior-year balance stays visibly separate from current-year, never
    // silently merged. Sums amountOwed across every OTHER academic year's applicable fee types —
    // the concrete query behind the "Prior-Year Balance" card on StudentProfilePage/ParentPaymentsPage.
    function priorYearsOutstanding(student, excludeYearId) {
      return db.academicYears.filter((y) => y.id !== excludeYearId).reduce((sum, y) => {
        return sum + feeTypesForStudent(student, y.id).reduce((s2, ft) => s2 + balanceFor(student, ft, y.id).amountOwed, 0);
      }, 0);
    }
    function describePayment(payment) {
      return describePaymentAllocations(db, payment);
    }
    // Every payments row that funds at least one obligation belonging to any of the given
    // students — a payment no longer carries studentId directly (one receipt can span several
    // students), so "this student's payment history" is now a join through
    // obligations → allocations → payments. Used for a single student's history (pass [id]) and
    // a family's combined history (pass every child's id) alike.
    function paymentsForStudents(studentIds) {
      const idSet = new Set(studentIds);
      const obligationIds = new Set(db.studentFeeObligations.filter((o) => idSet.has(o.studentId)).map((o) => o.id));
      const paymentIds = new Set(db.paymentAllocations.filter((a) => obligationIds.has(a.obligationId)).map((a) => a.paymentId));
      return db.payments.filter((p) => paymentIds.has(p.id));
    }
    function paymentMethodName(payment) {
      return (db.paymentMethods.find((m) => m.id === payment.paymentMethodId) || {}).name || "";
    }
    // Groups active students by parent account for the Fees & Payments screen's family view —
    // a student with no linked parent account still appears, as a family of one, so nobody with
    // an outstanding balance is ever left out of the list.
    function familyGroups() {
      const activeStudents = db.students.filter((s) => s.status !== "WITHDRAWN" && s.status !== "TRANSFERRED" && s.status !== "GRADUATED" && s.status !== "ARCHIVED");
      const groups = db.users
        .filter((u) => u.role === ROLES.PARENT)
        .map((p) => ({ id: p.id, parent: p, children: activeStudents.filter((s) => (p.childIds || []).includes(s.id)) }))
        .filter((g) => g.children.length > 0);
      const linkedIds = new Set(groups.flatMap((g) => g.children.map((c) => c.id)));
      activeStudents.filter((s) => !linkedIds.has(s.id)).forEach((s) => groups.push({ id: `solo_${s.id}`, parent: null, children: [s] }));
      return groups;
    }

    // One receipt = one call: `lines` is normally a single student, or 2+ when siblings are paid
    // for together, so they share one receiptNo and print on one Cash Receipt Voucher. A payments
    // row already IS the batch now (no separate batchId). Each `line` is `{studentId, feeTypeId,
    // installmentId, amount, method, date, note}` — `installmentId` refers to a real
    // `feeInstallments.id`, and is resolved to that student's obligation for it; a line with no
    // matching obligation (Decision A: this installment was never owed by this student) is
    // silently dropped, matching how the UI never offers it as a choice. Decision B (overpayment
    // reject/cap) is enforced right here against the LIVE draft `d`, not a value the UI computed
    // before another payment landed in the same tick.
    // `recordPayment` (singular) below is a thin one-line wrapper over this, so the existing
    // Record Payment UI keeps working unmodified.
    function recordPaymentBatch(lines, recordedBy) {
      let receiptNo = null;
      let paymentId = null;
      let entries = [];
      commit((d) => {
        const accepted = [];
        lines.forEach((line) => {
          const student = d.students.find((s) => s.id === line.studentId);
          if (!student || !line.installmentId || !line.amount || line.amount <= 0) return;
          const obligation = obligationForInstallment(d, line.studentId, line.installmentId);
          if (!obligation) return;
          const netOwed = netOwedForObligation(d, obligation);
          const cappedAmount = Math.min(Number(line.amount), netOwed);
          if (cappedAmount <= 0) return;
          accepted.push({ ...line, student, obligation, cappedAmount });
        });
        if (accepted.length === 0) return d;

        receiptNo = String(d.receiptSeq).padStart(4, "0");
        d.receiptSeq += 1;
        const method = accepted[0].method;
        let pm = d.paymentMethods.find((m) => m.name.toLowerCase() === method.toLowerCase());
        if (!pm) { pm = { id: uid("pm"), name: method, active: true }; d.paymentMethods.push(pm); }

        const payment = {
          id: uid("pay"), receiptNo, paymentMethodId: pm.id, amountTotal: 0,
          date: accepted[0].date, note: accepted[0].note || "", recordedBy, createdAt: Date.now(),
          status: "POSTED", voidedAt: null, voidedBy: null, voidReason: null,
        };
        d.payments.push(payment);
        paymentId = payment.id;

        accepted.forEach(({ student, obligation, cappedAmount }) => {
          const alloc = { id: uid("alloc"), paymentId: payment.id, obligationId: obligation.id, amount: cappedAmount, createdAt: Date.now() };
          d.paymentAllocations.push(alloc);
          payment.amountTotal += cappedAmount;
          const installment = d.feeInstallments.find((i) => i.id === obligation.feeInstallmentId);
          const schedule = installment && d.feeSchedules.find((s) => s.id === installment.feeScheduleId);
          const feeType = schedule && d.feeTypes.find((f) => f.id === schedule.feeTypeId);
          entries.push({ studentId: student.id, studentName: studentFullName(student), grade: classLabel(getClass(student.classId)), amount: cappedAmount, isBus: feeType?.category === "TRANSPORT", description: describeAllocation(d, alloc) });
        });

        // One consolidated "Payment Received" notification per parent per receipt (not one per fee
        // line) — covers every one of that parent's own children included in this transaction, and
        // carries the paymentId so tapping it opens the saved receipt directly instead of sending
        // the parent to hunt for it in Payments.
        const byParent = new Map();
        entries.forEach((entry) => {
          const parentIds = d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(entry.studentId)).map((u) => u.id);
          parentIds.forEach((pid) => {
            if (!byParent.has(pid)) byParent.set(pid, []);
            byParent.get(pid).push(entry);
          });
        });
        byParent.forEach((parentEntries, pid) => {
          const total = parentEntries.reduce((sum, e) => sum + e.amount, 0);
          const uniqueChildren = [...new Map(parentEntries.map((e) => [e.studentId, e])).values()];
          const childrenLabel = joinWithAnd(uniqueChildren.map((e) => `${e.studentName} · ${e.grade}`));
          d.notifications = [{
            id: uid("notif"), userId: pid, title: "Payment Received",
            message: `Your payment of ${formatMoney(total)} for ${childrenLabel} has been recorded.`,
            read: false, createdAt: Date.now(), type: "PAYMENT", paymentId: payment.id,
          }, ...d.notifications];
        });

        const namesSummary = [...new Set(entries.map((e) => e.studentName))].join(", ");
        d.activities = [{ id: uid("act"), text: `${formatMoney(payment.amountTotal)} payment recorded for ${namesSummary} (receipt #${receiptNo}).`, createdAt: Date.now(), navigation: { page: "payments", studentId: entries[0].studentId, paymentId: payment.id, receiptNo } }, ...d.activities];
        return d;
      });
      return { receiptNo, paymentId, entries };
    }

    function periodSchedule() {
      return computePeriodSchedule(db.timetableConfig);
    }
    // Subjects assignable into this exact class/day/period slot: must already have a teacher
    // assigned to this class, and that teacher must not already be booked elsewhere at this slot.
    function availableSubjectsForSlot(classId, day, period) {
      const classCurriculum = new Set(db.classSubjects.filter((cs) => cs.classId === classId).map((cs) => cs.subject));
      const subjectsForClass = [...new Set(db.teacherAssignments.filter((ta) => ta.classId === classId).map((ta) => ta.subject))]
        .filter((subject) => classCurriculum.has(subject));
      return subjectsForClass.filter((subject) => {
        const assignment = db.teacherAssignments.find((ta) => ta.classId === classId && ta.subject === subject);
        if (!assignment) return false;
        const conflict = db.timetableEntries.some((e) => e.teacherId === assignment.teacherId && e.day === day && e.period === period && e.classId !== classId);
        return !conflict;
      });
    }

    // Centralized attendance-calendar rules — every role's attendance UI (Owner, Educational
    // Director, Teacher, Parent) reads through these instead of implementing its own date math.
    // A school closure always wins, regardless of semester/break phase.
    function classifyAttendanceDay(dateKey) {
      return classifyAttendanceDate(dateKey, db.academicCalendar, todayKeyStr(), closuresByDateMap(db));
    }
    // A structural "is this a school day" check for features that aren't about attendance (e.g.
    // homework due dates) and may reasonably ask about a future date. Deliberately NOT an alias of
    // classifyAttendanceDay: that function treats every future date as unavailable ("hasn't
    // happened yet"), which is correct for recording attendance but wrong here — a homework due
    // date is normally in the future. Passing `dateKey` as its own "today" pivot skips that
    // future-vs-past check entirely and classifies purely by calendar structure (weekend, break,
    // closure, before/after the academic year).
    function classifySchoolDay(dateKey) {
      return classifyAttendanceDate(dateKey, db.academicCalendar, dateKey, closuresByDateMap(db));
    }
    function attendanceDateBounds() {
      const cal = db.academicCalendar;
      return { min: earliestAttendanceDate(cal), max: latestAttendanceDate(cal, todayKeyStr()) };
    }
    function closureForDate(dateKey) {
      return db.schoolClosures.find((c) => c.date === dateKey) || null;
    }
    // Staff attendance isn't gated by the academic calendar's semester/break phases (staff can
    // work through a break) — only by "not in the future" and "not a school closure day".
    function classifyStaffAttendanceDay(dateKey) {
      const todayKey = todayKeyStr();
      const closure = closureForDate(dateKey);
      if (closure) return { phase: "closed", available: false, label: dateKey === todayKey ? "No School Today" : "No School", message: closure.reason || "The school is closed on this date." };
      if (dateKey > todayKey) return { phase: "future", available: false, label: "Future date", message: "This date hasn't happened yet." };
      return { phase: dateKey === todayKey ? "today" : "past", available: true, label: dateKey === todayKey ? "Today" : "Completed day", message: "" };
    }

    // A class's roster for attendance-taking and homework targeting — excludes students whose
    // current status means they're no longer part of day-to-day school life (suspended,
    // transferred, graduated, withdrawn, archived). Their historical records stay fully visible
    // on their own profile, which reads by studentId directly rather than through this roster.
    function attendanceRosterForClass(classId) {
      return db.students.filter((s) => s.classId === classId && canStudentTakeAttendance(s.status));
    }

    return {
      db, getUser, getClass, classLabel, getStudent, studentFullName,
      studentIdentity, staffIdentity, userIdentity, leaveSubjectIdentity, announcementSenderLabel,
      parentsOfClass, parentsOfStudent,
      feeTypesForStudent, balanceFor, studentPaymentSummary, installmentStatusForStudent, recordPaymentBatch, periodSchedule, availableSubjectsForSlot,
      busFeeTypeForStudent, busScheduleForStudent, describePayment, familyGroups, dueStatusForFeeType, dueStatusForStudent, priorYearsOutstanding,
      paymentsForStudents, paymentMethodName,
      classifyAttendanceDay, classifySchoolDay, attendanceDateBounds, closureForDate, classifyStaffAttendanceDay, attendanceRosterForClass,

      // Keeps the current academic year's `enrollments` row in sync with a student's denormalized
      // "current" fields (grade/section/classId/status/suspension) every time any of them change —
      // so promoting/editing a student never overwrites history, it just stops updating last
      // year's row and starts (or continues) this year's. `yearId` lets callers that already
      // resolved the current year (createStudent) avoid resolving it twice.
      // Idempotent single-obligation creator — the JS-level form of UNIQUE(studentId,
      // feeInstallmentId). This is the ONE place a studentFeeObligations row comes into being,
      // used by year rollout, enrollment, bus opt-in, and payment migration alike.
      _materializeObligation(d, studentId, feeInstallment, reason) {
        const existing = obligationForInstallment(d, studentId, feeInstallment.id);
        if (existing) return existing;
        const ob = { id: uid("obl"), studentId, feeInstallmentId: feeInstallment.id, amountDue: feeInstallment.amount, createdAt: Date.now(), createdReason: reason };
        d.studentFeeObligations.push(ob);
        return ob;
      },
      // Materializes obligations for one student across every fee schedule already rolled out for
      // the given year, honoring Decision A (only installments due on/after `anchorDate` get a
      // row). Used at enrollment (anchorDate = admissionDate) and bus opt-in (anchorDate = today).
      _materializeObligationsForStudent(d, student, academicYearId, anchorDate, reason) {
        d.feeSchedules.filter((s) => s.academicYearId === academicYearId).forEach((schedule) => {
          const ft = d.feeTypes.find((f) => f.id === schedule.feeTypeId);
          if (!ft || ft.archivedAt || (ft.category === "TRANSPORT" && !student.usesBus)) return;
          installmentsForSchedule(d, schedule.id).filter((fi) => fi.dueDate >= anchorDate).forEach((fi) => {
            this._materializeObligation(d, student.id, fi, reason);
          });
        });
      },

      _syncEnrollment(d, student, yearId) {
        const academicYearId = yearId || (currentAcademicYear(d.academicYears) || {}).id;
        if (!academicYearId) return;
        let enr = d.enrollments.find((e) => e.studentId === student.id && e.academicYearId === academicYearId);
        if (!enr) {
          enr = { id: uid("enr"), studentId: student.id, academicYearId, enrollmentDate: student.admissionDate || todayKeyStr(), createdAt: Date.now() };
          d.enrollments.push(enr);
        }
        enr.grade = student.grade;
        enr.section = student.section;
        enr.classId = student.classId;
        enr.status = student.status;
        enr.suspension = student.suspension || null;
      },

      generateStudentId() {
        const year = currentAcademicYear(db.academicYears);
        const idYear = year ? new Date(year.yearStart).getFullYear() : new Date().getFullYear();
        return `TMA-${idYear}-${String(db.studentSeq).padStart(5, "0")}`;
      },

      generateReceiptNo() {
        return String(db.receiptSeq).padStart(4, "0");
      },

      createStudent(data) {
        let createdId = null;
        commit((d) => {
          const year = currentAcademicYear(d.academicYears);
          const idYear = year ? new Date(year.yearStart).getFullYear() : new Date().getFullYear();
          const studentId = `TMA-${idYear}-${String(d.studentSeq).padStart(5, "0")}`;
          d.studentSeq += 1;
          const cls = d.classes.find((c) => c.grade === data.grade && c.section === data.section);
          const student = {
            id: uid("stu"), studentId, ...data, classId: cls ? cls.id : null,
            status: data.status || "ACTIVE", suspension: null, parentIds: [],
          };
          d.students.unshift(student);
          this._syncEnrollment(d, student, year ? year.id : null);
          if (year) this._materializeObligationsForStudent(d, student, year.id, student.admissionDate || todayKeyStr(), "ENROLLMENT");
          d.activities = [{ id: uid("act"), text: `${studentFullName(student)} was added to ${data.grade}${data.section} (${studentId}).`, createdAt: Date.now() }, ...d.activities];
          createdId = studentId;
          return d;
        });
        return createdId;
      },

      updateStudent(id, patch) {
        commit((d) => {
          const s = d.students.find((x) => x.id === id);
          if (s) {
            // BUS_OPT_IN materialization anchors at "today" (the same anchor Decision A uses for
            // an already-enrolled continuing student at year rollout) — a family that stops using
            // the bus later keeps whatever they already owed/paid; future rollouts simply exclude
            // them per feeTypesForStudentIn's usesBus filter.
            const busOptIn = patch.usesBus === true && s.usesBus !== true;
            Object.assign(s, patch);
            if (patch.grade || patch.section) {
              const cls = d.classes.find((c) => c.grade === (patch.grade || s.grade) && c.section === (patch.section || s.section));
              if (cls) s.classId = cls.id;
            }
            this._syncEnrollment(d, s);
            if (busOptIn) {
              const year = currentAcademicYear(d.academicYears);
              if (year) this._materializeObligationsForStudent(d, s, year.id, todayKeyStr(), "BUS_OPT_IN");
            }
          }
          return d;
        });
      },

      archiveStudent(id, status) {
        commit((d) => {
          const s = d.students.find((x) => x.id === id);
          if (s) {
            s.status = status;
            if (status === "ACTIVE") s.suspension = null; // reinstating clears any lingering suspension record
            this._syncEnrollment(d, s);
          }
          d.activities = [{ id: uid("act"), text: `${s ? studentFullName(s) : "A student"} status changed to ${status}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      // ---- Academic Years: real Supabase data (see academicYearService). Only the activity-log
      // side effect still goes through commit()/the mock db -- `activities` hasn't converted yet.
      async createAcademicYear(fields, createdBy) {
        try {
          const base = defaultAcademicCalendar(fields.yearStart ? new Date(fields.yearStart) : undefined);
          const newYear = await academicYearService.create({ ...base, ...fields }, createdBy);
          await refetchAcademicYears();
          commit((d) => {
            d.activities = [{ id: uid("act"), text: `Academic year ${formatAcademicYearLabel(newYear)} was created.`, createdAt: Date.now() }, ...d.activities];
            return d;
          });
          return { ok: true, year: newYear };
        } catch (e) {
          console.error("Failed to create academic year", e);
          return { ok: false, message: e.message || "Couldn't create the academic year." };
        }
      },
      async setCurrentAcademicYear(id) {
        const year = academicYears.find((y) => y.id === id);
        if (!year) return { ok: false, message: "Academic year not found." };
        try {
          await academicYearService.setCurrent(id);
          await refetchAcademicYears();
          commit((d) => {
            d.activities = [{ id: uid("act"), text: `${formatAcademicYearLabel(year)} is now the current academic year.`, createdAt: Date.now() }, ...d.activities];
            return d;
          });
          return { ok: true };
        } catch (e) {
          console.error("Failed to set current academic year", e);
          return { ok: false, message: e.message || "Couldn't update the current academic year." };
        }
      },
      // Creates (or reuses) this student's enrollment row for `academicYearId` and updates their
      // current denormalized fields to match — the prior year's enrollment row, and every
      // attendance/homework/behavior/results/document tied to it, is left completely untouched.
      promoteStudent(studentId, { academicYearId, grade, section }) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const s = d.students.find((x) => x.id === studentId);
          const year = d.academicYears.find((y) => y.id === academicYearId);
          if (!s || !year) { result = { ok: false, message: "Student or academic year not found." }; return d; }
          const nextGrade = grade || s.grade;
          const nextSection = section !== undefined ? section : s.section;
          const cls = d.classes.find((c) => c.grade === nextGrade && c.section === nextSection);
          s.grade = nextGrade; s.section = nextSection; s.classId = cls ? cls.id : null;
          s.status = "ACTIVE"; s.suspension = null;
          this._syncEnrollment(d, s, academicYearId);
          d.activities = [{ id: uid("act"), text: `${studentFullName(s)} was promoted/re-enrolled into ${formatAcademicYearLabel(year)} (${nextGrade}${nextSection}).`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // ---- Real-data Overview stats (no placeholders) — all scoped to one academic year, so
      // switching a student's profile to a historical year shows that year's numbers, not the
      // current year's. `academicYearId` defaults to the current year when omitted.
      studentAttendanceRate(studentId, academicYearId) {
        const year = academicYearId ? db.academicYears.find((y) => y.id === academicYearId) : currentAcademicYear(db.academicYears);
        if (!year) return null;
        const records = db.attendance.filter((a) => a.studentId === studentId && a.date >= year.yearStart && a.date <= year.yearEnd);
        if (records.length === 0) return null;
        const presentLike = records.filter((a) => a.status === "Present" || a.status === "Late").length;
        return Math.round((presentLike / records.length) * 100);
      },
      // Mean of the student's per-semester averages (each itself the mean of that semester's
      // subject percentages, via the shared resultsEngine) — NOT a flat mean of every result
      // record, which used to mix subjects and semesters together unweighted and could disagree
      // with the Results grid/Report Card. Each semester's results are grouped by their own
      // record.classId (not the student's current class), so a promoted student's earlier-year
      // results are still scored against the class they actually belonged to at the time.
      studentResultsAverage(studentId, academicYearId) {
        const year = academicYearId ? db.academicYears.find((y) => y.id === academicYearId) : currentAcademicYear(db.academicYears);
        const records = db.results.filter((r) => r.studentId === studentId && (!year || !r.academicYearId || r.academicYearId === year.id));
        const semesterAverages = [];
        for (const semester of SEMESTERS) {
          const semRecords = records.filter((r) => r.semester === semester);
          const classIds = [...new Set(semRecords.map((r) => r.classId))];
          for (const classId of classIds) {
            const subjects = [...new Set(semRecords.filter((r) => r.classId === classId).map((r) => r.subject))];
            const { average } = computeStudentSemesterAverage({ results: records, studentId, classId, subjects, semester, academicYearId: year ? year.id : null });
            if (average != null) semesterAverages.push(average);
          }
        }
        if (semesterAverages.length === 0) return null;
        return Math.round(semesterAverages.reduce((a, b) => a + b, 0) / semesterAverages.length);
      },
      // No per-student homework-submission record exists in the data model (homework is assigned
      // per class, not tracked per student) — "Completed" is a due-date proxy (past due date), not
      // an actual submission status. Documented here rather than presented as more than it is.
      studentHomeworkStats(studentId, academicYearId) {
        const s = db.students.find((x) => x.id === studentId);
        if (!s) return { assigned: 0, completed: 0, pending: 0 };
        const year = academicYearId ? db.academicYears.find((y) => y.id === academicYearId) : currentAcademicYear(db.academicYears);
        const items = db.homework.filter((h) => h.classId === s.classId && (!year || !h.academicYearId || h.academicYearId === year.id));
        const todayKey = todayKeyStr();
        const pending = items.filter((h) => h.dueDate >= todayKey).length;
        return { assigned: items.length, completed: items.length - pending, pending };
      },
      // A student's full enrollment history, newest year first — backs the Academic Year switcher
      // on their profile.
      enrollmentsForStudent(studentId) {
        return db.enrollments.filter((e) => e.studentId === studentId).sort((a, b) => {
          const ya = db.academicYears.find((y) => y.id === a.academicYearId);
          const yb = db.academicYears.find((y) => y.id === b.academicYearId);
          return (yb?.yearStart || "").localeCompare(ya?.yearStart || "");
        });
      },

      // ---- Student documents (Report Cards / ID Copies / Other) ----
      createStudentDocument(studentId, { category, title, fileDataUrl, fileType, fileName }, uploadedBy) {
        commit((d) => {
          const year = currentAcademicYear(d.academicYears);
          d.studentDocuments.push({ id: uid("sdoc"), studentId, category, title, fileDataUrl, fileType, fileName, academicYearId: year ? year.id : null, uploadedBy, uploadedAt: Date.now() });
          const s = d.students.find((x) => x.id === studentId);
          d.activities = [{ id: uid("act"), text: `A document ("${title}") was uploaded for ${s ? studentFullName(s) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      deleteStudentDocument(id) {
        commit((d) => { d.studentDocuments = d.studentDocuments.filter((x) => x.id !== id); return d; });
      },

      // Permanently removes a student and every record that only makes sense in relation to them
      // (enrollment history, attendance, behavior, results/audit, documents, payments, leave
      // requests) and unlinks them from any parent's childIds. Homework is assigned per-class, not
      // per-student, so it's untouched. Irreversible — the UI requires a serious confirmation
      // before calling this.
      deleteStudent(id) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const s = d.students.find((x) => x.id === id);
          if (!s) { result = { ok: false, message: "Student not found." }; return d; }
          const name = studentFullName(s);
          d.students = d.students.filter((x) => x.id !== id);
          d.enrollments = d.enrollments.filter((e) => e.studentId !== id);
          d.attendance = d.attendance.filter((a) => a.studentId !== id);
          d.behaviorRecords = d.behaviorRecords.filter((b) => b.studentId !== id);
          d.results = d.results.filter((r) => r.studentId !== id);
          d.resultAuditLog = d.resultAuditLog.filter((a) => a.studentId !== id);
          d.resultEvidence = (d.resultEvidence || []).filter((e) => e.studentId !== id);
          d.studentDocuments = d.studentDocuments.filter((doc) => doc.studentId !== id);
          // Payments are immutable financial records (Locked Principle #4) — a hard student
          // delete never erases them, only this student's own billing state. Any payment that
          // funded this student's obligations keeps its row and its allocations as historical
          // fact; it simply funds a now-orphaned obligation instead of a deleted one.
          const orphanedObligationIds = d.studentFeeObligations.filter((o) => o.studentId === id).map((o) => o.id);
          d.feeObligationAdjustments = (d.feeObligationAdjustments || []).filter((a) => !orphanedObligationIds.includes(a.obligationId));
          d.studentFeeObligations = d.studentFeeObligations.filter((o) => o.studentId !== id);
          d.leaveRequests = (d.leaveRequests || []).filter((r) => !(r.kind === "STUDENT" && r.subjectId === id));
          d.users.filter((u) => u.role === ROLES.PARENT).forEach((p) => { if ((p.childIds || []).includes(id)) p.childIds = p.childIds.filter((cid) => cid !== id); });
          d.activities = [{ id: uid("act"), text: `${name} was permanently deleted.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Shared by deleteTeacher and deleteStaff (when the staff row is linked to a teacher login) —
      // removes the account, class/subject/timetable assignments, substitutions, and payroll/
      // attendance history, and clears (never leaves dangling) any class's headTeacherId/
      // subjectTeacherIds that pointed at them. Homework/results/behavior they authored stay as
      // historical records — deleting a teacher shouldn't erase a student's academic history.
      _cascadeDeleteTeacher(d, userId) {
        const u = d.users.find((x) => x.id === userId);
        const staffRec = d.staff.find((s) => s.userId === userId);
        d.teacherAssignments = d.teacherAssignments.filter((ta) => ta.teacherId !== userId);
        d.timetableEntries = d.timetableEntries.filter((e) => e.teacherId !== userId);
        d.substitutions = d.substitutions.filter((s) => s.originalTeacherId !== userId && s.substituteTeacherId !== userId);
        d.classes.forEach((c) => {
          if (c.headTeacherId === userId) c.headTeacherId = null;
          if (Array.isArray(c.subjectTeacherIds)) c.subjectTeacherIds = c.subjectTeacherIds.filter((tid) => tid !== userId);
        });
        if (staffRec) {
          d.payrollPayments = d.payrollPayments.filter((p) => p.staffId !== staffRec.id);
          d.salaryAdvances = d.salaryAdvances.filter((a) => a.staffId !== staffRec.id);
          d.staffAttendance = d.staffAttendance.filter((a) => a.staffId !== staffRec.id);
          d.leaveRequests = (d.leaveRequests || []).filter((r) => !(r.kind === "STAFF" && r.subjectId === staffRec.id));
          d.staff = d.staff.filter((s) => s.id !== staffRec.id);
        }
        d.users = d.users.filter((x) => x.id !== userId);
        d.notifications = d.notifications.filter((n) => n.userId !== userId);
        d.activities = [{ id: uid("act"), text: `${u ? u.name : "A teacher"} was permanently deleted.`, createdAt: Date.now() }, ...d.activities];
      },
      deleteTeacher(userId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const u = d.users.find((x) => x.id === userId);
          if (!u || u.role !== ROLES.TEACHER) { result = { ok: false, message: "Teacher not found." }; return d; }
          this._cascadeDeleteTeacher(d, userId);
          return d;
        });
        return result;
      },
      // Non-login staff (Cleaner/Guard/Driver/Cook/Other) are deleted outright; a staff row linked
      // to a Teacher login is routed through the same cascade as deleteTeacher. Director/Finance
      // accounts are out of scope here — those are managed via Accounts & Access, not Staff delete.
      deleteStaff(staffId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const staffRec = d.staff.find((s) => s.id === staffId);
          if (!staffRec) { result = { ok: false, message: "Staff member not found." }; return d; }
          const linkedUser = staffRec.userId ? d.users.find((u) => u.id === staffRec.userId) : null;
          if (linkedUser && linkedUser.role === ROLES.TEACHER) { this._cascadeDeleteTeacher(d, linkedUser.id); return d; }
          if (linkedUser && (linkedUser.role === ROLES.ADMIN || linkedUser.role === ROLES.FINANCE)) {
            result = { ok: false, message: "Director/Finance accounts can't be deleted from Staff — disable their access from Accounts & Access instead." };
            return d;
          }
          d.payrollPayments = d.payrollPayments.filter((p) => p.staffId !== staffId);
          d.salaryAdvances = d.salaryAdvances.filter((a) => a.staffId !== staffId);
          d.staffAttendance = d.staffAttendance.filter((a) => a.staffId !== staffId);
          d.leaveRequests = (d.leaveRequests || []).filter((r) => !(r.kind === "STAFF" && r.subjectId === staffId));
          d.staff = d.staff.filter((s) => s.id !== staffId);
          d.activities = [{ id: uid("act"), text: `${staffRec.name} was permanently deleted.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Builds { subject: [classId, ...] } — the set of class+subject pairs that are actually free
      // to assign, given the classes/subjects requested. A pair is skipped (not assigned) if the
      // subject isn't part of that class's curriculum at all, or if it's already taught by someone
      // else (other than `excludeTeacherId`, and unless explicitly forced via `reassignSet`) — so
      // one subject can be partly available across several classes. If a requested subject ends up
      // with zero free classes among those requested, this reports a conflict instead of silently
      // creating nothing for it — a Teacher+Class+Subject assignment is never created without the
      // caller knowing exactly what it collided with.
      _resolveTeacherAssignments(d, { subjects, classIds, excludeTeacherId, reassignSet }) {
        const pairsBySubject = {};
        for (const subj of subjects) {
          const valid = [];
          let conflict = null;
          let notOffered = null;
          for (const cid of classIds) {
            const cls = d.classes.find((c) => c.id === cid);
            const offered = d.classSubjects.some((cs) => cs.classId === cid && cs.subject === subj);
            if (!offered) {
              if (!notOffered) notOffered = { subject: subj, classLabel: cls ? `${cls.grade}${cls.section}` : "this class" };
              continue;
            }
            const existing = d.teacherAssignments.find((ta) => ta.classId === cid && ta.subject === subj && ta.teacherId !== excludeTeacherId);
            const forced = reassignSet && reassignSet.has(`${cid}|${subj}`);
            if (existing && !forced) {
              if (!conflict) {
                const otherTeacher = d.users.find((u) => u.id === existing.teacherId);
                conflict = { subject: subj, classLabel: cls ? `${cls.grade}${cls.section}` : "this class", teacherName: otherTeacher?.name || "another teacher" };
              }
              continue;
            }
            valid.push(cid);
          }
          if (valid.length === 0 && classIds.length > 0) {
            if (conflict) return { ok: false, message: `${conflict.subject} is already assigned to ${conflict.teacherName} in ${conflict.classLabel}. Please choose another subject/class assignment or reassign the existing teacher.` };
            return { ok: false, message: `${notOffered.subject} is not part of the curriculum for the selected class(es). Add it to the class's subjects first.` };
          }
          pairsBySubject[subj] = valid;
        }
        return { ok: true, pairsBySubject };
      },

      teacherSubjects(teacherId) {
        return [...new Set(db.teacherAssignments.filter((ta) => ta.teacherId === teacherId).map((ta) => ta.subject))];
      },
      teacherClassIds(teacherId) {
        return [...new Set(db.teacherAssignments.filter((ta) => ta.teacherId === teacherId).map((ta) => ta.classId))];
      },
      subjectAssignmentOwner(classId, subject) {
        const ta = db.teacherAssignments.find((t) => t.classId === classId && t.subject === subject);
        if (!ta) return null;
        const teacher = getUser(ta.teacherId);
        return { teacherId: ta.teacherId, teacherName: teacher?.name || "another teacher" };
      },

      // Moves each { classId, subject } pair in `reassignments` off whichever teacher currently
      // holds it and onto `teacherId`, so a Class+Subject slot is never held by two teachers at
      // once. Shared by create (hiring someone to explicitly take over an already-taught slot)
      // and edit (the Owner/Director moving a slot between two existing teachers).
      _applyReassignments(d, reassignments, teacherId) {
        reassignments.forEach(({ classId, subject }) => {
          const stolen = d.teacherAssignments.find((ta) => ta.classId === classId && ta.subject === subject && ta.teacherId !== teacherId);
          if (!stolen) return;
          d.teacherAssignments = d.teacherAssignments.filter((ta) => ta.id !== stolen.id);
          const stillTeachesClass = d.teacherAssignments.some((ta) => ta.teacherId === stolen.teacherId && ta.classId === classId);
          const cls = d.classes.find((c) => c.id === classId);
          if (cls && !stillTeachesClass && cls.headTeacherId !== stolen.teacherId) {
            cls.subjectTeacherIds = cls.subjectTeacherIds.filter((id) => id !== stolen.teacherId);
          }
        });
      },

      createTeacher(data) {
        const { firstName, middleName, lastName, email, phone, subjects = [], classIds = [], password, reassignments = [], photo } = data;
        let result = { ok: false, message: "" };
        commit((d) => {
          const trimmedEmail = (email || "").trim();
          if (d.users.some((u) => u.email.toLowerCase() === trimmedEmail.toLowerCase())) {
            result = { ok: false, message: "An account with this email already exists." };
            return d;
          }
          const reassignSet = new Set(reassignments.map((r) => `${r.classId}|${r.subject}`));
          const resolved = this._resolveTeacherAssignments(d, { subjects, classIds, excludeTeacherId: null, reassignSet });
          if (!resolved.ok) { result = resolved; return d; }

          const name = fullName(firstName, middleName, lastName);
          const t = {
            id: uid("user"), role: ROLES.TEACHER, status: "ACTIVE", photo: photo || null, mustChangePassword: true,
            firstName: (firstName || "").trim(), middleName: (middleName || "").trim(), lastName: (lastName || "").trim(), name,
            email: trimmedEmail, phone: (phone || "").trim(), password,
          };
          d.users.push(t);
          this._applyReassignments(d, reassignments, t.id);

          const classLabels = new Set();
          Object.entries(resolved.pairsBySubject).forEach(([subj, cids]) => {
            cids.forEach((cid) => {
              d.teacherAssignments.push({ id: uid("ta"), teacherId: t.id, subject: subj, classId: cid });
              const cls = d.classes.find((c) => c.id === cid);
              if (cls) {
                if (!cls.subjectTeacherIds.includes(t.id)) cls.subjectTeacherIds.push(t.id);
                classLabels.add(`${cls.grade}${cls.section}`);
              }
            });
          });
          // Every teacher login also gets a linked staff/payroll record (same as the seeded
          // teachers — see seed.js's "stay in sync with users" comment), so a newly hired teacher
          // immediately shows up in Payroll and Staff Attendance instead of only existing as a
          // login with no HR record until someone manually adds one from the Staff page.
          const staffSeq = d.staffSeq || 1;
          d.staffSeq = staffSeq + 1;
          d.staff.push({
            id: uid("staff"), userId: t.id, name, position: "Teacher",
            employmentDate: new Date().toISOString().slice(0, 10), phone: t.phone,
            salary: 4500, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: t.photo,
            bankAccount: data.bankAccount || null, employeeNumber: `TMA-EMP-${String(staffSeq).padStart(4, "0")}`,
          });

          d.activities = [{ id: uid("act"), text: `Teacher ${name} was added${classLabels.size ? ` and assigned to ${[...classLabels].join(", ")}` : ""}.`, createdAt: Date.now() }, ...d.activities];
          result = { ok: true, message: "Teacher added successfully.", teacherId: t.id };
          return d;
        });
        return result;
      },
      updateTeacher(id, patch) {
        commit((d) => {
          // bankAccount lives only on the staff/payroll record, not the login — pulled out before
          // patching `users` so it doesn't get duplicated onto the account object.
          const { bankAccount, ...userPatch } = patch;
          const t = d.users.find((u) => u.id === id);
          if (t) Object.assign(t, userPatch);
          // Keep the linked staff/payroll record's name/phone/photo/bank account in sync, same
          // invariant as updateOwnProfile below.
          const staffRec = d.staff.find((s) => s.userId === id);
          if (staffRec) {
            if (patch.name !== undefined) staffRec.name = patch.name;
            if (patch.phone !== undefined) staffRec.phone = patch.phone;
            if (patch.photo !== undefined) staffRec.photo = patch.photo;
            if (bankAccount !== undefined) staffRec.bankAccount = bankAccount;
          }
          return d;
        });
      },
      // Replaces a teacher's full set of Class+Subject assignments with the requested one.
      // `reassignments` is an optional array of { classId, subject } pairs the Owner/Director has
      // explicitly chosen to move from whichever teacher currently holds them onto this teacher —
      // without it, a class+subject already taught by someone else is left with that teacher.
      updateTeacherAssignments(teacherId, subjects = [], classIds = [], reassignments = []) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const teacher = d.users.find((u) => u.id === teacherId);
          if (!teacher) { result = { ok: false, message: "Teacher not found." }; return d; }
          const reassignSet = new Set(reassignments.map((r) => `${r.classId}|${r.subject}`));

          const resolved = this._resolveTeacherAssignments(d, { subjects, classIds, excludeTeacherId: teacherId, reassignSet });
          if (!resolved.ok) { result = resolved; return d; }

          this._applyReassignments(d, reassignments, teacherId);

          d.teacherAssignments = d.teacherAssignments.filter((ta) => ta.teacherId !== teacherId);
          d.classes.forEach((c) => { c.subjectTeacherIds = c.subjectTeacherIds.filter((id) => id !== teacherId); });
          const classLabels = new Set();
          Object.entries(resolved.pairsBySubject).forEach(([subj, cids]) => {
            cids.forEach((cid) => {
              d.teacherAssignments.push({ id: uid("ta"), teacherId, subject: subj, classId: cid });
              const cls = d.classes.find((c) => c.id === cid);
              if (cls) {
                if (!cls.subjectTeacherIds.includes(teacherId)) cls.subjectTeacherIds.push(teacherId);
                classLabels.add(`${cls.grade}${cls.section}`);
              }
            });
          });
          d.activities = [{ id: uid("act"), text: `${teacher.name}'s class and subject assignments were updated${classLabels.size ? ` (${[...classLabels].join(", ")})` : ""}.`, createdAt: Date.now() }, ...d.activities];
          result = { ok: true, message: "Teacher assignments updated." };
          return d;
        });
        return result;
      },

      resetTeacherPassword(teacherId, newPassword) {
        commit((d) => {
          const t = d.users.find((u) => u.id === teacherId);
          if (t) { t.password = newPassword; t.mustChangePassword = true; }
          d.activities = [{ id: uid("act"), text: `Password was reset for ${t?.name || "a teacher"}. The new temporary password was shared privately and is not stored anywhere visible.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      // `data.subjects`, if given, is the class's full curriculum (subject name strings) — set in
      // the same commit as the class itself so a brand-new class's subjects are never lost to the
      // setDb-batching hazard of chaining two commit()-returning calls in one tick (see
      // updateClass's matching `patch.subjects` handling for the full add/remove/cascade logic;
      // a newly created class has no prior teacherAssignments/results to reconcile against, so
      // this path is just a straight push).
      createClass(data) {
        let newId = null;
        commit((d) => {
          const exists = d.classes.some((c) => c.grade === data.grade && c.section === data.section);
          if (exists) return d;
          const cls = { id: uid("class"), grade: data.grade, section: data.section, headTeacherId: data.headTeacherId || null, subjectTeacherIds: [] };
          newId = cls.id;
          d.classes.push(cls);
          (data.subjects || []).forEach((name) => { d.classSubjects.push({ id: uid("csub"), classId: cls.id, subject: name }); });
          d.activities = [{ id: uid("act"), text: `${data.grade}${data.section} was added as a new class.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return newId;
      },

      // `patch.subjects`, if given, full-replaces the class's curriculum in this same commit
      // (diffed against its current classSubjects). Removing a subject the class no longer
      // teaches is blocked if students already have recorded results for it, and cleanly
      // unassigns any teacher who was teaching that class+subject pair — same cascade
      // `_applyReassignments` already uses for `cls.subjectTeacherIds` cleanup.
      updateClass(id, patch) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const cls = d.classes.find((c) => c.id === id);
          if (!cls) { result = { ok: false, message: "Class not found." }; return d; }
          const nextGrade = patch.grade ?? cls.grade;
          const nextSection = patch.section ?? cls.section;
          const duplicate = d.classes.some((c) => c.id !== id && c.grade === nextGrade && c.section === nextSection);
          if (duplicate) { result = { ok: false, message: `${nextGrade}${nextSection} already exists.` }; return d; }
          if (patch.subjects) {
            const current = d.classSubjects.filter((cs) => cs.classId === id).map((cs) => cs.subject);
            const toAdd = patch.subjects.filter((n) => !current.includes(n));
            const toRemove = current.filter((n) => !patch.subjects.includes(n));
            for (const name of toRemove) {
              const hasResults = d.results.some((r) => r.classId === id && r.subject === name);
              if (hasResults) { result = { ok: false, message: `Can't remove ${name} — ${cls.grade}${cls.section} already has recorded results for it. Remove those results first.` }; return d; }
            }
            toRemove.forEach((name) => {
              d.classSubjects = d.classSubjects.filter((cs) => !(cs.classId === id && cs.subject === name));
              const stale = d.teacherAssignments.filter((ta) => ta.classId === id && ta.subject === name);
              stale.forEach((ta) => {
                d.teacherAssignments = d.teacherAssignments.filter((x) => x.id !== ta.id);
                const stillTeachesClass = d.teacherAssignments.some((x) => x.teacherId === ta.teacherId && x.classId === id);
                if (!stillTeachesClass && cls.headTeacherId !== ta.teacherId) {
                  cls.subjectTeacherIds = cls.subjectTeacherIds.filter((tid) => tid !== ta.teacherId);
                }
              });
            });
            toAdd.forEach((name) => { d.classSubjects.push({ id: uid("csub"), classId: id, subject: name }); });
          }
          if ((patch.grade && patch.grade !== cls.grade) || (patch.section !== undefined && patch.section !== cls.section)) {
            // keep student/homework records pointing at the same class in sync with the renamed grade/section
            // (exam announcements aren't stored per-class — they're audience-scoped by grade/section at
            // announce-time, so there's nothing to cascade there)
            d.students.forEach((s) => { if (s.classId === id) { s.grade = nextGrade; s.section = nextSection; } });
            d.homework.forEach((h) => { if (h.classId === id) { h.grade = nextGrade; h.section = nextSection; } });
          }
          cls.grade = nextGrade;
          cls.section = nextSection;
          if (patch.headTeacherId !== undefined) cls.headTeacherId = patch.headTeacherId || null;
          d.activities = [{ id: uid("act"), text: `${nextGrade}${nextSection} was updated.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      deleteClass(id) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const cls = d.classes.find((c) => c.id === id);
          if (!cls) { result = { ok: false, message: "Class not found." }; return d; }
          const hasStudents = d.students.some((s) => s.classId === id);
          if (hasStudents) { result = { ok: false, message: `${cls.grade}${cls.section} still has students enrolled. Move or archive them before deleting this class.` }; return d; }
          d.classes = d.classes.filter((c) => c.id !== id);
          d.classSubjects = d.classSubjects.filter((cs) => cs.classId !== id);
          d.teacherAssignments = d.teacherAssignments.filter((ta) => ta.classId !== id);
          d.results = d.results.filter((r) => r.classId !== id);
          d.resultAuditLog = (d.resultAuditLog || []).filter((e) => e.classId !== id);
          d.homework = d.homework.filter((h) => h.classId !== id);
          d.activities = [{ id: uid("act"), text: `${cls.grade}${cls.section} was deleted.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      createSubject(name) {
        commit((d) => {
          d.subjects.push({ id: uid("sub"), name });
          d.activities = [{ id: uid("act"), text: `${name} was added as a new subject.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      updateSubject(id, newName) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const subj = d.subjects.find((s) => s.id === id);
          if (!subj) { result = { ok: false, message: "Subject not found." }; return d; }
          const trimmed = newName.trim();
          const duplicate = d.subjects.some((s) => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase());
          if (duplicate) { result = { ok: false, message: "This subject already exists." }; return d; }
          const oldName = subj.name;
          subj.name = trimmed;
          d.homework.forEach((h) => { if (h.subject === oldName) h.subject = trimmed; });
          d.teacherAssignments.forEach((ta) => { if (ta.subject === oldName) ta.subject = trimmed; });
          d.classSubjects.forEach((cs) => { if (cs.subject === oldName) cs.subject = trimmed; });
          d.users.forEach((u) => { if (u.role === ROLES.TEACHER && u.subject === oldName) u.subject = trimmed; });
          // Existing recorded results are keyed by subject name — without this, a rename orphans
          // every student's already-recorded scores under the old name (invisible in Results/
          // report cards, which all query by the class's *current* curriculum).
          d.results.forEach((r) => { if (r.subject === oldName) r.subject = trimmed; });
          d.activities = [{ id: uid("act"), text: `Subject "${oldName}" was renamed to "${trimmed}".`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      deleteSubject(id) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const subj = d.subjects.find((s) => s.id === id);
          if (!subj) { result = { ok: false, message: "Subject not found." }; return d; }
          const inUse = d.classSubjects.some((cs) => cs.subject === subj.name) || d.teacherAssignments.some((ta) => ta.subject === subj.name) || d.users.some((u) => u.role === ROLES.TEACHER && u.subject === subj.name);
          if (inUse) { result = { ok: false, message: `${subj.name} is still part of one or more classes' subjects. Remove it from those classes first.` }; return d; }
          d.subjects = d.subjects.filter((s) => s.id !== id);
          d.activities = [{ id: uid("act"), text: `${subj.name} was removed from the subject list.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      gradeOptions() {
        const list = [...new Set(db.classes.map((c) => c.grade))];
        return list.length ? list.sort((a, b) => GRADES.indexOf(a) - GRADES.indexOf(b)) : GRADES.slice(0, 3);
      },

      createParentAccount({ name, email, password, phone, children }) {
        let result = { ok: false, message: "" };
        commit((d) => {
          if (d.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
            result = { ok: false, message: "An account with this email already exists." };
            return d;
          }
          const resolvedChildren = [];
          for (const c of children) {
            const student = d.students.find((s) => s.studentId.toLowerCase() === c.studentId.trim().toLowerCase());
            if (!student) {
              result = { ok: false, message: `We couldn't find a student with ID ${c.studentId}. Please check the ID provided by the school.` };
              return d;
            }
            if (student.parentIds && student.parentIds.length > 0) {
              result = { ok: false, message: `${studentFullName(student)} (${student.studentId}) is already registered to a parent account. If this is a mistake, please contact the school.` };
              return d;
            }
            resolvedChildren.push(student);
          }
          const parent = { id: uid("user"), role: ROLES.PARENT, name, email, password, phone, photo: null, childIds: resolvedChildren.map((s) => s.id) };
          d.users.push(parent);
          resolvedChildren.forEach((s) => {
            if (!s.parentIds.includes(parent.id)) s.parentIds.push(parent.id);
          });
          d.activities = [{ id: uid("act"), text: `New parent account (${name}) connected to ${resolvedChildren.map((s) => s.studentId).join(", ")}.`, createdAt: Date.now() }, ...d.activities];
          result = { ok: true, message: "Account created.", parentId: parent.id };
          return d;
        });
        return result;
      },

      connectChild(parentId, studentIdRaw) {
        let result = { ok: false, message: "" };
        commit((d) => {
          const student = d.students.find((s) => s.studentId.toLowerCase() === studentIdRaw.trim().toLowerCase());
          if (!student) {
            result = { ok: false, message: "We couldn't find a student with this ID. Please check the ID provided by the school." };
            return d;
          }
          const parent = d.users.find((u) => u.id === parentId);
          if (student.parentIds.includes(parentId)) {
            result = { ok: false, message: "This child is already connected to your account." };
            return d;
          }
          student.parentIds.push(parentId);
          parent.childIds.push(student.id);
          d.activities = [{ id: uid("act"), text: `Parent account connected to student ${student.studentId}.`, createdAt: Date.now() }, ...d.activities];
          result = { ok: true, message: `${studentFullName(student)} has been added to your account.` };
          return d;
        });
        return result;
      },

      // Blocks the same two ways every other teacher-only academic action is blocked (see
      // canTeacherPerformAcademicAction and classifySchoolDay): the calendar says today isn't a
      // school day (weekend/break/closure/outside the academic year), or the teacher's own
      // staffAttendance record for today is Absent/Sick/Permission. Previously unchecked here — a
      // teacher could publish homework on any date, including after the academic year had ended.
      createHomework(data) {
        const today = todayKeyStr();
        const calendar = classifySchoolDay(today);
        if (!calendar.available) {
          return { ok: false, message: calendar.message || `${calendar.label} — homework can't be published today.` };
        }
        const teacherUser = db.users.find((u) => u.id === data.teacherId);
        const teacherStaffRec = db.staff.find((s) => s.userId === data.teacherId);
        const myRecordToday = teacherStaffRec && db.staffAttendance.find((a) => a.staffId === teacherStaffRec.id && a.date === today);
        if (!canTeacherAct(teacherUser, myRecordToday)) {
          return { ok: false, message: `You're marked ${myRecordToday.status.toLowerCase()} today — homework can't be published until this is corrected or a substitute is assigned.` };
        }
        commit((d) => {
          const cls = d.classes.find((c) => c.grade === data.grade && c.section === data.section);
          const year = currentAcademicYear(d.academicYears);
          const hw = { id: uid("hw"), ...data, classId: cls?.id, createdAt: Date.now(), attachment: data.attachment || null, academicYearId: year ? year.id : null };
          d.homework.push(hw);
          const teacher = d.users.find((u) => u.id === data.teacherId);
          d.activities = [{ id: uid("act"), text: `${teacher?.name || "A teacher"} published ${data.subject} homework for ${data.grade}${data.section}.`, createdAt: Date.now(), navigation: { page: "homework", homeworkId: hw.id, classId: cls?.id } }, ...d.activities];
          const studentIds = d.students.filter((s) => s.classId === cls?.id).map((s) => s.id);
          const parentIds = new Set();
          d.users.filter((u) => u.role === ROLES.PARENT).forEach((p) => { if ((p.childIds || []).some((cid) => studentIds.includes(cid))) parentIds.add(p.id); });
          parentIds.forEach((pid) => {
            const parentUser = d.users.find((u) => u.id === pid);
            const childId = (parentUser?.childIds || []).find((cid) => studentIds.includes(cid)) || null;
            d.notifications = [{ id: uid("notif"), userId: pid, title: `New ${data.subject} homework`, message: `${data.title} — due ${fmtDate(data.dueDate)}.`, read: false, createdAt: Date.now(), type: "HOMEWORK", navigation: { page: "homework", studentId: childId, homeworkId: hw.id } }, ...d.notifications];
          });
          return d;
        });
        return { ok: true, message: "" };
      },
      updateHomework(id, patch) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const hw = d.homework.find((h) => h.id === id);
          if (!hw) { result = { ok: false, message: "Homework not found." }; return d; }
          if (patch.grade !== undefined || patch.section !== undefined) {
            const grade = patch.grade ?? hw.grade, section = patch.section ?? hw.section;
            const cls = d.classes.find((c) => c.grade === grade && c.section === section);
            hw.classId = cls?.id;
          }
          Object.assign(hw, patch);
          d.activities = [{ id: uid("act"), text: `${hw.subject} homework for ${hw.grade}${hw.section} was updated.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      // Homework is only ever removed by the teacher who created it (or Owner/Educational
      // Director) — enforced by the caller, same pattern as deleteClass/deleteStaff below.
      deleteHomework(id) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const hw = d.homework.find((h) => h.id === id);
          if (!hw) { result = { ok: false, message: "Homework not found." }; return d; }
          d.homework = d.homework.filter((h) => h.id !== id);
          d.activities = [{ id: uid("act"), text: `${hw.subject} homework "${hw.title}" for ${hw.grade}${hw.section} was deleted.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Shared by direct save (saveAttendance/saveStaffAttendance) and leave auto-apply
      // (decideLeaveRequest), so a record created by an approved leave and a record edited by
      // hand go through the exact same upsert path.
      _upsertAttendanceRecord(d, { studentId, classId, date, status, note, markedBy, leaveRequestId }) {
        const existing = d.attendance.find((a) => a.studentId === studentId && a.date === date);
        // Only a genuinely new record or an actual status change is notification-worthy — re-saving
        // the same class (e.g. to fix one student's note, or a plain repeat Save) would otherwise
        // re-notify every already-marked-non-Present parent on every save, not just the one whose
        // status actually changed.
        const statusChanged = !existing || existing.status !== status;
        if (existing) { existing.status = status; existing.note = note || ""; existing.markedBy = markedBy; existing.markedAt = Date.now(); existing.leaveRequestId = leaveRequestId ?? existing.leaveRequestId ?? null; }
        else d.attendance.push({ id: uid("att"), studentId, classId, date, status, note: note || "", markedBy, markedAt: Date.now(), leaveRequestId: leaveRequestId ?? null });
        if (status !== "Present" && statusChanged) {
          const student = d.students.find((s) => s.id === studentId);
          const parentIds = d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(studentId)).map((u) => u.id);
          parentIds.forEach((pid) => {
            d.notifications = [{ id: uid("notif"), userId: pid, title: `Attendance update for ${student?.firstName}`, message: `${student?.firstName} was marked ${status.toLowerCase()} on ${fmtDate(date)}.`, read: false, createdAt: Date.now(), type: "ATTENDANCE", navigation: { page: "attendance", studentId, date } }, ...d.notifications];
          });
        }
      },

      saveAttendance(classId, date, records, markedBy) {
        commit((d) => {
          records.forEach((r) => {
            this._upsertAttendanceRecord(d, { studentId: r.studentId, classId, date, status: r.status, note: r.note, markedBy });
          });
          const cls = d.classes.find((c) => c.id === classId);
          d.activities = [{ id: uid("act"), text: `Attendance was recorded for ${cls ? cls.grade + cls.section : "a class"} on ${fmtDate(date)}.`, createdAt: Date.now(), navigation: { page: "attendance", classId, date } }, ...d.activities];
          return d;
        });
      },

      // `period` distinguishes multiple attendance sessions on the same day for shift-based staff
      // (a driver's morning school run vs. afternoon run — see staff.hasShifts). Every non-shift
      // staff member's records are all "FULL_DAY", so this is a no-op for the common case.
      _upsertStaffAttendanceRecord(d, { staffId, date, status, arrivalTime, note, markedBy, leaveRequestId, period }) {
        const finalPeriod = period || "FULL_DAY";
        const finalArrivalTime = status === "Late" ? (arrivalTime || "") : null;
        const existing = d.staffAttendance.find((a) => a.staffId === staffId && a.date === date && (a.period || "FULL_DAY") === finalPeriod);
        // Same guard as _upsertAttendanceRecord — don't re-notify the staff member on a repeat save
        // that doesn't actually change their status (or, for Late, their recorded arrival time).
        const statusChanged = !existing || existing.status !== status || (status === "Late" && existing.arrivalTime !== finalArrivalTime);
        if (existing) { existing.status = status; existing.arrivalTime = finalArrivalTime; existing.note = note || ""; existing.markedBy = markedBy; existing.markedAt = Date.now(); existing.leaveRequestId = leaveRequestId ?? existing.leaveRequestId ?? null; }
        else d.staffAttendance.push({ id: uid("tatt"), staffId, date, period: finalPeriod, status, arrivalTime: finalArrivalTime, note: note || "", markedBy, markedAt: Date.now(), leaveRequestId: leaveRequestId ?? null });
        if (status !== "Present" && statusChanged) {
          const staffRec = d.staff.find((s) => s.id === staffId);
          const periodPrefix = finalPeriod === "AM" ? "Morning — " : finalPeriod === "PM" ? "Afternoon — " : "";
          const message = status === "Late"
            ? `${periodPrefix}You were marked late on ${fmtDate(date)}${finalArrivalTime ? ` — arrived at ${to12Hour(finalArrivalTime)}` : ""}.`
            : `${periodPrefix}You were marked ${status.toLowerCase()} on ${fmtDate(date)}.`;
          if (staffRec?.userId) {
            d.notifications = [{ id: uid("notif"), userId: staffRec.userId, title: "Attendance recorded", message, read: false, createdAt: Date.now(), type: "ATTENDANCE" }, ...d.notifications];
          }
        }
      },

      saveStaffAttendance(date, records, markedBy) {
        commit((d) => {
          records.forEach((r) => {
            this._upsertStaffAttendanceRecord(d, { staffId: r.staffId, date, status: r.status, arrivalTime: r.arrivalTime, note: r.note, markedBy, period: r.period });
          });
          d.activities = [{ id: uid("act"), text: `Staff attendance was recorded for ${fmtDate(date)}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      /* ---------- Leave / permission requests ---------- */
      leaveRequestsFor(kind, subjectId) {
        return db.leaveRequests.filter((r) => r.kind === kind && r.subjectId === subjectId).sort((a, b) => b.createdAt - a.createdAt);
      },
      pendingLeaveRequests(kind) {
        return db.leaveRequests.filter((r) => r.kind === kind && r.approvalStatus === "PENDING").sort((a, b) => a.createdAt - b.createdAt);
      },

      createLeaveRequest({ kind, subjectId, requestedBy, status, fromDate, toDate, note }) {
        commit((d) => {
          const req = { id: uid("leave"), kind, subjectId, requestedBy, status, fromDate, toDate, note: note || "", approvalStatus: "PENDING", decidedBy: null, decidedAt: null, rejectionReason: null, completionNotified: false, createdAt: Date.now() };
          d.leaveRequests.unshift(req);
          const who = leaveSubjectLabel(d, kind, subjectId);
          d.activities = [{ id: uid("act"), text: `A ${status.toLowerCase()} leave request was submitted for ${who} (${fmtDate(fromDate)} – ${fmtDate(toDate)}).`, createdAt: Date.now() }, ...d.activities];

          // A Director's own leave only goes to the Owner (nobody else can decide it); everyone
          // else's goes to both the Owner and every Educational Director — matches canDecideLeaveRequest.
          const subjectStaff = kind === "STAFF" ? d.staff.find((s) => s.id === subjectId) : null;
          const isDirectorSubject = !!subjectStaff && staffGroupLabel(subjectStaff.position) === "Directors";
          const recipientRoles = isDirectorSubject ? [ROLES.OWNER] : [ROLES.OWNER, ROLES.ADMIN];
          const { title, message } = leaveSubmittedNotification(d, req);
          const leaveStudentId = kind === "STUDENT" ? subjectId : null;
          d.users.filter((u) => recipientRoles.includes(u.role)).forEach((u) => {
            d.notifications = [{ id: uid("notif"), userId: u.id, title, message, read: false, createdAt: Date.now(), type: "LEAVE", navigation: { page: "leaveRequests", studentId: leaveStudentId } }, ...d.notifications];
          });
          return d;
        });
      },

      // Approving auto-applies the request's status to every school day in range that's actually
      // an available attendance date, reusing the same upsert path as a manually saved day — so a
      // 7-day leave becomes one action instead of marking each day by hand.
      decideLeaveRequest(id, approvalStatus, decidedBy, reason) {
        commit((d) => {
          const req = d.leaveRequests.find((r) => r.id === id);
          if (!req || req.approvalStatus !== "PENDING") return d;
          // A rejection always needs a reason — enforced in the UI too (RejectLeaveModal), this
          // is the last-line guard so the data layer can never end up with an unexplained rejection.
          if (approvalStatus === "REJECTED" && !(reason || "").trim()) return d;
          req.approvalStatus = approvalStatus;
          req.decidedBy = decidedBy;
          req.decidedAt = Date.now();
          if (approvalStatus === "REJECTED") req.rejectionReason = reason.trim();
          if (approvalStatus === "APPROVED") {
            const closures = closuresByDateMap(d);
            let cur = req.fromDate;
            let guard = 0;
            while (cur <= req.toDate && guard++ < 400) {
              // A leave request is normally approved in advance of the dates it covers — that's
              // the whole point (the UI promises "once approved, it's applied to your attendance
              // automatically"). classifyAttendanceDate's own "hasn't happened yet" future-gate
              // exists to stop a human manually pre-marking an ordinary day's attendance, which
              // doesn't apply here: passing `cur` as its own todayKey sidesteps just that one
              // gate while still enforcing every other rule (weekends, closures, before/after the
              // academic year, breaks/gaps) for the date being applied.
              const dateOk = classifyAttendanceDate(cur, d.academicCalendar, cur, closures).available;
              const dow = new Date(cur + "T00:00:00").getDay(); // 0 = Sunday, 6 = Saturday
              if (dateOk && dow >= 1 && dow <= 5) {
                if (req.kind === "STUDENT") {
                  const student = d.students.find((s) => s.id === req.subjectId);
                  if (student) this._upsertAttendanceRecord(d, { studentId: student.id, classId: student.classId, date: cur, status: req.status, note: req.note, markedBy: decidedBy, leaveRequestId: req.id });
                } else {
                  // A leave request has no shift granularity — it covers the whole day, so a
                  // shift-based staff member (see staff.hasShifts) gets both sessions marked.
                  const staffRec = d.staff.find((s) => s.id === req.subjectId);
                  const periods = staffRec?.hasShifts ? ["AM", "PM"] : ["FULL_DAY"];
                  periods.forEach((period) => {
                    this._upsertStaffAttendanceRecord(d, { staffId: req.subjectId, date: cur, status: req.status, note: req.note, markedBy: decidedBy, leaveRequestId: req.id, period });
                  });
                }
              }
              cur = addDays(cur, 1);
            }
          }
          d.activities = [{ id: uid("act"), text: `A leave request was ${approvalStatus.toLowerCase()}.`, createdAt: Date.now() }, ...d.activities];

          const decider = d.users.find((u) => u.id === decidedBy);
          const { title, message } = leaveDecidedNotification(d, req, decider);
          d.notifications = [{ id: uid("notif"), userId: req.requestedBy, title, message, read: false, createdAt: Date.now(), type: "LEAVE", navigation: { page: "leaveRequests", studentId: req.kind === "STUDENT" ? req.subjectId : null } }, ...d.notifications];
          return d;
        });
      },

      // STUDENT requests: Owner or Educational Director. STAFF requests mirror
      // canEditStaffAttendanceFor exactly (an approval auto-writes staffAttendance records, so the
      // same remit applies): Owner always; Educational Director only for Teachers; Finance only for
      // Other Staff. Directors' own leave is Owner-only. See staffGroupLabel.
      canDecideLeaveRequest(request, user) {
        if (!request || !user) return false;
        if (user.role === ROLES.OWNER) return true;
        if (request.kind === "STUDENT") return user.role === ROLES.ADMIN;
        const subject = db.staff.find((s) => s.id === request.subjectId);
        const group = subject ? staffGroupLabel(subject.position) : null;
        if (user.role === ROLES.ADMIN) return group === "Teachers";
        if (user.role === ROLES.FINANCE) return group === "Other Staff";
        return false;
      },
      pendingDecidableLeaveCount(user) {
        return db.leaveRequests.filter((r) => r.approvalStatus === "PENDING" && this.canDecideLeaveRequest(r, user)).length;
      },

      // Once an approved leave's last day has passed, tell the requester it's over and let the
      // Owner/Educational Director know too — a `completionNotified` flag guarantees this fires
      // exactly once per request no matter how many times this runs (see the polling effect below).
      checkLeaveCompletions() {
        // Pre-check against the read-only `db` closure before touching `commit` — commit()
        // unconditionally bumps `updatedAt` and replaces `db`, which recreates this whole `api`
        // object, which re-arms the polling effect that calls this very method (DataContext's
        // `useEffect([ready, api])`). Calling commit() here with nothing to actually notify was
        // a real infinite render loop (visible as "Maximum update depth exceeded" every ~60s,
        // or immediately since this also runs once on mount) — this early return is the fix.
        const todayKey = todayKeyStr();
        if (!db.leaveRequests.some((r) => r.approvalStatus === "APPROVED" && !r.completionNotified && r.toDate < todayKey)) return;
        commit((d) => {
          const toNotify = d.leaveRequests.filter((r) => r.approvalStatus === "APPROVED" && !r.completionNotified && r.toDate < todayKey);
          if (toNotify.length === 0) return d;
          toNotify.forEach((req) => {
            req.completionNotified = true;
            const base = leaveTitleBase(req.status);
            const duration = leaveDurationLabel(req.fromDate, req.toDate);
            const returnDate = addDays(req.toDate, 1);
            const who = leaveSubjectLabel(d, req.kind, req.subjectId);
            const leaveStudentId = req.kind === "STUDENT" ? req.subjectId : null;
            d.notifications = [
              { id: uid("notif"), userId: req.requestedBy, title: `${base} completed`, message: `Your ${duration} ${base.toLowerCase()} has ended. You are expected to return on ${fmtDate(returnDate)}.`, read: false, createdAt: Date.now(), type: "LEAVE", navigation: { page: "leaveRequests", studentId: leaveStudentId } },
              ...d.notifications,
            ];
            const subjectStaff = req.kind === "STAFF" ? d.staff.find((s) => s.id === req.subjectId) : null;
            const isDirectorSubject = !!subjectStaff && staffGroupLabel(subjectStaff.position) === "Directors";
            const recipientRoles = isDirectorSubject ? [ROLES.OWNER] : [ROLES.OWNER, ROLES.ADMIN];
            d.users.filter((u) => recipientRoles.includes(u.role)).forEach((u) => {
              d.notifications = [
                { id: uid("notif"), userId: u.id, title: "Leave completed", message: `${who}'s approved ${base.toLowerCase()} ended on ${fmtDate(req.toDate)}.`, read: false, createdAt: Date.now(), type: "LEAVE", navigation: { page: "leaveRequests", studentId: leaveStudentId } },
                ...d.notifications,
              ];
            });
          });
          return d;
        });
      },

      // The Owner sits above everyone else, so their own leave has no approver and — since the
      // Owner deliberately has no `staff` row (see seed.js) — no staff-attendance record to flip.
      // This just logs it and lets the Educational Director know, for transparency.
      logOwnerLeave({ status, fromDate, toDate, note }, ownerUserId) {
        commit((d) => {
          const owner = d.users.find((u) => u.id === ownerUserId);
          const base = leaveTitleBase(status);
          const dateRange = fromDate === toDate ? fmtDate(fromDate) : `${fmtDate(fromDate)} – ${fmtDate(toDate)}`;
          d.ownerLeaveLog = d.ownerLeaveLog || [];
          d.ownerLeaveLog.unshift({ id: uid("ownleave"), status, fromDate, toDate, note: note || "", createdAt: Date.now() });
          d.activities = [{ id: uid("act"), text: `Owner ${owner?.name || ""} logged ${base.toLowerCase()} for ${dateRange}.`, createdAt: Date.now() }, ...d.activities];
          const title = `Owner ${base.toLowerCase()}`;
          const message = `${owner?.name || "The Owner"} will be on ${base.toLowerCase()} from ${dateRange}${note ? ` — ${note}` : ""}.`;
          d.users.filter((u) => u.role === ROLES.ADMIN).forEach((u) => {
            d.notifications = [{ id: uid("notif"), userId: u.id, title, message, read: false, createdAt: Date.now(), type: "LEAVE" }, ...d.notifications];
          });
          return d;
        });
      },

      /* ---------- Attendance permissions ---------- */
      canTakeClassAttendance(cls, user) {
        if (!cls || !user) return false;
        if (user.role === ROLES.OWNER) return true;
        if (user.role === ROLES.ADMIN) return true;
        if (user.role === ROLES.TEACHER) return cls.headTeacherId === user.id;
        return false;
      },
      canEditClassAttendance(cls, user) { return this.canTakeClassAttendance(cls, user); },
      // Unlike canTakeClassAttendance (head-teacher-only), period attendance is taken by that
      // period's own teacher — or that day's substitute, if one is assigned — since the whole
      // point is per-subject granularity. Reuses canTeacherPerformAcademicAction so a teacher
      // marked Absent/Sick/Permission is blocked here too, same as every other academic action.
      // The Educational Director gets one narrow exception: when the period's teacher is absent
      // and no substitute has been assigned yet, the class is otherwise uncovered, so the ED can
      // step in and take attendance directly instead of the period going unmarked all day.
      canTakePeriodAttendance(entry, date, user) {
        if (!entry || !user) return false;
        if (user.role === ROLES.OWNER) return true;
        if (user.role === ROLES.ADMIN) {
          const sub = db.substitutions.find((s) => s.timetableEntryId === entry.id && s.date === date);
          if (sub) return false;
          const teacherStaffRec = db.staff.find((s) => s.userId === entry.teacherId);
          const teacherAbsent = teacherStaffRec && db.staffAttendance.some((a) => a.staffId === teacherStaffRec.id && a.date === date && TEACHER_UNAVAILABLE_STATUSES.includes(a.status));
          return !!teacherAbsent;
        }
        if (user.role !== ROLES.TEACHER) return false;
        const sub = db.substitutions.find((s) => s.timetableEntryId === entry.id && s.date === date);
        const actingTeacherId = sub ? sub.substituteTeacherId : entry.teacherId;
        if (actingTeacherId !== user.id) return false;
        return this.canTeacherPerformAcademicAction(user, date);
      },
      canViewClassAttendance(cls, user) {
        if (!cls || !user) return false;
        if (user.role === ROLES.OWNER || user.role === ROLES.ADMIN) return true;
        if (user.role === ROLES.TEACHER) return cls.headTeacherId === user.id || this.teacherClassIds(user.id).includes(cls.id);
        return false;
      },
      // Per-record staff-attendance edit rights: the Owner has full authority across every group
      // (Directors, Teachers, Other Staff). The Educational Director's remit is Students +
      // Teachers — Teachers only, never Other Staff, never Directors. The Finance & Operations
      // Director's remit is Other Staff + payroll — Other Staff only, never Teachers, never
      // Directors. See staffGroupLabel.
      canEditStaffAttendanceFor(staffMember, user) {
        if (!staffMember || !user) return false;
        const group = staffGroupLabel(staffMember.position);
        if (user.role === ROLES.OWNER) return true;
        if (user.role === ROLES.ADMIN) return group === "Teachers";
        if (user.role === ROLES.FINANCE) return group === "Other Staff";
        return false;
      },
      // Which staff groups appear in the Staff Attendance list at all for this role — no view-only
      // oversight of groups outside a role's remit; if a role can't edit a group, that group simply
      // doesn't show up for them. Owner is the only role that sees everything, because Owner can
      // edit everything.
      staffAttendanceGroupsFor(user) {
        if (!user) return [];
        if (user.role === ROLES.OWNER) return ["Directors", "Teachers", "Other Staff"];
        if (user.role === ROLES.ADMIN) return ["Teachers"];
        if (user.role === ROLES.FINANCE) return ["Other Staff"];
        return [];
      },
      // Resolves the caller's own staffAttendance record for `dateKey` — used both to decide
      // whether a Teacher can act (canTeacherPerformAcademicAction) and to render *why* not.
      myAcademicActionStatusFor(user, dateKey) {
        if (!user || user.role !== ROLES.TEACHER) return null;
        const myStaffRec = db.staff.find((s) => s.userId === user.id);
        if (!myStaffRec) return null;
        return db.staffAttendance.find((a) => a.staffId === myStaffRec.id && a.date === dateKey) || null;
      },
      // A Teacher marked Absent/Sick/Permission for `dateKey` can't perform teacher-only academic
      // actions (taking student attendance, homework, results) for that date — see
      // canTeacherPerformAcademicAction in staffPermissions.js for the underlying rule.
      canTeacherPerformAcademicAction(user, dateKey) {
        return canTeacherAct(user, this.myAcademicActionStatusFor(user, dateKey));
      },

      /* ---------- School closures ---------- */
      // A closure overrides the timetable/attendance for that one date — see classifyAttendanceDay
      // and classifyStaffAttendanceDay, which both consult this list before anything else.
      createSchoolClosure({ date, reason }, createdBy) {
        let result = { ok: true, message: "" };
        commit((d) => {
          if (d.schoolClosures.some((c) => c.date === date)) {
            result = { ok: false, message: "This date already has a closure recorded. Remove it first to change the reason." };
            return d;
          }
          d.schoolClosures.push({ id: uid("closure"), date, reason: reason.trim(), createdBy, createdAt: Date.now() });
          d.schoolClosures.sort((a, b) => a.date.localeCompare(b.date));
          d.activities = [{ id: uid("act"), text: `${fmtDate(date)} was marked as a school closure (${reason}).`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      deleteSchoolClosure(id) {
        commit((d) => {
          d.schoolClosures = d.schoolClosures.filter((c) => c.id !== id);
          return d;
        });
      },

      // Only changes which dates are considered available for attendance — never touches any
      // attendance record already saved, no matter how the semester/break dates move.
      saveAcademicCalendar(fields, updatedBy) {
        commit((d) => {
          d.academicCalendar = { ...d.academicCalendar, ...fields, updatedAt: Date.now(), updatedBy };
          const idx = d.academicYears.findIndex((y) => y.id === d.academicCalendar.id);
          if (idx >= 0) d.academicYears[idx] = d.academicCalendar; else d.academicYears.push(d.academicCalendar);
          d.activities = [{ id: uid("act"), text: `The academic calendar was updated (${d.academicCalendar.yearName}).`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      createTimetableEntry({ classId, day, period, subject }) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const cls = d.classes.find((c) => c.id === classId);
          if (!cls) { result = { ok: false, message: "Class not found." }; return d; }
          const assignment = d.teacherAssignments.find((ta) => ta.classId === classId && ta.subject === subject);
          if (!assignment) { result = { ok: false, message: `No teacher is assigned to teach ${subject} in this class yet. Assign one from the Teachers page first.` }; return d; }
          const clash = d.timetableEntries.some((e) => e.classId === classId && e.day === day && e.period === period);
          if (clash) { result = { ok: false, message: `${cls.grade}${cls.section} already has a period ${period} on ${day}.` }; return d; }
          const doubleBooked = d.timetableEntries.find((e) => e.teacherId === assignment.teacherId && e.day === day && e.period === period && e.classId !== classId);
          if (doubleBooked) {
            const otherCls = d.classes.find((c) => c.id === doubleBooked.classId);
            const teacher = d.users.find((u) => u.id === assignment.teacherId);
            result = { ok: false, message: `${teacher?.name || "This teacher"} is already teaching ${doubleBooked.subject} in ${otherCls ? otherCls.grade + otherCls.section : "another class"} at this day/period.` };
            return d;
          }
          d.timetableEntries.push({ id: uid("tt"), classId, day, period, subject, teacherId: assignment.teacherId });
          d.activities = [{ id: uid("act"), text: `${subject} was added to ${cls.grade}${cls.section}'s timetable on ${day}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      deleteTimetableEntry(id) {
        commit((d) => {
          d.timetableEntries = d.timetableEntries.filter((e) => e.id !== id);
          d.periodLogs = d.periodLogs.filter((l) => l.timetableEntryId !== id);
          return d;
        });
      },
      markPeriodDone(timetableEntryId, date, completedBy) {
        commit((d) => {
          const existing = d.periodLogs.find((l) => l.timetableEntryId === timetableEntryId && l.date === date);
          if (existing) { existing.status = "done"; existing.completedBy = completedBy; existing.completedAt = Date.now(); }
          else d.periodLogs.push({ id: uid("plog"), timetableEntryId, date, status: "done", completedBy, completedAt: Date.now() });
          return d;
        });
      },
      // Per-period, per-student attendance — distinct from the class-level daily db.attendance.
      // Saving also marks the period done (status: "done"): a period with attendance recorded is
      // definitionally a period that happened, so the two never drift apart.
      savePeriodAttendance(timetableEntryId, date, records, markedBy) {
        commit((d) => {
          const existing = d.periodLogs.find((l) => l.timetableEntryId === timetableEntryId && l.date === date);
          const payload = { status: "done", completedBy: markedBy, completedAt: Date.now(), attendance: records, attendanceMarkedBy: markedBy, attendanceMarkedAt: Date.now() };
          if (existing) Object.assign(existing, payload);
          else d.periodLogs.push({ id: uid("plog"), timetableEntryId, date, ...payload });
          return d;
        });
      },

      // Resolves who actually covers a period/date: a formally assigned substitute
      // (db.substitutions), or — when the Educational Director/Owner steps in directly for an
      // absent teacher without going through Assign Substitute (see canTakePeriodAttendance's ED
      // exception) — the user who ended up marking the period's attendance (periodLogs.completedBy).
      // Every "who's covering this period" display should read from here rather than
      // re-deriving sub/teacherAbsent locally, so the two coverage paths never fall out of sync.
      getPeriodCoverage(entry, date) {
        if (!entry) return { sub: null, substituteUser: null, directCovererUser: null, teacherAbsent: null, log: null };
        const sub = db.substitutions.find((s) => s.timetableEntryId === entry.id && s.date === date) || null;
        const log = db.periodLogs.find((l) => l.timetableEntryId === entry.id && l.date === date) || null;
        const teacherStaffRec = db.staff.find((s) => s.userId === entry.teacherId);
        const teacherAbsent = (teacherStaffRec && db.staffAttendance.find((a) => a.staffId === teacherStaffRec.id && a.date === date && TEACHER_UNAVAILABLE_STATUSES.includes(a.status))) || null;
        const substituteUser = sub ? getUser(sub.substituteTeacherId) : null;
        // Only Owner/ED direct-cover counts here — a Teacher can only ever record this period's
        // attendance as its own teacher or a formally assigned substitute (canTakePeriodAttendance),
        // so a Teacher showing up as completedBy with no current `sub` is a stale leftover from a
        // substitute assignment that was later removed, not a real direct-cover exception.
        const completer = !sub && log?.completedBy && log.completedBy !== entry.teacherId ? getUser(log.completedBy) : null;
        const directCovererUser = completer && (completer.role === ROLES.OWNER || completer.role === ROLES.ADMIN) ? completer : null;
        return { sub, substituteUser, directCovererUser, teacherAbsent, log };
      },

      // School-wide rollup of today's periods across every class — what the per-class Today's
      // Journal card on the Timetable page shows one class at a time, totalled up for the
      // Owner/Educational Director dashboards. Categorization mirrors that card's own branching
      // (covered > teacher absent > done > pending) so the two views never disagree. "substituted"
      // counts both a formally assigned substitute and the ED/Owner covering a period directly.
      todaysJournalSummary() {
        const dateKey = todayKeyStr();
        const dayInfo = classifyAttendanceDay(dateKey);
        const todayName = todayDayName();
        if (!dayInfo.available || !todayName) return { available: false, label: dayInfo.label, scheduled: 0, completed: 0, pending: 0, teacherAbsent: 0, substituted: 0 };
        const entries = db.timetableEntries.filter((e) => e.day === todayName);
        let completed = 0, pending = 0, teacherAbsent = 0, substituted = 0;
        entries.forEach((e) => {
          const coverage = this.getPeriodCoverage(e, dateKey);
          if (coverage.sub || coverage.directCovererUser) substituted++;
          else if (coverage.teacherAbsent) teacherAbsent++;
          else if (coverage.log?.status === "done") completed++;
          else pending++;
        });
        return { available: true, label: dayInfo.label, scheduled: entries.length, completed, pending, teacherAbsent, substituted };
      },

      // Teachers eligible to cover `entry` on `date`: active teachers, excluding the entry's own
      // teacher, anyone marked Absent/Sick/Permission that day (TEACHER_UNAVAILABLE_STATUSES —
      // they can't cover a class if they can't perform academic actions themselves), and anyone
      // already teaching or substituting a different class at that exact day+period (double-booking).
      substituteCandidates(entry, date) {
        if (!entry) return [];
        const dow = new Date(date + "T00:00:00").getDay();
        const dayName = SCHOOL_DAYS[dow - 1] || entry.day;
        const busyTeacherIds = new Set();
        db.timetableEntries.filter((e) => e.id !== entry.id && e.day === dayName && e.period === entry.period).forEach((e) => {
          const sub = db.substitutions.find((s) => s.timetableEntryId === e.id && s.date === date);
          busyTeacherIds.add(sub ? sub.substituteTeacherId : e.teacherId);
        });
        return db.users.filter((u) => {
          if (u.role !== ROLES.TEACHER || u.status !== "ACTIVE" || u.id === entry.teacherId) return false;
          if (busyTeacherIds.has(u.id)) return false;
          const staffRec = db.staff.find((s) => s.userId === u.id);
          const unavailable = staffRec && db.staffAttendance.some((a) => a.staffId === staffRec.id && a.date === date && TEACHER_UNAVAILABLE_STATUSES.includes(a.status));
          return !unavailable;
        });
      },

      assignSubstitute(timetableEntryId, date, substituteTeacherId, assignedBy) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const entry = d.timetableEntries.find((e) => e.id === timetableEntryId);
          if (!entry) { result = { ok: false, message: "Period not found." }; return d; }
          const cls = d.classes.find((c) => c.id === entry.classId);
          const originalTeacher = d.users.find((u) => u.id === entry.teacherId);
          const substitute = d.users.find((u) => u.id === substituteTeacherId);
          if (!substitute) { result = { ok: false, message: "Substitute teacher not found." }; return d; }
          if (!this.substituteCandidates(entry, date).some((t) => t.id === substituteTeacherId)) {
            result = { ok: false, message: `${substitute.name} isn't available to cover this period — they're unavailable or already teaching another class at this time.` };
            return d;
          }

          const existing = d.substitutions.find((s) => s.timetableEntryId === timetableEntryId && s.date === date);
          const previousSubstituteId = existing && existing.substituteTeacherId !== substituteTeacherId ? existing.substituteTeacherId : null;
          if (existing) { existing.substituteTeacherId = substituteTeacherId; existing.assignedBy = assignedBy; existing.createdAt = Date.now(); }
          else d.substitutions.push({ id: uid("sub"), timetableEntryId, date, originalTeacherId: entry.teacherId, substituteTeacherId, assignedBy, createdAt: Date.now() });

          // Changing an already-assigned substitute to someone else — let the teacher who's no
          // longer covering know so they don't show up expecting to teach this period.
          if (previousSubstituteId) {
            d.notifications = [{ id: uid("notif"), userId: previousSubstituteId, title: "Substitute coverage changed", message: `You're no longer covering ${entry.subject} for ${cls ? cls.grade + cls.section : ""}, period ${entry.period} today — ${substitute.name} will cover it instead.`, read: false, createdAt: Date.now(), type: "SCHEDULE", navigation: { page: "timetable" } }, ...d.notifications];
          }

          const studentIds = d.students.filter((s) => s.classId === entry.classId).map((s) => s.id);
          const parentIds = new Set();
          d.users.filter((u) => u.role === ROLES.PARENT).forEach((p) => { if ((p.childIds || []).some((cid) => studentIds.includes(cid))) parentIds.add(p.id); });
          parentIds.forEach((pid) => {
            d.notifications = [{ id: uid("notif"), userId: pid, title: "Class schedule changed", message: `Today's ${entry.subject} class for ${cls ? cls.grade + cls.section : ""} will be covered by ${substitute.name} — ${originalTeacher?.name || "the usual teacher"} is away today.`, read: false, createdAt: Date.now(), type: "SCHEDULE", navigation: { page: "timetable" } }, ...d.notifications];
          });
          const entrySlot = computePeriodSchedule(d.timetableConfig).periods.find((p) => p.period === entry.period);
          d.notifications = [{ id: uid("notif"), userId: substituteTeacherId, title: "You're covering a class today", message: `Please cover ${entry.subject} for ${cls ? cls.grade + cls.section : ""}, period ${entry.period}${entrySlot ? ` (${entrySlot.startLabel}–${entrySlot.endLabel})` : ""}.`, read: false, createdAt: Date.now(), type: "SCHEDULE", navigation: { page: "timetable" } }, ...d.notifications];

          d.activities = [{ id: uid("act"), text: `${substitute.name} will substitute for ${originalTeacher?.name || "a teacher"} in ${cls ? cls.grade + cls.section : ""} ${entry.subject} today.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      removeSubstitute(timetableEntryId, date) {
        commit((d) => {
          const sub = d.substitutions.find((s) => s.timetableEntryId === timetableEntryId && s.date === date);
          if (!sub) return d;
          d.substitutions = d.substitutions.filter((s) => s.id !== sub.id);
          const entry = d.timetableEntries.find((e) => e.id === timetableEntryId);
          const cls = entry ? d.classes.find((c) => c.id === entry.classId) : null;
          d.notifications = [{ id: uid("notif"), userId: sub.substituteTeacherId, title: "Substitute coverage cancelled", message: `You're no longer needed to cover ${entry?.subject || "that period"} for ${cls ? cls.grade + cls.section : ""} today.`, read: false, createdAt: Date.now(), type: "SCHEDULE", navigation: { page: "timetable" } }, ...d.notifications];
          return d;
        });
      },

      // Affected entries a shrink would orphan — surfaced by the UI ahead of Save, and
      // re-checked authoritatively inside updateTimetableConfig itself.
      entriesBeyondPeriodCount(periodsCount) {
        return db.timetableEntries.filter((e) => e.period > periodsCount).map((e) => {
          const cls = db.classes.find((c) => c.id === e.classId);
          return { ...e, classLabel: cls ? `${cls.grade}${cls.section}` : "Unknown class" };
        });
      },

      updateTimetableConfig(patch, actorId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const candidate = { ...d.timetableConfig, ...patch };
          const periodsCount = Number(candidate.periodsCount);
          const periodDurationMins = Number(candidate.periodDurationMins);
          const breakDurationMins = Number(candidate.breakDurationMins);
          if (!Number.isFinite(periodsCount) || periodsCount < MIN_PERIODS || periodsCount > MAX_PERIODS) {
            result = { ok: false, message: `Number of periods must be between ${MIN_PERIODS} and ${MAX_PERIODS}.` };
            return d;
          }
          if (!/^\d{2}:\d{2}$/.test(candidate.startTime || "")) {
            result = { ok: false, message: "Start time is invalid." };
            return d;
          }
          if (!Number.isFinite(periodDurationMins) || periodDurationMins < 1) {
            result = { ok: false, message: "Period duration must be at least 1 minute." };
            return d;
          }
          if (!Number.isFinite(breakDurationMins) || breakDurationMins < 0) {
            result = { ok: false, message: "Break duration cannot be negative." };
            return d;
          }

          const orphaned = d.timetableEntries.filter((e) => e.period > periodsCount);
          if (orphaned.length > 0) {
            const examples = orphaned.slice(0, 5).map((e) => {
              const cls = d.classes.find((c) => c.id === e.classId);
              return `${cls ? cls.grade + cls.section : "Unknown"} (${e.day}, P${e.period})`;
            });
            const more = orphaned.length > 5 ? `, and ${orphaned.length - 5} more` : "";
            result = { ok: false, message: `Reducing to ${periodsCount} period${periodsCount === 1 ? "" : "s"} would remove periods still scheduled: ${examples.join(", ")}${more}. Remove those periods from each class's grid first, then lower the period count.` };
            return d;
          }

          let breakAfterPeriod = candidate.breakAfterPeriod;
          if (breakAfterPeriod != null) {
            breakAfterPeriod = Math.min(Number(breakAfterPeriod), periodsCount);
            if (breakAfterPeriod < 1) breakAfterPeriod = null;
          }

          d.timetableConfig = {
            periodsCount, startTime: candidate.startTime, periodDurationMins, breakDurationMins, breakAfterPeriod,
            updatedAt: Date.now(), updatedBy: actorId || null,
          };
          d.activities = [{ id: uid("act"), text: `Timetable settings were updated (${periodsCount} periods, starting ${to12Hour(candidate.startTime)}).`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // ---- Fee catalog (feeTypes) — never carries pricing or per-year state. name/category/
      // description/default* only; default* fields are template-only, prefill a new schedule at
      // rollout time, and are never read by any balance calculation.
      createFeeType(data) {
        commit((d) => {
          d.feeTypes.push({
            id: uid("fee"), name: data.name, category: data.category, description: data.description || "",
            defaultUnitAmount: Number(data.defaultUnitAmount) || 0, defaultUnitMonths: Number(data.defaultUnitMonths) || 1, defaultUnitsPerYear: Number(data.defaultUnitsPerYear) || 1,
            archivedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
          });
          d.activities = [{ id: uid("act"), text: `${data.name} was added as a new fee type.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      updateFeeType(id, patch) {
        commit((d) => {
          const ft = d.feeTypes.find((f) => f.id === id);
          if (ft) {
            if (patch.name !== undefined) ft.name = patch.name;
            if (patch.category !== undefined) ft.category = patch.category;
            if (patch.description !== undefined) ft.description = patch.description;
            if (patch.defaultUnitAmount !== undefined) ft.defaultUnitAmount = Number(patch.defaultUnitAmount);
            if (patch.defaultUnitMonths !== undefined) ft.defaultUnitMonths = Number(patch.defaultUnitMonths);
            if (patch.defaultUnitsPerYear !== undefined) ft.defaultUnitsPerYear = Number(patch.defaultUnitsPerYear);
            ft.updatedAt = Date.now();
          }
          d.activities = [{ id: uid("act"), text: `${ft?.name || "A fee type"} was updated.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      // ---- Year rollout: creates/refreshes ONE year's schedule + installments for a fee type,
      // then materializes obligations for every currently-applicable active student (Decision A:
      // only installments due on/after "today" for an already-enrolled continuing student).
      // Idempotent on the schedule itself (UNIQUE feeTypeId+academicYearId) and on each obligation
      // (UNIQUE studentId+feeInstallmentId) — re-running this never creates duplicates or doubles
      // a balance.
      rolloutFeeTypeForYear(feeTypeId, academicYearId, { unitAmount, unitMonths, unitsPerYear, installments }, actorId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const ft = d.feeTypes.find((f) => f.id === feeTypeId);
          if (!ft || ft.archivedAt) { result = { ok: false, message: "Fee type not found or archived." }; return d; }
          let schedule = scheduleForFeeType(d, feeTypeId, academicYearId);
          if (schedule) {
            result = { ok: true, message: `${ft.name} was already rolled out for this year — installments were not regenerated. Edit an individual installment below, or add an adjustment for an already-obligated student.` };
          } else {
            schedule = { id: uid("fsch"), feeTypeId, academicYearId, unitAmount: Number(unitAmount), unitMonths: Number(unitMonths), unitsPerYear: Number(unitsPerYear), createdAt: Date.now(), updatedAt: Date.now(), createdBy: actorId };
            d.feeSchedules.push(schedule);
            const year = d.academicYears.find((y) => y.id === academicYearId);
            const yearStart = year ? new Date(year.yearStart + "T00:00:00") : activeYearStartDate(d.academicYears);
            const rows = ft.category === "TUITION" && Array.isArray(installments) && installments.length > 0
              ? installments.map((inst, i) => ({ id: uid("finst"), feeScheduleId: schedule.id, sequenceIndex: i, label: inst.label, dueDate: inst.dueDate, amount: schedule.unitAmount, createdAt: Date.now(), updatedAt: Date.now() }))
              : Array.from({ length: schedule.unitsPerYear || 1 }, (_, i) => {
                  const d0 = new Date(yearStart.getFullYear(), yearStart.getMonth() + Math.round(i * (schedule.unitMonths || 1)), 1);
                  const label = ft.category === "TRANSPORT" ? d0.toLocaleString("en-US", { month: "long", year: "numeric" }) : `Cycle ${i + 1}`;
                  const dueDate = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-01`;
                  return { id: uid("finst"), feeScheduleId: schedule.id, sequenceIndex: i, label, dueDate, amount: schedule.unitAmount, createdAt: Date.now(), updatedAt: Date.now() };
                });
            rows.forEach((r) => d.feeInstallments.push(r));
          }
          const scheduleInstallments = installmentsForSchedule(d, schedule.id);
          d.students.filter((s) => !["WITHDRAWN", "TRANSFERRED", "GRADUATED", "ARCHIVED"].includes(s.status)).forEach((s) => {
            if (ft.category === "TRANSPORT" && !s.usesBus) return;
            const anchor = todayKeyStr(); // Decision A: "today" for an already-enrolled continuing student at rollout
            scheduleInstallments.filter((fi) => fi.dueDate >= anchor).forEach((fi) => this._materializeObligation(d, s.id, fi, "YEAR_ROLLOUT"));
          });
          d.activities = [{ id: uid("act"), text: `${ft.name} was rolled out for ${formatAcademicYearLabel(d.academicYears.find((y) => y.id === academicYearId))}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      // A single installment's amount/dueDate/label stays editable only until the first obligation
      // references it — after that, corrections go through addObligationAdjustment instead, so an
      // already-billed student's frozen amountDue is never silently changed out from under them.
      editInstallment(installmentId, patch) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const fi = d.feeInstallments.find((f) => f.id === installmentId);
          if (!fi) { result = { ok: false, message: "Installment not found." }; return d; }
          const hasObligations = d.studentFeeObligations.some((o) => o.feeInstallmentId === installmentId);
          if (hasObligations) { result = { ok: false, message: "This installment already has student obligations against it — use an adjustment to correct an individual student's balance instead." }; return d; }
          if (patch.label !== undefined) fi.label = patch.label;
          if (patch.dueDate !== undefined) fi.dueDate = patch.dueDate;
          if (patch.amount !== undefined) fi.amount = Number(patch.amount);
          fi.updatedAt = Date.now();
          return d;
        });
        return result;
      },
      // WAIVER/DISCOUNT/SCHOLARSHIP/CANCELLATION/CORRECTION against one obligation — append-only,
      // never edited. Guard: the running adjustment total can never drive net-owed below what's
      // already been allocated (can't waive away money already collected).
      addObligationAdjustment(obligationId, { type, amount, reason }, actorId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const obligation = d.studentFeeObligations.find((o) => o.id === obligationId);
          if (!obligation) { result = { ok: false, message: "Obligation not found." }; return d; }
          const already = adjustmentsTotal(d, obligation.id);
          const allocated = allocationsTotal(d, obligation.id);
          const projectedNet = obligation.amountDue - (already + Number(amount)) - allocated;
          if (projectedNet < 0 && type !== "CORRECTION") { result = { ok: false, message: "This would waive more than is still owed." }; return d; }
          if (!reason || !reason.trim()) { result = { ok: false, message: "A reason is required." }; return d; }
          d.feeObligationAdjustments.push({ id: uid("adj"), obligationId, type, amount: Number(amount), reason: reason.trim(), createdBy: actorId, createdAt: Date.now() });
          return d;
        });
        return result;
      },
      // Archive-or-delete guard, replacing the old hasPayments check: a fee type with any rolled-
      // out schedule can never be hard-deleted (that history must stay intact), so it's archived
      // instead — it stops appearing as a choice for a NEW year's rollout but every past year's
      // figures are untouched.
      deleteFeeType(id) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const ft = d.feeTypes.find((f) => f.id === id);
          if (!ft) { result = { ok: false, message: "Fee type not found." }; return d; }
          const hasSchedules = d.feeSchedules.some((s) => s.feeTypeId === id);
          if (hasSchedules) {
            ft.archivedAt = Date.now();
            result = { ok: true, archived: true, message: `${ft.name} has fee schedules and can't be deleted — it was archived instead, to keep financial history intact.` };
          } else {
            d.feeTypes = d.feeTypes.filter((f) => f.id !== id);
            result = { ok: true, archived: false, message: `${ft.name} was removed from the fee list.` };
          }
          d.activities = [{ id: uid("act"), text: `${ft.name} was ${hasSchedules ? "archived" : "removed"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      addPaymentMethod(name) {
        commit((d) => {
          const trimmed = (name || "").trim();
          if (trimmed && !d.paymentMethods.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) d.paymentMethods.push({ id: uid("pm"), name: trimmed, active: true });
          return d;
        });
      },

      recordPayment(payload, recordedBy) {
        return recordPaymentBatch([payload], recordedBy);
      },

      // Blocker 4 (payment void policy): payments are immutable financial records — this never
      // edits or removes a payment row, it only marks it VOIDED with a required reason and an
      // audit trail. The reason is validated here, inside the mutator, not just by the calling UI,
      // so a void can never be recorded without one regardless of entry point. Every balance/
      // coverage calculation reads `status !== "VOIDED"`-gated obligations/allocations live, so
      // voiding takes effect immediately with no second ledger to keep in sync. A payment already
      // VOIDED can't be voided again.
      //
      // Blocker 2 note: void is now whole-receipt, not per-line — a `payments` row has one
      // `status`, and `paymentAllocations` carries no per-line void field (a direct, structural
      // consequence of the locked schema, not a new decision). If Finance needs to correct just
      // one wrong line in a multi-student receipt, the workflow is: void the whole receipt, then
      // re-enter the correct lines as a new one.
      voidPayment(paymentId, reason, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const trimmedReason = (reason || "").trim();
          if (!trimmedReason) { result = { ok: false, message: "A reason is required to void a payment." }; return d; }
          const payment = d.payments.find((p) => p.id === paymentId);
          if (!payment) { result = { ok: false, message: "Payment not found." }; return d; }
          if (payment.status === "VOIDED") { result = { ok: false, message: "This payment has already been voided." }; return d; }

          payment.status = "VOIDED";
          payment.voidedAt = Date.now();
          payment.voidedBy = actorId;
          payment.voidReason = trimmedReason;

          const allocs = d.paymentAllocations.filter((a) => a.paymentId === paymentId);
          const studentIds = [...new Set(allocs.map((a) => {
            const ob = d.studentFeeObligations.find((o) => o.id === a.obligationId);
            return ob ? ob.studentId : null;
          }).filter(Boolean))];
          const studentNames = studentIds.map((sid) => { const s = d.students.find((x) => x.id === sid); return s ? studentFullName(s) : null; }).filter(Boolean);

          const actor = d.users.find((u) => u.id === actorId);
          d.paymentAuditLog = [{
            id: uid("aud"), entityType: "payment", entityId: payment.id, studentIds,
            action: "VOIDED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            amount: payment.amountTotal, receiptNo: payment.receiptNo, reason: trimmedReason, at: Date.now(),
          }, ...(d.paymentAuditLog || [])].slice(0, 500);

          d.activities = [{
            id: uid("act"), text: `${formatMoney(payment.amountTotal)} payment for ${joinWithAnd(studentNames) || "a student"} (receipt #${payment.receiptNo || "—"}) was voided by ${actor?.name || "an admin"}.`,
            createdAt: Date.now(), navigation: { page: "payments", studentId: studentIds[0] || null, paymentId: payment.id, receiptNo: payment.receiptNo },
          }, ...d.activities];
          return d;
        });
        return result;
      },

      sendPaymentReminder({ parentIds, message, image, feeTypeName }, sentBy) {
        commit((d) => {
          const title = feeTypeName ? `Payment reminder — ${feeTypeName}` : "Payment reminder";
          parentIds.forEach((pid) => {
            d.notifications = [{ id: uid("notif"), userId: pid, title, message, image: image || null, read: false, createdAt: Date.now(), type: "PAYMENT", navigation: { page: "payments" } }, ...d.notifications];
          });
          d.activities = [{ id: uid("act"), text: `A payment reminder was sent to ${parentIds.length} parent${parentIds.length === 1 ? "" : "s"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      // `academicYearId` defaults to the current year — see findOrCreateResultRecord for why it
      // must be part of the lookup key (classId is a persistent identity, not per-year).
      getResult(studentId, classId, subject, semester, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        return db.results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && (!r.academicYearId || r.academicYearId === yearId)) || null;
      },
      resultsForClassSubject(classId, subject, semester, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        return db.results.filter((r) => r.classId === classId && r.subject === subject && (!semester || r.semester === semester) && (!r.academicYearId || r.academicYearId === yearId));
      },
      // One student's results (optionally narrowed to one semester), scoped to one academic year
      // (defaults to current) — used by the Parent Dashboard/Results pages so a repeating child's
      // prior-year PUBLISHED results never mix into the current year's list. Pass `semester: null`
      // for every semester.
      resultsForStudentSemester(studentId, semester, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        return db.results.filter((r) => r.studentId === studentId && (!semester || r.semester === semester) && (!r.academicYearId || r.academicYearId === yearId));
      },
      // Every evidence page for one result's assessment component, in display order — the single
      // source of truth for the gradebook editor's thumbnail strip, the parent viewer, and the
      // read-only student-profile exams tab, so all three always agree on what's attached.
      resultEvidenceFor(resultId, component) {
        return (db.resultEvidence || []).filter((e) => e.resultId === resultId && e.component === component).sort((a, b) => a.order - b.order);
      },
      // Which semester phase (before/active/grace/locked) a result's own academic year is
      // currently in, per the academic calendar — used by the gradebook to render the "🔒 Semester
      // X is locked..." banner and by effectiveResultLock for the actual edit gate.
      semesterResultLockInfo(semester, academicYearId) {
        return classifySemesterResultLock(semester, resolveResultCal(db, academicYearId), todayKeyStr());
      },
      // The one answer the gradebook UI needs per row: is THIS result editable right now, combining
      // the manual publishStatus lock, the calendar auto-lock, and any active override. See
      // utils/permissions.js effectiveResultLock for the combination rules.
      resultLockFor(record, semester, academicYearId) {
        return effectiveResultLock(record, semester, resolveResultCal(db, academicYearId), todayKeyStr());
      },

      // Upserts one assessment component's score/share-flag for a student+class+subject+semester
      // result (evidence photos are a separate concern — see addResultEvidencePage/
      // removeResultEvidencePage/reorderResultEvidencePages below). Every change is diffed and
      // appended to resultAuditLog (the old value never silently disappears) plus a summarized
      // line in the shared activities feed. Parents are NOT notified per-save — see publishResults
      // for the batched notification instead. `actorId`/`actorRole` must be the caller's *real*
      // identity (auth.realUser), never an Owner's impersonated identity, so audit entries and
      // masking stay accurate.
      //
      // Gated by effectiveResultLock (manual LOCKED status, OR the semester's calendar-derived
      // auto-lock unless overridden) BEFORE the record is created, so a not-yet-existing result
      // can't be created once its semester is auto-locked either.
      saveResultComponent({ studentId, classId, subject, semester, component, score, sharedWithParents, reason }, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          if (!SEMESTERS.includes(semester) || !ASSESSMENT_COMPONENTS.includes(component)) {
            result = { ok: false, message: "Invalid semester or assessment component." };
            return d;
          }
          const student = d.students.find((s) => s.id === studentId);
          if (!student) { result = { ok: false, message: "Student not found." }; return d; }

          const academicYearId = (currentAcademicYear(d.academicYears) || {}).id || null;
          let record = d.results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && r.academicYearId === academicYearId);
          const cal = resolveResultCal(d, academicYearId);
          const lock = effectiveResultLock(record, semester, cal, todayKeyStr());
          if (lock.locked) { result = { ok: false, message: lock.message }; return d; }

          if (!record) record = findOrCreateResultRecord(d, { studentId, classId, subject, semester });

          const max = ASSESSMENT_COMPONENT_WEIGHT[component];
          const prev = record.components[component];
          // `score === undefined` means the caller isn't touching the score — leave it as-is;
          // `score === null` explicitly clears it.
          const nextScore = score === undefined ? prev.score : score === null ? null : Math.max(0, Math.min(max, Number(score)));

          const diff = [];
          if (prev.score !== nextScore) diff.push({ field: "score", from: prev.score, to: nextScore });
          if (sharedWithParents !== undefined && prev.sharedWithParents !== sharedWithParents) diff.push({ field: "sharedWithParents", from: prev.sharedWithParents, to: sharedWithParents });
          if (diff.length === 0) return d; // nothing actually changed — no phantom audit entry

          record.components[component] = {
            ...prev, score: nextScore, max,
            sharedWithParents: sharedWithParents !== undefined ? sharedWithParents : prev.sharedWithParents,
            updatedAt: Date.now(), updatedBy: actorId,
          };
          record.updatedAt = Date.now();

          const actor = d.users.find((u) => u.id === actorId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: record.id, studentId, classId, subject, semester, component,
            action: "COMPONENT_UPDATED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff, reason: reason || null, at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);

          d.activities = [{ id: uid("act"), text: `${ASSESSMENT_COMPONENT_LABEL[component]} recorded for ${studentFullName(student)} in ${subject} (${semester}).`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Bulk-publishes every editable result for the given class+subject+semester+students,
      // sending ONE batched notification per parent — not one per score, per component, or per
      // student save. This is the actual fix for "don't spam parents per mark".
      publishResults(classId, subject, semester, studentIds, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const actor = d.users.find((u) => u.id === actorId);
          const academicYearId = (currentAcademicYear(d.academicYears) || {}).id || null;
          const affected = [];
          studentIds.forEach((studentId) => {
            const record = d.results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && r.academicYearId === academicYearId);
            // Only a DRAFT record is actually publishable — re-selecting an already-PUBLISHED (but
            // unlocked) student and clicking Publish again used to re-run this and send parents a
            // second "Results published" notification for no real change. Skipping non-DRAFT here
            // makes repeat-publish a safe no-op (same pattern as the pre-existing LOCKED skip).
            if (!record || record.publishStatus !== "DRAFT") return;
            record.publishStatus = "PUBLISHED"; record.publishedAt = Date.now(); record.publishedBy = actorId;
            affected.push(record);
            const student = d.students.find((s) => s.id === studentId);
            d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(studentId)).forEach((p) => {
              d.notifications = [{ id: uid("notif"), userId: p.id, title: `Results published — ${subject}`, message: `${student ? student.firstName : "Your child"}'s ${subject} results for ${semester} are ready to view.`, read: false, createdAt: Date.now(), type: "RESULT", navigation: { page: "exams", studentId, semester } }, ...d.notifications];
            });
          });
          if (affected.length === 0) { result = { ok: false, message: "Nothing to publish." }; return d; }
          d.resultAuditLog = [
            ...affected.map((r) => ({
              id: uid("aud"), entityType: "result", entityId: r.id, studentId: r.studentId, classId, subject, semester, component: null,
              action: "PUBLISHED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
              diff: [{ field: "publishStatus", from: "DRAFT", to: "PUBLISHED" }], reason: null, at: Date.now(),
            })),
            ...(d.resultAuditLog || []),
          ].slice(0, 500);
          d.activities = [{ id: uid("act"), text: `${subject} ${semester} results published for ${affected.length} student${affected.length === 1 ? "" : "s"}.`, createdAt: Date.now(), navigation: { page: "exams", classId, subject, semester } }, ...d.activities];
          return d;
        });
        return result;
      },

      lockResult(recordId, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const record = d.results.find((r) => r.id === recordId);
          if (!record) { result = { ok: false, message: "Result not found." }; return d; }
          const actor = d.users.find((u) => u.id === actorId);
          const from = record.publishStatus;
          record.publishStatus = "LOCKED"; record.lockedAt = Date.now(); record.lockedBy = actorId;
          record.autoLockOverride = null; // a fresh manual lock always wins — clear any stale override
          const student = d.students.find((s) => s.id === record.studentId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: record.id, studentId: record.studentId, classId: record.classId, subject: record.subject, semester: record.semester, component: null,
            action: "LOCKED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff: [{ field: "publishStatus", from, to: "LOCKED" }], reason: null, at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);
          d.activities = [{ id: uid("act"), text: `${record.subject} ${record.semester} result locked for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Only valid for a MANUALLY locked result (publishStatus === "LOCKED") — see
      // overrideAutoLock for unlocking a result that's locked by the calendar instead. A reason is
      // required (checked here too, not just by the UI's textarea) since every unlock is audited.
      unlockResult(recordId, actorId, actorRole, reason) {
        let result = { ok: true, message: "" };
        commit((d) => {
          if (!reason || !reason.trim()) { result = { ok: false, message: "A reason is required to unlock a result." }; return d; }
          const record = d.results.find((r) => r.id === recordId);
          if (!record) { result = { ok: false, message: "Result not found." }; return d; }
          const actor = d.users.find((u) => u.id === actorId);
          const from = record.publishStatus;
          record.publishStatus = record.publishedAt ? "PUBLISHED" : "DRAFT";
          record.lockedAt = null; record.lockedBy = null;
          const student = d.students.find((s) => s.id === record.studentId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: record.id, studentId: record.studentId, classId: record.classId, subject: record.subject, semester: record.semester, component: null,
            action: "UNLOCKED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff: [{ field: "publishStatus", from, to: record.publishStatus }], reason: reason.trim(), at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);
          d.activities = [{ id: uid("act"), text: `${record.subject} ${record.semester} result unlocked for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Punches through a semester's calendar-derived auto-lock (see academicCalendar.js
      // classifySemesterResultLock) without touching publishStatus — only offered once that
      // semester has actually closed (grace_expired / next_semester_started / year_ended), never
      // for a semester that simply hasn't started. A reason is required and fully audited, exactly
      // like the manual unlockResult path. Stays in effect until reinstateAutoLock re-locks it.
      overrideAutoLock({ studentId, classId, subject, semester }, actorId, actorRole, reason) {
        let result = { ok: true, message: "" };
        commit((d) => {
          if (!reason || !reason.trim()) { result = { ok: false, message: "A reason is required to unlock a result." }; return d; }
          const academicYearId = (currentAcademicYear(d.academicYears) || {}).id || null;
          let record = d.results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && r.academicYearId === academicYearId);
          const cal = resolveResultCal(d, academicYearId);
          const lock = effectiveResultLock(record, semester, cal, todayKeyStr());
          const OVERRIDABLE_PHASES = ["grace_expired", "next_semester_started", "year_ended"];
          if (!(lock.locked && lock.source === "auto" && OVERRIDABLE_PHASES.includes(lock.phase))) {
            result = { ok: false, message: "This result isn't currently auto-locked." };
            return d;
          }
          if (!record) record = findOrCreateResultRecord(d, { studentId, classId, subject, semester });
          const actor = d.users.find((u) => u.id === actorId);
          record.autoLockOverride = { reason: reason.trim(), grantedBy: actorId, grantedByRole: actorRole || actor?.role, grantedAt: Date.now() };
          record.updatedAt = Date.now();
          const student = d.students.find((s) => s.id === studentId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: record.id, studentId, classId, subject, semester, component: null,
            action: "AUTO_LOCK_OVERRIDDEN", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff: [{ field: "autoLockOverride", from: null, to: true }], reason: reason.trim(), at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);
          d.activities = [{ id: uid("act"), text: `${subject} ${semester} result unlocked (auto-lock override) for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Re-establishes a semester's calendar-derived auto-lock on a result that had an active
      // overrideAutoLock — the "Re-lock" action once a correction made under the override is done.
      reinstateAutoLock(recordId, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const record = d.results.find((r) => r.id === recordId);
          if (!record) { result = { ok: false, message: "Result not found." }; return d; }
          if (!record.autoLockOverride) { result = { ok: false, message: "This result doesn't have an active unlock override." }; return d; }
          record.autoLockOverride = null;
          record.updatedAt = Date.now();
          const actor = d.users.find((u) => u.id === actorId);
          const student = d.students.find((s) => s.id === record.studentId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: record.id, studentId: record.studentId, classId: record.classId, subject: record.subject, semester: record.semester, component: null,
            action: "AUTO_LOCK_REINSTATED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff: [{ field: "autoLockOverride", from: true, to: null }], reason: null, at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);
          d.activities = [{ id: uid("act"), text: `${record.subject} ${record.semester} result re-locked for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },

      // Adds one evidence page (a photo/scan of the exam paper) to a component, appended after
      // whatever pages already exist. Same lock gate as saveResultComponent — evidence can't be
      // added to a result that's currently locked either. `fileType` defaults via inferFileType at
      // the call site (UI), not here, so this stays a plain data write.
      addResultEvidencePage({ studentId, classId, subject, semester, component, fileDataUrl, fileType, fileName }, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          if (!SEMESTERS.includes(semester) || !ASSESSMENT_COMPONENTS.includes(component)) {
            result = { ok: false, message: "Invalid semester or assessment component." };
            return d;
          }
          const academicYearId = (currentAcademicYear(d.academicYears) || {}).id || null;
          let record = d.results.find((r) => r.studentId === studentId && r.classId === classId && r.subject === subject && r.semester === semester && r.academicYearId === academicYearId);
          const cal = resolveResultCal(d, academicYearId);
          const lock = effectiveResultLock(record, semester, cal, todayKeyStr());
          if (lock.locked) { result = { ok: false, message: lock.message }; return d; }
          if (!record) record = findOrCreateResultRecord(d, { studentId, classId, subject, semester });

          d.resultEvidence = d.resultEvidence || [];
          const existing = d.resultEvidence.filter((e) => e.resultId === record.id && e.component === component);
          const order = existing.length === 0 ? 0 : Math.max(...existing.map((e) => e.order)) + 1;
          d.resultEvidence.push({
            id: uid("reve"), resultId: record.id, studentId, classId, semester, component, academicYearId: record.academicYearId,
            order, fileDataUrl, fileType: fileType || "image", fileName: fileName || null,
            uploadedBy: actorId, uploadedAt: Date.now(),
          });
          record.updatedAt = Date.now();

          const actor = d.users.find((u) => u.id === actorId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: record.id, studentId, classId, subject, semester, component,
            action: "EVIDENCE_ADDED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff: [{ field: "evidence", from: existing.length, to: existing.length + 1 }], reason: null, at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);
          return d;
        });
        return result;
      },

      // Removes one evidence page and re-sequences the remaining pages of the same component so
      // `order` stays a dense 0..n-1 run (stable relative to their prior order).
      removeResultEvidencePage(evidenceId, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const row = (d.resultEvidence || []).find((e) => e.id === evidenceId);
          if (!row) { result = { ok: false, message: "Evidence page not found." }; return d; }
          const record = d.results.find((r) => r.id === row.resultId);
          const cal = resolveResultCal(d, record ? record.academicYearId : row.academicYearId);
          const lock = effectiveResultLock(record, row.semester, cal, todayKeyStr());
          if (lock.locked) { result = { ok: false, message: lock.message }; return d; }

          d.resultEvidence = d.resultEvidence.filter((e) => e.id !== evidenceId);
          d.resultEvidence
            .filter((e) => e.resultId === row.resultId && e.component === row.component)
            .sort((a, b) => a.order - b.order)
            .forEach((e, i) => { e.order = i; });
          if (record) record.updatedAt = Date.now();

          const actor = d.users.find((u) => u.id === actorId);
          d.resultAuditLog = [{
            id: uid("aud"), entityType: "result", entityId: row.resultId, studentId: row.studentId, classId: row.classId, subject: record ? record.subject : null, semester: row.semester, component: row.component,
            action: "EVIDENCE_REMOVED", actorId, actorRole: actorRole || actor?.role, actorName: actor?.name || "Unknown",
            diff: [], reason: null, at: Date.now(),
          }, ...(d.resultAuditLog || [])].slice(0, 500);
          return d;
        });
        return result;
      },

      // Purely cosmetic page reordering (no audit entry — matches saveResultComponent's "no
      // phantom audit entry" rule). Ids not belonging to this resultId+component are ignored.
      reorderResultEvidencePages(resultId, component, orderedEvidenceIds, actorId, actorRole) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const record = d.results.find((r) => r.id === resultId);
          const rows = (d.resultEvidence || []).filter((e) => e.resultId === resultId && e.component === component);
          const cal = resolveResultCal(d, record ? record.academicYearId : (rows[0] ? rows[0].academicYearId : null));
          const semester = record ? record.semester : (rows[0] ? rows[0].semester : null);
          const lock = effectiveResultLock(record, semester, cal, todayKeyStr());
          if (lock.locked) { result = { ok: false, message: lock.message }; return d; }

          orderedEvidenceIds.forEach((id, i) => {
            const row = rows.find((e) => e.id === id);
            if (row) row.order = i;
          });
          return d;
        });
        return result;
      },

      announceExam({ title, audience, date, message, priority }, authorId) {
        commit((d) => {
          const announcement = { id: uid("examann"), title, message, audience, priority: priority || "Important", examDate: date, authorId, createdAt: Date.now() };
          d.examAnnouncements.push(announcement);

          let targetClasses = [];
          if (audience.type === "ALL") targetClasses = d.classes;
          else if (audience.type === "GRADE") targetClasses = d.classes.filter((c) => c.grade === audience.grade);
          else if (audience.type === "SECTION") targetClasses = d.classes.filter((c) => c.grade === audience.grade && c.section === audience.section);

          const studentIds = d.students.filter((s) => targetClasses.some((c) => c.id === s.classId)).map((s) => s.id);
          const parentIds = new Set();
          d.users.filter((u) => u.role === ROLES.PARENT).forEach((p) => { if ((p.childIds || []).some((cid) => studentIds.includes(cid))) parentIds.add(p.id); });
          parentIds.forEach((pid) => {
            const parentUser = d.users.find((u) => u.id === pid);
            const childId = (parentUser?.childIds || []).find((cid) => studentIds.includes(cid)) || null;
            d.notifications = [{ id: uid("notif"), userId: pid, title: `Upcoming exam: ${title}`, message: `${message} (${fmtDate(date)})`, read: false, createdAt: Date.now(), type: "EXAM", navigation: { page: "exams", studentId: childId } }, ...d.notifications];
          });

          const headTeacherClassId = new Map();
          targetClasses.forEach((c) => { if (c.headTeacherId && !headTeacherClassId.has(c.headTeacherId)) headTeacherClassId.set(c.headTeacherId, c.id); });
          headTeacherClassId.forEach((classId, tid) => {
            d.notifications = [{ id: uid("notif"), userId: tid, title: `Exam announced: ${title}`, message: `${title} was announced for your class on ${fmtDate(date)}. Please enter results once it's complete.`, read: false, createdAt: Date.now(), type: "EXAM", navigation: { page: "exams", classId } }, ...d.notifications];
          });

          d.activities = [{ id: uid("act"), text: `${title} was announced for ${audience.type === "ALL" ? "the whole school" : audience.type === "GRADE" ? audience.grade : `${audience.grade}${audience.section}`}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      createBehaviorRecord(data) {
        commit((d) => {
          const record = { id: uid("beh"), ...data, createdAt: Date.now() };
          d.behaviorRecords.push(record);
          const student = d.students.find((s) => s.id === data.studentId);
          d.activities = [{ id: uid("act"), text: `A ${data.type.toLowerCase()} behavior record was added for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          if (data.parentNotified) {
            const parentIds = d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(data.studentId)).map((u) => u.id);
            parentIds.forEach((pid) => {
              d.notifications = [{ id: uid("notif"), userId: pid, title: `Behavior record — ${student ? computeStudentIdentity(d, student).display : "a student"}`, message: `${data.type}: ${data.description.slice(0, 80)}`, read: false, createdAt: Date.now(), type: "BEHAVIOR", navigation: { page: "behavior", studentId: data.studentId } }, ...d.notifications];
            });
          }
          return d;
        });
      },

      suspendStudent(studentId, { reason, startDate, endDate, notes }) {
        commit((d) => {
          const s = d.students.find((x) => x.id === studentId);
          if (s) {
            s.status = "SUSPENDED"; s.suspension = { reason, startDate, endDate, notes };
            this._syncEnrollment(d, s);
          }
          d.behaviorRecords.push({ id: uid("beh"), studentId, date: new Date().toISOString().slice(0, 10), type: "Other", severity: "High", description: `Suspension: ${reason}`, staff: "School Administrator", action: `Suspended ${startDate} to ${endDate}`, parentNotified: true, createdAt: Date.now() });
          const parentIds = d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(studentId)).map((u) => u.id);
          parentIds.forEach((pid) => {
            d.notifications = [{ id: uid("notif"), userId: pid, title: `Suspension notice — ${s ? computeStudentIdentity(d, s).display : "a student"}`, message: `${s ? studentFullName(s) : "Your child"} has been suspended: ${reason}`, read: false, createdAt: Date.now(), type: "BEHAVIOR", navigation: { page: "behavior", studentId } }, ...d.notifications];
          });
          // The student's teacher(s) need to know too — head teacher of their class, plus every
          // subject teacher assigned to it, so no one keeps expecting the student in class.
          if (s && s.classId) {
            const cls = d.classes.find((c) => c.id === s.classId);
            const teacherIds = new Set();
            if (cls?.headTeacherId) teacherIds.add(cls.headTeacherId);
            d.teacherAssignments.filter((ta) => ta.classId === s.classId).forEach((ta) => teacherIds.add(ta.teacherId));
            teacherIds.forEach((tid) => {
              d.notifications = [{ id: uid("notif"), userId: tid, title: `Student suspended — ${computeStudentIdentity(d, s).display}`, message: `${studentFullName(s)} has been suspended (${fmtDate(startDate)}–${fmtDate(endDate)}): ${reason}. They should not be marked in daily attendance during this period.`, read: false, createdAt: Date.now(), type: "BEHAVIOR", navigation: { page: "behavior", studentId } }, ...d.notifications];
            });
          }
          d.activities = [{ id: uid("act"), text: `${s ? studentFullName(s) : "A student"} was suspended.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      createAnnouncement(data) {
        commit((d) => {
          const now = Date.now();
          const publishAt = data.publishAt || null;
          const isDueNow = !publishAt || publishAt <= now;
          const ann = { id: uid("ann"), ...data, pinned: !!data.pinned, publishAt, expiresAt: data.expiresAt || null, publishNotified: isDueNow, createdAt: now };
          d.announcements.push(ann);
          if (isDueNow) {
            dispatchAnnouncementNotifications(d, ann);
            d.activities = [{ id: uid("act"), text: `Announcement "${data.title}" was published.`, createdAt: now }, ...d.activities];
          } else {
            d.activities = [{ id: uid("act"), text: `Announcement "${data.title}" scheduled for ${fmtDate(publishAt)}.`, createdAt: now }, ...d.activities];
          }
          return d;
        });
      },

      // Scheduled announcements have no "event" to hook a notification dispatch to — nothing
      // happens when their publish time arrives except time passing — so, like
      // checkLeaveCompletions, this is polled on an interval. `publishNotified` keeps it
      // idempotent no matter how many times it runs.
      checkScheduledAnnouncements() {
        const now = Date.now();
        if (!db.announcements.some((a) => a.publishAt && !a.publishNotified && a.publishAt <= now)) return;
        commit((d) => {
          const due = d.announcements.filter((a) => a.publishAt && !a.publishNotified && a.publishAt <= Date.now());
          if (due.length === 0) return d;
          due.forEach((ann) => {
            ann.publishNotified = true;
            dispatchAnnouncementNotifications(d, ann);
            d.activities = [{ id: uid("act"), text: `Announcement "${ann.title}" was published.`, createdAt: Date.now() }, ...d.activities];
          });
          return d;
        });
      },

      toggleAnnouncementPinned(id) {
        commit((d) => { const a = d.announcements.find((x) => x.id === id); if (a) a.pinned = !a.pinned; return d; });
      },

      markNotificationRead(id) {
        commit((d) => { const n = d.notifications.find((x) => x.id === id); if (n) n.read = true; return d; });
      },
      markAllNotificationsRead(userId) {
        commit((d) => { d.notifications.forEach((n) => { if (n.userId === userId) n.read = true; }); return d; });
      },
      // Bulk-clears the unread notifications behind one sidebar section's badge the moment its
      // page is opened — e.g. visiting Homework marks every unread HOMEWORK notification read.
      // Messages/Announcements/Notifications keep their own finer-grained (per-item) read
      // tracking and are never routed through this (see the callers).
      markNotificationsForPageRead(userId, pageKey) {
        if (!pageKey) return;
        // Guard against committing (deep-clones db, writes localStorage) on every navigation —
        // this runs on every page change, so most calls have nothing to update.
        const hasUnread = db.notifications.some((n) => n.userId === userId && !n.read && notificationPageKey(n) === pageKey);
        if (!hasUnread) return;
        commit((d) => {
          d.notifications.forEach((n) => { if (n.userId === userId && !n.read && notificationPageKey(n) === pageKey) n.read = true; });
          return d;
        });
      },

      // Returns the conversation id immediately (never null) so callers like MessagesPage's
      // "open this conversation right now" effect can synchronously setActiveConv(id) without
      // waiting for a re-render. This deliberately does NOT read the id back out of the commit()
      // mutator (as most other DataContext creators do) — setDb's functional updater is only
      // guaranteed to run synchronously for the *first* queued update on a fiber; a second
      // getOrCreateConversation call in the same tick (e.g. React StrictMode's intentional double
      // effect-invocation in dev, or any caller that ends up invoking this twice before a render
      // lands) would otherwise read back `newId` before its own commit mutator has actually run,
      // getting `null`. Using a deterministic id derived from the sorted participant pair — instead
      // of a random uid() minted inside the mutator — means every call for the same two users
      // converges on the identical id up front, so duplicate/racing calls are harmless: whichever
      // commit runs first creates the row, and any later one for the same pair is a no-op guarded
      // by id, and every caller ends up pointed at the same, real conversation.
      getOrCreateConversation(userIdA, userIdB) {
        const existing = db.conversations.find((c) => c.participantIds.includes(userIdA) && c.participantIds.includes(userIdB));
        if (existing) return existing.id;
        const newId = `conv_${[userIdA, userIdB].sort().join("_")}`;
        commit((d) => {
          if (!d.conversations.some((c) => c.id === newId)) {
            d.conversations.push({ id: newId, participantIds: [userIdA, userIdB] });
          }
          return d;
        });
        return newId;
      },

      sendMessage(conversationId, senderId, text) {
        commit((d) => {
          d.messages.push({ id: uid("msg"), conversationId, senderId, text, createdAt: Date.now(), read: false });
          const conv = d.conversations.find((c) => c.id === conversationId);
          const recipientId = conv?.participantIds.find((id) => id !== senderId);
          if (recipientId) {
            const sender = d.users.find((u) => u.id === senderId);
            d.notifications = [{ id: uid("notif"), userId: recipientId, title: `New message from ${sender?.name}`, message: text.slice(0, 100), read: false, createdAt: Date.now(), type: "MESSAGE", navigation: { page: "messages", userId: senderId } }, ...d.notifications];
          }
          return d;
        });
      },
      markMessagesRead(conversationId, userId) {
        commit((d) => { d.messages.forEach((m) => { if (m.conversationId === conversationId && m.senderId !== userId) m.read = true; }); return d; });
      },

      recordTeacherAbsence({ teacherId, subject, classId, reason, replacementSubject }) {
        commit((d) => {
          const teacher = d.users.find((u) => u.id === teacherId);
          const cls = d.classes.find((c) => c.id === classId);
          d.activities = [{ id: uid("act"), text: `${teacher?.name} marked absent (${reason}). ${subject} for ${cls?.grade}${cls?.section} replaced with ${replacementSubject}.`, createdAt: Date.now() }, ...d.activities];
          const parentIds = parentsOfClass(classId);
          parentIds.forEach((pid) => {
            d.notifications = [{ id: uid("notif"), userId: pid, title: "Class schedule changed", message: `Today's ${subject} class has been replaced by ${replacementSubject}.`, read: false, createdAt: Date.now(), type: "SCHEDULE", navigation: { page: "timetable" } }, ...d.notifications];
          });
          return d;
        });
      },

      /* ---------- Staff & Payroll (Phase 1A) ---------- */
      logActivity(text) {
        commit((d) => { d.activities = [{ id: uid("act"), text, createdAt: Date.now() }, ...d.activities]; return d; });
      },

      createStaff(data) {
        let newId = null;
        commit((d) => {
          const seq = d.staffSeq || 1;
          d.staffSeq = seq + 1;
          const s = { id: uid("staff"), userId: data.userId || null, name: data.name, position: data.position, employmentDate: data.employmentDate || new Date().toISOString().slice(0, 10), phone: data.phone || null, salary: Number(data.salary) || 0, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: data.photo || null, hasShifts: !!data.hasShifts, bankAccount: data.bankAccount || null, employeeNumber: `TMA-EMP-${String(seq).padStart(4, "0")}` };
          newId = s.id;
          d.staff.push(s);
          d.activities = [{ id: uid("act"), text: `${s.name} was added to staff as ${s.position}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return newId;
      },
      updateStaff(id, patch) {
        commit((d) => {
          const s = d.staff.find((x) => x.id === id);
          if (s) Object.assign(s, patch, patch.salary !== undefined ? { salary: Number(patch.salary) || 0 } : {});
          return d;
        });
      },
      setStaffStatus(id, status, actorId) {
        commit((d) => {
          const s = d.staff.find((x) => x.id === id);
          if (s) s.status = status;
          // A staff record and its linked login account (if any) must always agree on active/
          // disabled — otherwise someone disabled here could still sign in, or show active in
          // Payroll while Accounts & Access says disabled. See setAccountStatus for the mirror.
          if (s?.userId) {
            const u = d.users.find((x) => x.id === s.userId);
            if (u) u.status = status;
          }
          d.activities = [{ id: uid("act"), text: `${s?.name || "A staff member"}'s status was changed to ${status}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      // Employment (are they currently employed) is separate from the status field above (can
      // they log in). Ending employment cascades into disabling login — the reverse is never true,
      // so disabling login via setStaffStatus/setAccountStatus above must NEVER touch
      // employmentStatus/employmentEndDate. History (payroll, attendance, assignments) is never
      // touched here — only deleteStaff/deleteTeacher erase records, and this is deliberately not
      // routed through them. `endDate` is the last employed day (inclusive) — see
      // employmentActiveOn (staffEmploymentStatus.js), which staffSalarySummary below and every
      // "is this person currently staff" check should use instead of re-deriving the date rule.
      endEmployment(staffId, endDate) {
        commit((d) => {
          const s = d.staff.find((x) => x.id === staffId);
          if (!s) return d;
          s.employmentStatus = "ENDED";
          s.employmentEndDate = endDate;
          s.status = "DISABLED";
          if (s.userId) {
            const u = d.users.find((x) => x.id === s.userId);
            if (u) u.status = "DISABLED";
          }
          d.activities = [{ id: uid("act"), text: `${s.name}'s employment ended effective ${endDate}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      reactivateEmployment(staffId) {
        commit((d) => {
          const s = d.staff.find((x) => x.id === staffId);
          if (!s) return d;
          s.employmentStatus = "ACTIVE";
          s.employmentEndDate = null;
          s.status = "ACTIVE";
          if (s.userId) {
            const u = d.users.find((x) => x.id === s.userId);
            if (u) u.status = "ACTIVE";
          }
          d.activities = [{ id: uid("act"), text: `${s.name}'s employment was reactivated.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      // Mirrors balanceFor()'s PAID/PARTIAL/UNPAID logic for Fees (line ~186) — a month's status
      // is derived from the sum of every payment recorded against it, never from a single
      // payment's amount, so a salary split across two partial payments still resolves correctly.
      // Never generates an "expected" month past employmentEndDate — otherwise Outstanding keeps
      // growing forever for someone who no longer works here (see endEmployment above). Decision
      // 1 (approved 2026-08-25): the termination month itself is NOT prorated automatically —
      // it's still a full expected month, same as any other; Finance types the actual final
      // amount into the existing free-entry Amount field, same mechanism as every other month.
      staffSalarySummary(staffId) {
        return computeStaffPayrollSummary(db, staffId);
      },

      // Blocker 5 (payroll overpayment + salary advance policy, approved 2026-08-25): a payment
      // can never exceed the employee's actual remaining obligation for that month, and a zero/
      // negative amount is rejected rather than silently no-op'd — the caller must be able to tell
      // whether anything was actually recorded (see voidPayment above for the same result-object
      // pattern). The cap is recomputed here from the live draft `d`, not a value the UI read
      // earlier, so two payments landing in the same tick can't jointly exceed the remaining amount.
      recordPayrollPayment(staffId, { amount, method, month, date, note, allowances, deductions, advanceApplied }, recordedBy) {
        let result = { success: false, error: "" };
        commit((d) => {
          const s = d.staff.find((x) => x.id === staffId);
          if (!s) { result = { success: false, error: "Staff member not found." }; return d; }
          const cash = Number(amount);
          if (!Number.isFinite(cash) || cash <= 0) {
            result = { success: false, error: "Payment amount must be greater than zero." };
            return d;
          }
          const newAllowances = Math.max(0, Number(allowances) || 0);
          const newDeductions = Math.max(0, Number(deductions) || 0);
          // The cap is scoped to THIS transaction's own chosen advanceApplied (not a pre-computed
          // "credit already netted" figure) — that way, if Finance applies less of the advance
          // balance than is available, the cash cap correctly grows to cover the rest, and there's
          // no mismatch between what's displayed as suggested and what's actually enforced.
          const advanceGiven = d.salaryAdvances.filter((a) => a.staffId === staffId).reduce((sum, a) => sum + a.amount, 0);
          const advanceAppliedTotal = d.payrollPayments.filter((p) => p.staffId === staffId).reduce((sum, p) => sum + (p.advanceApplied || 0), 0);
          const advanceBalance = Math.max(0, advanceGiven - advanceAppliedTotal);
          const appliedAdvance = Math.min(Math.max(0, Number(advanceApplied) || 0), advanceBalance);
          const paymentsForMonth = d.payrollPayments.filter((p) => p.staffId === staffId && p.month === month);
          const paidThisMonthAlready = paymentsForMonth.reduce((sum, p) => sum + p.amount + (p.advanceApplied || 0), 0);
          const cashCap = Math.max(0, s.salary + newAllowances - newDeductions - paidThisMonthAlready - appliedAdvance);
          if (cash > cashCap + 0.001) {
            const advanceNote = appliedAdvance > 0 ? ` after applying ${formatMoney(appliedAdvance)} of the salary advance` : "";
            result = { success: false, error: `Payment of ${formatMoney(cash)} exceeds the ${formatMoney(cashCap)} remaining for ${monthLabel(month)}${advanceNote}.` };
            return d;
          }
          const seq = d.payrollPaymentSeq || 1;
          d.payrollPaymentSeq = seq + 1;
          const [refYear, refMonth] = (month || "").split("-");
          const reference = refYear && refMonth ? `SAL-${refYear}-${refMonth}-${String(seq).padStart(4, "0")}` : null;
          const payment = {
            id: uid("payr"), staffId, amount: cash, method, month, date, note: note || "", recordedBy, reference, createdAt: Date.now(),
            allowances: newAllowances, deductions: newDeductions, advanceApplied: appliedAdvance,
          };
          d.payrollPayments.push(payment);
          d.activities = [{ id: uid("act"), text: `${formatMoney(cash)} salary payment recorded for ${s.name} (${monthLabel(month)}).`, createdAt: Date.now(), navigation: { page: "payroll", staffId: s.id } }, ...d.activities];
          if (s.userId) {
            d.notifications = [{
              id: uid("notif"), userId: s.userId, title: "Salary Paid",
              message: `Your ${monthLabel(month)} salary of ${formatMoney(cash)} has been recorded as paid. Tap to view your payslip.`,
              read: false, createdAt: Date.now(), type: "PAYROLL", paymentId: payment.id,
            }, ...d.notifications];
          }
          result = { success: true, payment };
          return d;
        });
        return result;
      },

      // A salary advance is money given to a staff member ahead of a regular payroll payment —
      // tracked as its own ledger (see staffSalarySummary's advances/advanceBalance) rather than
      // a payment, so it's never mistaken for a month's salary having been paid. It's settled
      // later via recordPayrollPayment's advanceApplied field.
      //
      // Blocker 5A: an advance can never exceed what's actually available (this month's own unmet
      // obligation, minus any advance balance already outstanding) — recomputed from the live draft
      // `d` at commit time, same reasoning as recordPayrollPayment's cash cap, so two advances
      // landing in the same tick can't jointly overshoot it.
      recordSalaryAdvance(staffId, { amount, date, note }, recordedBy) {
        let result = { success: false, error: "" };
        commit((d) => {
          const s = d.staff.find((x) => x.id === staffId);
          if (!s) { result = { success: false, error: "Staff member not found." }; return d; }
          const cash = Number(amount);
          if (!Number.isFinite(cash) || cash <= 0) {
            result = { success: false, error: "Advance amount must be greater than zero." };
            return d;
          }
          const summaryBefore = computeStaffPayrollSummary(d, staffId) || { maxAdvance: 0, advanceBalance: 0 };
          const { maxAdvance } = summaryBefore;
          if (cash > maxAdvance + 0.001) {
            result = {
              success: false,
              error: maxAdvance <= 0
                ? `${s.name} has no available Net Pay to advance against right now.`
                : `Advance exceeds the ${formatMoney(maxAdvance)} available Net Pay for ${s.name}.`,
            };
            return d;
          }
          const seq = d.advanceSeq || 1;
          d.advanceSeq = seq + 1;
          const [refYear, refMonth] = (date || "").split("-");
          const reference = refYear && refMonth ? `ADV-${refYear}-${refMonth}-${String(seq).padStart(4, "0")}` : null;
          const advance = {
            id: uid("adv"), staffId, amount: cash, date, payrollMonth: refYear && refMonth ? `${refYear}-${refMonth}` : null,
            note: note || "", recordedBy, reference, createdAt: Date.now(),
          };
          d.salaryAdvances.push(advance);
          d.activities = [{ id: uid("act"), text: `${formatMoney(cash)} salary advance recorded for ${s.name}.`, createdAt: Date.now(), navigation: { page: "payroll", staffId: s.id } }, ...d.activities];
          if (s.userId) {
            const newBalance = summaryBefore.advanceBalance + cash;
            d.notifications = [{
              id: uid("notif"), userId: s.userId, title: "Salary Advance Recorded",
              message: `An advance of ${formatMoney(cash)} was recorded for you on ${fmtDate(date)}. Your remaining advance balance is ${formatMoney(newBalance)}.`,
              read: false, createdAt: Date.now(), type: "PAYROLL",
            }, ...d.notifications];
          }
          result = { success: true, advance };
          return d;
        });
        return result;
      },

      /* ---------- Payment Methods (Phase 1A) ---------- */
      createPaymentMethod(name) {
        commit((d) => {
          const trimmed = (name || "").trim();
          if (!trimmed) return d;
          d.paymentMethods.push({ id: uid("pm"), name: trimmed, active: true });
          d.activities = [{ id: uid("act"), text: `Payment method "${trimmed}" was added.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      updatePaymentMethod(id, name) {
        commit((d) => {
          const pm = d.paymentMethods.find((m) => m.id === id);
          if (pm && (name || "").trim()) pm.name = name.trim();
          return d;
        });
      },
      setPaymentMethodActive(id, active) {
        commit((d) => {
          const pm = d.paymentMethods.find((m) => m.id === id);
          if (pm) pm.active = active;
          return d;
        });
      },

      /* ---------- Expenses (Phase 1A) ---------- */
      // One expense transaction (a single purchase/shopping trip) can carry any number of line
      // items — Finance shouldn't have to record "Add Expense" once per item bought on the same
      // trip. Every line's total is always server-derived as quantity*unitPrice (never trusted
      // from the client), and the transaction's totalAmount is always the sum of its lines —
      // never an independently-editable number that could drift from the items backing it.
      validateExpenseItems(rawItems) {
        const items = [];
        const list = Array.isArray(rawItems) ? rawItems : [];
        for (const it of list) {
          const itemName = (it.itemName || "").trim();
          const quantity = Number(it.quantity);
          const unitPrice = Number(it.unitPrice);
          if (!itemName) return { error: "Every item needs a name." };
          if (!Number.isFinite(quantity) || quantity <= 0) return { error: "Quantity must be greater than 0." };
          if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { error: "Unit price must be greater than 0." };
          items.push({ id: it.id || uid("expitem"), itemName, quantity, unitPrice, lineTotal: quantity * unitPrice });
        }
        if (items.length === 0) return { error: "Add at least one item." };
        return { items };
      },
      createExpense(data, recordedBy) {
        let result = { success: false, error: "" };
        commit((d) => {
          const { items, error } = this.validateExpenseItems(data.items);
          if (error) { result = { success: false, error }; return d; }
          const totalAmount = items.reduce((sum, it) => sum + it.lineTotal, 0);
          const seq = d.expenseSeq || 1;
          d.expenseSeq = seq + 1;
          const expense = {
            id: uid("exp"), expenseNo: `#${String(seq).padStart(4, "0")}`, date: data.date, items, totalAmount,
            method: data.method, purchasedBy: data.purchasedBy || "", note: data.note || "",
            receiptImage: data.receiptImage || null, receiptName: data.receiptName || null, receiptType: data.receiptType || null,
            recordedBy, createdAt: Date.now(),
          };
          d.expenses.push(expense);
          const label = items.length === 1 ? items[0].itemName : `${items.length} items`;
          d.activities = [{ id: uid("act"), text: `${formatMoney(totalAmount)} expense recorded: ${label}.`, createdAt: Date.now(), navigation: { page: "expenses", expenseId: expense.id } }, ...d.activities];
          result = { success: true, expense };
          return d;
        });
        return result;
      },
      updateExpense(id, data) {
        let result = { success: false, error: "" };
        commit((d) => {
          const e = d.expenses.find((x) => x.id === id);
          if (!e) { result = { success: false, error: "Expense not found." }; return d; }
          const { items, error } = this.validateExpenseItems(data.items !== undefined ? data.items : e.items);
          if (error) { result = { success: false, error }; return d; }
          e.items = items;
          e.totalAmount = items.reduce((sum, it) => sum + it.lineTotal, 0);
          if (data.date !== undefined) e.date = data.date;
          if (data.method !== undefined) e.method = data.method;
          if (data.purchasedBy !== undefined) e.purchasedBy = data.purchasedBy;
          if (data.note !== undefined) e.note = data.note;
          if (data.receiptImage !== undefined) e.receiptImage = data.receiptImage;
          if (data.receiptName !== undefined) e.receiptName = data.receiptName;
          if (data.receiptType !== undefined) e.receiptType = data.receiptType;
          d.activities = [{ id: uid("act"), text: `Expense ${e.expenseNo || ""} was updated.`, createdAt: Date.now() }, ...d.activities];
          result = { success: true, expense: e };
          return d;
        });
        return result;
      },
      deleteExpense(id) {
        commit((d) => {
          const exp = d.expenses.find((e) => e.id === id);
          d.expenses = d.expenses.filter((e) => e.id !== id);
          if (exp) d.activities = [{ id: uid("act"), text: `Expense "${exp.expenseNo || ""}" was removed.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      /* ---------- Owner: account management (Phase 1A) ---------- */
      setAccountStatus(userId, status) {
        commit((d) => {
          const u = d.users.find((x) => x.id === userId);
          if (u) u.status = status;
          // Mirror onto the linked staff record — see setStaffStatus for why these two can never
          // be allowed to drift apart.
          const linkedStaff = d.staff.find((s) => s.userId === userId);
          if (linkedStaff) linkedStaff.status = status;
          d.activities = [{ id: uid("act"), text: `${u?.name || "An account"}'s access was set to ${status}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      createDirectorAccount(data) {
        let newId = null;
        commit((d) => {
          const u = { id: uid("user"), role: ROLES.ADMIN, name: data.name, email: data.email, password: data.password, phone: data.phone || "", status: "ACTIVE", mustChangePassword: true, photo: null };
          newId = u.id;
          d.users.push(u);
          const staffSeq = d.staffSeq || 1;
          d.staffSeq = staffSeq + 1;
          d.staff.push({ id: uid("staff"), userId: u.id, name: u.name, position: "Educational Director", employmentDate: new Date().toISOString().slice(0, 10), phone: u.phone, salary: Number(data.salary) || 12000, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, bankAccount: data.bankAccount || null, employeeNumber: `TMA-EMP-${String(staffSeq).padStart(4, "0")}` });
          d.activities = [{ id: uid("act"), text: `${u.name} was added as Educational Director.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return newId;
      },
      createFinanceAccount(data) {
        let newId = null;
        commit((d) => {
          const u = { id: uid("user"), role: ROLES.FINANCE, name: data.name, email: data.email, password: data.password, phone: data.phone || "", status: "ACTIVE", mustChangePassword: true, photo: null };
          newId = u.id;
          d.users.push(u);
          const staffSeq = d.staffSeq || 1;
          d.staffSeq = staffSeq + 1;
          d.staff.push({ id: uid("staff"), userId: u.id, name: u.name, position: "Finance Director", employmentDate: new Date().toISOString().slice(0, 10), phone: u.phone, salary: Number(data.salary) || 12000, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, bankAccount: data.bankAccount || null, employeeNumber: `TMA-EMP-${String(staffSeq).padStart(4, "0")}` });
          d.activities = [{ id: uid("act"), text: `${u.name} was added as Finance & Operations Director.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return newId;
      },
      resetUserPassword(userId, newPassword) {
        commit((d) => {
          const u = d.users.find((x) => x.id === userId);
          if (u) { u.password = newPassword; u.mustChangePassword = true; }
          d.activities = [{ id: uid("act"), text: `Password was reset for ${u?.name || "an account"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      /* ---------- Report cards ----------
       * One annual report card per student+class, gated on Semester 2 (not a per-term concept —
       * Semester 1 results are viewable live all along, but never produce a formal report card).
       */
      requiredSubjectsForClass(classId) {
        return db.classSubjects.filter((cs) => cs.classId === classId).map((cs) => cs.subject);
      },
      // Total/Average/Rank/Class-Average/Top-Student for one class+semester — the single shared
      // engine backing the Results grid and Student Profile's Class Rank (see resultsEngine.js).
      // `academicYearId` defaults to current — pass a specific year explicitly when browsing a
      // past enrollment (see Student Profile, which already has a year picker).
      classSemesterResults(classId, semester, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        return computeClassSemesterResults({ db, classId, semester, academicYearId: yearId, requiredSubjectsForClass: (id) => this.requiredSubjectsForClass(id) });
      },
      // Yearly (S1+S2 blended) class ranking for the Report Card's Yearly Average/Rank row — a
      // student only ranks once BOTH semesters are fully complete. Distinct from, not derived by
      // re-averaging, the per-semester ranks above (see resultsEngine.js comment on why the Report
      // Card average is a legitimately different metric).
      classYearlyResults(classId, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        const s1 = this.classSemesterResults(classId, "S1", yearId);
        const s2 = this.classSemesterResults(classId, "S2", yearId);
        const baseRows = s1.rows.map((r1) => {
          const r2 = s2.rows.find((r) => r.studentId === r1.studentId);
          const allComplete = r1.allComplete && !!r2 && r2.allComplete;
          const average = allComplete ? Math.round((r1.average + r2.average) / 2) : null;
          return { studentId: r1.studentId, average, allComplete };
        });
        return { classId, rows: rankStudents(baseRows) };
      },
      // Highest-averaging allComplete student school-wide for the given semester, or null if no
      // student anywhere has finished every required subject yet.
      schoolTopPerformer(semester, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        const perClass = db.classes.map((c) => this.classSemesterResults(c.id, semester, yearId));
        return findSchoolTopPerformer(perClass);
      },
      // `academicYearId` defaults to current — see findOrCreateResultRecord for why classId alone
      // isn't enough to identify "this year's" results for a repeating/retained student.
      computeReportReadiness(studentId, classId, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        const required = this.requiredSubjectsForClass(classId);
        const records = db.results.filter((r) => r.studentId === studentId && r.classId === classId && r.semester === "S2" && (!r.academicYearId || r.academicYearId === yearId));
        const completedSubjects = required.filter((subj) => {
          const record = records.find((r) => r.subject === subj);
          return computeSemesterResult(record).completionStatus === "COMPLETE";
        });
        const missingSubjects = required.filter((s) => !completedSubjects.includes(s));
        return { required, completedCount: completedSubjects.length, requiredCount: required.length, missingSubjects, complete: required.length > 0 && missingSubjects.length === 0 };
      },
      // `academicYearId` defaults to current — classId alone collides for a repeating/retained
      // student who keeps the same classId next year (same reasoning as computeReportReadiness).
      isReportLocked(studentId, classId, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        return db.reportCards.some((rc) => rc.studentId === studentId && rc.classId === classId && rc.status === "LOCKED" && (!rc.academicYearId || rc.academicYearId === yearId));
      },
      getReportCard(studentId, classId, academicYearId) {
        const yearId = academicYearId || (currentAcademicYear(db.academicYears) || {}).id || null;
        return db.reportCards.find((rc) => rc.studentId === studentId && rc.classId === classId && (!rc.academicYearId || rc.academicYearId === yearId)) || null;
      },
      generateReportCard(studentId, classId, generatedBy, academicYearId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const yearId = academicYearId || (currentAcademicYear(d.academicYears) || {}).id || null;
          const student = d.students.find((s) => s.id === studentId);
          const readiness = this.computeReportReadiness(studentId, classId, yearId);
          if (!readiness.complete) { result = { ok: false, message: `${student?.firstName || "This student"} is missing Semester 2 results for: ${readiness.missingSubjects.join(", ")}.` }; return d; }
          let rc = d.reportCards.find((r) => r.studentId === studentId && r.classId === classId && r.academicYearId === yearId);
          if (rc) { rc.status = "GENERATED"; rc.generatedAt = Date.now(); rc.generatedBy = generatedBy; }
          else { rc = { id: uid("rc"), studentId, classId, academicYearId: yearId, status: "GENERATED", generatedAt: Date.now(), generatedBy, publishedAt: null, publishedBy: null, lockedAt: null, lockedBy: null, promoted: null, promotionNote: "" }; d.reportCards.push(rc); }
          d.activities = [{ id: uid("act"), text: `Report card generated for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      // Promotion is a manual staff decision (not an automatic pass-mark), recorded before the
      // card can be published so it's never silently skipped — see `publishReportCard`.
      setReportCardPromotion(id, promoted, note, actorId) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const rc = d.reportCards.find((r) => r.id === id);
          if (!rc) { result = { ok: false, message: "Report card not found." }; return d; }
          if (rc.status === "PUBLISHED" || rc.status === "LOCKED") { result = { ok: false, message: "This report card is already published — reopen it first to change the promotion decision." }; return d; }
          rc.promoted = promoted; rc.promotionNote = note || "";
          return d;
        });
        return result;
      },
      publishReportCard(id, publishedBy) {
        let result = { ok: true, message: "" };
        commit((d) => {
          const rc = d.reportCards.find((r) => r.id === id);
          if (!rc) { result = { ok: false, message: "Report card not found." }; return d; }
          // Idempotency guard matching publishResults — a rapid double-click (or any repeat call)
          // on an already-PUBLISHED/LOCKED card is a safe no-op instead of re-sending the parent
          // notification.
          if (rc.status === "PUBLISHED" || rc.status === "LOCKED") { result = { ok: true, message: "" }; return d; }
          if (rc.promoted === null || rc.promoted === undefined) { result = { ok: false, message: "Set the promotion decision (Promoted or Retained) before publishing." }; return d; }
          rc.status = "PUBLISHED"; rc.publishedAt = Date.now(); rc.publishedBy = publishedBy;
          const student = d.students.find((s) => s.id === rc.studentId);
          const parentIds = d.users.filter((u) => u.role === ROLES.PARENT && (u.childIds || []).includes(rc.studentId)).map((u) => u.id);
          parentIds.forEach((pid) => {
            d.notifications = [{ id: uid("notif"), userId: pid, title: `Report card published — ${student?.firstName}`, message: `${student?.firstName}'s report card is ready to view.`, read: false, createdAt: Date.now(), type: "RESULT", navigation: { page: "exams", studentId: rc.studentId, openReportCard: true } }, ...d.notifications];
          });
          d.activities = [{ id: uid("act"), text: `Report card published for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
        return result;
      },
      lockReportCard(id, lockedBy) {
        commit((d) => {
          const rc = d.reportCards.find((r) => r.id === id);
          if (!rc) return d;
          rc.status = "LOCKED"; rc.lockedAt = Date.now(); rc.lockedBy = lockedBy;
          const student = d.students.find((s) => s.id === rc.studentId);
          d.activities = [{ id: uid("act"), text: `Report card locked for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },
      reopenReportCard(id, actorId) {
        commit((d) => {
          const rc = d.reportCards.find((r) => r.id === id);
          if (!rc) return d;
          rc.status = "GENERATED"; rc.lockedAt = null; rc.lockedBy = null;
          const student = d.students.find((s) => s.id === rc.studentId);
          d.activities = [{ id: uid("act"), text: `Report card reopened for editing for ${student ? studentFullName(student) : "a student"}.`, createdAt: Date.now() }, ...d.activities];
          return d;
        });
      },

      resetDemoData() {
        const fresh = buildSeed();
        fresh.updatedAt = Date.now();
        lastWriteRef.current = fresh.updatedAt;
        saveDB(fresh);
        setDb(fresh);
      },
    };
  }, [mockDb, commit, academicYears]);

  // Leave completion and scheduled-announcement publishing are both date-boundary checks, not
  // events — nothing "happens" to trigger them, so they're checked on an ambient interval
  // instead. A minute is plenty granular; each has its own `*Notified` flag to stay idempotent.
  useEffect(() => {
    if (!ready || !api) return;
    api.checkLeaveCompletions();
    api.checkScheduledAnnouncements();
    const iv = setInterval(() => { api.checkLeaveCompletions(); api.checkScheduledAnnouncements(); }, 60000);
    return () => clearInterval(iv);
  }, [ready, api]);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3"><CircleAlert className="text-red-600" size={22} /></div>
          <p className="font-medium text-slate-700 mb-1">Unable to load Tilmaan Modern Academy.</p>
          <p className="text-xs text-slate-400 mb-4">{loadError}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium">Reload</button>
        </div>
      </div>
    );
  }

  if (!ready || !mockDb) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-sky-600" size={32} />
          <p className="text-slate-500 text-sm">Loading Tilmaan Modern Academy…</p>
        </div>
      </div>
    );
  }

  return <DataCtx.Provider value={api}>{children}</DataCtx.Provider>;
}

export { DataProvider, useData };
