// Shared leave/permission-request UI reused by Owner/Educational Director (AdminPages),
// Teacher (TeacherPages), and Parent (ParentPages) — kept out of AdminPages.jsx specifically
// so ParentPages.jsx can import it without a circular dependency (AdminPages.jsx already
// imports from ParentPages.jsx for ChildSwitcher/useActiveChild).
import React, { useState } from "react";
import { Card, Badge, EmptyState, Field, Modal, inputCls } from "./ui";
import { fmtDate, leaveDurationLabel } from "../utils/helpers";

function LeaveRequestHistoryList({ requests }) {
  if (requests.length === 0) return <EmptyState title="No leave requests yet" />;
  return (
    <Card className="divide-y divide-slate-100">
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <div>
            <span className="text-slate-600">{r.status} · {leaveDurationLabel(r.fromDate, r.toDate)} · {fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</span>
            {r.note && <p className="text-xs text-slate-400 mt-0.5">{r.note}</p>}
            {r.approvalStatus === "REJECTED" && r.rejectionReason && <p className="text-xs text-red-500 mt-0.5">Reason: {r.rejectionReason}</p>}
          </div>
          <Badge tone={r.approvalStatus === "APPROVED" ? "green" : r.approvalStatus === "REJECTED" ? "red" : "amber"}>{r.approvalStatus === "PENDING" ? "Pending" : r.approvalStatus === "APPROVED" ? "Approved" : "Rejected"}</Badge>
        </div>
      ))}
    </Card>
  );
}

// A rejection reason is mandatory — the "Reject Request" button stays disabled until something's
// typed, and data.decideLeaveRequest itself refuses a REJECTED decision with no reason too.
function RejectLeaveModal({ request, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  if (!request) return null;
  const canSubmit = reason.trim().length > 0;
  return (
    <Modal open={!!request} onClose={onClose} title="Reject Leave Request">
      <p className="text-sm text-slate-500 mb-3">A reason is required so the requester knows why this was declined.</p>
      <Field label="Reason for rejection" required>
        <textarea
          className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Please submit this request at least 3 days in advance."
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => { onConfirm(reason.trim()); setReason(""); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${canSubmit ? "bg-red-600 hover:bg-red-700" : "bg-red-300 cursor-not-allowed"}`}
        >
          Reject Request
        </button>
      </div>
    </Modal>
  );
}

export { LeaveRequestHistoryList, RejectLeaveModal };
