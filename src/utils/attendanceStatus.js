// Single source of truth for "has attendance been taken for this class on this date?".
//
// The rule: ONE saved attendance row is enough. Attendance is "taken" the moment any authorised
// actor saves at least one record for that class/date -- never gated on every student being
// marked. Every surface (class cards on the Owner/ED/Head Teacher pages, the monthly register /
// calendar, the editor modal) reads this so they can never disagree.
//
// `records` is db.attendance (already camelCased by attendanceService). `markedBy` is the
// server-stamped actor on the row, not a client-supplied name.
export function attendanceStatusForClassDate(records, classId, dateKey) {
  const rows = (records || []).filter((a) => a.classId === classId && a.date === dateKey);
  const latest = rows.reduce((l, r) => (!l || (r.markedAt || 0) > (l.markedAt || 0) ? r : l), null);
  return {
    taken: rows.length > 0,
    count: rows.length,
    rows,
    latestRecord: latest,
    markedBy: latest?.markedBy ?? null,
    markedAt: latest?.markedAt ?? null,
    label: rows.length > 0 ? "Attendance Taken" : "Not marked",
  };
}
