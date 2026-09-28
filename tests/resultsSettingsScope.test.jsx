import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Results Settings page: what is being VIEWED (Academic year / Semester / Grade filters) is separate
// from where a structure is APPLIED (explicit grades x semesters), and deleting a structure that has
// saved results is refused with the real affected-student count. The page is the real component; only
// the data layer behind useData is a stub, so every call the page makes is asserted.
const h = vi.hoisted(() => ({ data: null, toast: () => {} }));
vi.mock("../src/lib/supabaseClient", () => ({ supabase: {}, recoveryUrlState: {}, scrubAuthParamsFromUrl() {} })); // no .env needed
vi.mock("../src/context/DataContext", async (importOriginal) => ({ ...(await importOriginal()), useData: () => h.data }));
vi.mock("../src/context/AuthContext", () => ({ useAuth: () => ({ currentUser: { id: "owner", role: "OWNER" }, realUser: { id: "owner", role: "OWNER" } }) }));
vi.mock("../src/context/ToastContext", () => ({ useToast: () => (...a) => h.toast(...a) }));

import { ResultsSettingsPage } from "../src/pages/admin/ResultsSettings";

const Y19 = { id: "y19", ecLabel: "2019-2020", gcLabel: "2026-2027", yearStart: "2026-09-11", yearEnd: "2027-07-07", isCurrent: true };
const Y20 = { id: "y20", ecLabel: "2020-2021", gcLabel: "2027-2028", yearStart: "2027-09-11", yearEnd: "2028-07-07", isCurrent: false };
// The database hands classes back in TEXT order ("Grade 10" < "Grade 11" < "Grade 12" < "Grade 9").
const TEXT_ORDER = ["Grade 1", "Grade 10", "Grade 11", "Grade 12", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9"];
const CANONICAL = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`);
const comp = (id, name, weight, kind, order) => ({ id, name, weight, kind, order, active: true });
const cfg = (id, academicYearId, semester, grade, components, status = "ACTIVE", version = 1) => ({ id, academicYearId, semester, grade, status, version, components, updatedAt: null });
const G10_S2 = cfg("g10s2", "y19", "S2", "Grade 10", [comp("a1", "Midterm", 40, "TEST", 0), comp("a2", "Final", 60, "NON_TEST", 1)]);

function makeData(over = {}) {
  const configs = over.configs || [G10_S2];
  return {
    db: {
      academicYears: [Y19, Y20], workspaceYear: Y19,
      classes: TEXT_ORDER.map((g) => ({ id: `c-${g}`, grade: g, section: "" })),
      resultConfigs: configs, resultConfigAudit: [], results: over.results || [], resultEvidence: [],
    },
    semesterResultLockInfo: () => null,
    resultConfigVersions: (y, s, g) => configs.filter((c) => c.academicYearId === y && c.semester === s && c.grade === g),
    saveResultConfiguration: vi.fn(async ({ grades, semesters }) => ({ ok: true, results: grades.flatMap((g) => semesters.map((s) => ({ grade: g, semester: s, action: "CREATED" }))) })),
    resultConfigDeleteImpact: vi.fn(async () => ({ ok: true, impact: { canDelete: true, savedStudentCount: 0, savedResultCount: 0, emptyDraftCount: 0, students: [] } })),
    deleteResultConfiguration: vi.fn(async () => ({ ok: true, message: "", result: { outcome: "DELETED" } })),
    ...over.fns,
  };
}
const mount = (over) => { h.data = makeData(over); return render(<ResultsSettingsPage onBack={() => {}} onViewResults={over?.onViewResults} />); };
const options = (label) => within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.textContent);
const previewItems = () => within(screen.getByRole("list", { name: "Affected combinations" })).getAllByRole("listitem").map((li) => li.textContent);
const overviewHeaders = () => within(screen.getByRole("table")).getAllByRole("columnheader").map((c) => c.textContent);
const overviewGrades = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
async function addStructure() {
  fireEvent.click(screen.getByText("Add assessment"));
  fireEvent.change(screen.getByLabelText("Assessment 1 name"), { target: { value: "Final exam" } });
  fireEvent.change(screen.getByLabelText("Assessment 1 weight"), { target: { value: "100" } });
}

beforeEach(() => { h.toast = vi.fn(); window.scrollTo = vi.fn(); });
afterEach(() => cleanup());

describe("Test 1 — the top Semester selector", () => {
  it("defaults to All and offers exactly All / Semester 1 / Semester 2", () => {
    mount();
    expect(screen.getByLabelText("Semester").value).toBe("ALL");
    expect(options("Semester")).toEqual(["All", "Semester 1", "Semester 2"]);
  });
  it("is a view filter: it narrows the overview columns and never changes what gets applied", () => {
    mount();
    expect(overviewHeaders()).toEqual(["Grade", "Semester 1", "Semester 2"]);
    fireEvent.change(screen.getByLabelText("Semester"), { target: { value: "S1" } });
    expect(overviewHeaders()).toEqual(["Grade", "Semester 1"]);
    fireEvent.change(screen.getByLabelText("Semester"), { target: { value: "S2" } });
    expect(overviewHeaders()).toEqual(["Grade", "Semester 2"]);
    fireEvent.change(screen.getByLabelText("Semester"), { target: { value: "ALL" } });
    expect(overviewHeaders()).toEqual(["Grade", "Semester 1", "Semester 2"]);
  });
});

describe("Test 2 — the Grade selector", () => {
  it("defaults to All and lists Grade 1 … Grade 12 in numeric order (9, 10, 11, 12 present)", () => {
    mount();
    expect(screen.getByLabelText("Grade").value).toBe("ALL");
    expect(options("Grade")).toEqual(["All", ...CANONICAL]);
    const list = options("Grade");
    for (const g of ["Grade 9", "Grade 10", "Grade 11", "Grade 12"]) expect(list).toContain(g);
    expect(list.indexOf("Grade 9")).toBeLessThan(list.indexOf("Grade 10"));
  });
  it("the overview follows the same order, and a concrete grade filter shows just that grade", () => {
    mount();
    expect(overviewGrades()).toEqual(CANONICAL);
    fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "Grade 10" } });
    expect(overviewGrades()).toEqual(["Grade 10"]);
  });
});

describe("Test 3 — apply to All grades x All semesters", () => {
  it("previews every one of the 24 combinations exactly once, then saves them in one call", async () => {
    mount({ configs: [] });
    await addStructure();
    expect(screen.getByText("Choose at least one grade and one semester.")).toBeTruthy(); // "All" in the view never picks a target
    fireEvent.click(screen.getByLabelText("All semesters"));
    fireEvent.click(screen.getByLabelText("All grades"));
    expect(screen.getByText("This will affect 24 combinations:")).toBeTruthy();
    const items = previewItems();
    expect(items.length).toBe(24);
    const names = items.map((t) => t.replace(/(new|already identical|replaces.*)$/, ""));
    expect(new Set(names).size).toBe(24);
    expect(names[0]).toBe("Grade 1 — Semester 1");
    expect(names[1]).toBe("Grade 1 — Semester 2");
    expect(names[22]).toBe("Grade 12 — Semester 1");
    expect(names[23]).toBe("Grade 12 — Semester 2");
    expect(names.indexOf("Grade 9 — Semester 1")).toBeLessThan(names.indexOf("Grade 10 — Semester 1"));

    fireEvent.click(screen.getByText("Save for 24 combinations"));
    fireEvent.click(await screen.findByText("Apply and save")); // confirm, since it reaches beyond one structure
    await waitFor(() => expect(h.data.saveResultConfiguration).toHaveBeenCalledTimes(1));
    const call = h.data.saveResultConfiguration.mock.calls[0][0];
    expect(call.academicYearId).toBe("y19");
    expect(call.semesters.sort()).toEqual(["S1", "S2"]);
    expect(call.grades.sort()).toEqual([...CANONICAL].sort());
    expect(call.components).toEqual([{ name: "Final exam", weight: 100, kind: "TEST" }]);
  });
});

describe("Tests 4 & 5 — apply to one semester / all semesters", () => {
  it("Grade 10 + Semester 1 previews and saves ONLY that combination", async () => {
    mount({ configs: [] });
    await addStructure();
    fireEvent.click(screen.getByLabelText("Semester 1"));
    fireEvent.click(screen.getByLabelText("Grade 10", { selector: "input" }));
    expect(screen.getByText("This will affect 1 combination:")).toBeTruthy();
    expect(previewItems().map((t) => t.replace(/new$/, ""))).toEqual(["Grade 10 — Semester 1"]);
    fireEvent.click(screen.getByText("Save Configuration"));
    await waitFor(() => expect(h.data.saveResultConfiguration).toHaveBeenCalledTimes(1));
    expect(h.data.saveResultConfiguration.mock.calls[0][0]).toMatchObject({ grades: ["Grade 10"], semesters: ["S1"] });
  });

  it("Grade 10 + All semesters affects Semester 1 and Semester 2 of Grade 10 only", async () => {
    mount({ configs: [] });
    await addStructure();
    fireEvent.click(screen.getByLabelText("All semesters"));
    fireEvent.click(screen.getByLabelText("Grade 10", { selector: "input" }));
    expect(screen.getByText("This will affect 2 combinations:")).toBeTruthy();
    expect(previewItems().map((t) => t.replace(/new$/, ""))).toEqual(["Grade 10 — Semester 1", "Grade 10 — Semester 2"]);
    fireEvent.click(screen.getByText("Save for 2 combinations"));
    fireEvent.click(await screen.findByText("Apply and save"));
    await waitFor(() => expect(h.data.saveResultConfiguration).toHaveBeenCalledTimes(1));
    const call = h.data.saveResultConfiguration.mock.calls[0][0];
    expect([call.grades, call.semesters.sort()]).toEqual([["Grade 10"], ["S1", "S2"]]);
  });

  it("the preview says which combinations are new, which replace an existing structure and which are already identical", async () => {
    mount({ configs: [G10_S2] });
    fireEvent.click(screen.getAllByLabelText("Edit structure for Grade 10 Semester 2")[0]); // loads Grade 10 · Semester 2 as-is
    fireEvent.click(screen.getByLabelText("Semester 1"));
    const text = previewItems();
    expect(text).toEqual(["Grade 10 — Semester 1new", "Grade 10 — Semester 2already identical"]);
    expect(screen.getByText(/1 new · 0 replaced · 1 already identical/)).toBeTruthy();
  });
});

describe("the page filter never restricts the explicit Apply target", () => {
  it("Semester 1 in the view + All semesters in Apply -> both semesters are applied, and the page says so", async () => {
    mount({ configs: [] });
    fireEvent.change(screen.getByLabelText("Semester"), { target: { value: "S1" } });
    fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "Grade 10" } });
    await addStructure();
    // a concrete filter pre-fills the (untouched) apply target — visibly — but it is only a starting point
    expect(previewItems().map((t) => t.replace(/new$/, ""))).toEqual(["Grade 10 — Semester 1"]);
    fireEvent.click(screen.getByLabelText("All semesters"));
    expect(previewItems().map((t) => t.replace(/new$/, ""))).toEqual(["Grade 10 — Semester 1", "Grade 10 — Semester 2"]);
    const note = screen.getByTestId("scope-note").textContent;
    expect(note).toMatch(/Page filter: Semester 1 · Grade 10/);
    expect(note).toMatch(/Apply target: All semesters · Grade 10/);
    expect(note).toMatch(/The page filter controls what you are viewing\. The Apply target controls where this structure will be created/);
    // changing the view afterwards does not rewrite a target the user chose
    fireEvent.change(screen.getByLabelText("Semester"), { target: { value: "S2" } });
    expect(previewItems().length).toBe(2);
  });

  it("switching the academic year starts clean: structures of one year never appear under another", () => {
    const y20 = cfg("y20-g10s1", "y20", "S1", "Grade 10", [comp("b1", "Quiz", 30, "NON_TEST", 0), comp("b2", "Exam", 70, "TEST", 1)]);
    const y19 = cfg("y19-g10s1", "y19", "S1", "Grade 10", [comp("c1", "Midterm", 50, "TEST", 0), comp("c2", "Final", 50, "TEST", 1)]);
    mount({ configs: [y19, y20] });
    fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "Grade 10" } });
    let table = screen.getByRole("table");
    expect(within(table).getByText(/Midterm 50/)).toBeTruthy();
    expect(within(table).queryByText(/Quiz 30/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Academic year"), { target: { value: "y20" } });
    table = screen.getByRole("table");
    expect(within(table).getByText(/Quiz 30/)).toBeTruthy();
    expect(within(table).queryByText(/Midterm 50/)).toBeNull();
  });
});

describe("Test 6 (UI) — a structure with saved results cannot be deleted", () => {
  const blocked = (students, count = students.length) => ({ ok: true, impact: { canDelete: false, savedStudentCount: count, savedResultCount: count, emptyDraftCount: 0, students } });

  it("shows the real affected student and offers no delete button; nothing is deleted", async () => {
    const onViewResults = vi.fn();
    mount({ onViewResults, fns: { resultConfigDeleteImpact: vi.fn(async () => blocked([{ studentId: "s1", name: "Maxamed Bashiir Ahmed", subject: "MATHEMATICS", status: "DRAFT" }])) } });
    fireEvent.click(screen.getByLabelText("Delete structure for Grade 10 Semester 2"));
    expect(await screen.findByText("Cannot delete this assessment structure")).toBeTruthy();
    expect(screen.getByText(/Grade 10 — Semester 2/)).toBeTruthy();
    expect(screen.getByText(/1 student has saved results under this structure\./)).toBeTruthy();
    expect(screen.getByText(/Maxamed Bashiir Ahmed/)).toBeTruthy();
    expect(screen.getByText(/Remove or move that student's saved results before deleting the structure\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete structure" })).toBeNull();
    expect(h.data.resultConfigDeleteImpact).toHaveBeenCalledWith({ academicYearId: "y19", semester: "S2", grade: "Grade 10" });
    expect(h.data.deleteResultConfiguration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("View affected results"));
    expect(onViewResults).toHaveBeenCalledWith({ grade: "Grade 10", semester: "S2", academicYearId: "y19" });
  });

  it("says how many students when there are many", async () => {
    const students = Array.from({ length: 28 }, (_, i) => ({ studentId: `s${i}`, name: `Student ${i + 1}`, subject: "MATHEMATICS", status: "PUBLISHED" }));
    mount({ fns: { resultConfigDeleteImpact: vi.fn(async () => blocked(students)) } });
    fireEvent.click(screen.getByLabelText("Delete structure for Grade 10 Semester 2"));
    expect(await screen.findByText(/28 students have saved results under this structure\./)).toBeTruthy();
    expect(screen.getByText(/Review the saved results before deleting the structure\./)).toBeTruthy();
    expect(screen.getByText(/and 18 more/)).toBeTruthy();
  });

  it("re-checks in the delete itself: if a score was saved after the page looked, the server refusal replaces the confirm dialog", async () => {
    const refusal = { ok: false, message: "Cannot delete this assessment structure. Grade 10 — Semester 2. 1 student has saved results under it: Ann One.", impact: { canDelete: false, savedStudentCount: 1, savedResultCount: 1, emptyDraftCount: 0, students: [{ studentId: "s1", name: "Ann One", subject: "MATHEMATICS", status: "DRAFT" }] } };
    mount({ fns: { deleteResultConfiguration: vi.fn(async () => refusal) } });
    fireEvent.click(screen.getByLabelText("Delete structure for Grade 10 Semester 2"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete structure" })); // the page saw no saved results
    expect(await screen.findByText("Cannot delete this assessment structure")).toBeTruthy();
    expect(screen.getByText(/1 student has saved results under this structure\./)).toBeTruthy();
    expect(screen.getByText(/Ann One/)).toBeTruthy();
    expect(h.data.deleteResultConfiguration).toHaveBeenCalledWith({ academicYearId: "y19", semester: "S2", grade: "Grade 10" });
    expect(h.toast).not.toHaveBeenCalledWith(expect.stringMatching(/deleted/), "success");
  });

  it("with nothing saved the delete goes through, and empty drafts are mentioned", async () => {
    mount({ fns: { resultConfigDeleteImpact: vi.fn(async () => ({ ok: true, impact: { canDelete: true, savedStudentCount: 0, savedResultCount: 0, emptyDraftCount: 2, students: [] } })) } });
    fireEvent.click(screen.getByLabelText("Delete structure for Grade 10 Semester 2"));
    expect(await screen.findByText(/2 empty drafts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete structure" }));
    await waitFor(() => expect(h.data.deleteResultConfiguration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Structure for Grade 10 · Semester 2 deleted.", "success"));
  });
});
