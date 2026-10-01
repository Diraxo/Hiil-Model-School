import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Results register against the REAL DataProvider and the REAL gradebook editor: who sees the
// Publish controls (exact class + subject pair), that ONE click publishes every saved draft (no
// per-student selection, no per-image "Share?"), and that a saved result opens read-only.
const h = vi.hoisted(() => {
  const chain = () => {
    const p = new Proxy(function () {}, {
      get(_, prop) { if (prop === "then") return (res) => res({ data: [], error: null }); return () => p; },
      apply() { return p; },
    });
    return p;
  };
  return { chain, state: {}, published: [], notified: [] };
});

vi.mock("../src/lib/supabaseClient", () => ({
  supabase: {
    from: () => h.chain(), channel: () => h.chain(), removeChannel() {}, storage: { from: () => h.chain() },
    rpc: async (name, args) => { if (name === "notify_results_published") h.notified.push(args); return { data: null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "owner" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  recoveryUrlState: {}, scrubAuthParamsFromUrl() {},
}));
vi.mock("../src/context/ToastContext", () => ({ useToast: () => () => {} }));
vi.mock("../src/context/AuthContext", () => ({ useAuth: () => ({ currentUser: h.state.user, realUser: h.state.user }) }));

function stub(factoryName, override) {
  return async (importOriginal) => {
    const orig = await importOriginal();
    return { ...orig, [factoryName]: () => ({ ...orig[factoryName](), ...override() }) };
  };
}
vi.mock("../src/services/academicYearService", stub("createAcademicYearService", () => ({
  list: async () => h.state.years, listDecisions: async () => [], listAudit: async () => [], listTeacherAssignmentSnapshots: async () => [],
})));
vi.mock("../src/services/studentService", stub("createStudentService", () => ({
  list: async () => h.state.students, listEnrollments: async () => [], listDocuments: async () => [],
})));
vi.mock("../src/services/classService", stub("createClassService", () => ({
  list: async () => h.state.classes, listCurriculum: async () => [],
})));
vi.mock("../src/services/subjectService", stub("createSubjectService", () => ({
  list: async () => [{ id: "sub-math", name: "MATHEMATICS" }, { id: "sub-eng", name: "ENGLISH" }],
})));
vi.mock("../src/services/teacherService", stub("createTeacherService", () => ({
  listAssignments: async () => h.state.assignments,
})));
vi.mock("../src/services/resultService", stub("createResultService", () => ({
  list: async () => h.state.results, listAudit: async () => [],
  publish: async (ids) => { h.published.push(ids); return ids.map((id) => { const r = h.state.results.find((x) => x.id === id); return { id, student_id: r.studentId, class_id: r.classId, subject_id: r.subjectId, semester: r.semester }; }); },
  addAudit: async () => {},
  ensureRecord: async ({ studentId, classId, subjectId, semester, academicYearId }) => {
    const id = `new-${studentId}`;
    h.state.results = [...h.state.results, { id, studentId, classId, subjectId, semester, academicYearId, configurationId: "cur", publishStatus: "DRAFT", componentRows: [] }];
    return { id, created: true };
  },
})));
vi.mock("../src/services/resultEvidenceService", stub("createResultEvidenceService", () => ({
  list: async () => h.state.evidence || [],
  signedUrls: async () => new Map(),
  add: async ({ resultId, assessmentId }) => {
    const row = { id: `ev-${(h.state.evidence || []).length + 1}`, resultId, assessmentId, studentId: "s2", semester: "S1", academicYearId: "y19", order: 0, storagePath: null, fileName: "p.png", fileType: "image", mimeType: "image/png" };
    h.state.evidence = [...(h.state.evidence || []), row];
    return { ...row, order: 0 };
  },
})));
vi.mock("../src/services/resultConfigService", stub("createResultConfigService", () => ({
  list: async () => h.state.configs, listAudit: async () => [],
})));

import { DataProvider, useData } from "../src/context/DataContext";
import { SubjectSemesterResultsEditor } from "../src/pages/admin/AdminPages";

const Y19 = { id: "y19", ecLabel: "2019-2020", gcLabel: "2026-2027", yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-11", sem1End: "2027-01-19", breakDays: 15, sem2Start: "2027-02-04", sem2End: "2027-07-07", resultFinalizationGraceDays: 15, isCurrent: true, closedAt: null };
const NAMES = ["Maxamed Bashiir Ahmed", "Amin Mohamed Yusuf", "Mohamed Abduwali Mohamed"];
const student = (i, name) => {
  const [firstName, middleName, lastName] = name.split(" ");
  return { id: `s${i}`, studentId: `TMA-${i}`, firstName, middleName, lastName, grade: "Grade 10", section: "", classId: "c10", status: "ACTIVE", usesBus: false, parentIds: [], admissionDate: "2025-09-11" };
};
const comp = (id, name, weight, kind, order) => ({ id, name, weight, kind, order, active: true });
// NON_TEST only, so publishing needs no evidence and the test isolates the publish/permission behaviour.
const CFG = { id: "cur", academicYearId: "y19", semester: "S1", grade: "Grade 10", version: 1, status: "ACTIVE", components: [comp("q", "Quiz", 30, "NON_TEST", 0), comp("f", "Final", 70, "NON_TEST", 1)] };
const draft = (n, status = "DRAFT") => ({
  id: `r${n}`, studentId: `s${n}`, classId: "c10", subjectId: "sub-math", semester: "S1", academicYearId: "y19", configurationId: "cur", publishStatus: status,
  componentRows: [{ assessmentId: "q", score: 20, max: 30, sharedWithParents: false }, { assessmentId: "f", score: 50, max: 70, sharedWithParents: false }],
});

function reset(user, assignments = []) {
  h.published = []; h.notified = [];
  h.state = {
    user, years: [Y19], classes: [{ id: "c10", grade: "Grade 10", section: "" }],
    students: NAMES.map((n, i) => student(i + 1, n)), configs: [CFG], assignments,
    results: [draft(1), draft(2), draft(3, "PUBLISHED")],
  };
}
const OWNER = { id: "owner", role: "OWNER", name: "Owner" };
const TEACHER = { id: "t1", role: "TEACHER", name: "Teacher One" };
const asg = (subjectId, classId = "c10") => ({ id: `${subjectId}-${classId}`, teacherId: "t1", subjectId, classId });

function Editor({ subject = "MATHEMATICS" }) {
  const data = useData();
  if (data.db.students.length === 0 || data.db.teacherAssignments === undefined) return null;
  return <SubjectSemesterResultsEditor classId="c10" subject={subject} semester="S1" academicYearId="y19" onBack={() => {}} onOpenSettings={() => {}} />;
}
const show = (props) => render(<DataProvider><Editor {...props} /></DataProvider>);
const rowOf = (name) => screen.getByText(name).closest("tr");

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Owner / Educational Director", () => {
  it("a saved result is read-only (no inputs), has View / Edit / Publish, and there is no Share toggle or selection checkbox", async () => {
    reset(OWNER);
    show();
    await waitFor(() => expect(screen.getByText(NAMES[0])).toBeTruthy());
    const row = rowOf(NAMES[0]);
    expect(within(row).queryAllByRole("spinbutton").length).toBe(0);
    for (const name of ["View", "Edit", "Publish"]) expect(within(row).getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByText(/Share\?/)).toBeNull();
    expect(screen.queryAllByRole("checkbox").length).toBe(0);
    // the already-published student has no Publish
    expect(within(rowOf(NAMES[2])).queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("ONE Publish click (after confirming) publishes every saved draft together and notifies once per class/subject", async () => {
    reset(OWNER);
    show();
    const btn = await screen.findByRole("button", { name: /Publish results \(2\)/ });
    fireEvent.click(btn);
    const dialogTitle = screen.getByRole("heading", { name: "Publish Results?" });
    expect(dialogTitle).toBeTruthy();
    expect(h.published).toEqual([]); // nothing happens until confirmed
    fireEvent.click(screen.getByRole("button", { name: "Publish Results" }));
    await waitFor(() => expect(h.published).toHaveLength(1));
    expect(h.published[0].sort()).toEqual(["r1", "r2"]);
    await waitFor(() => expect(h.notified).toHaveLength(1));
    expect(h.notified[0]).toMatchObject({ p_class_id: "c10", p_subject_id: "sub-math", p_semester: "S1", p_academic_year_id: "y19" });
    expect(h.notified[0].p_student_ids.sort()).toEqual(["s1", "s2"]);
  });

  it("the row Publish publishes just that student, after a confirmation naming the student", async () => {
    reset(OWNER);
    show();
    await screen.findByText(NAMES[1]);
    fireEvent.click(within(rowOf(NAMES[1])).getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("heading", { name: "Publish Result?" })).toBeTruthy();
    expect(screen.getByText(NAMES[1], { selector: "dd" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish Result" }));
    await waitFor(() => expect(h.published).toEqual([["r2"]]));
  });

  it("View opens the read-only detail with an explicit Edit Result; nothing is editable until it is clicked", async () => {
    reset(OWNER);
    show();
    await screen.findByText(NAMES[0]);
    fireEvent.click(within(rowOf(NAMES[0])).getByRole("button", { name: "View" }));
    expect(screen.getByText("Result details")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Result" })).toBeTruthy();
    expect(screen.queryAllByRole("spinbutton").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit Result" }));
    await waitFor(() => expect(within(rowOf(NAMES[0])).queryAllByRole("spinbutton").length).toBe(2));
    fireEvent.click(within(rowOf(NAMES[0])).getByRole("button", { name: /Cancel|Done/ }));
    await waitFor(() => expect(within(rowOf(NAMES[0])).queryAllByRole("spinbutton").length).toBe(0));
  });
});

describe("Assigned teacher — exact class + subject pair", () => {
  it("assigned to Grade 10 Mathematics: sees Publish for it, and publishes all saved drafts in one go", async () => {
    reset(TEACHER, [asg("sub-math")]);
    show();
    const btn = await screen.findByRole("button", { name: /Publish results \(2\)/ });
    expect(within(rowOf(NAMES[0])).getByRole("button", { name: "Publish" })).toBeTruthy();
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: "Publish Results" }));
    await waitFor(() => expect(h.published).toHaveLength(1));
    expect(h.published[0].sort()).toEqual(["r1", "r2"]);
  });

  it("assigned to a DIFFERENT subject in the same class: no Publish, no Edit — even for a subject they can see nothing of", async () => {
    reset(TEACHER, [asg("sub-eng")]);
    show();
    await screen.findByText(NAMES[0]);
    expect(screen.queryByRole("button", { name: /Publish results/ })).toBeNull();
    expect(within(rowOf(NAMES[0])).queryByRole("button", { name: "Publish" })).toBeNull();
    expect(within(rowOf(NAMES[0])).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("assigned to Mathematics in ANOTHER class: no Publish here (no class x subject product)", async () => {
    reset(TEACHER, [asg("sub-math", "c9")]);
    show();
    await screen.findByText(NAMES[0]);
    expect(screen.queryByRole("button", { name: /Publish results/ })).toBeNull();
    expect(within(rowOf(NAMES[0])).queryByRole("button", { name: "Publish" })).toBeNull();
  });
});

describe("Entering a score and an image for a student with no result yet", () => {
  it("the row stays open for editing after the first image creates the result (no Edit click, typed score not lost)", async () => {
    reset(OWNER);
    h.state.evidence = [];
    h.state.results = [];
    h.state.configs = [{ ...CFG, components: [comp("t", "Test", 100, "TEST", 0)] }];
    show();
    await screen.findByText(NAMES[1]);
    const row = () => rowOf(NAMES[1]);
    const input = within(row()).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.click(within(row()).getByRole("button", { name: /Add test evidence/ }));
    const file = new File(["x"], "paper.png", { type: "image/png" });
    const picker = screen.getByText("Choose one image from Gallery").closest("label").querySelector("input[type=file]");
    expect(picker.multiple).toBe(false);
    fireEvent.change(picker, { target: { files: [file] } });
    // the evidence exists now, so the result exists...
    await waitFor(() => expect(h.state.evidence).toHaveLength(1));
    await waitFor(() => expect(within(row()).getByText("1 evidence image")).toBeTruthy());
    // ...and the row is STILL editable with the typed score intact, instead of collapsing to View/Edit
    expect(within(row()).getByRole("spinbutton").value).toBe("42");
    expect(within(row()).getByRole("button", { name: /Add test evidence/ })).toBeTruthy();
  });
});
