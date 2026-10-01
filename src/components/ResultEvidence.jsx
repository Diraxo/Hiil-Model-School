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

// Larger, labelled tiles for the read-only result detail. `pages` come from data.resultEvidenceFor()
// (already ordered, already signed). A tile is a real button, so it is keyboard reachable.
function EvidenceGallery({ pages, onOpen, context = "" }) {
  if (!pages || pages.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-2">Evidence · {pages.length} {pages.length === 1 ? "image" : "images"}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {pages.map((p, idx) => (
          <button key={p.id} type="button" onClick={() => onOpen(idx)} aria-label={`Open evidence ${idx + 1} of ${pages.length}${context ? ` — ${context}` : ""}`}
            className="group text-left rounded-xl border border-slate-200 hover:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400 overflow-hidden bg-slate-50">
            <div className="aspect-[4/3] flex items-center justify-center bg-slate-100">
              {p.fileType === "pdf" || !p.fileDataUrl
                ? <FileText size={28} className="text-slate-400" />
                : <img src={p.fileDataUrl} alt={`Evidence ${idx + 1}${context ? ` — ${context}` : ""}`} loading="lazy" decoding="async" className="w-full h-full object-cover" />}
            </div>
            <p className="px-2.5 py-1.5 text-xs font-medium text-slate-600 group-hover:text-brand-600">Evidence {idx + 1}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export { ExamEvidenceStrip, EvidenceGallery };
