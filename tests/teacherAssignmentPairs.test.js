// Teacher assignments are explicit class + subject PAIRS. These tests pin the pair model and the
// client-side authorization built on it (the database-side check is tests/teacherAssignmentPairsDb.test.js).
import { describe, it, expect } from "vitest";
import { pairKey, pairsForTeacher, teachesPair, addPair, removePair, diffPairs, resolveTeacherPairs } from "../src/utils/teacherAssignments";
import { canViewResult, canEditResultComponent, canViewResultAudit } from "../src/utils/permissions";
import { ROLES } from "../src/utils/constants";

const G9 = "grade-9", G10 = "grade-10";
const teacher = { id: "t1", role: ROLES.TEACHER };
// Grade 9 — English, Grade 10 — Mathematics
const rows = [
  { id: "a1", teacherId: "t1", classId: G9, subject: "English" },
  { id: "a2", teacherId: "t1", classId: G10, subject: "Mathematics" },
  { id: "a3", teacherId: "t2", classId: G9, subject: "Science" },
];

describe("authorization follows the exact pair (Tests 1, 5, 6)", () => {
  it("Test 1: Grade 9 English and Grade 10 Mathematics are allowed; the cross pairs are denied", () => {
    expect(teachesPair(rows, "t1", G9, "English")).toBe(true);
    expect(teachesPair(rows, "t1", G9, "Mathematics")).toBe(false);
    expect(teachesPair(rows, "t1", G10, "English")).toBe(false);
    expect(teachesPair(rows, "t1", G10, "Mathematics")).toBe(true);
  });

  it("the same matrix holds for Results view/edit and the audit trail", () => {
    const ctx = (classId, subject) => ({ classId, subject, teacherAssignments: rows });
    expect(canViewResult(teacher, ctx(G9, "English"))).toBe(true);
    expect(canViewResult(teacher, ctx(G9, "Mathematics"))).toBe(false);
    expect(canViewResult(teacher, ctx(G10, "English"))).toBe(false);
    expect(canViewResult(teacher, ctx(G10, "Mathematics"))).toBe(true);
    expect(canEditResultComponent(teacher, ctx(G9, "English"), null)).toBe(true);
    expect(canEditResultComponent(teacher, ctx(G9, "Mathematics"), null)).toBe(false);
    expect(canEditResultComponent(teacher, ctx(G10, "English"), null)).toBe(false);
    expect(canEditResultComponent(teacher, ctx(G10, "Mathematics"), null)).toBe(true);
    expect(canViewResultAudit(teacher, ctx(G9, "Mathematics"))).toBe(false);
    expect(canViewResultAudit(teacher, ctx(G10, "Mathematics"))).toBe(true);
  });

  it("Test 5: a teacher with only Grade 9 — English cannot reach Grade 10 English", () => {
    const one = [{ id: "x", teacherId: "t9", classId: G9, subject: "English" }];
    expect(teachesPair(one, "t9", G9, "English")).toBe(true);
    expect(teachesPair(one, "t9", G10, "English")).toBe(false);
  });

  it("Test 6: any class/subject pair that was not explicitly assigned is denied — including another teacher's", () => {
    expect(teachesPair(rows, "t1", G9, "Science")).toBe(false); // t2's pair
    expect(teachesPair(rows, "t1", "grade-11", "English")).toBe(false);
    expect(teachesPair(rows, "nobody", G9, "English")).toBe(false);
    expect(teachesPair([], "t1", G9, "English")).toBe(false);
    expect(teachesPair(undefined, "t1", G9, "English")).toBe(false);
  });

  it("pairsForTeacher returns the exact rows, never a class/subject product", () => {
    expect(pairsForTeacher(rows, "t1")).toEqual([{ classId: G9, subject: "English" }, { classId: G10, subject: "Mathematics" }]);
  });
});

describe("editing the pair list touches only that pair (Tests 2, 3, 4)", () => {
  const base = [{ classId: G9, subject: "English" }, { classId: G10, subject: "Mathematics" }];

  it("Test 2: adding another subject to Grade 9 does not add it to Grade 10", () => {
    const next = addPair(base, { classId: G9, subject: "Physics" });
    expect(next).toEqual([...base, { classId: G9, subject: "Physics" }]);
    expect(next.some((p) => p.classId === G10 && p.subject === "Physics")).toBe(false);
  });

  it("Test 3: adding another class pair does not hand that class the subjects the teacher already has", () => {
    const next = addPair(base, { classId: "grade-11", subject: "Physics" });
    expect(next).toHaveLength(3);
    expect(next.filter((p) => p.classId === "grade-11")).toEqual([{ classId: "grade-11", subject: "Physics" }]);
  });

  it("Test 4: removing Grade 9 — English leaves Grade 10 — Mathematics", () => {
    expect(removePair(base, { classId: G9, subject: "English" })).toEqual([{ classId: G10, subject: "Mathematics" }]);
  });

  it("adding a pair twice is a no-op; removing a pair that isn't there is a no-op", () => {
    expect(addPair(base, { classId: G9, subject: "English" })).toEqual(base);
    expect(removePair(base, { classId: G9, subject: "Mathematics" })).toEqual(base);
  });

  it("diffPairs reports only what changed", () => {
    const desired = [{ classId: G9, subject: "English" }, { classId: G9, subject: "Physics" }];
    expect(diffPairs(base, desired)).toEqual({ toAdd: [{ classId: G9, subject: "Physics" }], toRemove: [{ classId: G10, subject: "Mathematics" }] });
    expect(diffPairs(base, base)).toEqual({ toAdd: [], toRemove: [] });
  });
});

describe("resolveTeacherPairs never expands the request", () => {
  const d = {
    classes: [{ id: G9, grade: "Grade 9", section: "" }, { id: G10, grade: "Grade 10", section: "" }],
    classSubjects: [
      { classId: G9, subject: "English" }, { classId: G9, subject: "Mathematics" }, { classId: G9, subject: "Science" },
      { classId: G10, subject: "English" }, { classId: G10, subject: "Mathematics" },
    ],
    teacherAssignments: [{ teacherId: "t2", classId: G9, subject: "Science" }],
    users: [{ id: "t2", name: "Dawit" }],
  };

  it("two classes and two subjects requested as two pairs stay two pairs (no cartesian product)", () => {
    const res = resolveTeacherPairs(d, { pairs: [{ classId: G9, subject: "English" }, { classId: G10, subject: "Mathematics" }] });
    expect(res.ok).toBe(true);
    expect(res.pairs).toEqual([{ classId: G9, subject: "English" }, { classId: G10, subject: "Mathematics" }]);
  });

  it("duplicates collapse; order is preserved", () => {
    const res = resolveTeacherPairs(d, { pairs: [{ classId: G10, subject: "Mathematics" }, { classId: G10, subject: "Mathematics" }, { classId: G9, subject: "English" }] });
    expect(res.pairs).toEqual([{ classId: G10, subject: "Mathematics" }, { classId: G9, subject: "English" }]);
  });

  it("an unknown class or a subject outside the class's curriculum fails the whole request", () => {
    expect(resolveTeacherPairs(d, { pairs: [{ classId: "gone", subject: "English" }] }).ok).toBe(false);
    const bad = resolveTeacherPairs(d, { pairs: [{ classId: G9, subject: "English" }, { classId: G9, subject: "Chemistry" }] });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/Chemistry is not part of the curriculum for Grade 9/);
  });

  it("a pair another teacher holds needs an explicit reassignment of exactly that pair", () => {
    const want = { pairs: [{ classId: G9, subject: "Science" }], excludeTeacherId: "t1" };
    expect(resolveTeacherPairs(d, want).ok).toBe(false);
    expect(resolveTeacherPairs(d, { ...want, reassignSet: new Set([pairKey(G9, "Science")]) }).ok).toBe(true);
    expect(resolveTeacherPairs(d, { ...want, reassignSet: new Set([pairKey(G10, "Science")]) }).ok).toBe(false);
    // the pair the requesting teacher already holds is never a conflict with themselves
    expect(resolveTeacherPairs(d, { pairs: [{ classId: G9, subject: "Science" }], excludeTeacherId: "t2" }).ok).toBe(true);
  });
});
