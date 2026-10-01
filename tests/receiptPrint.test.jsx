import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import fs from "node:fs";
import { CashReceiptModal } from "../src/components/Receipt";

const props = {
  open: true, onClose() {}, receiptNo: "0002", date: "19/01/2019",
  entries: [{ name: "Silham Mukhtar Hassan", grade: "Grade 11", feeLines: [] }],
  busFeeLines: ["Silham — Meskerem"], purpose: "School Fee & Bus Fee", amount: "5,000", amountWords: "Five Thousand Birr only", method: "Cash",
};

afterEach(cleanup);
describe("Cash receipt print/download", () => {
  it("offers Download and Print actions in the no-print toolbar", () => {
    render(<CashReceiptModal {...props} />);
    const dl = screen.getByRole("button", { name: /Download Receipt/ });
    const pr = screen.getByRole("button", { name: /Print Receipt/ });
    expect(dl.parentElement).toBe(pr.parentElement);
    expect(pr.parentElement.className).toContain("no-print");
  });
  it("Print Receipt calls the native window.print", () => {
    const spy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<CashReceiptModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Print Receipt/ }));
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("declares a receipt-sized @page (not A4) and keeps content", () => {
    const { container } = render(<CashReceiptModal {...props} />);
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toMatch(/@page\s*\{\s*size:\s*200mm 190mm/);
    expect(css).not.toMatch(/size:\s*A4/i);
    const text = document.body.textContent;
    ["Silham Mukhtar Hassan", "Five Thousand Birr only", "0002", "School Fee & Bus Fee"].forEach((t) => expect(text).toContain(t));
  });
  it("every underlined value has line-height and bottom padding so the rule sits below the text", () => {
    render(<CashReceiptModal {...props} />);
    const blanks = document.querySelectorAll(".receipt-blank");
    expect(blanks.length).toBeGreaterThan(3);
    blanks.forEach((b) => { expect(b.className).toMatch(/pb-\[3px\]/); expect(b.className).toMatch(/leading-\[1\.5\]/); });
  });
  it("print CSS hides non-receipt UI and sizes the receipt to the printable area", () => {
    const css = fs.readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/body \* \{ visibility: hidden; \}/);
    expect(css).toMatch(/\.receipt-print, \.receipt-print \*/);
    expect(css).toMatch(/\.no-print \{ display: none !important; \}/);
    expect(css).toMatch(/\.receipt-print \{ width: 192mm/);
  });
});
