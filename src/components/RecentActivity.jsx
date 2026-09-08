import React from "react";
import { ROLE_LABEL } from "../utils/constants";
import { timeAgo, fmtDate, fmtTime } from "../utils/helpers";

// Shared "Recent Activity" feed for the Owner / Educational Director / Finance dashboards.
//
// Every item names the authenticated actor (full name + role) that log_activity stamped
// server-side (migration 20260908060000), so another authorized user can see WHO performed each
// action — important where multiple Owner accounts share one school. Rows written before that
// migration have no actor snapshot and honestly show "Actor information unavailable" rather than
// guessing.
//
// The caller passes an ALREADY-FILTERED `activities` array (the Educational Director dashboard
// strips finance rows, Finance keeps only financial rows) plus the dashboard's existing
// `onOpenActivity` deep-link dispatcher — this component only handles presentation + Today
// grouping and changes no visibility rules.

function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function ActorLine({ activity }) {
  if (!activity.actorName) {
    return <p className="text-slate-300 italic mt-0.5">Actor information unavailable</p>;
  }
  const role = ROLE_LABEL[activity.actorRole] || activity.actorRole || "";
  return (
    <p className="text-slate-400 mt-0.5">
      <span className="font-semibold text-slate-500">{activity.actorName}</span>
      {role ? <span> · {role}</span> : null}
    </p>
  );
}

function ActivityRow({ activity, onOpenActivity, today }) {
  const stamp = today
    ? `${fmtTime(activity.createdAt)} · ${timeAgo(activity.createdAt)}`
    : `${fmtDate(activity.createdAt)} · ${fmtTime(activity.createdAt)}`;
  const body = (
    <>
      <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
      <div className="min-w-0">
        <p className={`text-slate-600 leading-snug ${activity.navigation && onOpenActivity ? "group-hover:text-brand-700" : ""}`}>{activity.text}</p>
        <ActorLine activity={activity} />
        <p className="text-slate-300 mt-0.5">{stamp}</p>
      </div>
    </>
  );
  if (activity.navigation && onOpenActivity) {
    return (
      <button
        type="button"
        onClick={() => onOpenActivity(activity.navigation)}
        className="group w-full flex gap-3 text-xs text-left hover:bg-slate-50 rounded-lg -mx-1 px-1 py-1"
      >
        {body}
      </button>
    );
  }
  return <div className="flex gap-3 text-xs">{body}</div>;
}

function RecentActivityFeed({ activities, onOpenActivity, limit = 10, maxHeight = "max-h-80" }) {
  const rows = (activities || []).slice(0, limit);
  const todayRows = rows.filter((a) => isToday(a.createdAt));
  const earlierRows = rows.filter((a) => !isToday(a.createdAt));

  return (
    <div className={`space-y-4 ${maxHeight} overflow-y-auto`}>
      <div className="space-y-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Today</p>
        {todayRows.length === 0 ? (
          <p className="text-xs text-slate-400">No activity recorded today.</p>
        ) : (
          todayRows.map((a) => (
            <ActivityRow key={a.id} activity={a} onOpenActivity={onOpenActivity} today />
          ))
        )}
      </div>
      {earlierRows.length > 0 && (
        <div className="space-y-3.5 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Earlier</p>
          {earlierRows.map((a) => (
            <ActivityRow key={a.id} activity={a} onOpenActivity={onOpenActivity} />
          ))}
        </div>
      )}
    </div>
  );
}

export { RecentActivityFeed };
