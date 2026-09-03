// Shared announcement UI — the audience label, the composer's attachment picker, the compact
// attachment chip shown on a card, and the full detail modal — reused by Owner/Educational
// Director/Teacher/Finance/Parent views of AnnouncementsPage (all of which live in AdminPages.jsx).
// Kept as its own module (like src/components/leave.jsx) so ParentPages.jsx can use the detail
// modal without a circular import back into AdminPages.jsx.
import React, { useState } from "react";
import { FileText, ImagePlus, Megaphone, Pin } from "lucide-react";
import { Modal, Field, Card, Badge } from "./ui";
import { DocumentViewerModal } from "./DocumentViewer";
import { fmtDate, fmtTime, timeAgo } from "../utils/helpers";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";

// Whether a viewer should see this announcement right now — false for one scheduled in the
// future or past its expiry date. Admin/author oversight views deliberately bypass this (they
// need to see and manage scheduled/expired items), so this only gates plain-recipient views.
function isAnnouncementLive(a, now = Date.now()) {
  return (!a.publishAt || a.publishAt <= now) && (!a.expiresAt || a.expiresAt >= now);
}

// Phase 6: cross-user read counts can't come from the RLS-scoped notifications list anymore
// (a client only sees its own rows). DataContext fetches them via the announcement_read_stats
// SECURITY DEFINER RPC (author / Owner / Educational Director only) and exposes them as a map.
function announcementReadStats(db, announcementId) {
  return (db.announcementReadStatsById && db.announcementReadStatsById[announcementId]) || { total: 0, read: 0 };
}

function audienceLabel(audience) {
  if (!audience) return "—";
  if (audience.type === "ALL") return "All users";
  if (audience.type === "ALL_PARENTS") return "All parents";
  if (audience.type === "ALL_TEACHERS") return "All teachers";
  if (audience.type === "DIRECTORS") return "Directors";
  if (audience.type === "GRADE") return `${audience.grade} Parents`;
  if (audience.type === "SECTION") return `${audience.grade}${audience.section} Parents`;
  if (audience.type === "USER") return "Direct";
  return "—";
}

// One optional attachment — an image (with preview) or a PDF (shown as a filename chip) —
// mutually exclusive, matching the announcement schema's single `attachment` field. Stored as a
// data: URI for now (Phase 1 has no file storage yet); the `{ type, name, dataUrl }` shape is
// deliberately what a later Supabase Storage/R2 swap would keep, just pointing `dataUrl` at a
// real hosted URL instead of an inline data URI.
function AnnouncementAttachmentField({ attachment, onChange }) {
  function pick(type) {
    return (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => onChange({ type, name: file.name, dataUrl: reader.result });
      reader.readAsDataURL(file);
    };
  }
  return (
    <Field label="Attachment (optional)">
      {attachment ? (
        <div className="flex items-center gap-3">
          {attachment.type === "image" ? (
            <img src={attachment.dataUrl} alt={attachment.name} className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <FileText size={14} /> {attachment.name}
            </span>
          )}
          <button type="button" onClick={() => onChange(null)} className="text-xs text-red-500 font-medium">Remove</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-400 cursor-pointer hover:border-sky-300 w-fit">
            <ImagePlus size={15} /> Attach image
            <input type="file" accept="image/*" className="hidden" onChange={pick("image")} />
          </label>
          <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-400 cursor-pointer hover:border-sky-300 w-fit">
            <FileText size={15} /> Attach PDF
            <input type="file" accept="application/pdf" className="hidden" onChange={pick("pdf")} />
          </label>
        </div>
      )}
    </Field>
  );
}

// Compact attachment indicator shown on the announcement card (small thumbnail or a filename chip).
function AnnouncementAttachmentChip({ attachment }) {
  if (!attachment) return null;
  if (attachment.type === "image") {
    return <img src={attachment.dataUrl} alt={attachment.name} className="w-10 h-10 rounded-lg object-cover border border-slate-200" />;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <FileText size={13} /> {attachment.name}
    </span>
  );
}

// The full, untruncated announcement — title, role-aware sender, readable audience, full publish
// date, the complete message with line breaks preserved, and the attachment (full image or a
// PDF "open" link).
function AnnouncementDetailModal({ announcement, onClose }) {
  const data = useData();
  const [pdfOpen, setPdfOpen] = useState(false);
  if (!announcement) return null;
  const senderLabel = data.announcementSenderLabel(announcement.authorId);
  return (
    <Modal open={!!announcement} onClose={onClose} title={announcement.title} wide>
      <div className="space-y-3">
        <div className="text-xs text-slate-500 space-y-0.5">
          <p><span className="font-medium text-slate-600">From:</span> {senderLabel}</p>
          <p><span className="font-medium text-slate-600">Audience:</span> {audienceLabel(announcement.audience)}</p>
          <p><span className="font-medium text-slate-600">Published:</span> {fmtDate(announcement.createdAt)} at {fmtTime(announcement.createdAt)}</p>
        </div>
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{announcement.message}</p>
        {announcement.attachment?.type === "image" && (
          <img src={announcement.attachment.dataUrl} alt={announcement.attachment.name} className="w-full rounded-lg border border-slate-200 max-h-96 object-contain bg-slate-50" />
        )}
        {announcement.attachment?.type === "pdf" && (
          <button
            type="button" onClick={() => setPdfOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm text-sky-600 font-medium hover:underline"
          >
            <FileText size={15} /> PDF attachment: {announcement.attachment.name} → Open
          </button>
        )}
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
        </div>
      </div>
      <DocumentViewerModal
        open={pdfOpen} onClose={() => setPdfOpen(false)} fileType="pdf"
        title={announcement.attachment?.name} fileName={announcement.attachment?.name}
        fileDataUrl={announcement.attachment?.dataUrl}
      />
    </Modal>
  );
}

// The "recent announcements at a glance" widget shown on the Parent, Owner, and Teacher
// dashboards — identical layout on all three, so it's built once here rather than copy-pasted.
// Callers pass in whichever announcements their role/audience can see; this only adds the
// live/pinned/recency ordering and caps it to 3.
function AnnouncementsPreviewCard({ announcements, emptyText = "No announcements." }) {
  const data = useData();
  const auth = useAuth();
  const { db } = data;
  const [detail, setDetail] = useState(null);
  const now = Date.now();
  const top = [...announcements]
    .filter((a) => isAnnouncementLive(a, now))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt)
    .slice(0, 3);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Megaphone size={16} className="text-sky-600" />
        <h3 className="text-sm font-semibold text-slate-700">School Announcements</h3>
      </div>
      {top.length === 0 ? (
        <Card className="p-5"><p className="text-xs text-slate-400">{emptyText}</p></Card>
      ) : (
        <div className="space-y-2.5">
          {top.map((a) => {
            const unread = db.notifications.some((n) => n.userId === auth.currentUser.id && n.type === "ANNOUNCEMENT" && n.announcementId === a.id && !n.read);
            function open() {
              const n = db.notifications.find((x) => x.userId === auth.currentUser.id && x.type === "ANNOUNCEMENT" && x.announcementId === a.id && !x.read);
              if (n) data.markNotificationRead(n.id);
              setDetail(a);
            }
            return (
              <Card key={a.id} className={`p-0 overflow-hidden border-l-4 ${unread ? "border-l-sky-500" : "border-l-transparent"}`}>
                <button type="button" onClick={open} className={`w-full text-left p-4 hover:bg-slate-50 ${unread ? "bg-sky-50/50" : ""}`}>
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h4 className={`text-sm flex items-center gap-2 ${unread ? "font-semibold text-slate-800" : "font-medium text-slate-700"}`}>
                      {unread && <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />}
                      {a.pinned && <Pin size={12} className="text-amber-500 shrink-0" />}
                      {a.title}
                    </h4>
                    {a.priority && a.priority !== "Normal" && <Badge tone={a.priority === "Urgent" ? "red" : "amber"}>{a.priority}</Badge>}
                  </div>
                  <p className="text-xs text-slate-400 mb-1.5">{data.announcementSenderLabel(a.authorId)} · {timeAgo(a.createdAt)}</p>
                  <p className="text-sm text-slate-600 mb-2 line-clamp-2">{a.message}</p>
                  {a.attachment && <div className="mb-2"><AnnouncementAttachmentChip attachment={a.attachment} /></div>}
                  <span className="text-xs text-sky-600 font-medium">View announcement →</span>
                </button>
              </Card>
            );
          })}
        </div>
      )}
      <AnnouncementDetailModal announcement={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

export {
  audienceLabel, AnnouncementAttachmentField, AnnouncementAttachmentChip, AnnouncementDetailModal,
  isAnnouncementLive, announcementReadStats, AnnouncementsPreviewCard,
};
