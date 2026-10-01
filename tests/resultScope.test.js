import { describe, expect, it } from "vitest";
import { GRADES, sortGrades, compareGrades } from "../src/utils/constants";
import {
  gradesFromClasses, expandTargets, planApplyTargets, resultHasRecordedData, resultStateOf, classifyRecordedResult, planRecordingScreen,
  gradesInView, semestersInView, FILTER_ALL,
} from "../src/utils/resultConfig";

// One canonical grade order, exact grade x semester expansion, and the "what counts as recorded" rule
// that decides Not started / Draft / Saved and what protects a structure from deletion.
const comp = (id, name, weight, kind = "TEST", order = 0) => ({ id, name, weight, kind, order, active: true });
const cfg = (id, semester, grade, components, status = "ACTIVE", version = 1, academicYearId = "y19") => ({ id, academicYearId, semester, grade, status, version, components });

describe("one canonical grade order", () => {
  const dbOrder = ["Grade 1", "Grade 10", "Grade 11", "Grade 12", "Grade 2", "Grade 9", "Grade 3"];
  it("never sorts grade labels as text: 9 comes before 10, 11, 12", () => {
    expect(sortGrades(dbOrder)).toEqual(["Grade 1", "Grade 2", "Grade 3", "Grade 9", "Grade 10", "Grade 11", "Grade 12"]);
    expect(gradesFromClasses(dbOrder.map((g) => ({ grade: g })))).toEqual(sortGrades(dbOrder));
  });
  it("covers KG and unknown grades without breaking the order", () => {
    expect(sortGrades(["Grade 3", "KG2", "Form 4", "KG1", "Form 10"])).toEqual(["KG1", "KG2", "Grade 3", "Form 4", "Form 10"]);
    expect(compareGrades("Grade 9", "Grade 10")).toBeLessThan(0);
    expect(GRADES.slice(-4)).toEqual(["Grade 9", "Grade 10", "Grade 11", "Grade 12"]);
  });
  it("gradesFromClasses lists a grade once however many sections it has", () => {
    expect(gradesFromClasses([{ grade: "Grade 10" }, { grade: "Grade 10" }, { grade: "Grade 9" }, { grade: "" }, {}])).toEqual(["Grade 9", "Grade 10"]);
  });
});

describe("view filters", () => {
  it("All shows everything; a concrete value narrows to it", () => {
    const grades = sortGrades(["Grade 9", "Grade 10"]);
    expect(gradesInView(grades, FILTER_ALL)).toEqual(grades);
    expect(gradesInView(grades, "Grade 10")).toEqual(["Grade 10"]);
    expect(semestersInView(FILTER_ALL)).toEqual(["S1", "S2"]);
    expect(semestersInView("S2")).toEqual(["S2"]);
  });
});

describe("expandTargets", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`);
  it("12 grades x 2 semesters is 24 distinct combinations in canonical order", () => {
    const t = expandTargets(twelve, ["S1", "S2"]);
    expect(t.length).toBe(24);
    expect(new Set(t.map((x) => `${x.grade}|${x.semester}`)).size).toBe(24);
    expect(t[0]).toEqual({ grade: "Grade 1", semester: "S1" });
    expect(t[23]).toEqual({ grade: "Grade 12", semester: "S2" });
  });
  it("Grade 10 + Semester 1 is exactly one combination; Grade 10 + both is two", () => {
    expect(expandTargets(["Grade 10"], ["S1"])).toEqual([{ grade: "Grade 10", semester: "S1" }]);
    expect(expandTargets(["Grade 10"], ["S2", "S1"])).toEqual([{ grade: "Grade 10", semester: "S1" }, { grade: "Grade 10", semester: "S2" }]);
  });
  it("duplicates, unknown semesters and empty selections never produce extra or phantom combinations", () => {
    expect(expandTargets(["Grade 10", "Grade 10"], ["S1", "S1", "S3"]).length).toBe(1);
    expect(expandTargets([], ["S1"])).toEqual([]);
    expect(expandTargets(["Grade 10"], [])).toEqual([]);
  });
});

describe("planApplyTargets", () => {
  const draft = [{ name: "Test", weight: 100, kind: "TEST" }];
  const configs = [
    cfg("same", "S1", "Grade 10", [comp("a", "Test", 100)]),
    cfg("diff", "S2", "Grade 10", [comp("b", "Other", 100)]),
    cfg("other-year", "S1", "Grade 9", [comp("c", "Test", 100)], "ACTIVE", 1, "y20"),
  ];
  it("classifies each target as create / replace / same, scoped to the academic year", () => {
    const targets = expandTargets(["Grade 9", "Grade 10"], ["S1", "S2"]);
    const plan = planApplyTargets({ targets, configs, results: [], evidence: [], academicYearId: "y19", draftRows: draft });
    expect(plan.map((p) => `${p.grade}|${p.semester}|${p.status}`)).toEqual([
      "Grade 9|S1|create", "Grade 9|S2|create", "Grade 10|S1|same", "Grade 10|S2|replace",
    ]);
  });
  it("flags a replacement as a new version only when RECORDED results sit under it (an empty draft does not)", () => {
    const targets = expandTargets(["Grade 10"], ["S2"]);
    const empty = [{ id: "r1", configurationId: "diff", publishStatus: "DRAFT", componentRows: [] }];
    const saved = [{ id: "r1", configurationId: "diff", publishStatus: "DRAFT", componentRows: [{ assessmentId: "b", score: 5 }] }];
    expect(planApplyTargets({ targets, configs, results: empty, evidence: [], academicYearId: "y19", draftRows: draft })[0].hasResults).toBe(false);
    expect(planApplyTargets({ targets, configs, results: saved, evidence: [], academicYearId: "y19", draftRows: draft })[0].hasResults).toBe(true);
  });
});

describe("what counts as recorded", () => {
  const empty = { id: "r", publishStatus: "DRAFT", componentRows: [] };
  it("an empty draft, or one whose scores were cleared, is not a result", () => {
    expect(resultHasRecordedData(null, [])).toBe(false);
    expect(resultHasRecordedData(empty, [])).toBe(false);
    expect(resultHasRecordedData({ ...empty, componentRows: [{ assessmentId: "a", score: null }] }, [])).toBe(false);
    expect(resultStateOf(empty, [])).toBe("NOT_STARTED");
  });
  it("a score, an evidence page, or a locked status is a result (an emptied published result is not)", () => {
    expect(resultStateOf({ ...empty, componentRows: [{ assessmentId: "a", score: 0 }] }, [])).toBe("DRAFT"); // a recorded 0 counts
    expect(resultStateOf(empty, [{ resultId: "r" }])).toBe("DRAFT");
    expect(resultStateOf(empty, [{ resultId: "someone-else" }])).toBe("NOT_STARTED");
    expect(resultStateOf({ ...empty, publishStatus: "PUBLISHED", componentRows: [{ assessmentId: "a", score: 50 }] }, [])).toBe("SAVED");
    // a published result whose every score and image was removed is empty: it follows the active structure
    expect(resultStateOf({ ...empty, publishStatus: "PUBLISHED" }, [])).toBe("NOT_STARTED");
    expect(resultStateOf({ ...empty, publishStatus: "LOCKED" }, [])).toBe("LOCKED");
  });
});

describe("classifyRecordedResult / planRecordingScreen", () => {
  const active = cfg("cur", "S1", "Grade 10", [comp("t", "Test", 100)], "ACTIVE", 2);
  const closed = cfg("old", "S1", "Grade 10", [comp("o", "Old", 100)], "SUPERSEDED", 1);
  const saved = (id, configuration) => ({ id: `r-${id}`, studentId: id, publishStatus: "PUBLISHED", componentRows: [{ assessmentId: "o", score: 50 }], configuration });
  const students = ["s1", "s2", "s3"].map((id) => ({ id }));
  const plan = (records, activeConfig) => planRecordingScreen({ students, recordFor: (id) => records[id] || null, activeConfig, evidence: [] });

  it("recorded under a closed structure with NO active one is HISTORICAL; with an active successor it is an EARLIER_VERSION", () => {
    expect(classifyRecordedResult(saved("s1", closed), null, []).kind).toBe("HISTORICAL");
    expect(classifyRecordedResult(saved("s1", closed), active, []).kind).toBe("EARLIER_VERSION");
    expect(classifyRecordedResult(saved("s1", active), active, []).kind).toBe("CURRENT");
    expect(classifyRecordedResult({ ...saved("s1", closed), publishStatus: "DRAFT", componentRows: [] }, active, []).kind).toBe("NOT_STARTED");
  });
  it("names the screen state", () => {
    expect(plan({}, active).state).toBe("A_CONFIGURED_EMPTY");
    expect(plan({ s1: saved("s1", active) }, active).state).toBe("B_CONFIGURED_RESULTS");
    expect(plan({}, null).state).toBe("C_NO_STRUCTURE");
    expect(plan({ s1: saved("s1", closed) }, null).state).toBe("D_HISTORY_ONLY");
    expect(planRecordingScreen({ students: [], recordFor: () => null, activeConfig: active, evidence: [] }).state).toBe("E_NO_STUDENTS");
  });
  it("D: history is separate from the (unrecordable) rest of the roster; nobody is listed twice", () => {
    const p = plan({ s1: saved("s1", closed) }, null);
    expect(p.historical.map((h) => h.student.id)).toEqual(["s1"]);
    expect(p.unrecordable.map((s) => s.id)).toEqual(["s2", "s3"]);
    expect(p.groups).toEqual([]);
  });
  it("Earlier + current: the saved student sits in the earlier-version group, the others in the current one, each once", () => {
    const p = plan({ s1: saved("s1", closed) }, active);
    expect(p.groups.map((g) => [g.config.id, g.students.map((s) => s.id)])).toEqual([["cur", ["s2", "s3"]], ["old", ["s1"]]]);
    expect(p.counts).toMatchObject({ saved: 1, notStarted: 2 });
  });
});
