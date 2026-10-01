import { describe, it, expect, vi } from "vitest";
import { evidenceDownloadName, evidenceExtension, downloadEvidenceFile, downloadEvidenceFiles } from "../src/utils/evidenceDownload";

const file = (over = {}) => ({ id: "e1", fileDataUrl: "https://signed.example/a?token=1", fileType: "image", mimeType: "image/png", fileName: "1700000-IMG_1.png", ...over });

describe("evidence image file names", () => {
  it("builds a readable, sanitised name and keeps the real image format", () => {
    expect(evidenceDownloadName({ student: "Ahmed Abdiqadir Warsame", subject: "Mathematics", assessment: "dsafasdf", index: 0, file: file() }))
      .toBe("Ahmed-Abdiqadir-Warsame-Mathematics-dsafasdf-evidence-1.png");
    expect(evidenceDownloadName({ student: "A", subject: "B", assessment: "C", index: 2, file: file({ mimeType: "image/jpeg" }) })).toBe("A-B-C-evidence-3.jpg");
    expect(evidenceDownloadName({ student: "A", subject: "B", assessment: "C", index: 0, file: file({ mimeType: "image/webp" }) })).toMatch(/\.webp$/);
  });
  it("never produces a path separator or a pdf extension for an image", () => {
    const n = evidenceDownloadName({ student: "../../etc/pass wd", subject: "Math/ematics", assessment: "a\b:c*?", index: 0, file: file() });
    expect(n).not.toMatch(/[\/:*?"<>|]/);
    expect(n.endsWith(".png")).toBe(true);
    expect(n).not.toMatch(/pdf/i);
  });
  it("falls back to the stored file name, then jpg", () => {
    expect(evidenceExtension({ fileName: "scan.JPEG" })).toBe("jpg");
    expect(evidenceExtension({ fileName: "scan.png" })).toBe("png");
    expect(evidenceExtension({})).toBe("jpg");
  });
});

function env({ ok = true, fail = false } = {}) {
  const clicks = [];
  const doc = {
    body: { appendChild: vi.fn() },
    createElement: () => { const a = { style: {}, remove: vi.fn(), click() { clicks.push({ href: a.href, download: a.download }); } }; return a; },
  };
  const urlApi = { createObjectURL: vi.fn(() => "blob:local/1"), revokeObjectURL: vi.fn() };
  const fetchImpl = vi.fn(async () => { if (fail) throw new Error("net"); return { ok, blob: async () => new Blob(["img"], { type: "image/png" }) }; });
  return { doc, urlApi, fetchImpl, clicks };
}

describe("downloading evidence", () => {
  it("downloads the actual image bytes under the given name (no PDF conversion)", async () => {
    const e = env();
    await downloadEvidenceFile(file(), "Ann-Math-Quiz-evidence-1.png", e);
    expect(e.fetchImpl).toHaveBeenCalledWith("https://signed.example/a?token=1");
    expect(e.clicks).toEqual([{ href: "blob:local/1", download: "Ann-Math-Quiz-evidence-1.png" }]);
  });
  it("reports failure honestly instead of pretending", async () => {
    await expect(downloadEvidenceFile(file(), "x.png", env({ ok: false }))).rejects.toThrow(/could not be downloaded/i);
    await expect(downloadEvidenceFile(file(), "x.png", env({ fail: true }))).rejects.toThrow(/could not be downloaded/i);
    await expect(downloadEvidenceFile(file({ fileDataUrl: null }), "x.png", env())).rejects.toThrow(/not available/i);
  });
  it("download all saves every image as its own file, in order, and counts failures", async () => {
    const e = env();
    const files = [file({ id: "1" }), file({ id: "2", mimeType: "image/jpeg" }), file({ id: "3" })];
    const out = await downloadEvidenceFiles(files, (f, i) => `n-${i + 1}.${evidenceExtension(f)}`, { ...e, noDelay: true });
    expect(out).toEqual({ done: 3, failed: 0 });
    expect(e.clicks.map((c) => c.download)).toEqual(["n-1.png", "n-2.jpg", "n-3.png"]);
    const bad = await downloadEvidenceFiles([file(), file()], () => "x.png", { ...env({ ok: false }), noDelay: true });
    expect(bad).toEqual({ done: 0, failed: 2 });
  });
});
