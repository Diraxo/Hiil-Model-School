// Supabase-backed announcements.
//
// RLS is the boundary (announcements_select in migration 20260825190000): Owner/Educational
// Director see every row; an author always sees their own (even scheduled/expired); everyone
// else sees only a live (published, not expired) row whose audience matches their role/grade/
// section/user id. author_id is stamped server-side by the announcements_stamp_author trigger --
// the client-supplied authorId is ignored.
//
// The recipient fan-out ("New announcement" notifications) is done by notify_announcement, a
// SECURITY DEFINER RPC that derives the audience server-side and is idempotent via
// announcements.publish_notified.
//
// Attachment: one optional image or PDF. The bytes live in the private `announcement-attachments`
// bucket (path `<announcement_id>/<file>`, object RLS mirrors announcements_select); the
// `attachment_url text` column holds only `{ type, name, path }` JSON. DataContext resolves
// `path` to a short-lived signed URL and exposes it as `attachment.dataUrl`, so
// src/components/announcements.jsx stays unchanged. Legacy rows (`{ type, name, dataUrl }` with an
// inline data URI, or a bare URL string) are still parsed for backward compatibility.
import { supabase } from "../lib/supabaseClient";
import {
  isStoragePath, signPaths, uploadObject, removeObjects, validateDocFile, inferFileKind,
} from "../lib/storageMedia";

const BUCKET = "announcement-attachments";

function parseAttachment(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && (parsed.path || parsed.dataUrl)) {
      return { type: parsed.type || "pdf", name: parsed.name || "Attachment", path: parsed.path || null, dataUrl: parsed.dataUrl || null };
    }
  } catch {
    // A bare URL string (not our JSON shape) -- surface it as a generic file chip.
    return { type: "pdf", name: "Attachment", path: null, dataUrl: text };
  }
  return null;
}

function attachmentPathOf(text) {
  const a = parseAttachment(text);
  return a && isStoragePath(a.path) ? a.path : null;
}

function mapAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message || "",
    audience: row.audience || { type: "ALL" },
    priority: row.priority || "Normal",
    authorId: row.author_id || null,
    attachment: parseAttachment(row.attachment_url),
    pinned: !!row.pinned,
    publishAt: row.publish_at ? new Date(row.publish_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    publishNotified: !!row.publish_notified,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

const toIso = (ms) => (ms ? new Date(ms).toISOString() : null);

export function createAnnouncementService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapAnnouncement);
    },

    // `attachmentFile` (a raw File) is uploaded AFTER the row exists (bucket RLS keys on the
    // announcement id). The row is inserted with no attachment; on a successful upload the column
    // is set to `{type,name,path}` JSON. An upload failure removes the object and rethrows, but
    // the announcement row itself stays (attachment-less) rather than being half-created.
    async create({ title, message, audience, priority, attachmentFile, pinned, publishAt, expiresAt }) {
      const row = {
        title: (title || "").trim(),
        message: (message || "").trim() || null,
        audience: audience || { type: "ALL" },
        priority: priority || "Normal",
        attachment_url: null,
        pinned: !!pinned,
        publish_at: toIso(publishAt),
        expires_at: toIso(expiresAt),
        // A future-dated announcement is not yet dispatched; an immediate one is dispatched by
        // notify_announcement right after insert, which sets this itself. Seed it false so the
        // RPC's idempotency guard starts clean.
        publish_notified: false,
      };
      const { data, error } = await supabase.from("announcements").insert(row).select().single();
      if (error) throw error;
      let created = mapAnnouncement(data);
      if (attachmentFile instanceof File) {
        const invalid = validateDocFile(attachmentFile);
        if (invalid) throw new Error(invalid);
        const path = await uploadObject(BUCKET, created.id, attachmentFile);
        const meta = { type: inferFileKind(attachmentFile), name: attachmentFile.name || "Attachment", path };
        const { data: withAtt, error: attErr } = await supabase
          .from("announcements").update({ attachment_url: JSON.stringify(meta) }).eq("id", created.id).select().single();
        if (attErr) { await removeObjects(BUCKET, path); throw attErr; }
        created = mapAnnouncement(withAtt);
      }
      return created;
    },

    async togglePinned(id, pinned) {
      const { error } = await supabase.from("announcements").update({ pinned: !!pinned }).eq("id", id);
      if (error) throw error;
    },

    // Present for completeness / RLS parity (author or Owner/ED). No UI path today.
    async update(id, patch) {
      const row = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.message !== undefined) row.message = patch.message;
      if (patch.priority !== undefined) row.priority = patch.priority;
      if (patch.pinned !== undefined) row.pinned = !!patch.pinned;
      if (patch.expiresAt !== undefined) row.expires_at = toIso(patch.expiresAt);
      const { error } = await supabase.from("announcements").update(row).eq("id", id);
      if (error) throw error;
    },

    async remove(id) {
      const { data: cur } = await supabase.from("announcements").select("attachment_url").eq("id", id).single();
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw error;
      const path = attachmentPathOf(cur?.attachment_url);
      if (path) await removeObjects(BUCKET, path);
    },
    async signedUrls(paths) {
      return signPaths(BUCKET, paths);
    },

    // notify_announcement(p_announcement_id, p_title, p_message, p_navigation) -- idempotent,
    // server-derives the audience, no-ops if not yet due or already dispatched.
    async dispatch(announcementId, { title, message } = {}) {
      const { data, error } = await supabase.rpc("notify_announcement", {
        p_announcement_id: announcementId,
        p_title: title || "New announcement",
        p_message: message || "",
        p_navigation: { page: "announcements" },
      });
      if (error) throw error;
      return data;
    },

    // announcement_read_stats(uuid[]) -> [{ announcement_id, total, read_count }]
    async readStats(ids) {
      if (!ids || ids.length === 0) return {};
      const { data, error } = await supabase.rpc("announcement_read_stats", { p_announcement_ids: ids });
      if (error) throw error;
      const map = {};
      (data || []).forEach((r) => { map[r.announcement_id] = { total: r.total, read: r.read_count }; });
      return map;
    },
  };
}
