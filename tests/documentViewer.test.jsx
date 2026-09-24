import React, { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DocumentViewerModal } from "../src/components/DocumentViewer";
import { ExamEvidenceStrip } from "../src/components/ResultEvidence";

afterEach(cleanup);

const pages = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, fileType: "image", fileName: `page-${i + 1}.png`, fileDataUrl: `https://signed.example/p${i + 1}.png` }));

// A stand-in result screen that owns the viewer state exactly like the real pages do.
function ResultScreen() {
  const [view, setView] = useState(null);
  return (
    <div>
      <h1>Grade 9 - Mathematics - Test</h1>
      <p>15/20</p>
      <ExamEvidenceStrip pages={pages} onOpen={(idx) => setView({ title: "Mathematics - Test", files: pages, initialIndex: idx })} />
      <DocumentViewerModal open={!!view} onClose={() => setView(null)} title={view?.title} files={view?.files} initialIndex={view?.initialIndex} allowDownload={false} />
    </div>
  );
}

describe("Exam evidence thumbnails + in-app viewer", () => {
  it("shows the page count and one thumbnail per page", () => {
    render(<ResultScreen />);
    expect(screen.getByText(/Exam Evidence · 6 pages/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Open exam page/ })).toHaveLength(6);
  });
  it("P/Q: opens inside the app (a dialog, no links out) and pages through all six", () => {
    const { container } = render(<ResultScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Open exam page 1 of 6" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(container.querySelector("a[href]")).toBeNull();
    expect(screen.getByText(/page 1 of 6/)).toBeTruthy();
    for (let n = 2; n <= 6; n += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getByText(new RegExp(`page ${n} of 6`))).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText(/page 5 of 6/)).toBeTruthy();
  });
  it("R/S: opening page 4 then closing returns to the same result screen", () => {
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Open exam page 4 of 6" }));
    expect(screen.getByText(/page 4 of 6/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Grade 9 - Mathematics - Test")).toBeTruthy();
    expect(screen.getByText("15/20")).toBeTruthy();
  });
  it("Escape closes and arrow keys page", () => {
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Open exam page 1 of 6" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/page 2 of 6/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/page 1 of 6/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("T: the viewer is read-only - no download/upload/remove controls", () => {
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Open exam page 1 of 6" }));
    expect(screen.queryByText(/Download|Remove|Replace|Add image/i)).toBeNull();
  });
  it("renders nothing for a result with no evidence", () => {
    const { container } = render(<ExamEvidenceStrip pages={[]} onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("still offers Download for ordinary single documents (existing callers unchanged)", () => {
    render(<DocumentViewerModal open onClose={() => {}} title="Receipt" fileName="r.png" fileDataUrl="data:image/png;base64,AA" fileType="image" />);
    expect(screen.getByText("Download")).toBeTruthy();
  });
});
