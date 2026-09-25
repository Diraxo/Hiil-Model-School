import React, { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("../src/lib/supabaseClient", () => ({ supabase: {} }));
const identities = { t1: { display: "T. Amina Hassan" }, o1: { display: "Owner — Maxamed Kader" }, ed1: { display: "Educational Director — Ali Nur" } };
vi.mock("../src/context/DataContext", async (orig) => {
  const actual = await orig();
  return { ...actual, useData: () => ({ userIdentity: (id) => identities[id] || { display: "Unknown" } }) };
});

import { attendanceStatusForClassDate } from "../src/utils/attendanceStatus";
import { pageThrough } from "../src/services/attendanceService";
import { ClassAttendanceStatus } from "../src/pages/admin/AdminPages";
import { ConfirmDialog } from "../src/components/ui";

afterEach(cleanup);

const D = "2026-09-24";
const row = (i, extra = {}) => ({ id: `a${i}`, studentId: `s${i}`, classId: "g9", date: D, status: "Present", markedBy: "t1", markedAt: 1000 + i, ...extra });
const status = (rows, cls = "g9", d = D) => attendanceStatusForClassDate(rows, cls, d);

function Card({ rows, canEdit = true, date = D, onOpen = () => {} }) {
  return <ClassAttendanceStatus status={status(rows, "g9", date)} canEdit={canEdit} onOpen={onOpen} />;
}

describe("attendance status: one saved row means taken", () => {
  it("1: no rows -> Not marked + Take Attendance", () => {
    render(<Card rows={[]} />);
    expect(screen.getByText("Not marked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take Attendance" })).toBeTruthy();
    expect(screen.queryByText("Attendance Taken")).toBeNull();
  });
  it("2: one student marked -> Attendance Taken, not Take Attendance", () => {
    render(<Card rows={[row(1)]} />);
    expect(screen.getByText("Attendance Taken")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take Attendance" })).toBeNull();
    expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
  it("3: 1 of 30 saved is still Attendance Taken", () => {
    expect(status([row(1)]).taken).toBe(true);
    render(<Card rows={[row(1)]} />);
    expect(screen.getByText("Attendance Taken")).toBeTruthy();
  });
  it("4: all 30 saved -> Attendance Taken", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    expect(status(rows)).toMatchObject({ taken: true, count: 30 });
  });
  it("5: actor comes from the saved row's markedBy (teacher / Owner / ED), latest wins", () => {
    for (const [id, text] of [["t1", "T. Amina Hassan"], ["o1", "Owner — Maxamed Kader"], ["ed1", "Educational Director — Ali Nur"]]) {
      cleanup();
      render(<Card rows={[row(1, { markedBy: id })]} />);
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(status([row(1, { markedBy: "t1", markedAt: 5 }), row(2, { markedBy: "o1", markedAt: 9 })]).markedBy).toBe("o1");
  });
  it("6: View path exposes the read-only mode and never the editable mode", () => {
    const onOpen = vi.fn();
    render(<Card rows={[row(1)]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onOpen).toHaveBeenCalledWith("view");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onOpen).toHaveBeenLastCalledWith("edit");
  });
  it("a user who cannot edit sees View but no Edit / Take Attendance", () => {
    render(<Card rows={[row(1)]} canEdit={false} />);
    expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
  it("8: previous day taken, another previous day not marked", () => {
    const rows = [row(1)];
    expect(status(rows, "g9", "2026-09-24").taken).toBe(true);
    expect(status(rows, "g9", "2026-09-23").taken).toBe(false);
    expect(status(rows, "g8", "2026-09-24").taken).toBe(false);
  });
  it("9: calendar (register) and summary read the same helper", () => {
    const src = fs.readFileSync(path.resolve("src/pages/admin/AdminPages.jsx"), "utf8");
    expect(src).toMatch(/const hasRecord = attendanceStatusForClassDate\(/);
    expect(src).toMatch(/const status = attendanceStatusForClassDate\(db\.attendance, c\.id, dateKey\)/);
    const t = fs.readFileSync(path.resolve("src/pages/teacher/TeacherPages.jsx"), "utf8");
    expect(t).toMatch(/const status = attendanceStatusForClassDate\(db\.attendance, c\.id, dateKey\)/);
  });
  it("unavailable dates offer no action", () => {
    render(<ClassAttendanceStatus status={status([])} unavailable canEdit onOpen={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("root cause: attendance list must page past PostgREST's 1000-row cap", () => {
  function fakeClient(total) {
    const all = Array.from({ length: total }, (_, i) => ({ id: String(i).padStart(6, "0") }));
    return {
      from: () => ({
        select: () => ({
          order: () => ({ range: async (a, b) => ({ data: all.slice(a, Math.min(b, a + 999) + 1), error: null }) }),
        }),
      }),
    };
  }
  it("returns every row for 2,350 records", async () => {
    const rows = await pageThrough("attendance", { client: fakeClient(2350) });
    expect(rows).toHaveLength(2350);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2350);
  });
  it("handles an exact multiple of the page size", async () => {
    expect(await pageThrough("attendance", { client: fakeClient(2000) })).toHaveLength(2000);
  });
});

// Mirrors the real editors: closing while dirty asks via the shared ConfirmDialog.
function Editor({ onClosed }) {
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!open) return <p>closed</p>;
  return (
    <div>
      <button onClick={() => setDirty(true)}>mark absent</button>
      <p>{dirty ? "dirty" : "clean"}</p>
      <button aria-label="Close editor" onClick={() => (dirty ? setConfirm(true) : setOpen(false))}>x</button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setOpen(false); onClosed(); }}
        title="Unsaved Changes" confirmLabel="Discard Changes" cancelLabel="Keep Editing"
        description="You have unsaved attendance changes. If you leave now, those changes will be discarded." />
    </div>
  );
}

describe("unsaved-changes dialog", () => {
  it("10: shows the application dialog, never a browser confirm", () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Editor onClosed={() => {}} />);
    fireEvent.click(screen.getByText("mark absent"));
    fireEvent.click(screen.getByLabelText("Close editor"));
    expect(screen.getByText("Unsaved Changes")).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("11: Keep Editing keeps the editor and the unsaved change", () => {
    render(<Editor onClosed={() => {}} />);
    fireEvent.click(screen.getByText("mark absent"));
    fireEvent.click(screen.getByLabelText("Close editor"));
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.queryByText("Unsaved Changes")).toBeNull();
    expect(screen.getByText("dirty")).toBeTruthy();
  });
  it("12: Discard Changes closes the editor without saving", async () => {
    const closed = vi.fn();
    render(<Editor onClosed={closed} />);
    fireEvent.click(screen.getByText("mark absent"));
    fireEvent.click(screen.getByLabelText("Close editor"));
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    await waitFor(() => expect(screen.getByText("closed")).toBeTruthy());
    expect(closed).toHaveBeenCalled();
  });
  it("dialog buttons stack on phones and wrap long text (no fixed desktop width)", () => {
    render(<ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="t" description="d" />);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn.parentElement.className).toMatch(/flex-col-reverse/);
    expect(btn.parentElement.className).toMatch(/sm:flex-row/);
    expect(screen.getByText("d").className).toMatch(/break-words/);
  });
  it("both attendance editors use ConfirmDialog for discard", () => {
    for (const f of ["src/pages/admin/AdminPages.jsx", "src/pages/teacher/TeacherPages.jsx"]) {
      const src = fs.readFileSync(path.resolve(f), "utf8");
      expect(src).toContain('confirmLabel="Discard Changes" cancelLabel="Keep Editing"');
    }
  });
});

describe("13/14: no native browser dialogs in production source", () => {
  it("has no alert( / confirm( / prompt( calls", () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|tsx?)$/.test(e.name)) {
          fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
            if (/(^|[^\w.])(window\.)?(alert|confirm|prompt)\(/.test(line)) hits.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk(path.resolve("src"));
    expect(hits).toEqual([]);
  });
});
