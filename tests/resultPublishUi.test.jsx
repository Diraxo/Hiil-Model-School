import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";

const evidence = vi.hoisted(() => ({
  rows: [
    { id: "e1", resultId: "r1", assessmentId: "a1", order: 0, fileType: "image", mimeType: "image/png", fileDataUrl: "https://signed.example/1.png" },
    { id: "e2", resultId: "r1", assessmentId: "a1", order: 1, fileType: "image", mimeType: "image/jpeg", fileDataUrl: "https://signed.example/2.jpg" },
    { id: "e3", resultId: "r1", assessmentId: "a1", order: 2, fileType: "image", mimeType: "image/png", fileDataUrl: "https://signed.example/3.png" },
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
import { canPublishResult, canLockResult, canUnlockResult, canEditResultComponent } from "../src/utils/permissions";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const student = { id: "s1", grade: "Grade 9", section: "A" };
const record = (over = {}) => ({
  id: "r1", studentId: "s1", classId: "c1", subject: "Mathematics", semester: "SEMESTER_1", publishStatus: "DRAFT",
  assessments: [{ id: "a1", name: "dsafasdf", weight: 100, kind: "TEST" }],
  components: { a1: { score: 90, sharedWithParents: false } },
  ...over,
});

describe("Publish from the result detail", () => {
  it("a Draft offers Publish only when the caller may publish; it asks first with the student, subject, assessment and score", async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ResultDetailModal record={record()} student={student} audience="staff" onClose={() => {}} onPublish={null} />);
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();

    rerender(<ResultDetailModal record={record()} student={student} audience="staff" onClose={() => {}} onPublish={onPublish} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    const dialog = screen.getByText(/visible to the student's parent/i).parentElement;
    expect(within(dialog).getByText(/visible to the student's parent/i)).toBeTruthy();
    expect(screen.getAllByText("Ahmed Abdiqadir Warsame").length).toBeGreaterThan(1); // detail header + dialog
    expect(within(dialog).getByText(/Mathematics · /)).toBeTruthy();
    expect(within(dialog).getByText(/dsafasdf: 90 \/ 100/)).toBeTruthy();
    expect(onPublish).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onPublish).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Publish Result" }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it("an already published result has no Publish button; a parent never gets one even if a handler leaks in", () => {
    render(<ResultDetailModal record={record({ publishStatus: "PUBLISHED" })} student={student} audience="staff" onClose={() => {}} onPublish={() => {}} />);
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();
    cleanup();
    render(<ResultDetailModal record={record()} student={student} audience="parent" onClose={() => {}} onPublish={() => {}} />);
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
  });
});

describe("Evidence viewer downloads (images, never a PDF)", () => {
  let fetched; let clicks;
  beforeEach(() => {
    fetched = []; clicks = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => { fetched.push(url); return { ok: true, blob: async () => new Blob(["img"], { type: "image/png" }) }; }));
    URL.createObjectURL = vi.fn(() => "blob:local/x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() { clicks.push(this.download); });
  });

  function openViewer(rowIndex = 1) {
    render(<ResultDetailModal record={record({ publishStatus: "PUBLISHED" })} student={student} audience="parent" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Open evidence ${rowIndex} of 3`) }));
    return screen.getByRole("dialog", { name: /Mathematics — dsafasdf/ });
  }

  it("offers Download this image and Download all, and Previous/Next with the image count", () => {
    const viewer = openViewer(1);
    expect(within(viewer).getByText(/image 1 of 3/)).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "Download this image" })).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: /Download all \(3\)/ })).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "Next image" })).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "Zoom in" })).toBeTruthy();
  });

  it("Download this image saves only the viewed image, with a descriptive name and its own format", async () => {
    const viewer = openViewer(1);
    fireEvent.click(within(viewer).getByRole("button", { name: "Next image" }));
    fireEvent.click(within(viewer).getByRole("button", { name: "Download this image" }));
    await waitFor(() => expect(clicks).toEqual(["Ahmed-Abdiqadir-Warsame-Mathematics-dsafasdf-evidence-2.jpg"]));
    expect(fetched).toEqual(["https://signed.example/2.jpg"]);
    expect(await within(viewer).findByText("Image downloaded.")).toBeTruthy();
  });

  it("Download all saves every image separately — three files, no PDF, no combined file", async () => {
    const viewer = openViewer(1);
    fireEvent.click(within(viewer).getByRole("button", { name: /Download all/ }));
    await waitFor(() => expect(clicks).toHaveLength(3), { timeout: 5000 });
    expect(clicks).toEqual([
      "Ahmed-Abdiqadir-Warsame-Mathematics-dsafasdf-evidence-1.png",
      "Ahmed-Abdiqadir-Warsame-Mathematics-dsafasdf-evidence-2.jpg",
      "Ahmed-Abdiqadir-Warsame-Mathematics-dsafasdf-evidence-3.png",
    ]);
    expect(clicks.some((n) => /pdf/i.test(n))).toBe(false);
    expect(await within(viewer).findByText("3 images downloaded.")).toBeTruthy();
  });

  it("a failed download says so instead of pretending", async () => {
    fetch.mockResolvedValueOnce({ ok: false, blob: async () => new Blob([]) });
    const viewer = openViewer(1);
    fireEvent.click(within(viewer).getByRole("button", { name: "Download this image" }));
    expect((await within(viewer).findByRole("alert")).textContent).toMatch(/could not be downloaded/i);
    expect(clicks).toEqual([]);
  });

  it("zoom toggles and the image can fail to load without breaking the viewer", () => {
    const viewer = openViewer(1);
    fireEvent.click(within(viewer).getByRole("button", { name: "Zoom in" }));
    expect(within(viewer).getByRole("button", { name: "Zoom out" })).toBeTruthy();
    expect(within(viewer).getByRole("status").textContent).toMatch(/loading image/i);
    fireEvent.error(within(viewer).getByRole("img"));
    expect(within(viewer).getAllByRole("alert")[0].textContent).toMatch(/could not be loaded/i);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Mathematics — dsafasdf/ })).toBeNull();
  });

  it("a single evidence image has Download this image but no Download all", () => {
    const keep = evidence.rows.splice(1);
    try {
      render(<ResultDetailModal record={record({ publishStatus: "PUBLISHED" })} student={student} audience="parent" onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: /Open evidence 1 of 1/ }));
      const viewer = screen.getByRole("dialog", { name: /Mathematics — dsafasdf/ });
      expect(within(viewer).getByRole("button", { name: "Download this image" })).toBeTruthy();
      expect(within(viewer).queryByRole("button", { name: /Download all/ })).toBeNull();
    } finally { evidence.rows.push(...keep); }
  });
});

describe("who may publish (exact class + subject pair)", () => {
  const assignments = [
    { teacherId: "t1", classId: "g9", subject: "Mathematics" },
    { teacherId: "t1", classId: "g10", subject: "Mathematics" },
    { teacherId: "t2", classId: "g9", subject: "Mathematics" },
    { teacherId: "t2", classId: "g9", subject: "Science" },
  ];
  const teacher = (id) => ({ id, role: "TEACHER" });
  const ctx = (classId, subject) => ({ classId, subject, teacherAssignments: assignments });

  it("teacher of Grade 9 Math + Grade 10 Math manages both — and nothing else", () => {
    const t = teacher("t1");
    expect(canPublishResult(t, ctx("g9", "Mathematics"))).toBe(true);
    expect(canPublishResult(t, ctx("g10", "Mathematics"))).toBe(true);
    expect(canEditResultComponent(t, ctx("g9", "Mathematics"), null)).toBe(true);
    expect(canPublishResult(t, ctx("g9", "English"))).toBe(false);
    expect(canPublishResult(t, ctx("g10", "English"))).toBe(false);
    expect(canPublishResult(t, ctx("g10", "Science"))).toBe(false);
    expect(canPublishResult(t, ctx("g11", "Mathematics"))).toBe(false);
    expect(canEditResultComponent(t, ctx("g9", "English"), null)).toBe(false);
  });

  it("teacher of Grade 9 Math + Grade 9 Science manages both, but not Grade 10 (no classes x subjects product)", () => {
    const t = teacher("t2");
    expect(canPublishResult(t, ctx("g9", "Mathematics"))).toBe(true);
    expect(canPublishResult(t, ctx("g9", "Science"))).toBe(true);
    expect(canPublishResult(t, ctx("g10", "Mathematics"))).toBe(false);
    expect(canPublishResult(t, ctx("g10", "Science"))).toBe(false);
  });

  it("Owner and Educational Director publish anything; Finance and Parent never; nobody but Owner/Director locks", () => {
    for (const role of ["OWNER", "ADMIN"]) {
      const u = { id: "x", role };
      expect(canPublishResult(u, ctx("g11", "Art"))).toBe(true);
      expect(canPublishResult(u)).toBe(true);
      expect(canLockResult(u)).toBe(true);
      expect(canUnlockResult(u)).toBe(true);
    }
    for (const role of ["FINANCE", "PARENT"]) expect(canPublishResult({ id: "x", role }, ctx("g9", "Mathematics"))).toBe(false);
    expect(canLockResult(teacher("t1"))).toBe(false);
    expect(canUnlockResult(teacher("t1"))).toBe(false);
    expect(canPublishResult(teacher("t1"))).toBe(false); // no context -> no teacher access
    expect(canPublishResult(null, ctx("g9", "Mathematics"))).toBe(false);
  });
});
