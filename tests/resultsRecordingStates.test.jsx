import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor, screen, within } from "@testing-library/react";

// The Results Recording screen against the REAL DataProvider and the REAL gradebook editor: what each
// student row means depends on what is RECORDED, not on a result row merely existing.
//   A configured, nothing recorded   B configured, some recorded   C no structure, nothing recorded
//   D no active structure but historical results   (+ drafts vs saved, academic-year isolation)
const h = vi.hoisted(() => {
  const chain = () => {
    const p = new Proxy(function () {}, {
      get(_, prop) { if (prop === "then") return (res) => res({ data: [], error: null }); return () => p; },
      apply() { return p; },
    });
    return p;
  };
  return { chain, state: {} };
});

vi.mock("../src/lib/supabaseClient", () => ({
  supabase: {
    from: () => h.chain(), channel: () => h.chain(), removeChannel() {}, storage: { from: () => h.chain() },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "owner" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  recoveryUrlState: {}, scrubAuthParamsFromUrl() {},
}));
vi.mock("../src/context/ToastContext", () => ({ useToast: () => () => {} }));
const OWNER = { id: "owner", role: "OWNER", name: "Owner" };
vi.mock("../src/context/AuthContext", () => ({ useAuth: () => ({ currentUser: OWNER, realUser: OWNER }) }));

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
  list: async () => h.state.students, listEnrollments: async () => h.state.enrollments, listDocuments: async () => [],
})));
vi.mock("../src/services/classService", stub("createClassService", () => ({
  list: async () => h.state.classes, listCurriculum: async () => [],
})));
vi.mock("../src/services/subjectService", stub("createSubjectService", () => ({
  list: async () => [{ id: "sub-math", name: "MATHEMATICS" }],
})));
vi.mock("../src/services/resultService", stub("createResultService", () => ({
  list: async () => h.state.results, listAudit: async () => [],
})));
vi.mock("../src/services/resultConfigService", stub("createResultConfigService", () => ({
  list: async () => h.state.configs, listAudit: async () => [],
})));

import { DataProvider, useData } from "../src/context/DataContext";
import { SubjectSemesterResultsEditor } from "../src/pages/admin/AdminPages";

const Y19 = { id: "y19", ecLabel: "2019-2020", gcLabel: "2026-2027", yearStart: "2026-09-11", yearEnd: "2027-07-07", sem1Start: "2026-09-11", sem1End: "2027-01-19", breakDays: 15, sem2Start: "2027-02-04", sem2End: "2027-07-07", resultFinalizationGraceDays: 15, isCurrent: true, closedAt: null };
const Y18 = { id: "y18", ecLabel: "2018-2019", gcLabel: "2025-2026", yearStart: "2025-09-11", yearEnd: "2026-07-07", sem1Start: "2025-09-11", sem1End: "2026-01-19", breakDays: 15, sem2Start: "2026-02-04", sem2End: "2026-07-07", resultFinalizationGraceDays: 15, isCurrent: false, closedAt: "2026-08-01T00:00:00Z" };
const NAMES = ["Maxamed Bashiir Ahmed", "Amin Mohamed Yusuf", "Mohamed Abduwali Mohamed", "Muad Abdi Muhumed"];
const student = (i, name) => {
  const [firstName, middleName, lastName] = name.split(" ");
  return { id: `s${i}`, studentId: `TMA-${i}`, firstName, middleName, lastName, grade: "Grade 10", section: "", classId: "c10", status: "ACTIVE", usesBus: false, parentIds: [], admissionDate: "2025-09-11" };
};
const comp = (id, name, weight, kind, order) => ({ id, name, weight, kind, order, active: true });
const config = (id, year, status, version, comps) => ({ id, academicYearId: year, semester: "S1", grade: "Grade 10", version, status, components: comps });
const CUR = () => [comp("t", "Test", 20, "TEST", 0), comp("o", "Other", 80, "NON_TEST", 1)];
const OLD = () => [comp("ot", "Old test", 30, "TEST", 0), comp("oo", "Old other", 70, "NON_TEST", 1)];
const result = (studentId, configurationId, publishStatus, rows, year = "y19") => ({
  id: `r-${studentId}-${year}`, studentId, classId: "c10", subjectId: "sub-math", semester: "S1", academicYearId: year, configurationId, publishStatus,
  componentRows: rows.map(([assessmentId, score, max]) => ({ assessmentId, score, max, sharedWithParents: false })),
});

function reset() {
  h.state = {
    years: [Y19],
    classes: [{ id: "c10", grade: "Grade 10", section: "" }],
    students: NAMES.map((n, i) => student(i + 1, n)),
    enrollments: [],
    configs: [],
    results: [],
  };
}

function Editor({ year = "y19", ready }) {
  const data = useData();
  if (data.db.students.length === 0 || !(ready ? ready(data) : true)) return null;
  return <SubjectSemesterResultsEditor classId="c10" subject="MATHEMATICS" semester="S1" academicYearId={year} onBack={() => {}} onOpenSettings={() => {}} />;
}
const show = (props) => render(<DataProvider><Editor {...props} /></DataProvider>);
const rowOf = (name) => screen.getByText(name).closest("tr");
const inputsIn = (el) => within(el).queryAllByRole("spinbutton");

beforeEach(() => reset());
afterEach(() => cleanup());

describe("State A — structure configured, nothing recorded", () => {
  it("says so and shows every enrolled student as ready: Not started, with score inputs", async () => {
    h.state.configs = [config("cur", "y19", "ACTIVE", 1, CUR())];
    show();
    await waitFor(() => expect(screen.getByText(/Assessment structure configured\. No results recorded yet/)).toBeTruthy());
    for (const n of NAMES) expect(within(rowOf(n)).getByText("Not started")).toBeTruthy();
    expect(inputsIn(rowOf(NAMES[0])).length).toBe(2);
    expect(screen.queryByText(/Historical results/)).toBeNull();
  });
});

describe("State B — structure configured, some recorded", () => {
  it("shows every student once with Draft / Saved / Not started", async () => {
    h.state.configs = [config("cur", "y19", "ACTIVE", 1, CUR())];
    h.state.results = [
      result("s1", "cur", "DRAFT", [["t", 15, 20]]), // scored, not published -> Draft
      result("s2", "cur", "PUBLISHED", [["t", 18, 20], ["o", 70, 80]]), // published -> Saved
      result("s3", "cur", "DRAFT", []), // opened only -> Not started
    ];
    show();
    await waitFor(() => expect(within(rowOf(NAMES[0])).getByText("Draft")).toBeTruthy());
    expect(within(rowOf(NAMES[1])).getByText("Saved")).toBeTruthy();
    expect(within(rowOf(NAMES[2])).getByText("Not started")).toBeTruthy();
    expect(within(rowOf(NAMES[3])).getByText("Not started")).toBeTruthy();
    expect(screen.getAllByText(NAMES[0]).length).toBe(1);
    expect(screen.getByText(/1 saved · 1 draft · 2 not started/)).toBeTruthy();
  });
});

describe("Test 8 — no structure, no results", () => {
  it("says the structure is not configured and that nothing is recorded; no student is presented as recordable or as a result", async () => {
    show();
    await waitFor(() => expect(screen.getByText("No Results Structure Configured")).toBeTruthy());
    expect(screen.getByText(/Assessment structure not configured\./)).toBeTruthy();
    expect(screen.getByText(/No results recorded\./)).toBeTruthy();
    expect(screen.queryAllByRole("spinbutton").length).toBe(0);
    expect(screen.queryByTestId("historical-results")).toBeNull();
    // the roster is not lost — it sits in a collapsed "not recordable" list, never in a results table
    const details = screen.getByText(/Enrolled students \(4\)/).closest("details");
    expect(details.open).toBe(false);
    expect(within(details).getAllByText("Structure not configured").length).toBe(4);
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("Test 7 — a draft does not masquerade as a saved result", () => {
  it("an empty draft left behind by a deleted structure (detached, or still pinned to the closed one) is not a result", async () => {
    for (const pin of [null, "old"]) {
      cleanup(); reset();
      h.state.configs = pin ? [config("old", "y19", "SUPERSEDED", 1, OLD())] : [];
      h.state.results = [result("s1", pin, "DRAFT", [])];
      show();
      await waitFor(() => expect(screen.getByText("No Results Structure Configured")).toBeTruthy());
      expect(screen.queryByTestId("historical-results")).toBeNull();
      expect(screen.queryByText("Draft")).toBeNull();
      expect(screen.queryByText("Saved")).toBeNull();
      expect(screen.queryAllByRole("spinbutton").length).toBe(0);
      expect(screen.getAllByText("Structure not configured").length).toBe(4); // Maxamed is just as "not started" as the rest
    }
  });

  it("once a NEW structure exists, that empty draft is just Not started and records against the new one", async () => {
    h.state.configs = [config("old", "y19", "SUPERSEDED", 1, OLD()), config("cur", "y19", "ACTIVE", 2, CUR())];
    h.state.results = [result("s1", "old", "DRAFT", [])];
    show();
    await waitFor(() => expect(within(rowOf(NAMES[0])).getByText("Not started")).toBeTruthy());
    expect(screen.getAllByText(NAMES[0]).length).toBe(1);
    expect(screen.queryByText(/Recorded under an earlier structure/)).toBeNull();
    expect(inputsIn(rowOf(NAMES[0])).length).toBe(2); // the CURRENT structure's two columns, not the old one's
    expect(screen.queryByText("Old test")).toBeNull();
  });
});

describe("Test 9 — historical result only", () => {
  it("shows it in its own read-only 'Historical results under previous structure' section, never in a recording table", async () => {
    h.state.configs = [config("old", "y19", "SUPERSEDED", 1, OLD())];
    h.state.results = [result("s1", "old", "PUBLISHED", [["ot", 25, 30], ["oo", 60, 70]])];
    show();
    await waitFor(() => expect(screen.getByTestId("historical-results")).toBeTruthy());
    expect(screen.getByText(/No active assessment structure\./)).toBeTruthy();
    const hist = screen.getByTestId("historical-results");
    expect(within(hist).getByText("Historical results under previous structure")).toBeTruthy();
    expect(within(hist).getByText(NAMES[0])).toBeTruthy();
    expect(within(hist).getByText("25")).toBeTruthy();
    expect(within(hist).getByText(/read-only/)).toBeTruthy();
    expect(within(hist).queryAllByRole("spinbutton").length).toBe(0);
    expect(within(hist).queryAllByRole("checkbox").length).toBe(0);
    // not a current, editable result: no inputs anywhere, and the historical student is not in the "not recordable" roster
    expect(screen.queryAllByRole("spinbutton").length).toBe(0);
    const details = screen.getByText(/Enrolled students \(3\)/).closest("details");
    expect(within(details).queryByText(NAMES[0])).toBeNull();
    expect(within(details).getAllByText("Structure not configured").length).toBe(3);
  });

  it("history is also refused by the data layer, so it cannot be edited through any other path", async () => {
    h.state.configs = [config("old", "y19", "SUPERSEDED", 1, OLD())];
    h.state.results = [result("s1", "old", "PUBLISHED", [["ot", 25, 30]])];
    let probe;
    function Probe() { probe = useData(); return null; }
    render(<DataProvider><Probe /></DataProvider>);
    await waitFor(() => expect(probe && probe.db.results.length).toBe(1));
    const res = await probe.saveResultComponent({ studentId: "s1", classId: "c10", subject: "MATHEMATICS", semester: "S1", assessmentId: "ot", score: 30, academicYearId: "y19" }, "owner");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/recorded under a structure that has since been closed/);
  });
});

describe("Test 10 — earlier structure + current structure", () => {
  it("a student with SAVED results under an earlier version stays in one clearly labelled table (one result row per student); everyone else is Not started on the current one", async () => {
    h.state.configs = [config("old", "y19", "SUPERSEDED", 1, OLD()), config("cur", "y19", "ACTIVE", 2, CUR())];
    h.state.results = [result("s1", "old", "PUBLISHED", [["ot", 25, 30], ["oo", 60, 70]])];
    show();
    await waitFor(() => expect(screen.getByText(/Recorded under an earlier structure \(version 1\)/)).toBeTruthy());
    expect(screen.getByText(/Current structure \(version 2\)/)).toBeTruthy();
    expect(screen.getAllByText(NAMES[0]).length).toBe(1); // exactly once
    expect(within(rowOf(NAMES[0])).getByText("Saved")).toBeTruthy();
    for (const n of NAMES.slice(1)) expect(within(rowOf(n)).getByText("Not started")).toBeTruthy();
    expect(screen.queryByTestId("historical-results")).toBeNull(); // an active successor exists: not history
  });
});

describe("Test 11 — academic year isolation on the recording screen", () => {
  it("each year sees only its own structure and its own results", async () => {
    h.state.years = [Y19, Y18];
    h.state.enrollments = NAMES.map((_, i) => ({ id: `e${i}`, studentId: `s${i + 1}`, academicYearId: "y18", grade: "Grade 10", section: "", classId: "c10", status: "ACTIVE" }));
    h.state.configs = [config("cur", "y19", "ACTIVE", 1, CUR()), config("prev", "y18", "ACTIVE", 1, OLD())];
    h.state.results = [result("s1", "cur", "PUBLISHED", [["t", 18, 20]], "y19")];
    const ready = (d) => d.db.results.length > 0 && d.db.resultConfigs.length === 2 && d.db.academicYears.length === 2;

    show({ year: "y18", ready });
    await waitFor(() => expect(screen.getByText("Old test")).toBeTruthy());
    expect(screen.queryByText("Test")).toBeNull();
    for (const n of NAMES) expect(within(rowOf(n)).getByText("Not started")).toBeTruthy(); // y19's saved result does not leak in
    cleanup();

    show({ year: "y19", ready });
    await waitFor(() => expect(within(rowOf(NAMES[0])).getByText("Saved")).toBeTruthy());
    expect(screen.queryByText("Old test")).toBeNull();
  });
});
