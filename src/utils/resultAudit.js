// Structured audit trail for Results (Student → Subject → Semester → Assessment Component).
// Kept as a parallel log (db.resultAuditLog, from the result_audit_log table) rather than folded
// into the shared `activities` feed — see DataContext.jsx's result mutators for why: `activities`
// is a global, staff-only, free-text feed with consumers that regex/slice `.text` directly, and
// the audience for this trail is different (visible, masked, to Teachers; invisible to Parents).
import { ROLES } from "./constants";

const RESULT_AUDIT_ACTIONS = [
  "COMPONENT_UPDATED", "PUBLISHED", "LOCKED", "UNLOCKED",
  "EVIDENCE_ADDED", "EVIDENCE_REMOVED", "AUTO_LOCK_OVERRIDDEN", "AUTO_LOCK_REINSTATED",
];

// Masks who made a change, from the viewpoint of `viewerRole`:
// - An Owner-authored change reads as "School Administration" to every non-Owner viewer
//   (including the Educational Director) — the Owner's day-to-day involvement stays invisible
//   to staff; only the Owner's own view (and the underlying record) keeps the real identity.
// - An Educational Director's change always shows their real name — they're the academic
//   authority responsible for results, so there's no reason to mask them.
// - Anyone else (Teacher, etc.) always shows their real name.
function displayActorLabel(entry, viewerRole) {
  if (!entry) return "Unknown";
  if (entry.actorRole === ROLES.OWNER && viewerRole !== ROLES.OWNER) return "School Administration";
  if (entry.actorRole === ROLES.ADMIN) return `Educational Director — ${entry.actorName || "Unknown"}`;
  return entry.actorName || "Unknown";
}

export { RESULT_AUDIT_ACTIONS, displayActorLabel };
