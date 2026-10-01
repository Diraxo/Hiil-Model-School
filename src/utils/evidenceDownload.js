// Downloading evidence IMAGES (never converted to a PDF). Evidence lives in a private bucket and is
// served from short-lived cross-origin signed URLs, where the HTML `download` attribute is ignored, so
// the bytes are fetched and handed to the browser as a same-origin blob with a proper file name.

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };

function slug(text) {
  return String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Keeps the ORIGINAL format: the extension comes from the file's real MIME type, falling back to the
// stored file name, and only then to "jpg". Never ".pdf" for an image.
export function evidenceExtension(file) {
  const fromMime = EXT_BY_MIME[String(file?.mimeType || file?.type || "").toLowerCase()];
  if (fromMime) return fromMime;
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(String(file?.fileName || ""));
  if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  return file?.fileType === "pdf" ? "pdf" : "jpg";
}

// "Ahmed-Abdiqadir-Warsame-Mathematics-Midterm-evidence-1.png" — safe on every OS, no path separators.
export function evidenceDownloadName({ student, subject, assessment, index, file }) {
  const parts = [student, subject, assessment].map(slug).filter(Boolean);
  const base = [...parts, "evidence", String(index + 1)].join("-").slice(0, 150);
  return `${base}.${evidenceExtension(file)}`;
}

// Fetches one evidence file and saves it. Rejects (never pretends to succeed) when the file cannot be read.
export async function downloadEvidenceFile(file, filename, { fetchImpl = globalThis.fetch, doc = globalThis.document, urlApi = globalThis.URL } = {}) {
  if (!file?.fileDataUrl) throw new Error("This image is not available to download.");
  let res;
  try { res = await fetchImpl(file.fileDataUrl); } catch { throw new Error("The image could not be downloaded. Check your connection and try again."); }
  if (!res.ok) throw new Error("The image could not be downloaded. It may have expired — close and reopen the result, then try again.");
  const blob = await res.blob();
  const href = urlApi.createObjectURL(blob);
  try {
    const a = doc.createElement("a");
    a.href = href;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    doc.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => urlApi.revokeObjectURL(href), 10000);
  }
}

// Each image is its own download (no PDF, no combined file). Continues past a failure and reports it.
export async function downloadEvidenceFiles(files, nameFor, opts = {}) {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await downloadEvidenceFile(files[i], nameFor(files[i], i), opts);
      done += 1;
      // eslint-disable-next-line no-await-in-loop
      if (i < files.length - 1 && !opts.noDelay) await new Promise((r) => setTimeout(r, 350)); // lets browsers accept a series of downloads
    } catch { failed += 1; }
  }
  return { done, failed };
}
