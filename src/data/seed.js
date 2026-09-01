// Demo/mock data layer for Phase 1. Everything below builds and migrates
// the local "database" that DataContext persists to localStorage.
// In Phase 2 this is replaced by real Supabase tables/queries.
import {
  ROLES, STUDENT_STATUS, BEHAVIOR_TYPES, SEVERITIES, SCHOOL_DAYS,
  todayDayName, academicYearStart, addMonthsFloat, feeCoverage,
  SUBJECTS, GRADES, SECTIONS, sectionLabel,
  STORAGE_KEY, CURRENCY, DEFAULT_PAYMENT_METHODS, formatMoney,
  BRAND, LOGO_DATA_URI, DEFAULT_TIMETABLE_CONFIG,
  ASSESSMENT_COMPONENTS, ASSESSMENT_COMPONENT_WEIGHT,
} from "../utils/constants";
import {
  uid, fmtDate, fmtTime, to12Hour, timeAgo, initials, copyText, generatePassword, avatarColor, fullName,
} from "../utils/helpers";
import { todayKeyStr } from "../components/ui";
import { defaultAcademicCalendar, currentAcademicYear, activeYearStartDate, DEFAULT_RESULT_FINALIZATION_GRACE_DAYS } from "../utils/academicCalendar";
import { ecYearLabelForGcStart } from "../utils/ethiopianCalendar";
import { inferFileType } from "../utils/fileType";

/* ============================== SEED DATA ============================== */

const FIRST_NAMES = ["Ahmed","Aisha","Mohamed","Amina","Hassan","Fatima","Yusuf","Halima","Abdirahman","Sahra",
  "Khadija","Omar","Zainab","Ibrahim","Layla","Abdi","Hodan","Farah","Nadia","Mustafa",
  "Sagal","Warsame","Hamdi","Ismail","Rahma","Bashir","Iman","Samir","Ubah","Nur"];
const LAST_NAMES = ["Hassan","Ali","Yusuf","Nur","Abdi","Warsame","Ismail","Omar","Farah","Bashir",
  "Mohamud","Jama","Ahmed","Aden","Elmi","Roble","Dahir","Kahin","Muse","Sheikh"];

function pick(arr, i) { return arr[i % arr.length]; }

// 4 tuition installments, 2.5 months apart starting at the academic year's start — the default
// an admin sees in Fee Settings until they pick their own exact dates. `start` should be the
// active academic year's start date; defaults to the Sept-1 guess only when no calendar is
// available yet (e.g. migrating a fee type before the academic calendar block below has run).
function defaultInstallmentDates(start = academicYearStart()) {
  return [0, 2.5, 5, 7.5].map((offsetMonths, i) => ({
    id: uid("inst"),
    label: `Quarter ${i + 1}`,
    dueDate: addMonthsFloat(start, offsetMonths).toISOString().slice(0, 10),
  }));
}

function buildSeed() {
  const now = Date.now();
  const users = [];
  const students = [];
  const classes = [];
  const classSubjects = [];
  const teacherAssignments = [];
  const homework = [];
  const attendance = [];
  const results = [];
  const resultAuditLog = [];
  const paymentAuditLog = [];
  const resultEvidence = [];
  const examAnnouncements = [];
  const behaviorRecords = [];
  const announcements = [];
  const notifications = [];
  const conversations = [];
  const messages = [];
  const activities = [];
  const staff = [];
  const payrollPayments = [];
  const expenses = [];
  const reportCards = [];
  const subjects = SUBJECTS.map((name) => ({ id: uid("sub"), name }));
  const enrollments = [];
  const studentDocuments = [];

  // ---- The one academic year that exists at first install — a real, id'd entity (not just a
  // filter value), so students/attendance/homework/results/documents can stay associated with the
  // correct year once a school moves on to a second one. E.C. label is computed, never hardcoded.
  const firstAcademicYear = defaultAcademicCalendar();
  firstAcademicYear.id = uid("ayear");

  // ---- Owner (Super Admin)
  const owner = { id: "user_owner_demo", role: ROLES.OWNER, name: "Abdirahman Ali", email: "owner@tilmaan-demo.com", password: "Demo123!", status: "ACTIVE", photo: null };
  users.push(owner);

  // ---- Admin (displayed as "Educational Director" in the UI)
  const admin = { id: "user_admin", role: ROLES.ADMIN, name: "School Administrator", email: "admin@tilmaan-demo.com", password: "Demo123!", status: "ACTIVE", photo: null };
  users.push(admin);

  // ---- Finance & Operations Director
  const finance = { id: "user_finance_demo", role: ROLES.FINANCE, name: "Mohamed Ali", email: "finance@tilmaan-demo.com", password: "Demo123!", status: "ACTIVE", photo: null };
  users.push(finance);

  // ---- Teachers (10)
  const teacherNames = ["Amina Hassan","Ahmed Ali","Fatima Yusuf","Mohamed Nur","Halima Abdi","Abdirahman Warsame","Sahra Ismail","Yusuf Omar","Zainab Farah","Khadija Bashir"];
  const teachers = teacherNames.map((fullNameStr, i) => {
    const [first, last] = fullNameStr.split(" ");
    const middle = pick(LAST_NAMES, i + 6);
    const name = fullName(first, middle, last);
    const t = {
      id: i === 0 ? "user_teacher_demo" : uid("user"),
      role: ROLES.TEACHER,
      firstName: first, middleName: middle, lastName: last,
      name,
      email: i === 0 ? "teacher@tilmaan-demo.com" : `${fullNameStr.toLowerCase().replace(/ /g, ".")}@tilmaan-demo.com`,
      password: "Demo123!",
      status: "ACTIVE",
      photo: null,
      mustChangePassword: false,
      phone: `+252 61${(1000000 + i * 7331).toString().slice(0, 7)}`,
    };
    users.push(t);
    return t;
  });

  // ---- Staff / payroll records: every paid employee, whether or not they log in.
  // Login accounts (director, finance, teachers) get a `userId` link so their name/photo
  // stay in sync with `users`; non-login employees (cleaner, guard, driver) stand alone.
  // `employeeNumber` is system-assigned (never hand-typed) via staffSeq below, same gap-safe
  // sequential-numbering pattern as expenseNo/payrollPaymentSeq.
  let staffSeq = 1;
  const nextEmployeeNumber = () => `TMA-EMP-${String(staffSeq++).padStart(4, "0")}`;
  const employmentDate = "2024-09-01";
  staff.push({ id: uid("staff"), userId: admin.id, name: admin.name, position: "Educational Director", employmentDate, phone: "+252 615 900 001", salary: 12000, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, bankAccount: null, employeeNumber: nextEmployeeNumber() });
  staff.push({ id: uid("staff"), userId: finance.id, name: finance.name, position: "Finance Director", employmentDate, phone: "+252 615 900 002", salary: 12000, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, bankAccount: null, employeeNumber: nextEmployeeNumber() });
  teachers.forEach((t) => {
    staff.push({ id: uid("staff"), userId: t.id, name: t.name, position: "Teacher", employmentDate, phone: t.phone, salary: 8000, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, bankAccount: null, employeeNumber: nextEmployeeNumber() });
  });
  const nonLoginStaff = [
    { name: "Warsame Ali", position: "Cleaner", salary: 4500 },
    { name: "Nur Hassan", position: "Guard", salary: 5000 },
    { name: "Ismail Farah", position: "Driver", salary: 5500 },
  ];
  nonLoginStaff.forEach((s) => {
    staff.push({ id: uid("staff"), userId: null, name: s.name, position: s.position, employmentDate, phone: null, salary: s.salary, paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, hasShifts: s.position === "Driver", bankAccount: null, employeeNumber: nextEmployeeNumber() });
  });

  // A couple of months of payroll history for the demo: everyone paid last month, some paid this month.
  const lastMonthKey = new Date(now - 30 * 86400000).toISOString().slice(0, 7);
  const thisMonthKey = new Date(now).toISOString().slice(0, 7);
  staff.forEach((s, i) => {
    payrollPayments.push({ id: uid("payr"), staffId: s.id, amount: s.salary, method: "Cash", month: lastMonthKey, date: new Date(now - 30 * 86400000).toISOString().slice(0, 10), note: "", recordedBy: finance.id, createdAt: now - 30 * 86400000, allowances: 0, deductions: 0, advanceApplied: 0 });
    if (i % 2 === 0) payrollPayments.push({ id: uid("payr"), staffId: s.id, amount: s.salary, method: "CBE", month: thisMonthKey, date: new Date(now).toISOString().slice(0, 10), note: "", recordedBy: finance.id, createdAt: now - 2 * 86400000, allowances: 0, deductions: 0, advanceApplied: 0 });
  });
  const salaryAdvances = [];

  // ---- A handful of demo expenses. expenseSeq tracks the next number to hand out —
  // never derived from array position/length so deleting an expense can't renumber others.
  // Each expense is one purchase/shopping trip that can carry several line items — a line's
  // total is always quantity*unitPrice, and the transaction's totalAmount is the sum of its lines.
  let expenseSeq = 1;
  const nextExpenseNo = () => `#${String(expenseSeq++).padStart(4, "0")}`;
  function makeExpenseItems(lines) {
    return lines.map((l) => ({ id: uid("expitem"), itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.quantity * l.unitPrice }));
  }
  const officeSuppliesItems = makeExpenseItems([
    { itemName: "A4 Paper", quantity: 5, unitPrice: 250 },
    { itemName: "Pens", quantity: 20, unitPrice: 15 },
    { itemName: "Cleaning liquid", quantity: 2, unitPrice: 375 },
  ]);
  expenses.push({
    id: uid("exp"), expenseNo: nextExpenseNo(), date: new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    items: officeSuppliesItems, totalAmount: officeSuppliesItems.reduce((s, it) => s + it.lineTotal, 0),
    method: "Cash", purchasedBy: "Finance & Operations Director — " + finance.name,
    receiptImage: null, receiptName: null, receiptType: null, note: "Front office & cleaning supplies for the term",
    recordedBy: finance.id, createdAt: now - 3 * 86400000,
  });
  const playgroundItems = makeExpenseItems([{ itemName: "Playground equipment repair", quantity: 1, unitPrice: 4200 }]);
  expenses.push({
    id: uid("exp"), expenseNo: nextExpenseNo(), date: new Date(now - 8 * 86400000).toISOString().slice(0, 10),
    items: playgroundItems, totalAmount: playgroundItems.reduce((s, it) => s + it.lineTotal, 0),
    method: "CBE Birr", purchasedBy: "Finance & Operations Director — " + finance.name,
    receiptImage: null, receiptName: null, receiptType: null, note: "",
    recordedBy: finance.id, createdAt: now - 8 * 86400000,
  });

  // ---- Classes (6): Grade 1A,1B,2A,2B,3A,3B
  const classDefs = [];
  ["Grade 1", "Grade 2", "Grade 3"].forEach((g, gi) => {
    ["A", "B"].forEach((s, si) => {
      classDefs.push({ grade: g, section: s, headTeacher: teachers[(gi * 2 + si) % teachers.length] });
    });
  });
  classDefs.forEach((c) => {
    classes.push({ id: uid("class"), grade: c.grade, section: c.section, headTeacherId: c.headTeacher.id, subjectTeacherIds: [] });
  });

  // Assign the demo teacher (Amina Hassan, English) to Grade 3A & 3B explicitly
  const g3a = classes.find((c) => c.grade === "Grade 3" && c.section === "A");
  const g3b = classes.find((c) => c.grade === "Grade 3" && c.section === "B");
  teacherAssignments.push({ id: uid("ta"), teacherId: "user_teacher_demo", subject: "English", classId: g3a.id });
  teacherAssignments.push({ id: uid("ta"), teacherId: "user_teacher_demo", subject: "English", classId: g3b.id });
  g3a.subjectTeacherIds.push("user_teacher_demo");
  g3b.subjectTeacherIds.push("user_teacher_demo");
  // Only a class's head teacher can take that class's attendance — make Amina Hassan head teacher of Grade 3A for the demo.
  g3a.headTeacherId = "user_teacher_demo";

  // ---- Every seeded class teaches every global subject (uniform demo curriculum) — a class's
  // subject list is independent of teacher staffing, so this is seeded up front rather than
  // derived from the teacherAssignments loop below.
  classes.forEach((cls) => {
    subjects.forEach((subj) => {
      classSubjects.push({ id: uid("csub"), classId: cls.id, subject: subj.name });
    });
  });

  // Assign remaining teachers across classes/subjects for realism
  classes.forEach((cls, ci) => {
    subjects.forEach((subj, si) => {
      const teacher = teachers[(ci + si) % teachers.length];
      if (!teacherAssignments.some((ta) => ta.classId === cls.id && ta.subject === subj.name)) {
        teacherAssignments.push({ id: uid("ta"), teacherId: teacher.id, subject: subj.name, classId: cls.id });
        if (!cls.subjectTeacherIds.includes(teacher.id)) cls.subjectTeacherIds.push(teacher.id);
      }
    });
  });

  // ---- Timetable: a few periods per class across the week, derived from each class's actual subject/teacher assignments
  const timetableEntries = [];
  const periodLogs = [];
  classes.forEach((cls) => {
    const classTaughtSubjects = teacherAssignments.filter((ta) => ta.classId === cls.id).slice(0, 4);
    SCHOOL_DAYS.forEach((day, di) => {
      classTaughtSubjects.forEach((ta, pi) => {
        timetableEntries.push({
          id: uid("tt"), classId: cls.id, day, period: pi + 1, subject: ta.subject, teacherId: ta.teacherId,
        });
      });
    });
  });
  // Mark today's periods for Grade 3A as partly complete, for a realistic demo journal
  const todayName = todayDayName();
  if (todayName) {
    timetableEntries.filter((e) => e.classId === g3a.id && e.day === todayName).forEach((e, i) => {
      if (i === 0) periodLogs.push({ id: uid("plog"), timetableEntryId: e.id, date: todayKeyStr(), status: "done", completedBy: e.teacherId, completedAt: now - 3600000 });
    });
  }

  // Dead code as of the Parents Supabase conversion: `mockDb.students`/`mockDb.users` built below
  // are both fully superseded at read time (DataContext.jsx's `db` shadow always overlays real
  // `studentsRaw` and merges real parent profiles over any PARENT entries here — see
  // mergeParentsIntoUsers), so this mock parent/student/parentIds/childIds web is unreachable from
  // the running app. Left in place (not deleted) only because `demoParent.id` is still referenced
  // by this same seed's mock notifications/messages/conversations further down, which belong to
  // still-unconverted domains (Messages, Notifications, Homework, Results, Behavior) — deleting it
  // now would silently break those domains' demo data ahead of their own conversion pass.
  const parents = [];
  const demoParent = { id: "user_parent_demo", role: ROLES.PARENT, name: "Mohamed Hassan", email: "parent@tilmaan-demo.com", password: "Demo123!", phone: "+252 615 220 481", photo: null, childIds: [] };
  parents.push(demoParent);
  users.push(demoParent);
  for (let i = 0; i < 11; i++) {
    const name = `${pick(FIRST_NAMES, i + 5)} ${pick(LAST_NAMES, i + 3)}`;
    const p = { id: uid("user"), role: ROLES.PARENT, name, email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`, password: "Demo123!", phone: `+252 61${(2000000 + i * 5231).toString().slice(0, 7)}`, photo: null, childIds: [] };
    parents.push(p);
    users.push(p);
  }

  // ---- Students (7 per class = 42), student IDs sequential
  let studentSeq = 1;
  const idYear = new Date(firstAcademicYear.yearStart).getFullYear();
  const genStudentId = () => `TMA-${idYear}-${String(studentSeq++).padStart(5, "0")}`;
  let nameIdx = 0;
  classes.forEach((cls) => {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const first = pick(FIRST_NAMES, nameIdx);
      const last = pick(LAST_NAMES, nameIdx + 2);
      nameIdx++;
      const gender = nameIdx % 2 === 0 ? "Male" : "Female";
      const parent = parents[(nameIdx + classes.indexOf(cls)) % parents.length];
      const student = {
        id: uid("stu"),
        studentId: genStudentId(),
        firstName: first,
        middleName: pick(LAST_NAMES, nameIdx + 1),
        lastName: last,
        gender,
        dob: `20${16 - (classes.indexOf(cls) % 3)}-0${(nameIdx % 9) + 1}-1${nameIdx % 9}`,
        grade: cls.grade,
        section: cls.section,
        classId: cls.id,
        admissionDate: "2024-09-01",
        photo: null,
        status: "ACTIVE",
        suspension: null,
        emergencyContact: parent.phone,
        parentIds: [parent.id],
        usesBus: nameIdx % 3 === 0,
      };
      students.push(student);
      parent.childIds.push(student.id);
      enrollments.push({
        id: uid("enr"), studentId: student.id, academicYearId: firstAcademicYear.id,
        grade: student.grade, section: student.section, classId: student.classId,
        status: student.status, enrollmentDate: student.admissionDate, suspension: null,
        createdAt: now,
      });
    }
  });

  // Force demo parent's two named children per spec: Ahmed Hassan (Grade 3A), Aisha Hassan (Grade 1B)
  const ahmed = students.find((s) => s.grade === "Grade 3" && s.section === "A");
  ahmed.firstName = "Ahmed"; ahmed.middleName = "Abdi"; ahmed.lastName = "Hassan"; ahmed.gender = "Male"; ahmed.usesBus = true;
  if (!ahmed.parentIds.includes(demoParent.id)) { ahmed.parentIds = [demoParent.id]; }
  const aisha = students.find((s) => s.grade === "Grade 1" && s.section === "B");
  aisha.firstName = "Aisha"; aisha.middleName = "Abdi"; aisha.lastName = "Hassan"; aisha.gender = "Female";
  if (!aisha.parentIds.includes(demoParent.id)) { aisha.parentIds = [demoParent.id]; }
  demoParent.childIds = [ahmed.id, aisha.id];
  // remove ahmed/aisha from whichever other parent had them originally
  parents.forEach((p) => {
    if (p.id !== demoParent.id) p.childIds = p.childIds.filter((id) => id !== ahmed.id && id !== aisha.id);
  });
  // The random assignment loop above can also land another student on the demo parent by modulo
  // luck; overwriting demoParent.childIds just above would silently drop that student from their
  // childIds while their own parentIds still points at the demo parent — a phantom link where the
  // student's profile shows this parent but the parent's portal can't see them at all (no results,
  // no notifications, no fee reminders). Reconcile by moving any such student to a real parent on
  // both sides, keeping the demo account at exactly its two named children per spec.
  students.forEach((s) => {
    if (s.id === ahmed.id || s.id === aisha.id) return;
    if (!s.parentIds.includes(demoParent.id)) return;
    const fallback = parents.find((p) => p.id !== demoParent.id) || parents[1];
    s.parentIds = [fallback.id];
    fallback.childIds.push(s.id);
  });

  // ---- Attendance for today, mostly present
  // Local calendar-day key (matches todayKeyStr() everywhere else) — NOT toISOString(), which
  // rounds through UTC and can land on the wrong day for any timezone ahead of UTC.
  const todayKey = todayKeyStr();
  students.forEach((s, i) => {
    let status = "Present";
    if (i % 11 === 0) status = "Absent";
    else if (i % 13 === 0) status = "Late";
    attendance.push({ id: uid("att"), studentId: s.id, classId: s.classId, date: todayKey, status, note: "", markedBy: "user_teacher_demo", leaveRequestId: null });
  });
  // make sure ahmed present today, aisha present
  const ahmedAtt = attendance.find((a) => a.studentId === ahmed.id);
  if (ahmedAtt) ahmedAtt.status = "Present";

  // ---- Staff attendance for today, keyed by staff.id (covers directors, teachers, and non-login staff alike)
  const staffAttendance = [];
  staff.forEach((s) => {
    if (s.hasShifts) {
      // Demo the morning/afternoon shift model (e.g. a driver): came for the morning run, not
      // the afternoon one — exactly the "Present / Absent" pairing the profile page should surface.
      staffAttendance.push({ id: uid("tatt"), staffId: s.id, date: todayKey, period: "AM", status: "Present", arrivalTime: null, note: "", markedBy: finance.id, leaveRequestId: null });
      staffAttendance.push({ id: uid("tatt"), staffId: s.id, date: todayKey, period: "PM", status: "Absent", arrivalTime: null, note: "", markedBy: finance.id, leaveRequestId: null });
      return;
    }
    let status = "Present";
    let arrivalTime = null;
    if (s.position === "Teacher" && teachers[3] && s.userId === teachers[3].id) { status = "Late"; arrivalTime = "09:15"; }
    if (s.position === "Teacher" && teachers[1] && s.userId === teachers[1].id) { status = "Sick"; }
    staffAttendance.push({ id: uid("tatt"), staffId: s.id, date: todayKey, period: "FULL_DAY", status, arrivalTime, note: "", markedBy: "user_admin", leaveRequestId: null });
  });

  // ---- Substitute teacher demo: Ahmed Ali (absent, Sick) has a period today covered by Halima Abdi
  const substitutions = [];
  if (todayName) {
    const absentEntry = timetableEntries.find((e) => e.teacherId === teachers[1].id && e.day === todayName);
    if (absentEntry) {
      substitutions.push({ id: uid("sub"), timetableEntryId: absentEntry.id, date: todayKey, originalTeacherId: teachers[1].id, substituteTeacherId: teachers[4].id, assignedBy: "user_admin", createdAt: now - 1800000 });
    }
  }

  // ---- Fees & payments: catalog (feeTypes) → this year's pricing (feeSchedules) → concrete due
  // dates (feeInstallments) → what a specific student actually owes (studentFeeObligations,
  // frozen at materialization time, Decision A "future installments only" applied against each
  // student's admissionDate) → payments/paymentAllocations funding those obligations. See the
  // "Fee Ledger Schema" design doc (Blocker 2) for the full rationale — a fee type is a reusable
  // catalog entity, never duplicated per year; a schedule/installment/obligation is immutable
  // once created, corrected only via feeObligationAdjustments, never mutated in place.
  const feeTypes = [
    { id: uid("fee"), name: "School Fee", category: "TUITION", description: "Charged in 2.5-month cycles, four cycles per school year.", defaultUnitAmount: 5000, defaultUnitMonths: 2.5, defaultUnitsPerYear: 4, archivedAt: null, createdAt: now, updatedAt: now },
    { id: uid("fee"), name: "Bus Fee", category: "TRANSPORT", description: "Charged monthly for students using the school bus.", defaultUnitAmount: 1000, defaultUnitMonths: 1, defaultUnitsPerYear: 10, archivedAt: null, createdAt: now, updatedAt: now },
  ];
  const tuitionFeeType = feeTypes[0];
  const busFeeType = feeTypes[1];
  const paymentMethods = DEFAULT_PAYMENT_METHODS.map((name) => ({ id: uid("pm"), name, active: true }));

  const feeSchedules = [];
  const feeInstallments = [];
  const studentFeeObligations = [];
  const feeObligationAdjustments = [];
  const payments = [];
  const paymentAllocations = [];
  let receiptSeq = 1;
  const nextReceiptNo = () => String(receiptSeq++).padStart(4, "0");

  const yearStartDate = new Date(firstAcademicYear.yearStart + "T00:00:00");

  const tuitionSchedule = { id: uid("fsch"), feeTypeId: tuitionFeeType.id, academicYearId: firstAcademicYear.id, unitAmount: tuitionFeeType.defaultUnitAmount, unitMonths: tuitionFeeType.defaultUnitMonths, unitsPerYear: tuitionFeeType.defaultUnitsPerYear, createdAt: now, updatedAt: now, createdBy: owner.id };
  feeSchedules.push(tuitionSchedule);
  defaultInstallmentDates(yearStartDate).forEach((inst, i) => {
    feeInstallments.push({ id: uid("finst"), feeScheduleId: tuitionSchedule.id, sequenceIndex: i, label: inst.label, dueDate: inst.dueDate, amount: tuitionSchedule.unitAmount, createdAt: now, updatedAt: now });
  });

  const busSchedule = { id: uid("fsch"), feeTypeId: busFeeType.id, academicYearId: firstAcademicYear.id, unitAmount: busFeeType.defaultUnitAmount, unitMonths: busFeeType.defaultUnitMonths, unitsPerYear: busFeeType.defaultUnitsPerYear, createdAt: now, updatedAt: now, createdBy: owner.id };
  feeSchedules.push(busSchedule);
  // Bus installments are synthesized once here, at rollout time, using the same
  // start-of-year-plus-N-cycles arithmetic the app used to recompute on every read — bus stops
  // being derived math and becomes real stored rows, exactly like tuition's fixed quarters.
  for (let i = 0; i < busSchedule.unitsPerYear; i++) {
    const d0 = new Date(yearStartDate.getFullYear(), yearStartDate.getMonth() + Math.round(i * busSchedule.unitMonths), 1);
    const label = d0.toLocaleString("en-US", { month: "long", year: "numeric" });
    const dueDate = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-01`;
    feeInstallments.push({ id: uid("finst"), feeScheduleId: busSchedule.id, sequenceIndex: i, label, dueDate, amount: busSchedule.unitAmount, createdAt: now, updatedAt: now });
  }

  function installmentsForScheduleSeed(scheduleId) {
    return feeInstallments.filter((fi) => fi.feeScheduleId === scheduleId).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  }
  function obligationForSeed(studentId, feeInstallmentId) {
    return studentFeeObligations.find((o) => o.studentId === studentId && o.feeInstallmentId === feeInstallmentId);
  }

  // Materialize obligations for every student × applicable schedule, honoring Decision A (only
  // installments due on/after the student's admissionDate get an obligation row).
  students.forEach((s) => {
    installmentsForScheduleSeed(tuitionSchedule.id).forEach((fi) => {
      if (fi.dueDate < s.admissionDate) return;
      studentFeeObligations.push({ id: uid("obl"), studentId: s.id, feeInstallmentId: fi.id, amountDue: fi.amount, createdAt: now, createdReason: "YEAR_ROLLOUT" });
    });
    if (s.usesBus) {
      installmentsForScheduleSeed(busSchedule.id).forEach((fi) => {
        if (fi.dueDate < s.admissionDate) return;
        studentFeeObligations.push({ id: uid("obl"), studentId: s.id, feeInstallmentId: fi.id, amountDue: fi.amount, createdAt: now, createdReason: "YEAR_ROLLOUT" });
      });
    }
  });

  // Records a full-amount payment against a student's Nth installment of a given schedule, i.e.
  // one payments row + one paymentAllocations row, mirroring exactly what RecordPaymentModal
  // produces for a single-line receipt.
  function recordSeedPayment(student, schedule, sequenceIndex, method, createdAt) {
    const installment = installmentsForScheduleSeed(schedule.id)[sequenceIndex];
    if (!installment) return;
    const obligation = obligationForSeed(student.id, installment.id);
    if (!obligation) return; // Decision A excluded this cycle for this student
    const pm = paymentMethods.find((m) => m.name === method) || paymentMethods[0];
    const payment = { id: uid("pay"), receiptNo: nextReceiptNo(), paymentMethodId: pm.id, amountTotal: obligation.amountDue, date: todayKey, note: "", recordedBy: "user_admin", createdAt, status: "POSTED", voidedAt: null, voidedBy: null, voidReason: null };
    payments.push(payment);
    paymentAllocations.push({ id: uid("alloc"), paymentId: payment.id, obligationId: obligation.id, amount: obligation.amountDue, createdAt });
  }

  // Demo parent (Mohamed Hassan): Ahmed has paid one tuition cycle and one month of bus fee; Aisha hasn't paid yet.
  recordSeedPayment(ahmed, tuitionSchedule, 0, "Cash", now - 6 * 86400000);
  recordSeedPayment(ahmed, busSchedule, 0, "EVC Plus", now - 6 * 86400000);
  // A handful of other students across the school with a mix of paid/unpaid tuition, for realistic reporting.
  students.slice(0, 20).forEach((s, i) => {
    if (s.id === ahmed.id) return;
    if (i % 3 === 0) recordSeedPayment(s, tuitionSchedule, 0, paymentMethods[i % paymentMethods.length].name, now - (i + 1) * 86400000);
    if (s.usesBus && i % 4 === 0) recordSeedPayment(s, busSchedule, 0, "Cash", now - (i + 1) * 86400000);
  });

  // ---- Homework
  const tomorrow = new Date(now + 86400000).toISOString().slice(0, 10);
  homework.push({
    id: uid("hw"), subject: "English", grade: "Grade 3", section: "A", classId: g3a.id,
    title: "English Reading — Chapter 4", description: "Read pages 20–25 and answer questions 1–5.",
    dueDate: tomorrow, teacherId: "user_teacher_demo", attachment: null, createdAt: now - 3600000,
    academicYearId: firstAcademicYear.id,
  });
  homework.push({
    id: uid("hw"), subject: "English", grade: "Grade 3", section: "B", classId: g3b.id,
    title: "Vocabulary Practice — Unit 5", description: "Write each new word in a sentence.",
    dueDate: tomorrow, teacherId: "user_teacher_demo", attachment: null, createdAt: now - 7200000,
    academicYearId: firstAcademicYear.id,
  });
  const mathClass1A = classes.find((c) => c.grade === "Grade 1" && c.section === "A");
  const mathTeacher1A = teacherAssignments.find((ta) => ta.classId === mathClass1A.id && ta.subject === "Mathematics")?.teacherId;
  homework.push({
    id: uid("hw"), subject: "Mathematics", grade: "Grade 1", section: "A", classId: mathClass1A.id,
    title: "Addition & Subtraction Worksheet", description: "Complete worksheet pages 4-5.",
    dueDate: tomorrow, teacherId: mathTeacher1A, attachment: null, createdAt: now - 5400000,
    academicYearId: firstAcademicYear.id,
  });

  // ---- Results (Semester 1 / Semester 2, fixed-weight assessment components). The head teacher
  // records marks after the school administers the paper exam; no "exam" entity is created in-app —
  // examAnnouncements below is just the heads-up notice to parents/teachers.
  const examDate = new Date(now + 5 * 86400000).toISOString().slice(0, 10);

  function emptyComponent(max) { return { score: null, max, sharedWithParents: false, updatedAt: null, updatedBy: null }; }
  function logResultAudit({ entityId, studentId, classId, subject, semester, component, action, actorId, actorRole, actorName, diff, reason, at }) {
    resultAuditLog.push({ id: uid("aud"), entityType: "result", entityId, studentId, classId, subject, semester, component, action, actorId, actorRole, actorName, diff, reason: reason || null, at });
  }
  // Builds one semester's result record for a student+class+subject, only filling in whichever
  // components are given in `scores` (the rest stay null/"Incomplete") — and seeds a matching
  // COMPONENT_UPDATED audit entry per score, so Phase 2's audit UI has real history immediately.
  function seedSemesterResult({ studentId, classId, subject, semester, scores, actorId, actorRole, actorName, baseAt }) {
    const record = {
      id: uid("res"), studentId, classId, subject, semester, academicYearId: firstAcademicYear.id,
      components: Object.fromEntries(ASSESSMENT_COMPONENTS.map((c) => [c, emptyComponent(ASSESSMENT_COMPONENT_WEIGHT[c])])),
      publishStatus: "DRAFT", publishedAt: null, publishedBy: null, lockedAt: null, lockedBy: null,
      autoLockOverride: null,
      createdAt: baseAt, updatedAt: baseAt,
    };
    let i = 0;
    ASSESSMENT_COMPONENTS.forEach((c) => {
      if (scores[c] == null) return;
      const at = baseAt + i * 60000; i += 1;
      record.components[c] = { score: scores[c], max: ASSESSMENT_COMPONENT_WEIGHT[c], sharedWithParents: false, updatedAt: at, updatedBy: actorId };
      logResultAudit({ entityId: record.id, studentId, classId, subject, semester, component: c, action: "COMPONENT_UPDATED", actorId, actorRole, actorName, diff: [{ field: "score", from: null, to: scores[c] }], at });
      record.updatedAt = at;
    });
    results.push(record);
    return record;
  }
  function logLifecycleAudit(record, action, from, to, actorId, actorRole, actorName, at, reason) {
    logResultAudit({ entityId: record.id, studentId: record.studentId, classId: record.classId, subject: record.subject, semester: record.semester, component: null, action, actorId, actorRole, actorName, diff: [{ field: "publishStatus", from, to }], reason, at });
  }

  const englishTeacherId = "user_teacher_demo";
  const mathTeacherId = teacherAssignments.find((ta) => ta.classId === aisha.classId && ta.subject === "Mathematics")?.teacherId || admin.id;
  const mathTeacherName = teachers.find((t) => t.id === mathTeacherId)?.name || "A teacher";

  students.filter((s) => s.classId === g3a.id).forEach((s, i) => {
    const s1 = seedSemesterResult({
      studentId: s.id, classId: g3a.id, subject: "English", semester: "S1",
      scores: { midterm1: 14 + (i % 6), midterm2: 15 + (i % 5), studentBook: 7 + (i % 3), finalExam: 38 + (i % 12) },
      actorId: englishTeacherId, actorRole: ROLES.TEACHER, actorName: "Amina Hassan", baseAt: now - 20 * 86400000,
    });
    seedSemesterResult({
      studentId: s.id, classId: g3a.id, subject: "English", semester: "S2",
      scores: { midterm1: 13 + (i % 7), studentBook: 8 + (i % 2) }, // Semester 2 deliberately left Incomplete for the demo
      actorId: englishTeacherId, actorRole: ROLES.TEACHER, actorName: "Amina Hassan", baseAt: now - 3 * 86400000,
    });

    if (s.id === ahmed.id) {
      // Publish Ahmed's Semester 1 English result, and demonstrate a corrected mark: the
      // Educational Director fixes a transcription error on the final exam (old value preserved
      // in the audit diff, never silently overwritten).
      const originalFinal = s1.components.finalExam.score;
      s1.components.finalExam.score = originalFinal + 2;
      s1.components.finalExam.updatedAt = now - 17 * 86400000;
      s1.components.finalExam.updatedBy = admin.id;
      logResultAudit({
        entityId: s1.id, studentId: s.id, classId: g3a.id, subject: "English", semester: "S1", component: "finalExam",
        action: "COMPONENT_UPDATED", actorId: admin.id, actorRole: ROLES.ADMIN, actorName: admin.name,
        diff: [{ field: "score", from: originalFinal, to: s1.components.finalExam.score }],
        reason: "Corrected transcription error from the paper exam.", at: now - 17 * 86400000,
      });
      s1.publishStatus = "PUBLISHED"; s1.publishedAt = now - 16 * 86400000; s1.publishedBy = admin.id;
      logLifecycleAudit(s1, "PUBLISHED", "DRAFT", "PUBLISHED", admin.id, ROLES.ADMIN, admin.name, s1.publishedAt, null);
    } else if (i === 1) {
      // Publish then lock the second student's Semester 1 English result, so Phase 1's UI has a
      // real locked example (locked blocks everyone, including Owner/Director, until unlocked).
      s1.publishStatus = "PUBLISHED"; s1.publishedAt = now - 15 * 86400000; s1.publishedBy = admin.id;
      logLifecycleAudit(s1, "PUBLISHED", "DRAFT", "PUBLISHED", admin.id, ROLES.ADMIN, admin.name, s1.publishedAt, null);
      s1.publishStatus = "LOCKED"; s1.lockedAt = now - 10 * 86400000; s1.lockedBy = admin.id;
      logLifecycleAudit(s1, "LOCKED", "PUBLISHED", "LOCKED", admin.id, ROLES.ADMIN, admin.name, s1.lockedAt, null);
    } else if (i === 2) {
      // Demonstrate Owner-authored masking: the Owner corrects a Student Book score directly —
      // teachers/parents should see this as "School Administration", never the Owner's real name.
      const before = s1.components.studentBook.score;
      const after = Math.min(ASSESSMENT_COMPONENT_WEIGHT.studentBook, before + 1);
      s1.components.studentBook.score = after;
      s1.components.studentBook.updatedAt = now - 12 * 86400000;
      s1.components.studentBook.updatedBy = owner.id;
      logResultAudit({
        entityId: s1.id, studentId: s.id, classId: g3a.id, subject: "English", semester: "S1", component: "studentBook",
        action: "COMPONENT_UPDATED", actorId: owner.id, actorRole: ROLES.OWNER, actorName: owner.name,
        diff: [{ field: "score", from: before, to: after }], reason: null, at: now - 12 * 86400000,
      });
    }
  });

  students.filter((s) => s.classId === aisha.classId).forEach((s, i) => {
    const s1 = seedSemesterResult({
      studentId: s.id, classId: aisha.classId, subject: "Mathematics", semester: "S1",
      scores: { midterm1: 15 + (i % 5), midterm2: 14 + (i % 6), studentBook: 8 + (i % 2), finalExam: 40 + (i % 10) },
      actorId: mathTeacherId, actorRole: ROLES.TEACHER, actorName: mathTeacherName, baseAt: now - 20 * 86400000,
    });
    seedSemesterResult({
      studentId: s.id, classId: aisha.classId, subject: "Mathematics", semester: "S2",
      scores: { midterm1: 16 + (i % 4) }, // Incomplete on purpose — Semester 2 is still in progress
      actorId: mathTeacherId, actorRole: ROLES.TEACHER, actorName: mathTeacherName, baseAt: now - 3 * 86400000,
    });
    if (s.id === aisha.id) {
      s1.publishStatus = "PUBLISHED"; s1.publishedAt = now - 16 * 86400000; s1.publishedBy = admin.id;
      logLifecycleAudit(s1, "PUBLISHED", "DRAFT", "PUBLISHED", admin.id, ROLES.ADMIN, admin.name, s1.publishedAt, null);
    }
  });

  // ---- Exam announcement (admin's job: just announce that a paper exam is coming; the head teacher enters marks afterward — no exam entity is created in-app)
  examAnnouncements.push({
    id: uid("examann"), title: "Midterm Exams", message: "Midterm exams begin next week. Please make sure your child reviews all subjects.",
    audience: { type: "GRADE", grade: "Grade 3" }, priority: "Important", examDate, authorId: "user_admin", createdAt: now - 86400000,
  });
  notifications.push({ id: uid("notif"), userId: demoParent.id, title: "Upcoming exam: Midterm Exams", message: `Midterm exams begin next week. Please make sure your child reviews all subjects. (${fmtDate(examDate)})`, read: false, createdAt: now - 86400000, type: "EXAM" });
  notifications.push({ id: uid("notif"), userId: "user_teacher_demo", title: "Exam announced: Midterm Exams", message: `Midterm Exams was announced for your class on ${fmtDate(examDate)}. Please enter results once it's complete.`, read: false, createdAt: now - 86400000, type: "EXAM" });

  // ---- Behavior
  behaviorRecords.push({
    id: uid("beh"), studentId: ahmed.id, date: new Date(now - 86400000).toISOString().slice(0, 10), type: "Positive", severity: "Low",
    description: "Helped a classmate finish the reading assignment and volunteered to read aloud.",
    staff: "Amina Hassan", action: "Praised in class", parentNotified: true, createdAt: now - 86400000,
  });

  // ---- Announcements
  announcements.push({
    id: uid("ann"), title: "Term 1 Parent-Teacher Meetings", message: "Parent-teacher meetings will be held on 28 August 2026. Please book a slot with your child's teacher.",
    audience: { type: "ALL" }, priority: "Important", authorId: "user_admin", createdAt: now - 2 * 86400000, attachment: null,
  });
  announcements.push({
    id: uid("ann"), title: "Grade 3 Field Trip Permission Slip", message: "Grade 3 students are invited to a science museum trip on 30 August 2026. Please return signed permission slips by Friday.",
    audience: { type: "GRADE", grade: "Grade 3" }, priority: "Normal", authorId: "user_admin", createdAt: now - 5 * 3600000, attachment: null,
  });

  // ---- Messages: seed one conversation between demo parent and demo teacher
  const convId = uid("conv");
  conversations.push({ id: convId, participantIds: [demoParent.id, "user_teacher_demo"] });
  messages.push({ id: uid("msg"), conversationId: convId, senderId: demoParent.id, text: "Good afternoon, how is Ahmed doing with his reading this week?", createdAt: now - 3 * 3600000, read: true });
  messages.push({ id: uid("msg"), conversationId: convId, senderId: "user_teacher_demo", text: "Good afternoon Mr. Hassan — he is doing very well, quite confident reading aloud now.", createdAt: now - 2.5 * 3600000, read: true });

  // ---- Activities
  activities.push({ id: uid("act"), text: "Amina Hassan added English homework for Grade 3A.", createdAt: now - 3600000 });
  activities.push({ id: uid("act"), text: "English Semester 1 results were published for Grade 3A.", createdAt: now - 86400000 });
  activities.push({ id: uid("act"), text: "Term 1 Parent-Teacher Meetings announcement was published.", createdAt: now - 2 * 86400000 });
  activities.push({ id: uid("act"), text: `${finance.name} recorded an expense: 3 items (${formatMoney(officeSuppliesItems.reduce((s, it) => s + it.lineTotal, 0))}).`, createdAt: now - 3 * 86400000 });
  activities.push({ id: uid("act"), text: `${finance.name} paid this month's salaries.`, createdAt: now - 2 * 86400000 });

  // ---- Notifications: give demo parent a homework + behavior notification, demo teacher a message notification
  notifications.push({ id: uid("notif"), userId: demoParent.id, title: "New English homework", message: "English Reading — Chapter 4 was assigned to Grade 3A.", read: false, createdAt: now - 3600000, type: "HOMEWORK" });
  notifications.push({ id: uid("notif"), userId: demoParent.id, title: "Behavior note for Ahmed Hassan", message: "Positive note: helped a classmate with reading.", read: false, createdAt: now - 86400000, type: "BEHAVIOR" });
  notifications.push({ id: uid("notif"), userId: "user_teacher_demo", title: "New message from Mohamed Hassan", message: "Good afternoon, how is Ahmed doing with his reading this week?", read: true, createdAt: now - 3 * 3600000, type: "MESSAGE" });
  // One batched notification per publish action (matches DataContext.publishResults), not one per mark.
  notifications.push({ id: uid("notif"), userId: demoParent.id, title: "Results published — English", message: `${ahmed.firstName}'s English results for Semester 1 are ready to view.`, read: false, createdAt: now - 16 * 86400000, type: "RESULT" });
  notifications.push({ id: uid("notif"), userId: demoParent.id, title: "Results published — Mathematics", message: `${aisha.firstName}'s Mathematics results for Semester 1 are ready to view.`, read: false, createdAt: now - 16 * 86400000, type: "RESULT" });

  return {
    version: 1, updatedAt: now,
    users, students, classes, subjects, classSubjects, teacherAssignments, homework, attendance, staffAttendance, results, resultAuditLog, resultEvidence, examAnnouncements,
    behaviorRecords, announcements, notifications, conversations, messages, activities,
    feeTypes, feeSchedules, feeInstallments, studentFeeObligations, feeObligationAdjustments,
    paymentMethods, payments, paymentAllocations, paymentAuditLog, timetableEntries, periodLogs, substitutions,
    timetableConfig: { ...DEFAULT_TIMETABLE_CONFIG, updatedAt: now, updatedBy: null },
    academicYears: [firstAcademicYear],
    academicCalendar: firstAcademicYear,
    enrollments, studentDocuments,
    studentSeq, receiptSeq, staff, payrollPayments, expenses, expenseSeq, reportCards, leaveRequests: [], schoolClosures: [], ownerLeaveLog: [],
    staffSeq, salaryAdvances, advanceSeq: 1,
  };
}

/* ============================== STORAGE / SYNC ============================== */

// Phase 1 persistence: plain browser localStorage, scoped to this browser only.
// (The original prototype called a Claude.ai-Artifacts-only `window.storage`
// API that does not exist in a real deployed site - this is the real-world
// equivalent, kept behind the same loadDB/saveDB signature so nothing else
// in the app has to change.) Phase 2 will swap this file's internals for
// Supabase reads/writes + Realtime without touching any component.
async function loadDB() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* not found yet, or storage unavailable */ }
  return null;
}
async function saveDB(db) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) { console.error("storage save failed", e); }
}
// Backfills any fields/collections added in later versions of the app so data saved by an
// earlier session (which won't have them) doesn't crash the app with "Cannot read properties
// of undefined" when a newer component reads them.
function migrateDB(db) {
  if (!db) return db;

  // ---- Academic Calendar & academic-year normalization runs first — the feeTypes migration
  // just below anchors its default installment dates to db.academicCalendar.yearStart, so the
  // calendar must already be valid by the time that runs.
  if (!db.academicCalendar || typeof db.academicCalendar !== "object") {
    db.academicCalendar = defaultAcademicCalendar();
  } else {
    const fallback = defaultAcademicCalendar();
    const dateFields = ["yearStart", "yearEnd", "sem1Start", "sem1End", "sem2Start", "sem2End"];
    dateFields.forEach((f) => {
      if (typeof db.academicCalendar[f] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(db.academicCalendar[f])) {
        db.academicCalendar[f] = fallback[f];
      }
    });
    if (!Number.isFinite(db.academicCalendar.breakDays) || db.academicCalendar.breakDays < 0) db.academicCalendar.breakDays = fallback.breakDays;
    if (!Number.isFinite(db.academicCalendar.resultFinalizationGraceDays) || db.academicCalendar.resultFinalizationGraceDays < 0) db.academicCalendar.resultFinalizationGraceDays = fallback.resultFinalizationGraceDays;
    if (typeof db.academicCalendar.yearName !== "string" || !db.academicCalendar.yearName) db.academicCalendar.yearName = fallback.yearName;
  }

  // ---- Academic Year becomes a real, id'd, multi-year entity (not just the one global calendar
  // object it used to be) — needed so students/attendance/homework/results/documents can stay
  // associated with the correct year once a school creates a second one. `db.academicCalendar`
  // is kept in sync as a convenience pointer to whichever year is current, so every existing
  // call site that reads it (attendance-date rules, the calendar settings modal) keeps working
  // unchanged.
  if (!Array.isArray(db.academicYears) || db.academicYears.length === 0) {
    if (!db.academicCalendar.id) db.academicCalendar.id = uid("ayear");
    if (!db.academicCalendar.gcLabel) db.academicCalendar.gcLabel = db.academicCalendar.yearName;
    if (!db.academicCalendar.ecLabel) db.academicCalendar.ecLabel = ecYearLabelForGcStart(new Date(db.academicCalendar.yearStart));
    db.academicCalendar.isCurrent = true;
    db.academicYears = [db.academicCalendar];
  } else {
    db.academicYears.forEach((y) => {
      if (!y.id) y.id = uid("ayear");
      if (!y.gcLabel) y.gcLabel = y.yearName;
      if (!y.ecLabel) y.ecLabel = ecYearLabelForGcStart(new Date(y.yearStart));
      if (!Number.isFinite(y.resultFinalizationGraceDays) || y.resultFinalizationGraceDays < 0) y.resultFinalizationGraceDays = DEFAULT_RESULT_FINALIZATION_GRACE_DAYS;
    });
    if (!db.academicYears.some((y) => y.isCurrent)) {
      const latest = [...db.academicYears].sort((a, b) => (b.yearStart || "").localeCompare(a.yearStart || ""))[0];
      if (latest) latest.isCurrent = true;
    }
    db.academicCalendar = currentAcademicYear(db.academicYears);
  }

  if (!Array.isArray(db.paymentMethods) || db.paymentMethods.length === 0) {
    db.paymentMethods = DEFAULT_PAYMENT_METHODS.map((name) => ({ id: uid("pm"), name, active: true }));
  } else if (typeof db.paymentMethods[0] === "string") {
    // Payment methods used to be a flat list of names — upgrade to {id, name, active} so they can
    // be individually renamed/deactivated (spec: configurable payment methods) without touching
    // the payment records that already store the method by name.
    db.paymentMethods = db.paymentMethods.map((name) => ({ id: uid("pm"), name, active: true }));
  }

  // ---- Blocker 2: fee/payment academic-year schema. feeTypes/payments used to be flat and
  // global (no year scoping at all); this backfill runs once and converts an old install's
  // flat shape into the new catalog → schedule → installment → obligation → payment/allocation
  // model, gated the same way every other one-time backfill in this function is (array-existence
  // check). A truly fresh install never reaches this block — buildSeed() already produces the
  // new shape directly.
  if (!Array.isArray(db.feeSchedules)) {
    const currentYear = currentAcademicYear(db.academicYears) || db.academicYears[0];
    const yearStart = activeYearStartDate(db.academicYears);
    const oldFeeTypes = Array.isArray(db.feeTypes) && db.feeTypes.length > 0 ? db.feeTypes : [
      { id: uid("fee"), name: "School Fee", category: "TUITION", unitMonths: 2.5, unitAmount: 5000, unitsPerYear: 4, description: "Charged in 2.5-month cycles, four cycles per school year.", installments: defaultInstallmentDates(yearStart) },
      { id: uid("fee"), name: "Bus Fee", category: "TRANSPORT", unitMonths: 1, unitAmount: 1000, unitsPerYear: 10, description: "Charged monthly for students using the school bus." },
    ];
    // Exact installment due dates + name/label relabeling — same backfill this block always did,
    // applied to the OLD shape before it's converted below.
    oldFeeTypes.forEach((ft) => {
      if (ft.category === "TUITION" && !Array.isArray(ft.installments)) ft.installments = defaultInstallmentDates(yearStart);
      if (ft.category === "TUITION" && ft.name === "Tuition Fee") ft.name = "School Fee";
      if (ft.category === "TUITION" && Array.isArray(ft.installments)) {
        ft.installments.forEach((inst, i) => { if (inst.label === `Installment ${i + 1}`) inst.label = `Quarter ${i + 1}`; });
      }
    });

    db.feeSchedules = [];
    db.feeInstallments = [];
    db.studentFeeObligations = [];
    db.feeObligationAdjustments = [];
    db.paymentAllocations = [];

    const oldInstallmentIdMap = {}; // old feeTypes[].installments[].id -> new feeInstallments row
    oldFeeTypes.forEach((oft) => {
      const schedule = { id: uid("fsch"), feeTypeId: oft.id, academicYearId: currentYear.id, unitAmount: oft.unitAmount, unitMonths: oft.unitMonths, unitsPerYear: oft.unitsPerYear, createdAt: Date.now(), updatedAt: Date.now(), createdBy: null };
      db.feeSchedules.push(schedule);
      if (oft.category === "TUITION" && Array.isArray(oft.installments) && oft.installments.length > 0) {
        oft.installments.forEach((oldInst, i) => {
          const newInst = { id: uid("finst"), feeScheduleId: schedule.id, sequenceIndex: i, label: oldInst.label, dueDate: oldInst.dueDate, amount: schedule.unitAmount, createdAt: Date.now(), updatedAt: Date.now() };
          db.feeInstallments.push(newInst);
          oldInstallmentIdMap[oldInst.id] = newInst;
        });
      } else {
        // Synthesize cycles (bus, or any non-tuition type with no stored installments) using the
        // exact same start-of-year-plus-N-cycles arithmetic the app used to recompute on every read.
        for (let i = 0; i < (oft.unitsPerYear || 1); i++) {
          const d0 = new Date(yearStart.getFullYear(), yearStart.getMonth() + Math.round(i * (oft.unitMonths || 1)), 1);
          const label = oft.category === "TRANSPORT" ? d0.toLocaleString("en-US", { month: "long", year: "numeric" }) : `Cycle ${i + 1}`;
          const dueDate = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-01`;
          db.feeInstallments.push({ id: uid("finst"), feeScheduleId: schedule.id, sequenceIndex: i, label, dueDate, amount: schedule.unitAmount, createdAt: Date.now(), updatedAt: Date.now() });
        }
      }
    });

    const installmentsBySchedule = (scheduleId) => db.feeInstallments.filter((fi) => fi.feeScheduleId === scheduleId).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    const obligationFor = (studentId, feeInstallmentId) => db.studentFeeObligations.find((o) => o.studentId === studentId && o.feeInstallmentId === feeInstallmentId);
    const materializeObligation = (student, installment, reason) => {
      const existing = obligationFor(student.id, installment.id);
      if (existing) return existing;
      const ob = { id: uid("obl"), studentId: student.id, feeInstallmentId: installment.id, amountDue: installment.amount, createdAt: Date.now(), createdReason: reason };
      db.studentFeeObligations.push(ob);
      return ob;
    };

    (db.students || []).filter((s) => !["WITHDRAWN", "TRANSFERRED", "GRADUATED", "ARCHIVED"].includes(s.status)).forEach((s) => {
      db.feeSchedules.forEach((schedule) => {
        const oft = oldFeeTypes.find((f) => f.id === schedule.feeTypeId);
        if (!oft || (oft.category === "TRANSPORT" && !s.usesBus)) return;
        installmentsBySchedule(schedule.id).forEach((fi) => {
          if (fi.dueDate < (s.admissionDate || "0000-00-00")) return; // Decision A
          materializeObligation(s, fi, "YEAR_ROLLOUT");
        });
      });
    });

    // ---- Convert old flat payments[] into new payments[] + paymentAllocations[]. A batch used
    // to share one receiptNo/batchId; a payments row already IS the batch now, so each old group
    // collapses into one new row — except a group with a mix of POSTED/VOIDED old lines, which
    // can no longer be represented by a single row (void is whole-receipt going forward), so any
    // VOIDED line is split into its own single-line receipt, preserving its original void metadata.
    const oldPayments = Array.isArray(db.payments) ? db.payments : [];
    const groups = new Map();
    oldPayments.forEach((p) => {
      const key = p.batchId || p.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });

    // Reconstructs which cycle a no-installmentId (bus) payment originally covered — the exact
    // same order-based logic describePaymentAgainst used to run at read time, now run once here.
    const priorUnitsByStudentFeeType = {};
    const cycleIndexForOldPayment = {};
    [...oldPayments].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((p) => {
      const key = `${p.studentId}|${p.feeTypeId}`;
      const prior = priorUnitsByStudentFeeType[key] || 0;
      cycleIndexForOldPayment[p.id] = Math.floor(prior);
      if (p.status !== "VOIDED") priorUnitsByStudentFeeType[key] = prior + (p.units || 0);
    });

    db.payments = [];
    let nextSyntheticReceiptNo = typeof db.receiptSeq === "number" ? db.receiptSeq : 1;
    function pushMigratedPayment(paymentLines, receiptNo, statusOverride) {
      if (paymentLines.length === 0) return;
      const first = paymentLines[0];
      const pm = db.paymentMethods.find((m) => m.name === first.method) || db.paymentMethods[0];
      const payment = {
        id: uid("pay"), receiptNo, paymentMethodId: pm ? pm.id : null, amountTotal: 0,
        date: first.date, note: first.note || "", recordedBy: first.recordedBy, createdAt: first.createdAt || Date.now(),
        status: statusOverride || "POSTED",
        voidedAt: statusOverride === "VOIDED" ? (first.voidedAt || null) : null,
        voidedBy: statusOverride === "VOIDED" ? (first.voidedBy || null) : null,
        voidReason: statusOverride === "VOIDED" ? (first.voidReason || null) : null,
      };
      db.payments.push(payment);
      paymentLines.forEach((line) => {
        const schedule = db.feeSchedules.find((s) => s.feeTypeId === line.feeTypeId);
        const student = (db.students || []).find((s) => s.id === line.studentId);
        if (!schedule || !student) return;
        let installment = line.installmentId && oldInstallmentIdMap[line.installmentId] ? oldInstallmentIdMap[line.installmentId] : null;
        if (!installment) {
          const rows = installmentsBySchedule(schedule.id);
          installment = rows[cycleIndexForOldPayment[line.id] || 0] || rows[rows.length - 1];
        }
        if (!installment) return;
        // Every historical payment must keep funding something, even one that predates what
        // Decision A would have granted (e.g. an admissionDate corrected after the fact) — this
        // on-the-fly materialization is the one sanctioned exception to the three createdReason
        // triggers (YEAR_ROLLOUT/ENROLLMENT/BUS_OPT_IN).
        const obligation = obligationFor(line.studentId, installment.id) || materializeObligation(student, installment, "YEAR_ROLLOUT");
        db.paymentAllocations.push({ id: uid("alloc"), paymentId: payment.id, obligationId: obligation.id, amount: line.amount, createdAt: payment.createdAt });
        payment.amountTotal += line.amount;
      });
    }
    groups.forEach((lines) => {
      const posted = lines.filter((l) => l.status !== "VOIDED");
      const voided = lines.filter((l) => l.status === "VOIDED");
      pushMigratedPayment(posted, lines[0].receiptNo || String(nextSyntheticReceiptNo++).padStart(4, "0"), "POSTED");
      voided.forEach((v) => pushMigratedPayment([v], v.receiptNo || String(nextSyntheticReceiptNo++).padStart(4, "0"), "VOIDED"));
    });
    db.receiptSeq = nextSyntheticReceiptNo;

    // ---- Catalog cutover: feeTypes loses per-year pricing fields, gains default* template
    // fields (prefill only, never read by balance logic) + archivedAt.
    db.feeTypes = oldFeeTypes.map((oft) => ({
      id: oft.id, name: oft.name, category: oft.category, description: oft.description || "",
      defaultUnitAmount: oft.unitAmount, defaultUnitMonths: oft.unitMonths, defaultUnitsPerYear: oft.unitsPerYear,
      archivedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    }));
  }
  if (!Array.isArray(db.payments)) db.payments = [];
  db.payments.forEach((p) => {
    // Blocker 4 (void policy): every payment recorded before this existed is a real, uncorrected
    // receipt — it defaults to POSTED, not VOIDED, so historical balances don't change under it.
    if (p.status === undefined) p.status = "POSTED";
    if (p.voidedAt === undefined) p.voidedAt = null;
    if (p.voidedBy === undefined) p.voidedBy = null;
    if (p.voidReason === undefined) p.voidReason = null;
    if (p.amountTotal === undefined) p.amountTotal = 0;
  });
  if (!Array.isArray(db.paymentAllocations)) db.paymentAllocations = [];
  if (!Array.isArray(db.feeObligationAdjustments)) db.feeObligationAdjustments = [];
  if (!Array.isArray(db.paymentAuditLog)) db.paymentAuditLog = [];
  if (!Array.isArray(db.examAnnouncements)) db.examAnnouncements = [];
  // Results model rewrite: Student → Subject → Semester → Assessment Component → Score, replacing
  // the old flat bookmark/midterm/final shape. Clean cutover, not a field migration (per product
  // decision) — existing local demo results/report-card history is retired, not carried forward.
  if (!Array.isArray(db.results)) { db.results = []; delete db.subjectResults; }
  if (!Array.isArray(db.resultAuditLog)) db.resultAuditLog = [];
  // Multi-page exam evidence: each component's single `image` (a data-URL) moves into its own row
  // in the new flat `db.resultEvidence` array (mirrors `db.studentDocuments`'s shape/pattern) so a
  // result can carry any number of evidence pages instead of exactly one. Runs once per record —
  // the `already` dedupe check makes this idempotent across repeated app loads. `autoLockOverride`
  // (semester-aware locking's "unlocked past the calendar's auto-lock, with a reason" flag) is
  // backfilled here too since it lives on the same result record.
  if (!Array.isArray(db.resultEvidence)) db.resultEvidence = [];
  db.results.forEach((r) => {
    if (r.autoLockOverride === undefined) r.autoLockOverride = null;
    ASSESSMENT_COMPONENTS.forEach((c) => {
      const comp = r.components && r.components[c];
      if (!comp) return;
      if (typeof comp.image === "string" && comp.image) {
        const already = db.resultEvidence.some((e) => e.resultId === r.id && e.component === c);
        if (!already) {
          db.resultEvidence.push({
            id: uid("reve"), resultId: r.id, studentId: r.studentId, classId: r.classId,
            semester: r.semester, component: c, academicYearId: r.academicYearId,
            order: 0, fileDataUrl: comp.image, fileType: inferFileType(comp.image), fileName: null,
            uploadedBy: comp.updatedBy || null, uploadedAt: comp.updatedAt || r.updatedAt || Date.now(),
          });
        }
      }
      delete comp.image;
    });
  });
  if (!Array.isArray(db.timetableEntries)) db.timetableEntries = [];
  if (!Array.isArray(db.periodLogs)) db.periodLogs = [];
  if (!Array.isArray(db.substitutions)) db.substitutions = [];
  if (!db.timetableConfig || typeof db.timetableConfig !== "object") {
    db.timetableConfig = { ...DEFAULT_TIMETABLE_CONFIG, updatedAt: Date.now(), updatedBy: null };
  } else {
    if (!Number.isFinite(db.timetableConfig.periodsCount) || db.timetableConfig.periodsCount < 1) db.timetableConfig.periodsCount = DEFAULT_TIMETABLE_CONFIG.periodsCount;
    if (typeof db.timetableConfig.startTime !== "string" || !/^\d{2}:\d{2}$/.test(db.timetableConfig.startTime)) db.timetableConfig.startTime = DEFAULT_TIMETABLE_CONFIG.startTime;
    if (!Number.isFinite(db.timetableConfig.periodDurationMins) || db.timetableConfig.periodDurationMins < 1) db.timetableConfig.periodDurationMins = DEFAULT_TIMETABLE_CONFIG.periodDurationMins;
    if (!Number.isFinite(db.timetableConfig.breakDurationMins) || db.timetableConfig.breakDurationMins < 0) db.timetableConfig.breakDurationMins = DEFAULT_TIMETABLE_CONFIG.breakDurationMins;
    if (db.timetableConfig.breakAfterPeriod != null && (!Number.isFinite(db.timetableConfig.breakAfterPeriod) || db.timetableConfig.breakAfterPeriod < 1)) db.timetableConfig.breakAfterPeriod = DEFAULT_TIMETABLE_CONFIG.breakAfterPeriod;
  }
  if (Array.isArray(db.students)) db.students.forEach((s) => { if (typeof s.usesBus !== "boolean") s.usesBus = false; });
  if (Array.isArray(db.users)) db.users.forEach((u) => { if (u.role === ROLES.TEACHER && typeof u.mustChangePassword !== "boolean") u.mustChangePassword = false; });
  if (!Array.isArray(db.subjects)) db.subjects = [];
  // Class Subjects: a class's curriculum used to be implicit (whatever subjects already had a
  // teacher assigned there). Backfilling from existing teacherAssignments on first migration
  // preserves every existing installation's current subject list exactly as it was, instead of
  // suddenly showing zero subjects for every class.
  if (!Array.isArray(db.classSubjects)) {
    db.classSubjects = [];
    const seenClassSubject = new Set();
    (db.teacherAssignments || []).forEach((ta) => {
      const key = `${ta.classId}|${ta.subject}`;
      if (seenClassSubject.has(key)) return;
      seenClassSubject.add(key);
      db.classSubjects.push({ id: uid("csub"), classId: ta.classId, subject: ta.subject });
    });
  }
  if (!Array.isArray(db.classes)) db.classes = [];
  db.classes.forEach((c) => { if (!Array.isArray(c.subjectTeacherIds)) c.subjectTeacherIds = []; if (c.headTeacherId === undefined) c.headTeacherId = null; });

  // ---- Phase 1A: Owner/Finance roles, account status, staff/payroll/expenses, report cards
  if (Array.isArray(db.users)) {
    db.users.forEach((u) => {
      if (u.role === ROLES.TEACHER && u.status === "INACTIVE") u.status = "DISABLED";
      if (typeof u.status !== "string") u.status = "ACTIVE";
    });
    if (!db.users.some((u) => u.role === ROLES.OWNER)) {
      db.users.push({ id: "user_owner_demo", role: ROLES.OWNER, name: "Abdirahman Ali", email: "owner@tilmaan-demo.com", password: "Demo123!", status: "ACTIVE", photo: null });
    }
    if (!db.users.some((u) => u.role === ROLES.FINANCE)) {
      db.users.push({ id: "user_finance_demo", role: ROLES.FINANCE, name: "Mohamed Ali", email: "finance@tilmaan-demo.com", password: "Demo123!", status: "ACTIVE", photo: null });
    }
    // Backfill firstName/middleName/lastName for teachers saved before the multi-subject/class
    // rework, so their full name keeps rendering correctly and they remain editable in the new form.
    db.users.forEach((u) => {
      if (u.role === ROLES.TEACHER && !u.firstName && !u.lastName) {
        const parts = (u.name || "").trim().split(/\s+/).filter(Boolean);
        u.firstName = parts[0] || "";
        u.lastName = parts.length > 1 ? parts[parts.length - 1] : "";
        u.middleName = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
      }
    });
  }
  if (!Array.isArray(db.staff)) {
    // Backfill one staff/payroll record per existing login account that should be paid (director, finance, teachers),
    // so payroll works immediately for schools that were already using the app before this feature existed.
    db.staff = (db.users || [])
      .filter((u) => u.role === ROLES.ADMIN || u.role === ROLES.FINANCE || u.role === ROLES.TEACHER)
      .map((u) => ({
        id: uid("staff"), userId: u.id, name: u.name,
        position: u.role === ROLES.ADMIN ? "Educational Director" : u.role === ROLES.FINANCE ? "Finance Director" : "Teacher",
        employmentDate: "2024-09-01", phone: u.phone || null, salary: u.role === ROLES.TEACHER ? 8000 : 12000,
        paymentSchedule: "MONTHLY", status: "ACTIVE", employmentStatus: "ACTIVE", employmentEndDate: null, photo: null, hasShifts: false,
      }));
  }
  if (Array.isArray(db.staff)) db.staff.forEach((s) => { if (typeof s.hasShifts !== "boolean") s.hasShifts = s.position === "Driver"; });
  // Bank account (optional, completable later) and a system-assigned employee number — neither
  // existed before payroll gained advance/allowance tracking. staffSeq is gap-safe sequential
  // numbering, same pattern as expenseSeq below.
  if (typeof db.staffSeq !== "number") db.staffSeq = 1;
  if (Array.isArray(db.staff)) {
    db.staff.forEach((s) => {
      if (s.bankAccount === undefined) s.bankAccount = null;
      if (!s.employeeNumber) { s.employeeNumber = `TMA-EMP-${String(db.staffSeq).padStart(4, "0")}`; db.staffSeq += 1; }
      // Employment status/end-date didn't exist before Blocker 3 — everyone pre-existing is
      // assumed still employed (ACTIVE, no end date). A DISABLED account status pre-migration was
      // a login toggle only, never an employment signal, so it's deliberately not read here.
      if (s.employmentStatus === undefined) s.employmentStatus = "ACTIVE";
      if (s.employmentEndDate === undefined) s.employmentEndDate = null;
    });
  }
  if (!Array.isArray(db.salaryAdvances)) db.salaryAdvances = [];
  if (typeof db.advanceSeq !== "number") db.advanceSeq = 1;
  // Blocker 5A: payrollMonth wasn't tracked before — backfill from each advance's own recorded
  // date rather than "now", so historical advances keep the period they actually belonged to.
  db.salaryAdvances.forEach((a) => { if (a.payrollMonth === undefined) a.payrollMonth = (a.date || "").slice(0, 7) || null; });
  if (!Array.isArray(db.payrollPayments)) db.payrollPayments = [];
  db.payrollPayments.forEach((p) => {
    if (p.allowances === undefined) p.allowances = 0;
    if (p.deductions === undefined) p.deductions = 0;
    if (p.advanceApplied === undefined) p.advanceApplied = 0;
  });
  if (!Array.isArray(db.expenses)) db.expenses = [];
  // Sequential, gap-safe expense numbering (spec: never derived from array index/position, so
  // deleting an expense can't renumber the ones around it).
  if (typeof db.expenseSeq !== "number") db.expenseSeq = 1;
  db.expenses.forEach((e) => {
    if (!e.expenseNo) { e.expenseNo = `#${String(db.expenseSeq).padStart(4, "0")}`; db.expenseSeq += 1; }
    if (e.receiptName === undefined) e.receiptName = null;
    if (e.receiptType === undefined) e.receiptType = null;
    // Multi-item expenses: a single-item/quantity/cost record becomes one line item, with
    // `cost` (previously the whole transaction's total, not a per-unit price) preserved exactly
    // as totalAmount and best-effort divided back out into a unitPrice so the line still reads
    // sensibly — never re-derived as quantity*unitPrice, which would drift from the real total
    // on a non-integer division.
    if (!Array.isArray(e.items)) {
      const quantity = Number(e.quantity) || 1;
      const totalAmount = Number(e.cost) || 0;
      const unitPrice = quantity > 0 ? totalAmount / quantity : totalAmount;
      e.items = [{ id: uid("expitem"), itemName: e.item || "Item", quantity, unitPrice, lineTotal: totalAmount }];
      e.totalAmount = totalAmount;
      delete e.item;
      delete e.quantity;
      delete e.cost;
    }
  });
  if (!Array.isArray(db.reportCards)) db.reportCards = [];
  if (typeof db.studentSeq !== "number") db.studentSeq = (db.students?.length || 0) + 1;
  if (typeof db.receiptSeq !== "number") db.receiptSeq = 1;

  // ---- Attendance overhaul: staff attendance is now keyed by staff.id (not the login user id),
  // so non-login staff (cleaner/guard/driver/cook) can be tracked too, and Sick/Permission/Excused
  // are now their own top-level statuses instead of an Absent + reason pair.
  if (!Array.isArray(db.staffAttendance)) {
    db.staffAttendance = Array.isArray(db.teacherAttendance)
      ? db.teacherAttendance
          .map((a) => {
            const staffRec = db.staff.find((s) => s.userId === a.teacherId);
            if (!staffRec) return null;
            const { teacherId, reason, ...rest } = a;
            return { ...rest, staffId: staffRec.id, leaveRequestId: null };
          })
          .filter(Boolean)
      : [];
  }
  delete db.teacherAttendance;
  function migrateAttendanceStatus(records) {
    records.forEach((r) => {
      if (r.status === "Absent" && (r.reason === "Sick" || r.reason === "Permission")) r.status = r.reason;
      if (r.reason !== undefined) delete r.reason;
      if (r.leaveRequestId === undefined) r.leaveRequestId = null;
      if (typeof r.note !== "string") r.note = "";
    });
  }
  if (Array.isArray(db.attendance)) migrateAttendanceStatus(db.attendance);
  migrateAttendanceStatus(db.staffAttendance);
  if (!Array.isArray(db.leaveRequests)) db.leaveRequests = [];
  db.leaveRequests.forEach((r) => {
    if (r.rejectionReason === undefined) r.rejectionReason = null;
    if (typeof r.completionNotified !== "boolean") r.completionNotified = false;
  });
  if (Array.isArray(db.announcements)) db.announcements.forEach((a) => { if (a.attachment === undefined) a.attachment = null; });
  if (!Array.isArray(db.schoolClosures)) db.schoolClosures = [];
  if (!Array.isArray(db.ownerLeaveLog)) db.ownerLeaveLog = [];

  if (!Array.isArray(db.studentDocuments)) db.studentDocuments = [];
  if (!Array.isArray(db.enrollments)) {
    // Backfill one enrollment row per existing student for the current year, so history exists
    // going forward even for a school that was already using the app before this feature existed.
    const current = currentAcademicYear(db.academicYears);
    db.enrollments = (db.students || []).map((s) => ({
      id: uid("enr"), studentId: s.id, academicYearId: current ? current.id : null,
      grade: s.grade, section: s.section, classId: s.classId, status: s.status,
      enrollmentDate: s.admissionDate || null, suspension: s.suspension || null, createdAt: Date.now(),
    }));
  } else {
    db.enrollments.forEach((e) => { if (e.suspension === undefined) e.suspension = null; });
  }
  if (Array.isArray(db.students)) db.students.forEach((s) => { if (s.suspension === undefined) s.suspension = null; });
  if (Array.isArray(db.homework)) {
    const current = currentAcademicYear(db.academicYears);
    db.homework.forEach((h) => { if (h.academicYearId === undefined) h.academicYearId = current ? current.id : null; });
  }
  if (Array.isArray(db.results)) {
    const current = currentAcademicYear(db.academicYears);
    db.results.forEach((r) => { if (r.academicYearId === undefined) r.academicYearId = current ? current.id : null; });
  }
  if (Array.isArray(db.reportCards)) {
    const current = currentAcademicYear(db.academicYears);
    db.reportCards.forEach((rc) => { if (rc.academicYearId === undefined) rc.academicYearId = current ? current.id : null; });
  }

  return db;
}


export { buildSeed, migrateDB, loadDB, saveDB, FIRST_NAMES, LAST_NAMES, pick };
