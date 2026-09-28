import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

// The REAL DataProvider's teacher-assignment writes (createTeacher / updateTeacherAssignments) against a
// fake Supabase client and spied services: what reaches teacher_assignments is exactly the requested
// class+subject PAIRS — never a class list crossed with a subject list, never delete-all-and-recreate.
const h = vi.hoisted(() => {
  const chain = () => {
    const p = new Proxy(function () {}, {
      get(_, prop) { if (prop === "then") return (res) => res({ data: [], error: null }); return () => p; },
      apply() { return p; },
    });
    return p;
  };
  return { chain, state: {}, spies: {} };
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

function stub(factoryName, override) {
  return async (importOriginal) => {
    const orig = await importOriginal();
    return { ...orig, [factoryName]: () => ({ ...orig[factoryName](), ...override() }) };
  };
}
vi.mock("../src/services/teacherService", stub("createTeacherService", () => ({
  list: async () => h.state.teachers,
  listAssignments: async () => h.state.assignments,
  assign: (...a) => h.spies.assign(...a),
  unassignPair: (...a) => h.spies.unassignPair(...a),
  unassignAllForTeacher: (...a) => h.spies.unassignAll(...a),
})));
vi.mock("../src/services/subjectService", stub("createSubjectService", () => ({ list: async () => h.state.subjects })));
vi.mock("../src/services/classService", stub("createClassService", () => ({ list: async () => h.state.classes, listCurriculum: async () => h.state.curriculum })));
vi.mock("../src/services/accountService", stub("createAccountService", () => ({ create: (...a) => h.spies.createAccount(...a) })));
vi.mock("../src/services/staffService", stub("createStaffService", () => ({
  list: async () => [], listFull: async () => [], myRecord: async () => null, listAttendance: async () => [],
  create: async () => ({ id: "staff-new" }),
})));

import { DataProvider, useData } from "../src/context/DataContext";

const SUB = { eng: "sub-eng", math: "sub-math", phys: "sub-phys", sci: "sub-sci" };
const C9 = "c9", C10 = "c10";

function reset() {
  h.state = {
    teachers: [{ id: "t1", name: "Tigist Bekele", email: "t1@x", phone: "", status: "ACTIVE" }, { id: "t2", name: "Dawit Alemu", email: "t2@x", phone: "", status: "ACTIVE" }],
    subjects: [{ id: SUB.eng, name: "English" }, { id: SUB.math, name: "Mathematics" }, { id: SUB.phys, name: "Physics" }, { id: SUB.sci, name: "Science" }],
    classes: [{ id: C9, grade: "Grade 9", section: "" }, { id: C10, grade: "Grade 10", section: "" }],
    // Curriculum: Grade 9 = English, Physics, Science, Mathematics; Grade 10 = Mathematics, Physics (NOT English)
    curriculum: [
      { id: "1", classId: C9, subjectId: SUB.eng }, { id: "2", classId: C9, subjectId: SUB.phys }, { id: "3", classId: C9, subjectId: SUB.sci }, { id: "4", classId: C9, subjectId: SUB.math },
      { id: "5", classId: C10, subjectId: SUB.math }, { id: "6", classId: C10, subjectId: SUB.phys },
    ],
    // Tigist: Grade 9 — English, Grade 10 — Mathematics.  Dawit: Grade 9 — Science.
    assignments: [
      { id: "ta1", teacherId: "t1", subjectId: SUB.eng, classId: C9 },
      { id: "ta2", teacherId: "t1", subjectId: SUB.math, classId: C10 },
      { id: "ta3", teacherId: "t2", subjectId: SUB.sci, classId: C9 },
    ],
  };
  h.spies = {
    assign: vi.fn(async () => undefined), unassignPair: vi.fn(async () => undefined), unassignAll: vi.fn(async () => undefined),
    createAccount: vi.fn(async () => ({ ok: true, userId: "t-new" })),
  };
}

let probe;
function Probe() { probe = useData(); return null; }
async function mount() {
  render(<DataProvider><Probe /></DataProvider>);
  await waitFor(() => expect(probe.db.teacherAssignments.length).toBe(3));
}
const data = () => probe;
const pair = (classId, subject) => ({ classId, subject });
const writes = () => ({ assign: h.spies.assign.mock.calls, unassignPair: h.spies.unassignPair.mock.calls, unassignAll: h.spies.unassignAll.mock.calls });

beforeEach(() => { try { window.localStorage.clear(); } catch { /* */ } reset(); });
afterEach(() => { cleanup(); });

describe("updateTeacherAssignments writes exactly the requested pairs", () => {
  it("the live model is pairs: Tigist teaches Grade 9 English and Grade 10 Mathematics only", async () => {
    await mount();
    const mine = data().db.teacherAssignments.filter((a) => a.teacherId === "t1").map((a) => `${a.classId}:${a.subject}`).sort();
    expect(mine).toEqual([`${C10}:Mathematics`, `${C9}:English`]);
  });

  it("saving the same pairs changes nothing — no delete-all-and-recreate", async () => {
    await mount();
    const res = await data().updateTeacherAssignments("t1", [pair(C9, "English"), pair(C10, "Mathematics")]);
    expect(res.ok).toBe(true);
    expect(writes()).toEqual({ assign: [], unassignPair: [], unassignAll: [] });
  });

  it("Test 2: adding Physics to Grade 9 grants only Grade 9 Physics — not Grade 10 Physics, not English/Math anywhere else", async () => {
    await mount();
    const res = await data().updateTeacherAssignments("t1", [pair(C9, "English"), pair(C10, "Mathematics"), pair(C9, "Physics")]);
    expect(res.ok).toBe(true);
    expect(writes().assign).toEqual([["t1", SUB.phys, C9]]);
    expect(writes().unassignPair).toEqual([]);
    expect(writes().unassignAll).toEqual([]);
  });

  it("Test 3: adding a class pair does not hand that class every subject the teacher already teaches", async () => {
    await mount();
    // The teacher already teaches English and Mathematics; add ONLY Grade 10 Physics.
    const res = await data().updateTeacherAssignments("t1", [pair(C9, "English"), pair(C10, "Mathematics"), pair(C10, "Physics")]);
    expect(res.ok).toBe(true);
    expect(writes().assign).toEqual([["t1", SUB.phys, C10]]);
  });

  it("Test 4: removing Grade 9 — English deletes only that pair; Grade 10 — Mathematics is untouched", async () => {
    await mount();
    const res = await data().updateTeacherAssignments("t1", [pair(C10, "Mathematics")]);
    expect(res.ok).toBe(true);
    expect(writes().unassignPair).toEqual([[C9, SUB.eng]]);
    expect(writes().assign).toEqual([]);
    expect(writes().unassignAll).toEqual([]);
  });

  it("a pair that is not in the class's curriculum is rejected and nothing is written (Grade 10 has no English)", async () => {
    await mount();
    const res = await data().updateTeacherAssignments("t1", [pair(C9, "English"), pair(C10, "Mathematics"), pair(C10, "English")]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/English is not part of the curriculum for Grade 10/);
    expect(writes()).toEqual({ assign: [], unassignPair: [], unassignAll: [] });
  });

  it("a pair another teacher holds is refused unless the Owner/Director explicitly reassigns that exact pair", async () => {
    await mount();
    const want = [pair(C9, "English"), pair(C10, "Mathematics"), pair(C9, "Science")];
    const refused = await data().updateTeacherAssignments("t1", want);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/Science is already assigned to Dawit Alemu in Grade 9/);
    expect(writes()).toEqual({ assign: [], unassignPair: [], unassignAll: [] });

    const moved = await data().updateTeacherAssignments("t1", want, [pair(C9, "Science")]);
    expect(moved.ok).toBe(true);
    expect(writes().unassignPair).toEqual([[C9, SUB.sci]]); // only that pair leaves Dawit
    expect(writes().assign).toEqual([["t1", SUB.sci, C9]]);
  });

  it("a reassignment request for a pair that isn't on the requested list is ignored (it can't steal anything)", async () => {
    await mount();
    const res = await data().updateTeacherAssignments("t1", [pair(C9, "English"), pair(C10, "Mathematics")], [pair(C9, "Science")]);
    expect(res.ok).toBe(true);
    expect(writes()).toEqual({ assign: [], unassignPair: [], unassignAll: [] });
  });
});

describe("createTeacher writes exactly the requested pairs", () => {
  it("Grade 9 — English + Grade 10 — Mathematics creates two assignments, not four", async () => {
    await mount();
    const res = await data().createTeacher({
      firstName: "New", middleName: "T", lastName: "Teacher", email: "new@x.test", phone: "1", password: "pw",
      assignments: [pair(C9, "English"), pair(C10, "Mathematics")],
    });
    // Grade 9 English is currently held by Tigist -> refused without a reassignment; use free pairs instead.
    expect(res.ok).toBe(false);
    expect(h.spies.assign).not.toHaveBeenCalled();
    expect(h.spies.createAccount).not.toHaveBeenCalled(); // validated before anything is created

    const ok = await data().createTeacher({
      firstName: "New", middleName: "T", lastName: "Teacher", email: "new@x.test", phone: "1", password: "pw",
      assignments: [pair(C9, "Physics"), pair(C10, "Physics")],
    });
    expect(ok.ok).toBe(true);
    expect(h.spies.assign.mock.calls).toEqual([["t-new", SUB.phys, C9], ["t-new", SUB.phys, C10]]);
  });

  it("two different subjects in two different classes stay exactly those two pairs", async () => {
    await mount();
    // free the pairs first: Tigist gives up both, then a new teacher takes exactly them
    h.state.assignments = [];
    await act(async () => { await data().updateTeacherAssignments("t2", []); });
    h.spies.assign.mockClear();
    const res = await data().createTeacher({
      firstName: "Pair", middleName: "T", lastName: "Teacher", email: "pair@x.test", phone: "1", password: "pw",
      assignments: [pair(C9, "English"), pair(C10, "Mathematics")],
    });
    expect(res.ok).toBe(true);
    expect(h.spies.assign.mock.calls).toEqual([["t-new", SUB.eng, C9], ["t-new", SUB.math, C10]]);
  });
});
