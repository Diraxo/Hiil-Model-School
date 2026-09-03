// Maps a notification to the sidebar nav key its unread badge belongs to, and that a visit to
// that page should clear. Most notifications carry an explicit `navigation.page` (set by the
// notify_* RPCs / DataContext) that matches a nav key directly; for any row that has no
// `navigation`, this falls back to `type` for every type whose destination is unambiguous.
// ATTENDANCE is deliberately left unmapped: a parent's is always navigation-tagged
// already, while a staff member's own "your attendance was recorded" notification (no navigation)
// has no matching nav page — Teacher's "Attendance" page is for taking students' attendance, not
// reading their own — so it's left to show only in the general Notifications count.
function notificationPageKey(n) {
  if (n.navigation && n.navigation.page) return n.navigation.page;
  switch (n.type) {
    case "PAYMENT": return "payments";
    case "PAYROLL": return "mySalary";
    case "LEAVE": return "leaveRequests";
    case "ANNOUNCEMENT": return "announcements";
    case "MESSAGE": return "messages";
    case "HOMEWORK": return "homework";
    case "EXAM": case "RESULT": return "exams";
    case "BEHAVIOR": return "behavior";
    case "SCHEDULE": return "timetable";
    default: return null;
  }
}

export { notificationPageKey };
