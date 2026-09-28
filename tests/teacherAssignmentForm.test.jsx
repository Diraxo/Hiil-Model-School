// The Add/Edit Teacher form: teaching assignments are entered as explicit class + subject PAIRS.
// Selecting Grade 9 — English and Grade 10 — Mathematics must send exactly those two pairs.
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";

vi.mock("../src/lib/supabaseClient", () => ({ supabase: {} }));

const C9 = "c9", C10 = "c10";
const curriculum = { [C9]: ["English", "Mathematics", "Science"], [C10]: ["Mathematics", "Physics"] };
const state = { assignments: [], calls: {} };

const cls = [{ id: C9, grade: "Grade 9", section: "" }, { id: C10, grade: "Grade 10", section: "" }];
vi.mock("../src/context/DataContext", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useData: () => ({
      db: { classes: cls, subjects: [], teacherAssignments: state.assignments, staff: [] },
      getClass: (id) => cls.find((c) => c.id === id) || null,
      requiredSubjectsForClass: (id) => curriculum[id] || [],
      subjectAssignmentOwner: (classId, subject) => {
        const ta = state.assignments.find((t) => t.classId === classId && t.subject === subject);
        return ta ? { teacherId: ta.teacherId, teacherName: ta.teacherId === "t2" ? "Dawit Alemu" : "Tigist Bekele" } : null;
      },
      createTeacher: async (payload) => { state.calls.create = payload; return { ok: true, teacherId: "new" }; },
      updateTeacher: async () => ({ ok: true }),
      updateTeacherAssignments: async (...args) => { state.calls.update = args; return { ok: true }; },
      resetTeacherPassword: async () => ({ ok: true }),
    }),
  };
});
vi.mock("../src/context/ToastContext", () => ({ useToast: () => () => {} }));

import { TeacherFormModal } from "../src/pages/admin/AdminPages";

beforeEach(() => { state.assignments = []; state.calls = {}; });
afterEach(cleanup);

function pick(classLabel, subject) {
  const classSel = screen.getByLabelText("Assignment class");
  fireEvent.change(classSel, { target: { value: classLabel === "Grade 9" ? C9 : C10 } });
  fireEvent.change(screen.getByLabelText("Assignment subject"), { target: { value: subject } });
  fireEvent.click(screen.getByRole("button", { name: /^(Add|Reassign & add)$/ }));
}
const listed = () => screen.queryAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label").replace(/^Remove /, ""));

function fillAddForm() {
  fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Amina" } });
  fireEvent.change(screen.getByLabelText(/Middle name/), { target: { value: "Ali" } });
  fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: "Hassan" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "amina@school.test" } });
  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "+252 61 000 0000" } });
}

describe("Add Teacher: pair entry", () => {
  it("there are no independent Classes / Subjects checkbox lists any more", () => {
    render(<TeacherFormModal open onClose={() => {}} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Teaching assignments")).toBeTruthy();
    expect(screen.getByLabelText("Assignment class")).toBeTruthy();
    expect(screen.getByLabelText("Assignment subject")).toBeTruthy();
  });

  it("the subject list is that class's own curriculum", () => {
    render(<TeacherFormModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Assignment class"), { target: { value: C10 } });
    const options = within(screen.getByLabelText("Assignment subject")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose subject…", "Mathematics", "Physics"]); // Grade 10 has no English
  });

  it("Grade 9 — English + Grade 10 — Mathematics submits exactly those two pairs (no Grade 9 Mathematics, no Grade 10 English)", async () => {
    render(<TeacherFormModal open onClose={() => {}} />);
    fillAddForm();
    pick("Grade 9", "English");
    pick("Grade 10", "Mathematics");
    expect(listed()).toEqual(["Grade 9 — English", "Grade 10 — Mathematics"]);
    fireEvent.click(screen.getByRole("button", { name: "Add Teacher" }));
    await waitFor(() => expect(state.calls.create).toBeTruthy());
    expect(state.calls.create.assignments).toEqual([{ classId: C9, subject: "English" }, { classId: C10, subject: "Mathematics" }]);
    expect(state.calls.create.subjects).toBeUndefined();
    expect(state.calls.create.classIds).toBeUndefined();
  });

  it("the same pair can't be added twice, and Remove drops only that pair", () => {
    render(<TeacherFormModal open onClose={() => {}} />);
    pick("Grade 9", "English");
    pick("Grade 9", "Mathematics");
    pick("Grade 10", "Mathematics");
    expect(listed()).toEqual(["Grade 9 — English", "Grade 9 — Mathematics", "Grade 10 — Mathematics"]);
    fireEvent.change(screen.getByLabelText("Assignment class"), { target: { value: C9 } });
    const englishOption = within(screen.getByLabelText("Assignment subject")).getByRole("option", { name: /English/ });
    expect(englishOption.disabled).toBe(true); // already added
    fireEvent.click(screen.getByRole("button", { name: "Remove Grade 9 — English" }));
    expect(listed()).toEqual(["Grade 9 — Mathematics", "Grade 10 — Mathematics"]);
  });

  it("at least one assignment is required", async () => {
    render(<TeacherFormModal open onClose={() => {}} />);
    fillAddForm();
    fireEvent.click(screen.getByRole("button", { name: "Add Teacher" }));
    expect(await screen.findByText("Please add at least one class + subject assignment.")).toBeTruthy();
    expect(state.calls.create).toBeUndefined();
  });

  it("a pair held by another teacher is offered only as an explicit 'Reassign & add' and is sent as a reassignment of that exact pair", async () => {
    state.assignments = [{ id: "x", teacherId: "t2", classId: C9, subject: "Science" }];
    render(<TeacherFormModal open onClose={() => {}} />);
    fillAddForm();
    fireEvent.change(screen.getByLabelText("Assignment class"), { target: { value: C9 } });
    fireEvent.change(screen.getByLabelText("Assignment subject"), { target: { value: "Science" } });
    expect(screen.getByText(/currently taught by Dawit Alemu/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reassign & add" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Teacher" }));
    await waitFor(() => expect(state.calls.create).toBeTruthy());
    expect(state.calls.create.assignments).toEqual([{ classId: C9, subject: "Science" }]);
    expect(state.calls.create.reassignments).toEqual([{ classId: C9, subject: "Science" }]);
  });
});

describe("Edit Teacher: existing pairs stay exactly as they are", () => {
  const teacher = { id: "t1", name: "Tigist Bekele", firstName: "Tigist", middleName: "B", lastName: "Bekele", email: "t1@x.test", phone: "1", photo: null };
  beforeEach(() => {
    state.assignments = [
      { id: "a1", teacherId: "t1", classId: C9, subject: "English" },
      { id: "a2", teacherId: "t1", classId: C10, subject: "Mathematics" },
    ];
  });

  it("opens with Grade 9 — English and Grade 10 — Mathematics — not the four-way product", () => {
    render(<TeacherFormModal open onClose={() => {}} teacher={teacher} />);
    expect(listed()).toEqual(["Grade 9 — English", "Grade 10 — Mathematics"]);
  });

  it("saving without changes sends the same two pairs back (never widened)", async () => {
    render(<TeacherFormModal open onClose={() => {}} teacher={teacher} />);
    await waitFor(() => expect(listed()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(state.calls.update).toBeTruthy());
    const [teacherId, assignments, reassignments] = state.calls.update;
    expect(teacherId).toBe("t1");
    expect(assignments).toEqual([{ classId: C9, subject: "English" }, { classId: C10, subject: "Mathematics" }]);
    expect(reassignments).toEqual([]);
  });

  it("removing Grade 9 — English saves only Grade 10 — Mathematics", async () => {
    render(<TeacherFormModal open onClose={() => {}} teacher={teacher} />);
    await waitFor(() => expect(listed()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove Grade 9 — English" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(state.calls.update).toBeTruthy());
    expect(state.calls.update[1]).toEqual([{ classId: C10, subject: "Mathematics" }]);
  });

  it("adding Grade 9 — Science adds just that pair to the existing two", async () => {
    render(<TeacherFormModal open onClose={() => {}} teacher={teacher} />);
    await waitFor(() => expect(listed()).toHaveLength(2));
    pick("Grade 9", "Science");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(state.calls.update).toBeTruthy());
    expect(state.calls.update[1]).toEqual([
      { classId: C9, subject: "English" }, { classId: C10, subject: "Mathematics" }, { classId: C9, subject: "Science" },
    ]);
  });
});
