// Infers "image" | "pdf" from a data: URI's mime type, or a filename / URL extension as a
// fallback. Lives in utils (not components/DocumentViewer.jsx) so data-layer code can use it
// without importing from the UI layer; DocumentViewer.jsx re-exports it for existing callers.
// NOTE: stored files also carry an explicit `file_type` / `type` column — prefer that; this is
// only the fallback when no explicit type is available.
function inferFileType(dataUrlOrName) {
  if (!dataUrlOrName) return "image";
  if (dataUrlOrName.startsWith("data:application/pdf")) return "pdf";
  if (dataUrlOrName.startsWith("data:image/")) return "image";
  // Drop any signed-URL query string / fragment before checking the extension.
  const clean = String(dataUrlOrName).split(/[?#]/)[0];
  return /\.pdf$/i.test(clean) ? "pdf" : "image";
}

export { inferFileType };
