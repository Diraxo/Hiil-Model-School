import { describe, it, expect } from "vitest";
import { activeConfigFor, activeAssessments } from "../src/utils/resultConfig";

const comp = (id, name, weight, kind = "NON_TEST", order = 0) => ({ id, name, weight, kind, order, active: true });
const cfg = (id, academicYearId, semester, grade, components, status = "ACTIVE", version = 1) => ({ id, academicYearId, semester, grade, status, version, components });

const Y26 = "y-2026";
const Y27 = "y-2027";
const configs = [
  cfg("c9", Y26, "S1", "Grade 9", [comp("t9", "Test", 20, "TEST", 0), comp("a9", "Assignment", 10, "NON_TEST", 1), comp("f9", "Final", 70, "TEST", 2)]),
  cfg("c10", Y26, "S1", "Grade 10", [comp("t10", "Test", 30, "TEST", 0), comp("a10", "Assignment", 20, "NON_TEST", 1), comp("f10", "Final", 50, "TEST", 2)]),
];
const weights = (c) => activeAssessments(c).map((a) => a.weight);

describe("Results structure is scoped to academic year + semester + grade", () => {
  it("A: Grade 9 sees its own structure, Grade 10 does not get it", () => {
    expect(weights(activeConfigFor(configs, Y26, "S1", "Grade 9"))).toEqual([20, 10, 70]);
    expect(activeConfigFor(configs, Y26, "S1", "Grade 10").id).not.toBe("c9");
  });
  it("B: Grade 10 sees only Grade 10; Grade 9 is unaffected", () => {
    expect(weights(activeConfigFor(configs, Y26, "S1", "Grade 10"))).toEqual([30, 20, 50]);
    expect(weights(activeConfigFor(configs, Y26, "S1", "Grade 9"))).toEqual([20, 10, 70]);
  });
  it("C: a grade with no configuration resolves to null, never another grade's", () => {
    expect(activeConfigFor(configs, Y26, "S1", "Grade 11")).toBeNull();
    expect(activeConfigFor(configs, Y26, "S1", "Grade 12")).toBeNull();
    expect(activeConfigFor(configs, Y26, "S1", null)).toBeNull();
    expect(activeConfigFor(configs, Y26, "S1", undefined)).toBeNull();
  });
  it("C2: with only Grade 9 configured, Grade 10 is null", () => {
    expect(activeConfigFor([configs[0]], Y26, "S1", "Grade 10")).toBeNull();
  });
  it("E: switching grade 9 -> 10 -> 11 -> 9 always follows the selected grade", () => {
    const seq = ["Grade 9", "Grade 10", "Grade 11", "Grade 9"];
    expect(seq.map((g) => activeConfigFor(configs, Y26, "S1", g)?.id ?? null)).toEqual(["c9", "c10", null, "c9"]);
  });
  it("F: academic years do not leak", () => {
    expect(activeConfigFor(configs, Y27, "S1", "Grade 9")).toBeNull();
    expect(activeConfigFor(configs, Y27, "S1", "Grade 10")).toBeNull();
  });
  it("G: semesters do not leak", () => {
    expect(activeConfigFor(configs, Y26, "S2", "Grade 9")).toBeNull();
  });
  it("an archived (deleted-with-results) structure is never the active one", () => {
    const archived = [cfg("old", Y26, "S1", "Grade 11", [comp("x", "Test", 100, "TEST")], "ARCHIVED", 1)];
    expect(activeConfigFor(archived, Y26, "S1", "Grade 11")).toBeNull();
  });
  it("a new version is preferred over its archived predecessor for the same scope", () => {
    const v = [
      cfg("v1", Y26, "S1", "Grade 9", [comp("a", "Test", 100, "TEST")], "ARCHIVED", 1),
      cfg("v2", Y26, "S1", "Grade 9", [comp("b", "Test", 40, "TEST"), comp("c", "Final", 60, "TEST", 1)], "ACTIVE", 2),
    ];
    expect(activeConfigFor(v, Y26, "S1", "Grade 9").id).toBe("v2");
  });
  it("D: a result is matched by class, so a Grade 9 result is invisible under a Grade 10 class", () => {
    // Mirrors the record lookup in DataContext.getResult / saveResultComponent (classId is part of it).
    const results = [{ id: "r1", studentId: "s1", classId: "class-9", subject: "Math", semester: "S1", academicYearId: Y26 }];
    const find = (classId) => results.find((r) => r.studentId === "s1" && r.classId === classId && r.subject === "Math" && r.semester === "S1" && r.academicYearId === Y26) || null;
    expect(find("class-9")).not.toBeNull();
    expect(find("class-10")).toBeNull();
  });
});
