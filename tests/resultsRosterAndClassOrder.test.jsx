import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor, screen } from "@testing-library/react";

// Regression for two production reports:
//  1. Results tabs came out "Grade 10, 11, 12, 9" (database text order) instead of 9, 10, 11, 12.
//  2. After a grade's Results Structure was deleted (kept, archived, because one student already had a
//     result recorded under it) the recording screen listed ONLY that one student — the other 27 vanished.
// Both are asserted against the REAL DataProvider and the REAL gradebook editor.
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
const NAMES = ["Maxamed Bashiir Ahmed", "Amin Mohamed Yusuf", "Mohamed Abduwali Mohamed", "Muad Abdi Muhumed"];
const student = (i, name) => {
  const [firstName, middleName, lastName] = name.split(" ");
  return { id: `s${i}`, studentId: `TMA-${i}`, firstName, middleName, lastName, grade: "Grade 10", section: "", classId: "c10", status: "ACTIVE", usesBus: false, parentIds: [], admissionDate: "2025-09-11" };
};
const cls = (id, grade) => ({ id, grade, section: "" });
const comp = (id, name, weight, kind, order) => ({ id, name, weight, kind, order, active: true });

function reset() {
  h.state = {
    years: [Y19],
    // The database hands classes back in TEXT order: "Grade 10" < "Grade 11" < "Grade 12" < "Grade 9".
    classes: [cls("c10", "Grade 10"), cls("c11", "Grade 11"), cls("c12", "Grade 12"), cls("c9", "Grade 9")],
    students: NAMES.map((n, i) => student(i + 1, n)),
    enrollments: [],
    // The Grade 10 structure was deleted (archived, because it already had a result); no new one yet.
    configs: [{ id: "old", academicYearId: "y19", semester: "S1", grade: "Grade 10", version: 1, status: "ARCHIVED", components: [comp("a1", "Test", 20, "TEST", 0), comp("a2", "Other", 80, "NON_TEST", 1)] }],
    // Only the FIRST student ever had a result saved under it.
    results: [{ id: "r1", studentId: "s1", classId: "c10", subjectId: "sub-math", semester: "S1", academicYearId: "y19", configurationId: "old", publishStatus: "DRAFT", componentRows: [] }],
  };
}

let probe;
function Probe() { probe = useData(); return null; }
beforeEach(() => reset());
afterEach(() => cleanup());

describe("class order", () => {
  it("db.classes is Grade 9, 10, 11, 12 whatever order the database returns them in", async () => {
    render(<DataProvider><Probe /></DataProvider>);
    await waitFor(() => expect(probe && probe.db.classes.length).toBe(4));
    expect(probe.db.classes.map((c) => c.grade)).toEqual(["Grade 9", "Grade 10", "Grade 11", "Grade 12"]);
  });
});

describe("the recording screen roster", () => {
  function Editor() {
    const data = useData();
    if (data.db.students.length === 0 || data.db.results.length === 0) return null;
    return <SubjectSemesterResultsEditor classId="c10" subject="MATHEMATICS" semester="S1" academicYearId="y19" onBack={() => {}} onOpenSettings={() => {}} />;
  }

  it("lists EVERY student of the class after the structure was deleted, not only the one who had a result", async () => {
    render(<DataProvider><Editor /></DataProvider>);
    await waitFor(() => expect(screen.getByText("Maxamed Bashiir Ahmed")).toBeTruthy());
    for (const name of NAMES) expect(screen.getByText(name)).toBeTruthy();
    // and it says why the other students can't be recorded yet, with a way to fix it
    expect(screen.getByText(/No active Results Structure/)).toBeTruthy();
    // The first student's only row is an EMPTY draft (nothing was ever scored), so it is not a result: all
    // four are equally "not recordable" — none is presented as a saved result of the deleted structure.
    expect(screen.getAllByText("Structure not configured").length).toBe(4);
    expect(screen.queryByText(/Historical results under previous structure/)).toBeNull();
  });

  it("with no structure and no results at all, the whole roster is still shown", async () => {
    h.state.results = [];
    h.state.configs = [];
    function Editor2() {
      const data = useData();
      if (data.db.students.length === 0) return null;
      return <SubjectSemesterResultsEditor classId="c10" subject="MATHEMATICS" semester="S1" academicYearId="y19" onBack={() => {}} onOpenSettings={() => {}} />;
    }
    render(<DataProvider><Editor2 /></DataProvider>);
    await waitFor(() => expect(screen.getByText("No Results Structure Configured")).toBeTruthy());
    for (const name of NAMES) expect(screen.getByText(name)).toBeTruthy();
  });
});
