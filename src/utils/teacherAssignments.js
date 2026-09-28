// A teacher's teaching assignments are EXPLICIT class + subject PAIRS — `[{ classId, subject }]` —
// never two independent lists (classes[] + subjects[]). "Grade 9 — English" and "Grade 10 —
// Mathematics" grants exactly those two pairs, not English + Mathematics in both classes. This
// mirrors the database, where teacher_assignments is one row per (class_id, subject_id) and the RLS
// helper teaches_class_subject(class, subject) checks that exact row; nothing here ever crosses a
// list of classes with a list of subjects.
//
// `subject` is the subject NAME, the convention every consumer of DataContext's teacherAssignments
// ({ teacherId, subject, classId }) already uses.

function pairKey(classId, subject) { return `${classId}|${subject}`; }

function samePair(a, b) { return a.classId === b.classId && a.subject === b.subject; }

// The exact pairs a teacher holds, from the live teacherAssignments rows.
function pairsForTeacher(teacherAssignments, teacherId) {
  return (teacherAssignments || [])
    .filter((ta) => ta.teacherId === teacherId)
    .map((ta) => ({ classId: ta.classId, subject: ta.subject }));
}

// Whether the teacher holds exactly this class + subject. The one client-side authorization check
// (permissions.js's isAssignedSubjectTeacher is the same predicate).
function teachesPair(teacherAssignments, teacherId, classId, subject) {
  return (teacherAssignments || []).some((ta) => ta.teacherId === teacherId && ta.classId === classId && ta.subject === subject);
}

// Adds one pair; a pair already present is left alone. Only that pair is touched.
function addPair(pairs, pair) {
  return pairs.some((p) => samePair(p, pair)) ? pairs : [...pairs, { classId: pair.classId, subject: pair.subject }];
}

// Removes exactly that pair — every other pair, including other subjects in the same class and the
// same subject in other classes, stays.
function removePair(pairs, pair) {
  return pairs.filter((p) => !samePair(p, pair));
}

// What changes when a teacher's pairs go from `current` to `desired`: only the difference, so a
// pair that stays is never deleted and re-created.
function diffPairs(current, desired) {
  return {
    toAdd: desired.filter((d) => !current.some((c) => samePair(c, d))),
    toRemove: current.filter((c) => !desired.some((d) => samePair(d, c))),
  };
}

// Validates a requested set of pairs against the school's data. `d` is the DataContext `db`
// ({ classes, classSubjects, teacherAssignments, users }). Every requested pair must be in that
// class's curriculum and free (or already this teacher's, or explicitly forced via `reassignSet`,
// a Set of pairKey()s the Owner/Director chose to move onto this teacher). The first problem fails
// the whole request — a pair the user asked for is never silently dropped or guessed at.
function resolveTeacherPairs(d, { pairs, excludeTeacherId, reassignSet }) {
  const out = [];
  for (const pair of pairs || []) {
    if (out.some((p) => samePair(p, pair))) continue;
    const cls = d.classes.find((c) => c.id === pair.classId);
    const classLabel = cls ? `${cls.grade}${cls.section}` : "this class";
    if (!cls) return { ok: false, message: `${classLabel} no longer exists. Remove that assignment and try again.` };
    if (!d.classSubjects.some((cs) => cs.classId === pair.classId && cs.subject === pair.subject)) {
      return { ok: false, message: `${pair.subject} is not part of the curriculum for ${classLabel}. Add it to the class's subjects first.` };
    }
    const existing = d.teacherAssignments.find((ta) => ta.classId === pair.classId && ta.subject === pair.subject && ta.teacherId !== excludeTeacherId);
    if (existing && !(reassignSet && reassignSet.has(pairKey(pair.classId, pair.subject)))) {
      const other = d.users.find((u) => u.id === existing.teacherId);
      return { ok: false, message: `${pair.subject} is already assigned to ${other?.name || "another teacher"} in ${classLabel}. Choose another subject/class assignment or reassign the existing teacher.` };
    }
    out.push({ classId: pair.classId, subject: pair.subject });
  }
  return { ok: true, pairs: out };
}

export { pairKey, samePair, pairsForTeacher, teachesPair, addPair, removePair, diffPairs, resolveTeacherPairs };
