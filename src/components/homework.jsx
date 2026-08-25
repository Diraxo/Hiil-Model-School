import React from "react";
import { ClipboardList, ChevronRight } from "lucide-react";
import { Badge, Card, Modal, EmptyState, todayKeyStr, shiftDateKey } from "./ui";
import { fmtDate } from "../utils/helpers";

// Every teacher reference inside the Homework module reads "T. <name>" so subject/class/teacher
// scan consistently on cards and in the details modal, per the school's naming convention.
function teacherLabel(name) {
  if (!name) return "Unassigned";
  return name.startsWith("T. ") ? name : `T. ${name}`;
}

function homeworkDueStatus(dueDate) {
  const today = todayKeyStr();
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate <= shiftDateKey(today, 3)) return "soon";
  return "upcoming";
}
const DUE_STATUS_LABEL = { overdue: "Overdue", today: "Due Today", soon: "Due Soon", upcoming: "Upcoming" };
const DUE_STATUS_TONE = { overdue: "red", today: "amber", soon: "sky", upcoming: "slate" };

function HomeworkDueBadge({ dueDate }) {
  const status = homeworkDueStatus(dueDate);
  return <Badge tone={DUE_STATUS_TONE[status]}>{DUE_STATUS_LABEL[status]}</Badge>;
}

// Groups homework into a day-relative timeline so a scan of the list reads like a diary
// (Overdue first so nothing slips, then Yesterday/Today/Tomorrow, then wider buckets).
function homeworkGroupLabel(dueDate) {
  const today = todayKeyStr();
  if (dueDate < shiftDateKey(today, -1)) return "Overdue";
  if (dueDate === shiftDateKey(today, -1)) return "Yesterday";
  if (dueDate === today) return "Today";
  if (dueDate === shiftDateKey(today, 1)) return "Tomorrow";
  if (dueDate <= shiftDateKey(today, 7)) return "This Week";
  return "Later";
}
const GROUP_ORDER = ["Overdue", "Yesterday", "Today", "Tomorrow", "This Week", "Later"];

function groupHomeworkByDueDate(list) {
  const groups = {};
  list.forEach((h) => { const g = homeworkGroupLabel(h.dueDate); (groups[g] = groups[g] || []).push(h); });
  return GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({ label: g, items: groups[g] }));
}

function homeworkSummary(list) {
  const today = todayKeyStr();
  const publishedToday = list.filter((h) => new Date(h.createdAt).toDateString() === new Date().toDateString()).length;
  const overdue = list.filter((h) => h.dueDate < today).length;
  const dueSoon = list.filter((h) => h.dueDate >= today && h.dueDate <= shiftDateKey(today, 3)).length;
  return { publishedToday, overdue, dueSoon, total: list.length };
}

function HomeworkCard({ homework, teacherName, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(homework)} className="w-full text-left px-4 py-3.5 hover:bg-slate-50 transition-colors group">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">{homework.title}</p>
        <HomeworkDueBadge dueDate={homework.dueDate} />
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <Badge tone="sky">{(homework.subject || "").toUpperCase()}</Badge>
        <Badge tone="indigo">{homework.grade}{homework.section}</Badge>
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <div className="text-xs text-slate-400">
          <span className="text-slate-600 font-medium">{teacherLabel(teacherName)}</span>
          <span> • Published {fmtDate(homework.createdAt)}</span>
        </div>
        <span className="text-xs font-medium text-sky-600 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          View details <ChevronRight size={13} />
        </span>
      </div>
    </button>
  );
}

// Shared date-grouped list used by every role's homework page — Owner/Director see the whole
// school, teachers see their own classes, parents see one child's class — only the input list differs.
function HomeworkList({ list, getTeacherName, onOpen, emptyTitle, emptyDescription }) {
  if (list.length === 0) return <EmptyState icon={ClipboardList} title={emptyTitle} description={emptyDescription} />;
  const groups = groupHomeworkByDueDate(list);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 px-0.5 ${g.label === "Overdue" ? "text-red-500" : "text-slate-400"}`}>{g.label}</h3>
          <Card className="divide-y divide-slate-100">
            {g.items.map((h) => (
              <HomeworkCard key={h.id} homework={h} teacherName={getTeacherName(h)} onOpen={onOpen} />
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

// `onEdit`/`onDelete` are optional — only the teacher who owns the homework gets them wired up
// (from TeacherHomeworkPage); Parent and Admin/Owner usage passes neither, so their read-only
// view is unchanged.
function HomeworkDetailsModal({ homework, teacherName, classLabel, onClose, onEdit, onDelete }) {
  return (
    <Modal open={!!homework} onClose={onClose} title="Homework Details" wide>
      {homework && (
        <div>
          <div className="flex items-start justify-between gap-3 mb-2">
            <h2 className="text-base font-semibold text-slate-800">{homework.title}</h2>
            <HomeworkDueBadge dueDate={homework.dueDate} />
          </div>
          <div className="flex items-center gap-1.5 mb-4">
            <Badge tone="sky">{(homework.subject || "").toUpperCase()}</Badge>
            <Badge tone="indigo">{classLabel || `${homework.grade}${homework.section}`}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4 bg-slate-50 rounded-xl p-4">
            <div><p className="text-[11px] text-slate-400 mb-0.5">Teacher</p><p className="text-sm font-medium text-slate-700">{teacherLabel(teacherName)}</p></div>
            <div><p className="text-[11px] text-slate-400 mb-0.5">Published</p><p className="text-sm font-medium text-slate-700">{fmtDate(homework.createdAt)}</p></div>
            <div><p className="text-[11px] text-slate-400 mb-0.5">Due</p><p className="text-sm font-medium text-slate-700">{fmtDate(homework.dueDate)}</p></div>
            <div><p className="text-[11px] text-slate-400 mb-0.5">Status</p><HomeworkDueBadge dueDate={homework.dueDate} /></div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Instructions</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{homework.description?.trim() || "No additional instructions were given."}</p>
          </div>
          {(onEdit || onDelete) && (
            <div className="flex justify-end gap-2 border-t border-slate-100 mt-4 pt-4">
              {onDelete && <button type="button" onClick={onDelete} className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>}
              {onEdit && <button type="button" onClick={onEdit} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-sky-600 hover:bg-sky-700">Edit Homework</button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export {
  teacherLabel, homeworkDueStatus, HomeworkDueBadge, groupHomeworkByDueDate, homeworkSummary,
  HomeworkCard, HomeworkList, HomeworkDetailsModal,
};
