// Read-only "Exam Evidence" block for one Test assessment: a page count plus a thumbnail per
// page (in stored order). Clicking a thumbnail hands its index to `onOpen`, which the caller wires
// to the in-app DocumentViewerModal — nothing here links out of the app. `pages` comes from
// data.resultEvidenceFor(), so it is already ordered and carries signed `fileDataUrl`s.
import React from "react";
import { FileText } from "lucide-react";

function ExamEvidenceStrip({ pages, onOpen }) {
  if (!pages || pages.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="text-[11px] font-medium text-slate-500 mb-1">Exam Evidence · {pages.length} {pages.length === 1 ? "page" : "pages"}</p>
      <div className="flex flex-wrap gap-1.5">
        {pages.map((p, idx) => (
          <button key={p.id} type="button" onClick={() => onOpen(idx)} aria-label={`Open exam page ${idx + 1} of ${pages.length}`}
            className="relative w-14 h-14 rounded-lg border border-slate-200 hover:border-brand-400 overflow-hidden bg-slate-50 flex items-center justify-center">
            {p.fileType === "pdf" || !p.fileDataUrl
              ? <FileText size={18} className="text-slate-400" />
              : <img src={p.fileDataUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
            <span className="absolute bottom-0 right-0 bg-slate-900/70 text-white text-[9px] leading-none px-1 py-0.5 rounded-tl">{idx + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { ExamEvidenceStrip };
