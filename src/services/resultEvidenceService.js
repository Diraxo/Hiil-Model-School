// Supabase-backed result-evidence (exam-evidence) service. Same pattern as every other domain --
// this file only ever talks to the `result_evidence` table and the private `result-evidence`
// Storage bucket; DataContext.jsx owns the read-side state + refetch (metadata rows AND a
// path->signed-URL map) and wraps every write in an async api.* method that writes through here,
// refetches, then writes the result_audit_log entry and the activity line (log_activity RPC).
//
// Security model (defence in depth, RLS is the real boundary):
//   - result_evidence RLS (20260825190000_rls_policies.sql L826-849, refined by
//     20260901040000): SELECT = Owner/Educational Director, the assigned subject teacher, or a
//     linked parent ONLY when the result is PUBLISHED/LOCKED and that component is
//     shared_with_parents. INSERT/UPDATE/DELETE = can_edit_result_component() (Owner/Director or
//     assigned teacher; blocked outright once LOCKED). Finance: zero access.
//   - storage.objects RLS for bucket 'result-evidence' (20260827010000 + 20260901050000) mirrors
//     the same rules per object, so createSignedUrl(s) fails closed for a path the caller may not
//     read even if a stale metadata row leaked through.
//   - the object key is ALWAYS <result_id>/<component>/<safe-name> built here from server-known
//     ids, never from client input -- filenames are sanitised, path separators stripped, so a
//     client cannot escape its own result's folder.
//   - uploaded_by is stamped server-side from auth.uid() (stamp_result_evidence_uploader trigger).
import { supabase } from "../lib/supabaseClient";

const BUCKET = "result-evidence";
// Mirrors the bucket's own limits (20260827010000_storage_buckets_and_policies.sql).
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_EVIDENCE_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const SIGNED_URL_TTL_SECONDS = 3600;

const ts = (v) => (v ? new Date(v).getTime() : null);

function inferType(mime, name) {
  if (mime === "application/pdf") return "pdf";
  if (mime && mime.startsWith("image/")) return "image";
  return /\.pdf$/i.test(name || "") ? "pdf" : "image";
}

function mapRow(row) {
  return {
    id: row.id,
    resultId: row.result_id,
    studentId: row.student_id,
    classId: row.class_id || null,
    semester: row.semester,
    component: row.component,
    academicYearId: row.academic_year_id,
    order: row.page_order == null ? 0 : row.page_order,
    storagePath: row.storage_path || null,
    fileName: row.file_name || null,
    fileType: row.file_type || inferType(row.mime_type, row.file_name),
    mimeType: row.mime_type || null,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    uploadedBy: row.uploaded_by || null,
    uploadedAt: ts(row.uploaded_at),
  };
}

// User-facing validation shared by the UI (pre-check) and every write path here (authoritative).
export function validateEvidenceFile(file) {
  if (!file) return "Choose a file to attach.";
  const type = file.type || "";
  if (!ALLOWED_EVIDENCE_MIME.includes(type)) {
    return "Unsupported file type — attach a JPEG, PNG, WebP, or PDF.";
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return "That file is too large — the maximum size is 20 MB.";
  }
  return null;
}

// Strips directory separators and anything that isn't a safe filename char, so the caller can
// never influence the object path beyond the leaf name. Always yields `<base>.<ext>`.
export function sanitizeEvidenceFileName(name) {
  const raw = String(name || "file").split(/[\\/]/).pop() || "file";
  const dot = raw.lastIndexOf(".");
  const rawBase = dot > 0 ? raw.slice(0, dot) : raw;
  const rawExt = dot > 0 ? raw.slice(dot + 1) : "";
  const base =
    rawBase.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  const ext = rawExt.replace(/[^A-Za-z0-9]+/g, "").toLowerCase().slice(0, 8) || "bin";
  return `${base}.${ext}`;
}

function buildPath(resultId, component, fileName) {
  return `${resultId}/${component}/${Date.now()}-${sanitizeEvidenceFileName(fileName)}`;
}

export function createResultEvidenceService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("result_evidence")
        .select("*")
        .order("page_order", { ascending: true });
      if (error) throw error;
      return (data || []).map(mapRow);
    },

    // Batch-sign a set of object keys -> Map(path -> signedUrl). Storage RLS filters per object,
    // so a key the caller isn't entitled to simply comes back without a URL (no throw).
    async signedUrls(paths) {
      const uniq = [...new Set((paths || []).filter(Boolean))];
      const out = new Map();
      if (uniq.length === 0) return out;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(uniq, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      (data || []).forEach((entry) => {
        if (entry && entry.signedUrl && !entry.error) out.set(entry.path, entry.signedUrl);
      });
      return out;
    },

    // Upload one evidence page: file -> Storage, then metadata row. On a metadata failure the
    // just-uploaded object is best-effort removed so a failed add leaves nothing behind.
    async add({ resultId, studentId, classId, semester, component, academicYearId, file }) {
      const invalid = validateEvidenceFile(file);
      if (invalid) throw new Error(invalid);

      const { data: existing, error: exErr } = await supabase
        .from("result_evidence")
        .select("page_order")
        .eq("result_id", resultId)
        .eq("component", component);
      if (exErr) throw exErr;
      const nextOrder = existing && existing.length
        ? Math.max(...existing.map((e) => e.page_order || 0)) + 1
        : 0;

      const path = buildPath(resultId, component, file.name);
      const safeName = sanitizeEvidenceFileName(file.name);
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data, error } = await supabase
        .from("result_evidence")
        .insert({
          result_id: resultId,
          student_id: studentId,
          class_id: classId || null,
          semester,
          component,
          academic_year_id: academicYearId,
          page_order: nextOrder,
          storage_path: path,
          file_name: safeName,
          file_type: inferType(file.type, file.name),
          mime_type: file.type || null,
          file_size: file.size == null ? null : file.size,
        })
        .select()
        .single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw error;
      }
      return mapRow(data);
    },

    // Replace the file behind an existing page: upload the new object, repoint the row, and only
    // once both have succeeded drop the old object. A failure at any step leaves the page pointing
    // at a file that exists.
    async replace(row, file) {
      const invalid = validateEvidenceFile(file);
      if (invalid) throw new Error(invalid);

      const path = buildPath(row.resultId, row.component, file.name);
      const safeName = sanitizeEvidenceFileName(file.name);
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data, error } = await supabase
        .from("result_evidence")
        .update({
          storage_path: path,
          file_name: safeName,
          file_type: inferType(file.type, file.name),
          mime_type: file.type || null,
          file_size: file.size == null ? null : file.size,
        })
        .eq("id", row.id)
        .select()
        .single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw error;
      }
      if (row.storagePath && row.storagePath !== path) {
        await supabase.storage.from(BUCKET).remove([row.storagePath]).catch(() => {});
      }
      return mapRow(data);
    },

    // Delete metadata first (RLS-gated), then the object. Resilient to a missing object.
    async remove(row) {
      const { error } = await supabase.from("result_evidence").delete().eq("id", row.id);
      if (error) throw error;
      if (row.storagePath) {
        await supabase.storage.from(BUCKET).remove([row.storagePath]).catch(() => {});
      }
    },

    // updates: [{ id, order }] -- page reordering only, no file movement.
    async setOrder(updates) {
      for (const u of updates || []) {
        // eslint-disable-next-line no-await-in-loop
        const { error } = await supabase
          .from("result_evidence")
          .update({ page_order: u.order })
          .eq("id", u.id);
        if (error) throw error;
      }
    },

    // Best-effort bulk object cleanup when a student/class (and its results) is hard-deleted --
    // the metadata rows cascade in Postgres, the Storage objects do not.
    async removeObjects(paths) {
      const uniq = [...new Set((paths || []).filter(Boolean))];
      if (uniq.length === 0) return;
      await supabase.storage.from(BUCKET).remove(uniq).catch(() => {});
    },
  };
}
