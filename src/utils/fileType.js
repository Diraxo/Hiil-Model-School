// Infers "image" | "pdf" from a data: URI's mime type, or a filename's extension as a fallback.
// Lives in utils (not components/DocumentViewer.jsx) so data-layer code (seed.js migrations) can
// use it without importing from the UI layer; DocumentViewer.jsx re-exports it for existing callers.
function inferFileType(dataUrlOrName) {
  if (!dataUrlOrName) return "image";
  if (dataUrlOrName.startsWith("data:application/pdf")) return "pdf";
  if (dataUrlOrName.startsWith("data:image/")) return "image";
  return /\.pdf$/i.test(dataUrlOrName) ? "pdf" : "image";
}

export { inferFileType };
