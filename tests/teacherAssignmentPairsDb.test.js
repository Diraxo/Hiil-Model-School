// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootReplica, inTx, seed, U, F } from "./helpers/pgReplica.js";

// Test 7 — the class+subject pairing is enforced in the DATABASE, not just the UI. Every migration is
// replayed into an in-memory Postgres (PGlite); nothing here touches the school's Supabase project.
// A teacher holding Grade 1 — English and Grade 2 — Mathematics talks to the tables directly (as a
// malicious client would) and is refused every pair it wasn't given.
const YEAR = "00000000-0000-4000-8000-0000000c1900";
let db;

beforeAll(async () => { db = await bootReplica(); await seed(db); }, 240000);
afterAll(async () => { await db?.close?.(); });

async function fixture(s) {
  // an academic year whose Semester 1 is open today, so edit windows are open
  const r = await s.admin(`insert into public.academic_years (id, gc_label, ec_label, year_start, year_end, sem1_start, sem1_end, break_days, sem2_start, sem2_end, is_current)
    values ($1, 'x', 'x', current_date - 60, current_date + 300, current_date - 50, current_date + 100, 15, current_date + 120, current_date + 290, true)`, [YEAR]);
  expect(r.ok, r.msg).toBe(true);
  // Results need the semester's structure configured (Owner/Director) — for both grades.
  const comps = JSON.stringify([{ name: "Midterm", weight: 40, kind: "TEST" }, { name: "Final", weight: 60, kind: "NON_TEST" }]);
  for (const grade of ["Grade 1", "Grade 2"]) {
    const c = await s.run("OWNER", "select public.save_result_configuration($1, 'S1'::semester, $2, $3::jsonb) r", [YEAR, grade, comps]);
    expect(c.ok, c.msg).toBe(true);
  }
  const eng = (await s.admin("insert into public.subjects (name) values ('English') returning id")).rows[0].id;
  const math = (await s.admin("insert into public.subjects (name) values ('Mathematics') returning id")).rows[0].id;
  // U.TEACHER: Grade 1A — English, Grade 2A — Mathematics.  (Both classes have a student.)
  for (const [t, c, sub] of [[U.TEACHER, F.CLASS1, eng], [U.TEACHER, F.CLASS2, math]]) {
    const a = await s.admin("insert into public.teacher_assignments (teacher_id, class_id, subject_id) values ($1, $2, $3)", [t, c, sub]);
    expect(a.ok, a.msg).toBe(true);
  }
  return { eng, math };
}
const teaches = async (s, who, cls, sub) => (await s.run(who, "select public.teaches_class_subject($1, $2) ok", [cls, sub])).rows[0].ok;
const insertResult = (s, who, studentId, classId, subject) =>
  s.run(who, "insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1'::semester, $4) returning id", [studentId, classId, subject, YEAR]);
const insertHomework = (s, who, classId, subject) =>
  s.run(who, "insert into public.homework (subject_id, grade, section, class_id, title, due_date, teacher_id) values ($1, 'g', 'A', $2, 'HW', current_date + 7, $3) returning id", [subject, classId, U[who]]);

describe("the database authorizes the exact teacher + class + subject", () => {
  it("teaches_class_subject: Grade 1 English and Grade 2 Mathematics yes; the cross pairs no", async () => {
    await inTx(db, async (s) => {
      const { eng, math } = await fixture(s);
      expect(await teaches(s, "TEACHER", F.CLASS1, eng)).toBe(true);
      expect(await teaches(s, "TEACHER", F.CLASS1, math)).toBe(false);
      expect(await teaches(s, "TEACHER", F.CLASS2, eng)).toBe(false);
      expect(await teaches(s, "TEACHER", F.CLASS2, math)).toBe(true);
      // a teacher with no assignments has no pair at all
      expect(await teaches(s, "TEACHER2", F.CLASS1, eng)).toBe(false);
      expect(await teaches(s, "TEACHER2", F.CLASS2, math)).toBe(false);
    });
  });

  it("Results: a direct insert is accepted for an assigned pair and rejected for every other pair", async () => {
    await inTx(db, async (s) => {
      const { eng, math } = await fixture(s);
      const good1 = await insertResult(s, "TEACHER", F.S1, F.CLASS1, eng);
      expect(good1.ok, good1.msg).toBe(true);
      const good2 = await insertResult(s, "TEACHER", F.S2, F.CLASS2, math);
      expect(good2.ok, good2.msg).toBe(true);
      const bad1 = await insertResult(s, "TEACHER", F.S1, F.CLASS1, math);   // Grade 1 + Mathematics
      expect(bad1.ok).toBe(false);
      expect(bad1.msg).toMatch(/row-level security/i);
      const bad2 = await insertResult(s, "TEACHER", F.S2, F.CLASS2, eng);    // Grade 2 + English
      expect(bad2.ok).toBe(false);
      expect(bad2.msg).toMatch(/row-level security/i);
    });
  });

  it("Results: another teacher's pair stays invisible — a teacher only reads the rows of pairs they hold", async () => {
    await inTx(db, async (s) => {
      const { eng, math } = await fixture(s);
      // rows written by the school (Owner) for all four class/subject combinations that exist
      for (const [stu, cls, sub] of [[F.S1, F.CLASS1, eng], [F.S1, F.CLASS1, math], [F.S2, F.CLASS2, eng], [F.S2, F.CLASS2, math]]) {
        const r = await s.admin("insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1'::semester, $4)", [stu, cls, sub, YEAR]);
        expect(r.ok, r.msg).toBe(true);
      }
      const seen = (await s.run("TEACHER", "select class_id, subject_id from public.results order by class_id, subject_id")).rows;
      expect(seen.map((r) => `${r.class_id}:${r.subject_id}`).sort()).toEqual([`${F.CLASS1}:${eng}`, `${F.CLASS2}:${math}`].sort());
      // the parent of a Grade 1 child and the other teacher see none of the unpublished rows
      expect((await s.run("TEACHER2", "select 1 from public.results")).rows).toHaveLength(0);
    });
  });

  it("Homework: creating homework for a pair you don't hold is rejected", async () => {
    await inTx(db, async (s) => {
      const { eng, math } = await fixture(s);
      expect((await insertHomework(s, "TEACHER", F.CLASS1, eng)).ok).toBe(true);
      expect((await insertHomework(s, "TEACHER", F.CLASS2, math)).ok).toBe(true);
      const bad = await insertHomework(s, "TEACHER", F.CLASS1, math);
      expect(bad.ok).toBe(false);
      expect(bad.msg).toMatch(/row-level security/i);
      expect((await insertHomework(s, "TEACHER", F.CLASS2, eng)).ok).toBe(false);
    });
  });

  it("a teacher cannot grant themselves (or anyone) a pair: teacher_assignments writes are Owner/Director only", async () => {
    await inTx(db, async (s) => {
      const { eng, math } = await fixture(s);
      const grab = await s.run("TEACHER", "insert into public.teacher_assignments (teacher_id, class_id, subject_id) values ($1, $2, $3)", [U.TEACHER, F.CLASS1, math]);
      expect(grab.ok).toBe(false);
      expect(grab.msg).toMatch(/row-level security/i);
      // nor can they rewrite an existing row to point at a different subject/class
      const rewrite = await s.run("TEACHER", "update public.teacher_assignments set subject_id = $1 where teacher_id = $2 and class_id = $3 returning id", [math, U.TEACHER, F.CLASS1]);
      expect(rewrite.ok ? rewrite.rows : []).toHaveLength(0);
      expect(await teaches(s, "TEACHER", F.CLASS1, math)).toBe(false);
      expect(await teaches(s, "TEACHER", F.CLASS1, eng)).toBe(true);
      // and the Director can — proving the block above is the policy, not a broken fixture
      const ok = await s.run("ADMIN", "insert into public.teacher_assignments (teacher_id, class_id, subject_id) values ($1, $2, $3)", [U.TEACHER2, F.CLASS1, math]);
      expect(ok.ok, ok.msg).toBe(true);
    });
  });

  it("a class+subject can only be held by one teacher, so a pair can never be silently doubled", async () => {
    await inTx(db, async (s) => {
      const { eng } = await fixture(s);
      const dup = await s.admin("insert into public.teacher_assignments (teacher_id, class_id, subject_id) values ($1, $2, $3)", [U.TEACHER2, F.CLASS1, eng]);
      expect(dup.ok).toBe(false);
      expect(dup.msg).toMatch(/teacher_assignments_unique|duplicate key/);
    });
  });

  it("removing one pair removes only that pair", async () => {
    await inTx(db, async (s) => {
      const { eng, math } = await fixture(s);
      const del = await s.run("ADMIN", "delete from public.teacher_assignments where class_id = $1 and subject_id = $2", [F.CLASS1, eng]);
      expect(del.ok, del.msg).toBe(true);
      expect(await teaches(s, "TEACHER", F.CLASS1, eng)).toBe(false);
      expect(await teaches(s, "TEACHER", F.CLASS2, math)).toBe(true);
    });
  });
});
