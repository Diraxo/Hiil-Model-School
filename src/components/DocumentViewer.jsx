// One shared in-app viewer for any attached document (image or PDF), so a receipt/attachment
// never has to leave the app in a new browser tab. Currently wired into Expense receipts and
// Announcement attachments — written generically so wiring in homework/exam attachments later is
// a one-line change per call site, not a rewrite.
import React, { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";
import { inferFileType } from "../utils/fileType";

const ZOOM_STEPS = [1, 1.5, 2];

// `fileType`: "image" | "pdf". `fileDataUrl`: a data: URI (or any URL) for the file itself.
// `fileName`: used for the Download attribute; `title` is the header/tab label shown to the user
// (e.g. "Expense #0007 — Receipt") — falls back to fileName, never renders "Untitled".
//
// Multi-page mode: pass `files` (an array of `{fileDataUrl, fileType, fileName}`, e.g. from
// `data.resultEvidenceFor(...)`) instead of the single-file props, plus optional `initialIndex`.
// When `files` is omitted this renders exactly as the original single-file viewer (all 4 existing
// call sites keep working unchanged); `files` adds Prev/Next paging and image zoom.
function DocumentViewerModal({ open, onClose, title, fileName, fileDataUrl, fileType, files, initialIndex = 0 }) {
  const multi = Array.isArray(files) && files.length > 0;
  const [index, setIndex] = useState(initialIndex);
  const [zoomStep, setZoomStep] = useState(0);

  useEffect(() => {
    if (open) { setIndex(initialIndex); setZoomStep(0); }
  }, [open, initialIndex]);

  if (!open) return null;
  if (!multi && !fileDataUrl) return null;

  const current = multi ? files[Math.min(index, files.length - 1)] : { fileDataUrl, fileType, fileName };
  if (!current || !current.fileDataUrl) return null;
  const resolvedType = current.fileType || inferFileType(current.fileDataUrl);
  const displayTitle = title || current.fileName || fileName || "Document";
  const zoom = ZOOM_STEPS[zoomStep];

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/90 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-white/80 hover:text-white text-sm font-medium">
          <ArrowLeft size={16} /> Back
        </button>
        <p className="text-sm font-medium text-white truncate px-2">
          {displayTitle}{multi && files.length > 1 && <span className="text-white/60 font-normal"> — page {index + 1} of {files.length}</span>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {resolvedType !== "pdf" && (
            <button
              type="button"
              onClick={() => setZoomStep((z) => (z + 1) % ZOOM_STEPS.length)}
              title={zoom > 1 ? "Zoom" : "Zoom in"}
              className="inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg px-2.5 py-1.5"
            >
              {zoom > 1 ? <ZoomOut size={15} /> : <ZoomIn size={15} />}
            </button>
          )}
          <a
            href={current.fileDataUrl}
            download={current.fileName || displayTitle}
            className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg px-3 py-1.5"
          >
            <Download size={15} /> Download
          </a>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative">
        {multi && files.length > 1 && index > 0 && (
          <button type="button" onClick={() => { setIndex((i) => i - 1); setZoomStep(0); }} className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-2">
            <ChevronLeft size={20} />
          </button>
        )}
        {resolvedType === "pdf" ? (
          <iframe title={displayTitle} src={current.fileDataUrl} className="w-full h-full bg-white rounded-lg border-0" />
        ) : (
          <img src={current.fileDataUrl} alt={displayTitle} style={{ transform: `scale(${zoom})` }} className="max-w-full max-h-full object-contain rounded-lg bg-white transition-transform" />
        )}
        {multi && files.length > 1 && index < files.length - 1 && (
          <button type="button" onClick={() => { setIndex((i) => i + 1); setZoomStep(0); }} className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-2">
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

export { DocumentViewerModal, inferFileType };
