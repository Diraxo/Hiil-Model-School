// One shared in-app viewer for any attached document (image or PDF), so a receipt/attachment
// never has to leave the app in a new browser tab. Currently wired into Expense receipts and
// Announcement attachments — written generically so wiring in homework/exam attachments later is
// a one-line change per call site, not a rewrite.
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { inferFileType } from "../utils/fileType";
import { downloadEvidenceFile, downloadEvidenceFiles } from "../utils/evidenceDownload";

const ZOOM_STEPS = [1, 1.5, 2];

// `fileType`: "image" | "pdf". `fileDataUrl`: a data: URI (or any URL) for the file itself.
// `fileName`: used for the Download attribute; `title` is the header/tab label shown to the user
// (e.g. "Expense #0007 — Receipt") — falls back to fileName, never renders "Untitled".
//
// Multi-page mode: pass `files` (an array of `{fileDataUrl, fileType, fileName}`, e.g. from
// `data.resultEvidenceFor(...)`) instead of the single-file props, plus optional `initialIndex`.
// When `files` is omitted this renders exactly as the original single-file viewer (all 4 existing
// call sites keep working unchanged); `files` adds Previous/Next paging and image zoom.
//
// `allowDownload` (default true) shows a plain Download link. Private evidence is served from
// short-lived cross-origin signed URLs, where the `download` attribute is ignored and the browser
// would navigate away from the app to the storage host — so evidence callers pass false and instead
// pass `downloadName(file, index)`, which turns on "Download this image" / "Download all": each image
// is fetched and saved as its own file in its original format (never combined, never a PDF).
function DocumentViewerModal({ open, onClose, title, fileName, fileDataUrl, fileType, files, initialIndex = 0, allowDownload = true, itemLabel = "page", downloadName = null }) {
  const multi = Array.isArray(files) && files.length > 0;
  const [index, setIndex] = useState(initialIndex);
  const [zoomStep, setZoomStep] = useState(0);
  const [imgState, setImgState] = useState("loading"); // loading | ready | error
  const [dl, setDl] = useState({ busy: false, message: "", tone: "info" });
  const closeRef = useRef(null);

  useEffect(() => {
    if (open) { setIndex(initialIndex); setZoomStep(0); setDl({ busy: false, message: "", tone: "info" }); }
  }, [open, initialIndex]);
  // A new image (or a reopen) starts in the loading state; the close control takes focus.
  useEffect(() => { if (open) setImgState("loading"); }, [open, index]);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);

  const count = multi ? files.length : 1;

  // Keyboard: Esc closes, ←/→ page. Registered only while open, and always cleaned up.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") { setIndex((i) => Math.max(0, i - 1)); setZoomStep(0); }
      else if (e.key === "ArrowRight") { setIndex((i) => Math.min(count - 1, i + 1)); setZoomStep(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, count]);

  if (!open) return null;
  if (!multi && !fileDataUrl) return null;

  const safeIndex = multi ? Math.min(index, files.length - 1) : 0;
  const current = multi ? files[safeIndex] : { fileDataUrl, fileType, fileName };
  if (!current || !current.fileDataUrl) return null;
  const resolvedType = current.fileType || inferFileType(current.fileDataUrl);
  const displayTitle = title || current.fileName || fileName || "Document";
  const zoom = ZOOM_STEPS[zoomStep];
  const canPrev = multi && files.length > 1 && index > 0;
  const canNext = multi && files.length > 1 && index < files.length - 1;
  const canDownload = typeof downloadName === "function" && multi;
  const showFooter = (multi && files.length > 1) || canDownload;
  const go = (delta) => { setIndex((i) => Math.min(count - 1, Math.max(0, i + delta))); setZoomStep(0); };

  async function downloadCurrent() {
    setDl({ busy: true, message: "", tone: "info" });
    try {
      await downloadEvidenceFile(current, downloadName(current, safeIndex));
      setDl({ busy: false, message: "Image downloaded.", tone: "ok" });
    } catch (e) {
      setDl({ busy: false, message: e.message || "The image could not be downloaded.", tone: "error" });
    }
  }
  async function downloadAll() {
    setDl({ busy: true, message: "", tone: "info" });
    const { done, failed } = await downloadEvidenceFiles(files, (f, i) => downloadName(f, i));
    setDl(failed === 0
      ? { busy: false, message: `${done} ${done === 1 ? "image" : "images"} downloaded.`, tone: "ok" }
      : { busy: false, message: `${done} downloaded, ${failed} could not be downloaded. Try those again one at a time.`, tone: "error" });
  }

  const navBtn = "inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg px-3";
  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/90 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label={displayTitle}>
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-white/10 shrink-0" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="Close viewer" className={navBtn}>
          <X size={16} /> Close
        </button>
        <p className="text-sm font-medium text-white px-1 min-w-0 flex-1 text-center leading-snug break-words">
          {displayTitle}{multi && files.length > 1 && <span className="block text-xs text-white/70 font-normal">{itemLabel} {index + 1} of {files.length}</span>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {resolvedType !== "pdf" && (
            <button
              type="button"
              onClick={() => setZoomStep((z) => (z + 1) % ZOOM_STEPS.length)}
              title={zoom > 1 ? "Zoom" : "Zoom in"}
              aria-label={zoom > 1 ? "Zoom out" : "Zoom in"}
              className={navBtn}
            >
              {zoom > 1 ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            </button>
          )}
          {allowDownload && (
            <a href={current.fileDataUrl} download={current.fileName || displayTitle} className={navBtn}>
              <Download size={15} /> Download
            </a>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-2 sm:p-4 relative">
        {resolvedType === "pdf" ? (
          <iframe title={displayTitle} src={current.fileDataUrl} className="w-full h-full bg-white rounded-lg border-0" />
        ) : (
          <>
            {imgState === "loading" && <p role="status" className="absolute text-sm text-white/70">Loading image…</p>}
            {imgState === "error" ? (
              <p role="alert" className="text-sm text-white/80 bg-white/10 rounded-lg px-4 py-3">This image could not be loaded. It may have expired — close and reopen the result to refresh it.</p>
            ) : (
              <img src={current.fileDataUrl} alt={displayTitle} onLoad={() => setImgState("ready")} onError={() => setImgState("error")}
                style={{ transform: `scale(${zoom})` }} className={`max-w-full max-h-full object-contain rounded-lg bg-white transition-transform ${imgState === "loading" ? "opacity-0" : ""}`} />
            )}
          </>
        )}
      </div>
      {showFooter && (
        <div className="shrink-0 border-t border-white/10 px-3 sm:px-4 pt-2 space-y-2" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {dl.message && <p role={dl.tone === "error" ? "alert" : "status"} className={`text-xs text-center ${dl.tone === "error" ? "text-red-200" : "text-white/70"}`}>{dl.message}</p>}
          {multi && files.length > 1 && (
            <div className="flex items-center gap-2">
              <div className="flex-1">{canPrev && <button type="button" aria-label={`Previous ${itemLabel}`} onClick={() => go(-1)} className={`${navBtn} w-full`}><ChevronLeft size={18} /> Previous</button>}</div>
              <div className="flex-1">{canNext && <button type="button" aria-label={`Next ${itemLabel}`} onClick={() => go(1)} className={`${navBtn} w-full`}>Next <ChevronRight size={18} /></button>}</div>
            </div>
          )}
          {canDownload && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={downloadCurrent} disabled={dl.busy} className={`${navBtn} flex-1 disabled:opacity-50`}>
                <Download size={15} /> {dl.busy ? "Downloading…" : "Download this image"}
              </button>
              {files.length > 1 && (
                <button type="button" onClick={downloadAll} disabled={dl.busy} className={`${navBtn} flex-1 disabled:opacity-50`}>
                  <Download size={15} /> Download all ({files.length})
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { DocumentViewerModal, inferFileType };
