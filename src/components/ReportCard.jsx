import React, { useRef, useState } from "react";
import { Printer, Download } from "lucide-react";
import { Modal, resultTotals } from "./ui";
import { useData } from "../context/DataContext";
import { LOGO_DATA_URI, GRADES, round2 } from "../utils/constants";
import { downloadElementAsA4Pdf } from "../utils/pdf";

// Fixed school address block on the printed card — not per-student data, so it isn't sourced
// from the student record (the app has no region/city fields; this is the school's own location).
const SCHOOL_REGION = "Somali";
const SCHOOL_CITY = "Jigjiga, Ethiopia";

// A4-portrait, print-first replica of the school's physical "Student Yearly Report Card" pad
// (src/assets/ReportCard.jpeg): no student photo, no seal/stamp, no auto-filled date — teacher
// and principal signatures plus every date are left blank so the school signs/stamps on paper
// after printing. Shared by the Director/Owner's Report Cards page and the Parent's Results page.
function ReportCardModal({ student, classId, onClose }) {
  const data = useData();
  const printRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  if (!student) return null;
  const cls = data.getClass(classId);
  const required = data.requiredSubjectsForClass(classId);
  const rc = data.getReportCard(student.id, classId);

  const rows = required.map((subject) => {
    const s1 = data.getResult(student.id, classId, subject, "S1");
    const s2 = data.getResult(student.id, classId, subject, "S2");
    const t1 = resultTotals(s1);
    const t2 = resultTotals(s2);
    const final = t1.count > 0 && t2.count > 0 ? round2((t1.total + t2.total) / 2) : (t2.count > 0 ? t2.total : null);
    return { subject, t1, t2, final };
  });

  const requiredCount = required.length;
  const outOfTotal = requiredCount * 100;
  const s1Total = round2(rows.reduce((sum, r) => sum + (r.t1.count > 0 ? r.t1.total : 0), 0));
  const s2Total = round2(rows.reduce((sum, r) => sum + (r.t2.count > 0 ? r.t2.total : 0), 0));
  const yearlyTotal = round2(rows.reduce((sum, r) => sum + (r.final !== null ? r.final : 0), 0));
  // Overall averages (across all subjects) round to a whole number everywhere in the app — Results
  // grid, Student Profile, Class Rank, and Parent Results all use Math.round via resultsEngine.js.
  // Per-subject totals/percentages above keep full decimal precision (round2 only, for float
  // safety); only this cross-subject aggregate is rounded down to a whole percentage.
  const s1Avg = requiredCount ? Math.round(s1Total / requiredCount) : null;
  const s2Avg = requiredCount ? Math.round(s2Total / requiredCount) : null;
  const yearlyAvg = requiredCount ? Math.round(yearlyTotal / requiredCount) : null;

  const s1Results = data.classSemesterResults(classId, "S1");
  const s2Results = data.classSemesterResults(classId, "S2");
  const yearlyResults = data.classYearlyResults(classId);
  const s1Rank = s1Results.rows.find((r) => r.studentId === student.id)?.rank ?? null;
  const s2Rank = s2Results.rows.find((r) => r.studentId === student.id)?.rank ?? null;
  const yearlyRank = yearlyResults.rows.find((r) => r.studentId === student.id)?.rank ?? null;

  const gradeIndex = cls ? GRADES.indexOf(cls.grade) : -1;
  const nextGrade = gradeIndex >= 0 && gradeIndex < GRADES.length - 1 ? GRADES[gradeIndex + 1] : null;

  async function handleDownload() {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsA4Pdf(printRef.current, `Report-Card-${data.studentFullName(student).replace(/\s+/g, "-")}.pdf`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal open={!!student} onClose={onClose} title={`Report Card — ${data.studentFullName(student)}`} maxWidthClass="sm:max-w-[880px]">
      <style>{"@media print { @page { size: A4 portrait; margin: 0; } }"}</style>
      <div className="report-card-print overflow-x-auto">
        <div ref={printRef} className="relative flex flex-col bg-white text-slate-900 font-serif mx-auto" style={{ width: "210mm", minHeight: "297mm", padding: "12mm", boxSizing: "border-box" }}>
          {/* Blank photo box — no student photo, matches the physical pad */}
          <div className="absolute border-2 border-slate-800" style={{ top: "12mm", right: "12mm", width: "26mm", height: "31mm" }} />

          {/* Header */}
          <div className="relative text-center pb-3 mb-4 border-b-[3px] border-sky-800">
            <div className="absolute inset-x-0 top-2 h-[5px] bg-red-600" />
            <img src={LOGO_DATA_URI} alt="Tilmaan Modern Academy" className="relative z-10 w-20 h-20 mx-auto rounded-full border-2 border-white shadow object-cover" />
            <h1 className="mt-1 text-2xl font-bold tracking-wide text-sky-900 uppercase">Tilmaan Modern Academy</h1>
            <p className="text-xs italic font-medium text-sky-800 tracking-wide">Quality Education and Personal Excellence</p>
          </div>

          <p className="text-center font-bold text-sm uppercase underline underline-offset-4 mb-3">Student Yearly Report Card</p>

          <div className="text-[13px] leading-relaxed mb-3" style={{ paddingRight: "30mm" }}>
            <p>
              <span className="font-semibold">Student's Name: </span>{data.studentFullName(student).toUpperCase()}
              <span className="font-semibold ml-6">Sex: </span>{(student.gender || "—").toUpperCase()}
            </p>
            <p>
              <span className="font-semibold">Completed: </span>{cls ? cls.grade.toUpperCase() : "—"}
              <span className="font-semibold ml-6">Region: </span>{SCHOOL_REGION.toUpperCase()}
              <span className="font-semibold ml-6">City: </span>{SCHOOL_CITY.toUpperCase()}
            </p>
          </div>

          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-900 px-2 py-1 text-left">Subject</th>
                <th className="border border-slate-900 px-2 py-1">Out of</th>
                <th className="border border-slate-900 px-2 py-1">Sem 1</th>
                <th className="border border-slate-900 px-2 py-1">Sem II</th>
                <th className="border border-slate-900 px-2 py-1">Yearly Average</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.subject}>
                  <td className="border border-slate-900 px-2 py-1 font-medium">{r.subject}</td>
                  <td className="border border-slate-900 px-2 py-1 text-center">100</td>
                  <td className="border border-slate-900 px-2 py-1 text-center">{r.t1.count > 0 ? r.t1.total : "—"}</td>
                  <td className="border border-slate-900 px-2 py-1 text-center">{r.t2.count > 0 ? r.t2.total : "—"}</td>
                  <td className="border border-slate-900 px-2 py-1 text-center font-semibold">{r.final !== null ? r.final : "—"}</td>
                </tr>
              ))}
              <tr className="font-bold bg-slate-50">
                <td className="border border-slate-900 px-2 py-1">Total</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{outOfTotal}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{s1Total}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{s2Total}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{yearlyTotal}</td>
              </tr>
              <tr className="font-bold">
                <td className="border border-slate-900 px-2 py-1">Average</td>
                <td className="border border-slate-900 px-2 py-1"></td>
                <td className="border border-slate-900 px-2 py-1 text-center">{s1Avg ?? "—"}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{s2Avg ?? "—"}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{yearlyAvg ?? "—"}</td>
              </tr>
              <tr className="font-bold">
                <td className="border border-slate-900 px-2 py-1">Rank</td>
                <td className="border border-slate-900 px-2 py-1"></td>
                <td className="border border-slate-900 px-2 py-1 text-center">{s1Rank ?? "—"}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{s2Rank ?? "—"}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">{yearlyRank ?? "—"}</td>
              </tr>
            </tbody>
          </table>

          {rc && rc.promoted !== null && rc.promoted !== undefined && (
            <p className="mt-3 text-[13px] font-bold uppercase tracking-wide">
              {rc.promoted ? (nextGrade ? `Promoted to ${nextGrade}` : "Promoted") : `Retained in ${cls ? cls.grade : "current grade"}`}
            </p>
          )}

          {/* Signatures, blank date fields — filled in by hand after printing */}
          <div className="mt-auto pt-10 text-[13px]">
            <div className="flex justify-between items-end mb-7">
              <div style={{ width: "58%" }}>
                <div className="border-b border-slate-900 h-6" />
                <p className="mt-1">Class Teacher's Sign</p>
              </div>
              <div style={{ width: "34%" }} className="text-right">
                <p>Date: ____ / ____ / ______</p>
              </div>
            </div>
            <div className="flex justify-between items-end">
              <div style={{ width: "58%" }}>
                <div className="border-b border-slate-900 h-6" />
                <p className="mt-1">Principal's Sign</p>
              </div>
              <div style={{ width: "34%" }} className="text-right">
                <p>Date: ____ / ____ / ______</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4 no-print">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg px-3.5 py-2 text-sm font-medium"><Printer size={15} /> Print Report Card</button>
        <button onClick={handleDownload} disabled={downloading} className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-60"><Download size={15} /> {downloading ? "Preparing…" : "Download PDF"}</button>
      </div>
    </Modal>
  );
}

export { ReportCardModal };
