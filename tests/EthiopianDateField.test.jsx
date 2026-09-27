// Verifies the Phase 2 EC/GC date-entry widget (src/components/ui.jsx: EthiopianDateField) — the
// drop-in replacement for <input type="date"> used by Enrollment and Payment date entry. Same
// value/onChange contract as a native date input (a plain "YYYY-MM-DD" Gregorian string) in both
// directions, regardless of which calendar mode is active.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EthiopianDateField } from "../src/components/ui";
import { ethiopianToGregorianKey, getEthiopianToday } from "../src/utils/ethiopianCalendar";

afterEach(cleanup);

function Wrapper({ initial = "" }) {
  const [value, setValue] = React.useState(initial);
  return (
    <div>
      <EthiopianDateField value={value} onChange={setValue} />
      <span data-testid="value">{value}</span>
    </div>
  );
}

describe("EthiopianDateField", () => {
  it("defaults to Ethiopian mode", () => {
    render(<Wrapper initial="2025-09-22" />);
    expect(screen.getByRole("button", { name: "Ethiopian" }).className).toMatch(/bg-brand-600/);
    expect(screen.getByRole("button", { name: "Gregorian" }).className).not.toMatch(/bg-brand-600/);
  });

  it("prefills the Ethiopian selects from an existing Gregorian value", () => {
    // 22 September 2025 GC = Meskerem 12, 2018 EC.
    render(<Wrapper initial="2025-09-22" />);
    expect(screen.getByDisplayValue("Meskerem")).toBeTruthy();
    expect(screen.getByText(/Meskerem 12, 2018 E\.C\./)).toBeTruthy();
    expect(screen.getByText(/22 September 2025 G\.C\./)).toBeTruthy();
  });

  it("emits the correct Gregorian date-key when the Ethiopian day/month/year is changed", () => {
    render(<Wrapper initial="2025-09-22" />);
    const selects = screen.getAllByRole("combobox");
    const monthSelect = selects[1]; // [day, month]
    fireEvent.change(monthSelect, { target: { value: "2" } }); // Tikimt
    expect(screen.getByTestId("value").textContent).toBe("2025-10-22");
  });

  it("switching to Gregorian mode still emits a plain YYYY-MM-DD string", () => {
    render(<Wrapper initial="2025-09-22" />);
    fireEvent.click(screen.getByRole("button", { name: "Gregorian" }));
    const input = screen.getByDisplayValue("2025-09-22");
    fireEvent.change(input, { target: { value: "2025-12-25" } });
    expect(screen.getByTestId("value").textContent).toBe("2025-12-25");
    expect(screen.getByText(/25 December 2025 G\.C\./)).toBeTruthy();
  });

  it("defaults to today's Ethiopian date when the value is empty", () => {
    render(<Wrapper initial="" />);
    const today = getEthiopianToday();
    // The Ethiopian year <input type="number"> shows today's EC year with no value ever selected.
    expect(screen.getByDisplayValue(String(today.year))).toBeTruthy();
  });

  it("caps the day options at the month's actual length (Pagumen has only 5 or 6 days)", () => {
    // Pagumen 5, 2016 EC (non-leap) is the last day of the EC year.
    render(<Wrapper initial={ethiopianToGregorianKey(2016, 13, 5)} />);
    const selects = screen.getAllByRole("combobox");
    const daySelect = selects[0];
    const options = Array.from(daySelect.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["1", "2", "3", "4", "5"]);
  });
});
