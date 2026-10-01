import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

const evidence = vi.hoisted(() => ({
  rows: [
    { id: "e1", resultId: "r1", assessmentId: "a1", order: 0, fileType: "image", fileDataUrl: "https://signed.example/1.png" },
    { id: "e2", resultId: "r1", assessmentId: "a1", order: 1, fileType: "image", fileDataUrl: "https://signed.example/2.png" },
    { id: "e3", resultId: "r1", assessmentId: "a1", order: 2, fileType: "image", fileDataUrl: "https://signed.example/3.png" },
  ],
}));

vi.mock("../src/context/DataContext", () => ({
  useData: () => ({
    getClass: () => ({ id: "c1", grade: "Grade 9", section: "A" }),
    classLabel: (c) => `${c.grade}${c.section}`,
    studentFullName: () => "Ahmed Abdiqadir Warsame",
    resultEvidenceFor: (rid, aid) => evidence.rows.filter((e) => e.resultId === rid && e.assessmentId === aid),
  }),
}));

import { ResultDetailModal } from "../src/components/ResultDetail";
import { singleEvidenceFile, validateEvidenceFile } from "../src/services/resultEvidenceService";

afterEach(cleanup);

const student = { id: "s1", grade: "Grade 9", section: "A" };
function record(over = {}, shared = true) {
  return {
    id: "r1", studentId: "s1", classId: "c1", subject: "Mathematics", semester: "SEMESTER_1", publishStatus: "PUBLISHED",
    assessments: [
      { id: "a1", name: "Midterm", weight: 100, kind: "TEST" },
    ],
    components: { a1: { score: 90, sharedWithParents: shared } },
    ...over,
  };
}

describe("ResultDetailModal — one read-only detail for every role", () => {
  it("parent: shows score, subject, published status and shared evidence, with no edit/publish controls", () => {
    render(<ResultDetailModal record={record()} student={student} audience="parent" onClose={() => {}} onEdit={() => {}} onHistory={() => {}} />);
    expect(screen.getByText("Mathematics")).toBeTruthy();
    expect(screen.getAllByText("90 / 100").length).toBeGreaterThan(0);
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText(/Evidence · 3 images/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /history/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /publish|delete|add evidence/i })).toBeNull();
    expect(document.querySelectorAll("input").length).toBe(0);
  });

  it("parent: publishing IS the share — evidence shows even though no per-image share flag was ever set", () => {
    render(<ResultDetailModal record={record({}, false)} student={student} audience="parent" onClose={() => {}} />);
    expect(screen.getByText(/Evidence · 3 images/)).toBeTruthy();
    expect(screen.queryByText(/Share/i)).toBeNull();
  });

  it("parent: a result with no evidence rows says so (rows the database withheld are simply absent)", () => {
    const saved = evidence.rows.splice(0);
    render(<ResultDetailModal record={record()} student={student} audience="parent" onClose={() => {}} />);
    expect(screen.getByText("No evidence images.")).toBeTruthy();
    evidence.rows.push(...saved);
  });

  it("staff: a Draft says parents cannot see it yet, and Edit is an explicit action", () => {
    const onEdit = vi.fn();
    render(<ResultDetailModal record={record({ publishStatus: "DRAFT" }, false)} student={student} audience="staff" onClose={() => {}} onEdit={onEdit} onHistory={() => {}} />);
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(/parents cannot see this result yet/i)).toBeTruthy();
    expect(document.querySelectorAll("input").length).toBe(0); // read-only until Edit is clicked
    fireEvent.click(screen.getByRole("button", { name: /edit result/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /history/i })).toBeTruthy();
  });

  it("staff without edit rights (locked / not assigned) gets no Edit button", () => {
    render(<ResultDetailModal record={record({ publishStatus: "LOCKED" })} student={student} audience="staff" onClose={() => {}} onEdit={null} />);
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit result/i })).toBeNull();
  });

  it("evidence opens inside the app and pages through all three images; Escape closes the viewer", () => {
    const { container } = render(<ResultDetailModal record={record()} student={student} audience="parent" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Open evidence 1 of 3/ }));
    const viewer = screen.getByRole("dialog", { name: /Mathematics — Midterm/ });
    expect(within(viewer).getByText(/image 1 of 3/)).toBeTruthy();
    expect(within(viewer).getByRole("img").getAttribute("src")).toBe("https://signed.example/1.png");
    expect(container.querySelector("a[href]")).toBeNull();
    fireEvent.click(within(viewer).getByRole("button", { name: "Next image" }));
    expect(within(viewer).getByText(/image 2 of 3/)).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "Next image" }));
    expect(within(viewer).queryByRole("button", { name: "Next image" })).toBeNull();
    fireEvent.click(within(viewer).getByRole("button", { name: "Previous image" }));
    expect(within(viewer).getByText(/image 2 of 3/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Mathematics — Midterm/ })).toBeNull();
  });

  it("shows an error state when an evidence image cannot load", () => {
    render(<ResultDetailModal record={record()} student={student} audience="parent" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Open evidence 2 of 3/ }));
    const viewer = screen.getByRole("dialog", { name: /Mathematics — Midterm/ });
    fireEvent.error(within(viewer).getByRole("img"));
    expect(within(viewer).getByRole("alert").textContent).toMatch(/could not be loaded/i);
  });
});

describe("one image per upload action", () => {
  const png = (n) => new File(["x"], `image${n}.png`, { type: "image/png" });

  it("accepts a single selection", () => {
    expect(singleEvidenceFile([png(1)])).toEqual({ file: expect.any(File), error: null });
  });
  it("refuses several files instead of taking the first", () => {
    const res = singleEvidenceFile([png(1), png(2), png(3)]);
    expect(res.file).toBeNull();
    expect(res.error).toMatch(/one image at a time/i);
  });
  it("does nothing for an empty selection", () => {
    expect(singleEvidenceFile([])).toEqual({ file: null, error: null });
  });
  it("the authoritative validator rejects an array of files that reaches it programmatically", () => {
    expect(validateEvidenceFile([png(1), png(2)])).toMatch(/one image at a time/i);
    expect(validateEvidenceFile(png(1))).toBeNull();
  });
  it("still rejects non-image/PDF types and oversize files", () => {
    expect(validateEvidenceFile(new File(["x"], "a.exe", { type: "application/x-msdownload" }))).toMatch(/unsupported/i);
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    expect(validateEvidenceFile(big)).toMatch(/too large/i);
  });
});
