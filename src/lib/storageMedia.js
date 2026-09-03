// Shared helpers for user-uploaded files that live in private Supabase Storage buckets.
//
// Every user-uploaded image/file in this app is stored the same way: the bytes go into a private
// bucket, and only the object PATH (`<owner_id>/<unique-name>`) is persisted in Postgres. The UI
// still reads a plain, directly-usable string off the record (`student.photo`,
// `announcement.attachment.dataUrl`, `document.fileDataUrl`, ...), so DataContext/AuthContext
// resolve those paths to short-lived signed URLs on read (see `signPaths` below) and swap them in
// before the value reaches a component. `isStoragePath` is what tells a stored path apart from a
// legacy inline `data:` URI (pre-Storage rows) or an already-signed `https:` URL.
import { supabase } from "./supabaseClient";

export const SIGNED_URL_TTL_SECONDS = 3600;

export const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const DOC_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

// True when `value` is a bare Storage object key (what we persist), rather than an inline data URI,
// a blob: preview URL, or an already-resolved http(s) signed URL. Fails closed on empty/non-string.
export function isStoragePath(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("http://") || value.startsWith("https://")) {
    return false;
  }
  return true;
}

// Strips directory separators and unsafe characters so a caller can never influence the object
// path beyond the leaf filename. Always yields `<base>.<ext>`.
export function sanitizeFileName(name) {
  const raw = String(name || "file").split(/[\\/]/).pop() || "file";
  const dot = raw.lastIndexOf(".");
  const rawBase = dot > 0 ? raw.slice(0, dot) : raw;
  const rawExt = dot > 0 ? raw.slice(dot + 1) : "";
  const base = rawBase.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  const ext = rawExt.replace(/[^A-Za-z0-9]+/g, "").toLowerCase().slice(0, 8) || "bin";
  return `${base}.${ext}`;
}

// `<ownerId>/<timestamp>-<safe-name>` — the first path segment is always a server-known id
// (profile id, staff id, student id, announcement id) that the bucket's RLS policy parses to find
// the owning record. `crypto.randomUUID()` keeps two uploads in the same millisecond distinct.
export function buildObjectPath(ownerId, fileName) {
  const rand = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2, 10)).slice(0, 8);
  return `${ownerId}/${Date.now()}-${rand}-${sanitizeFileName(fileName)}`;
}

export function validateImageFile(file) {
  if (!file) return "Choose an image to upload.";
  if (!IMAGE_MIME.includes(file.type || "")) return "Unsupported image type — use a JPEG, PNG, WebP, or GIF.";
  if (file.size > MAX_IMAGE_BYTES) return "That image is too large — the maximum size is 5 MB.";
  return null;
}

export function validateDocFile(file) {
  if (!file) return "Choose a file to upload.";
  if (!DOC_MIME.includes(file.type || "")) return "Unsupported file type — attach a JPEG, PNG, WebP, or PDF.";
  if (file.size > MAX_DOC_BYTES) return "That file is too large — the maximum size is 20 MB.";
  return null;
}

export function inferFileKind(file) {
  const mime = (file && file.type) || "";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return /\.pdf$/i.test((file && file.name) || "") ? "pdf" : "image";
}

// Batch-sign object keys for one bucket -> Map(path -> signedUrl). Storage RLS filters per object,
// so a key the caller isn't entitled to simply comes back without a URL (never throws for that).
export async function signPaths(bucket, paths) {
  const uniq = [...new Set((paths || []).filter((p) => isStoragePath(p)))];
  const out = new Map();
  if (uniq.length === 0) return out;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(uniq, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  (data || []).forEach((entry) => {
    if (entry && entry.signedUrl && !entry.error) out.set(entry.path, entry.signedUrl);
  });
  return out;
}

// Upload one file to `bucket` at a fresh `<ownerId>/...` key. Returns the stored path.
export async function uploadObject(bucket, ownerId, file) {
  const path = buildObjectPath(ownerId, file.name);
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Best-effort object removal — a missing object (already gone, RLS, never uploaded) is not fatal
// to the caller's flow. Accepts a single path or an array.
export async function removeObjects(bucket, paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter((p) => isStoragePath(p));
  if (list.length === 0) return;
  await supabase.storage.from(bucket).remove(list).catch(() => {});
}
