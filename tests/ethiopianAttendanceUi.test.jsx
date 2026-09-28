// UI side of Ethiopian-calendar attendance: the Monthly Register renders E.C. day numbers under an
// E.C. month heading and pages by E.C. month; DateNav picks/steps E.C. dates while always handing
// back the Gregorian key attendance is stored under.
import React, { useState } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

vi.mock("../src/lib/supabaseClient", () => ({ supabase: {} }));

import { classifyAttendanceDate } from "../src/utils/academicCalendar";

const cal = { yearStart: "2026-09-01", yearEnd: "2027-08-07", sem1Start: "2026-09-14", sem1End: "2027-02-14", breakDays: 15, sem2Start: "2027-03-02", sem2End: "2027-08-02" };
const TODAY = "2027-06-30";
const classify = (k) => classifyAttendanceDate(k, cal, TODAY, {});

// Existing rows, keyed by the Gregorian date they were stored under.
const attendance = [
  { id: "a1", studentId: "s1", classId: "g9", date: "2026-09-14", status: "Present" },  // Meskerem 4
  { id: "a2", studentId: "s1", classId: "g9", date: "2026-09-28", status: "Absent" },   // Meskerem 18
  { id: "a3", studentId: "s1", classId: "g9", date: "2026-10-12", status: "Late" },     // Tikimt 2
  { id: "a4", studentId: "s2", classId: "g9", date: "2026-09-28", status: "Sick" },     // Meskerem 18
];
const students = [
  { id: "s1", firstName: "Amina", middleName: "Ali", lastName: "Hassan" },
  { id: "s2", firstName: "Bilal", middleName: "Nur", lastName: "Omar" },
];
const state = { attendance };

vi.mock("../src/context/DataContext", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useData: () => ({
      db: { classes: [{ id: "g9", grade: "Grade 9", section: "", headTeacherId: "t1" }], attendance: state.attendance },
      attendanceRosterForClass: () => students,
      getUser: () => ({ name: "T. Head" }),
      attendanceDateBounds: () => ({ min: "2026-09-14", max: "2027-06-30" }),
      classifyAttendanceDay: classify,
      studentFullName: (s) => `${s.firstName} ${s.middleName} ${s.lastName}`,
    }),
  };
});

import { ClassMonthlyRegisterModal } from "../src/pages/admin/AdminPages";
import { DateNav, EcMonthNav } from "../src/components/ui";

// Pin "today" to the calendar's TODAY so labels read as plain dates ("Today · ..." only for TODAY itself).
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2027, 5, 30, 12)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function Register({ initial = "2019-01", onOpenDay = () => {} }) {
  const [month, setMonth] = useState(initial);
  return <ClassMonthlyRegisterModal classId="g9" monthKey={month} onMonthChange={setMonth} onClose={() => {}} onOpenDay={onOpenDay} canManage />;
}

const headerDays = () => screen.getAllByRole("columnheader").map((h) => h.textContent).filter((t) => /^\d+$/.test(t) && t !== "");

describe("Monthly Register (E.C.)", () => {
  it("heading is the E.C. month and the columns are E.C. days — not Gregorian September day numbers", () => {
    render(<Register />);
    expect(screen.getByText(/Meskerem 2019 E\.C\./)).toBeTruthy();
    expect(screen.getByText(/11 Sept? – 10 Oct 2026 G\.C\./)).toBeTruthy();
    // The register's day headers (the first "#" column is not numeric text). E.C. 4..8, 11..15, ...
    const days = headerDays();
    expect(days.slice(0, 10)).toEqual(["4", "5", "6", "7", "8", "11", "12", "13", "14", "15"]);
    expect(days).not.toContain("30");
    expect(days).not.toContain("16"); // Meskerem 16 = Saturday 26 Sep
  });

  it("existing records sit under the E.C. day their stored date converts to, with their original status", () => {
    render(<Register />);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    const col = (day) => headers.indexOf(String(day));
    const row = (name) => within(table).getByText(name).closest("tr");
    const cells = (r) => within(r).getAllByRole("cell").map((c) => c.textContent);
    const amina = cells(row("Amina Ali Hassan"));
    // 2026-09-14 -> Meskerem 4 -> Present (P); 2026-09-28 -> Meskerem 18 -> Absent (A)
    expect(amina[col(4)]).toBe("P");
    expect(amina[col(18)]).toBe("A");
    const bilal = cells(row("Bilal Nur Omar"));
    expect(bilal[col(18)]).toBe("S");
    expect(bilal[col(4)]).toBe("—");
  });

  it("clicking a column opens that exact stored date (Meskerem 18 -> 2026-09-28)", () => {
    const opened = [];
    render(<Register onOpenDay={(dateKey, mode) => opened.push([dateKey, mode])} />);
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getAllByRole("columnheader").find((h) => h.textContent === "18"));
    expect(opened).toEqual([["2026-09-28", "edit"]]);
  });

  it("Next month is Tikimt 2019 (11 Oct – 9 Nov): the 12 Oct record is E.C. day 2 there", () => {
    render(<Register />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText(/Tikimt 2019 E\.C\./)).toBeTruthy();
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    // 12 Oct is a Monday: Tikimt 2. Totals: Amina has 1 Late.
    expect(headers).toContain("2");
    const amina = within(within(table).getByText("Amina Ali Hassan").closest("tr")).getAllByRole("cell").map((c) => c.textContent);
    expect(amina[headers.indexOf("2")]).toBe("L");
  });

  it("Previous month stops at the first month that still overlaps the first attendance date", () => {
    render(<Register />);
    // Meskerem 2019 contains 14 Sep (the minimum bound); Pagumen 2018 ended 10 Sep, before it.
    expect((screen.getByRole("button", { name: "Previous month" })).disabled).toBe(true);
  });

  it("per-status totals and percentage columns are computed from the very same records", () => {
    render(<Register />);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    const amina = within(within(table).getByText("Amina Ali Hassan").closest("tr")).getAllByRole("cell").map((c) => c.textContent);
    // Meskerem register: Amina Present 1 + Absent 1 (the Tikimt 12 Oct row isn't in this month) -> 50%
    expect(amina.at(-1)).toBe("50%");
    expect(headers.at(-1)).toBe("%");
  });
});

describe("EcMonthNav", () => {
  it("rolls Pagumen -> Meskerem of the next E.C. year", () => {
    function Host() {
      const [m, setM] = useState("2018-13");
      return <EcMonthNav ecMonthKey={m} onChange={setM} />;
    }
    render(<Host />);
    expect(screen.getByText(/Pagumen 2018 E\.C\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText(/Meskerem 2019 E\.C\./)).toBeTruthy();
  });
});

describe("DateNav is E.C.-first and stores the Gregorian key", () => {
  function Host({ initial = "2026-09-28", minDate, maxDate }) {
    const [d, setD] = useState(initial);
    return (
      <div>
        <DateNav date={d} onChange={setD} minDate={minDate} maxDate={maxDate || "2027-06-30"} skipDates={(k) => !classify(k).available} />
        <span data-testid="key">{d}</span>
      </div>
    );
  }

  it("shows the date as Meskerem 18, 2019 E.C. with the Gregorian date secondary, in the pickers", () => {
    render(<Host />);
    expect(screen.getByLabelText("Ethiopian month").value).toBe("1");
    expect(screen.getByLabelText("Ethiopian day").value).toBe("18");
    expect(screen.getByLabelText("Ethiopian year").value).toBe("2019");
    expect(screen.getByText(/Meskerem 18, 2019 E\.C\. · .*28 Sept? 2026 G\.C\./)).toBeTruthy();
  });

  it("choosing an E.C. day stores the matching Gregorian key", () => {
    render(<Host />);
    fireEvent.change(screen.getByLabelText("Ethiopian day"), { target: { value: "19" } });
    expect(screen.getByTestId("key").textContent).toBe("2026-09-29");
    fireEvent.change(screen.getByLabelText("Ethiopian month"), { target: { value: "2" } }); // Tikimt 19
    expect(screen.getByTestId("key").textContent).toBe("2026-10-29");
  });

  it("Next school day moves Meskerem 18 -> 19 -> 20 (real dates 28 -> 29 -> 30 Sep) and skips the weekend", () => {
    render(<Host />);
    const next = screen.getByRole("button", { name: "Next school day" });
    fireEvent.click(next);
    expect(screen.getByTestId("key").textContent).toBe("2026-09-29");
    expect(screen.getByLabelText("Ethiopian day").value).toBe("19");
    fireEvent.click(next);
    expect(screen.getByTestId("key").textContent).toBe("2026-09-30");
    expect(screen.getByLabelText("Ethiopian day").value).toBe("20");
    fireEvent.click(next); // 1 Oct
    fireEvent.click(next); // 2 Oct (Fri)
    fireEvent.click(next); // skips Sat 3/Sun 4 -> Mon 5 Oct = Meskerem 25
    expect(screen.getByTestId("key").textContent).toBe("2026-10-05");
    expect(screen.getByLabelText("Ethiopian day").value).toBe("25");
  });

  it("Pagumen: the day list follows the month length (6 days in leap Pagumen 2019) and stores the right key", () => {
    render(<Host initial="2027-08-02" maxDate="2028-01-01" />);
    fireEvent.change(screen.getByLabelText("Ethiopian month"), { target: { value: "13" } });
    const dayOptions = within(screen.getByLabelText("Ethiopian day")).getAllByRole("option").map((o) => o.textContent);
    expect(dayOptions).toEqual(["1", "2", "3", "4", "5", "6"]);
    fireEvent.change(screen.getByLabelText("Ethiopian day"), { target: { value: "6" } });
    expect(screen.getByTestId("key").textContent).toBe("2027-09-11"); // last day of E.C. 2019
  });

  it("a choice past the allowed range is clamped to it", () => {
    render(<Host initial="2026-09-14" minDate="2026-09-01" />);
    fireEvent.change(screen.getByLabelText("Ethiopian month"), { target: { value: "13" } });
    expect(screen.getByTestId("key").textContent).toBe("2027-06-30");
  });

  it("the Gregorian switch is still available and returns the same kind of key", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "G.C." }));
    fireEvent.change(screen.getByLabelText("Gregorian date"), { target: { value: "2026-10-01" } });
    expect(screen.getByTestId("key").textContent).toBe("2026-10-01");
  });
});
