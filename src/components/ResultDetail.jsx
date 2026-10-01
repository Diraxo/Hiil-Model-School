// ONE read-only result detail, shared by every role (Owner, Educational Director, Teacher, Parent).
// It never renders an input: editing is a separate, explicit action the caller wires to `onEdit`
// (staff only), and publishing to `onPublish` (Owner / Director / the assigned teacher). Publishing IS
// the share — a parent sees the score and ALL evidence of a published result, so nothing here asks
// staff to "share" an image. Authorization is NOT decided here: the rows passed in are already
// RLS-filtered and the caller passes `onEdit` / `onPublish` / `onHistory` only when the role may use
// them; this only avoids rendering controls a role cannot use.
import React, { useState } from "react";
import { Pencil, History as HistoryIcon, Send } from "lucide-react";
import { Badge, Modal, GhostButton, PrimaryButton, resultTotals } from "./ui";
import { DocumentViewerModal } from "./DocumentViewer";
import { EvidenceGallery } from "./ResultEvidence";
import { useData } from "../context/DataContext";
import { evidenceDownloadName } from "../utils/evidenceDownload";
import { SEMESTER_LABEL, ASSESSMENT_KIND, ASSESSMENT_KIND_LABEL } from "../utils/constants";

const STATUS = {
  DRAFT: { label: "Draft", tone: "amber" },
  PUBLISHED: { label: "Published", tone: "green" },
  LOCKED: { label: "Locked", tone: "red" },
};

function pctOf(score, max) {
  return score != null && max ? Math.round((Number(score) / Number(max)) * 1000) / 10 : null;
}

function SectionTitle({ children }) {
  return <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">{children}</h4>;
}

function PublishConfirm({ open, onClose, onConfirm, studentName, subject, semesterLabel, rows, totalText }) {
  const [busy, setBusy] = useState(false);
  async function submitPublish() {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); onClose(); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Publish Result?">
      <p className="text-sm text-slate-600 mb-4">This result will become visible to the student's parent, with its evidence images.</p>
      <dl className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-2 mb-5">
        <div><dt className="text-xs text-slate-400">Student</dt><dd className="font-medium text-slate-800 break-words">{studentName}</dd></div>
        <div><dt className="text-xs text-slate-400">Subject</dt><dd className="font-medium text-slate-800">{subject} · {semesterLabel}</dd></div>
        {rows.map((r) => (
          <div key={r.name}><dt className="text-xs text-slate-400">Assessment</dt><dd className="font-medium text-slate-800 break-words">{r.name}: {r.score}</dd></div>
        ))}
        <div><dt className="text-xs text-slate-400">Score</dt><dd className="font-semibold text-slate-800">{totalText}</dd></div>
      </dl>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={submitPublish} className="px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60">{busy ? "Publishing…" : "Publish Result"}</button>
      </div>
    </Modal>
  );
}

function ResultDetailBody({ record, student, audience, onEdit, onHistory, onPublish }) {
  const data = useData();
  const [viewer, setViewer] = useState(null); // { title, files, initialIndex, context } | null
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const isParent = audience === "parent";
  const status = STATUS[record.publishStatus] || STATUS.DRAFT;
  const totals = resultTotals(record);
  const cls = data.getClass(record.classId);
  const studentName = student ? data.studentFullName(student) : "Student";
  const gradeLabel = cls ? data.classLabel(cls) : (student ? `${student.grade}${student.section || ""}` : "");
  const semesterLabel = SEMESTER_LABEL[record.semester] || record.semester;
  const complete = totals.completionStatus === "COMPLETE";
  const totalText = `${complete ? totals.total : totals.entered} / ${totals.totalMax}`;
  const totalPct = pctOf(complete ? totals.total : totals.entered, totals.totalMax);
  const canPublish = !isParent && onPublish && record.publishStatus === "DRAFT";
  const scored = record.assessments
    .map((a) => ({ name: a.name, score: record.components?.[a.id]?.score != null ? `${record.components[a.id].score} / ${a.weight}` : null }))
    .filter((r) => r.score);

  return (
    <div>
      <section aria-label="Student">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-800 break-words">{studentName}</p>
            <p className="text-xs text-slate-400">{gradeLabel}{gradeLabel ? " · " : ""}{semesterLabel}</p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </section>

      <section aria-label="Result" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Subject</p>
          <p className="text-sm font-semibold text-slate-800 break-words">{record.subject}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-slate-400">{complete ? "Total" : "Entered so far"}</p>
          <p className="text-lg font-semibold text-slate-800">{totalText}</p>
          {totalPct != null && <p className="text-xs text-slate-400">{totalPct}%</p>}
        </div>
      </section>

      {!isParent && record.publishStatus === "DRAFT" && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Draft — parents cannot see this result yet. It becomes visible, with its evidence, as soon as it is published.
        </p>
      )}

      <div className="mt-4">
        <SectionTitle>Assessments</SectionTitle>
        <div className="space-y-3">
          {record.assessments.map((a) => {
            const comp = record.components?.[a.id];
            const isTest = a.kind === ASSESSMENT_KIND.TEST;
            const pages = isTest ? data.resultEvidenceFor(record.id, a.id) : [];
            const pct = pctOf(comp?.score, a.weight);
            const context = `${studentName} · ${record.subject} · ${a.name}`;
            return (
              <section key={a.id} aria-label={a.name} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 break-words">{a.name}</p>
                    <p className="text-xs text-slate-400">{ASSESSMENT_KIND_LABEL[a.kind]} · out of {a.weight}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {comp?.score != null ? (
                      <>
                        <p className="text-lg font-semibold text-slate-800">{comp.score} / {a.weight}</p>
                        <p className="text-xs text-slate-400">{pct}%</p>
                      </>
                    ) : <p className="text-sm text-slate-400">Not yet recorded</p>}
                  </div>
                </div>
                {isTest && (
                  <div className="mt-3">
                    {pages.length > 0 ? (
                      <EvidenceGallery pages={pages} context={context}
                        onOpen={(idx) => setViewer({ title: `${record.subject} — ${a.name}`, files: pages, initialIndex: idx, assessment: a.name })} />
                    ) : (
                      <p className="text-xs text-slate-400">{isParent ? "No evidence images." : "No evidence attached."}</p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {!isParent && (onEdit || onHistory || canPublish) && (
        <div className="mt-5 flex justify-end gap-2 flex-wrap">
          {onHistory && <GhostButton icon={HistoryIcon} onClick={onHistory}>History</GhostButton>}
          {onEdit && <GhostButton icon={Pencil} onClick={onEdit}>Edit Result</GhostButton>}
          {canPublish && <PrimaryButton icon={Send} onClick={() => setConfirmingPublish(true)}>Publish</PrimaryButton>}
        </div>
      )}

      <PublishConfirm open={confirmingPublish} onClose={() => setConfirmingPublish(false)} onConfirm={onPublish}
        studentName={studentName} subject={record.subject} semesterLabel={semesterLabel} rows={scored} totalText={totalText} />

      <DocumentViewerModal open={!!viewer} onClose={() => setViewer(null)} title={viewer?.title} files={viewer?.files}
        initialIndex={viewer?.initialIndex} allowDownload={false} itemLabel="image"
        downloadName={(file, index) => evidenceDownloadName({ student: studentName, subject: record.subject, assessment: viewer?.assessment, index, file })} />
    </div>
  );
}

// `record` null = closed. Wrap in a Modal so it reads as a result page yet keeps the caller's
// list (and any unsaved edits) exactly where they were.
function ResultDetailModal({ record, student, audience = "staff", onClose, onEdit, onHistory, onPublish }) {
  return (
    <Modal open={!!record} onClose={onClose} title="Result details" wide>
      {record && <ResultDetailBody record={record} student={student} audience={audience} onEdit={onEdit} onHistory={onHistory} onPublish={onPublish} />}
    </Modal>
  );
}

export { ResultDetailModal, ResultDetailBody };
