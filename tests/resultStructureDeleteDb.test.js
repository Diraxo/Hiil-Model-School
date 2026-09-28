// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootReplica, inTx, seed, readSql, U, F, ROLLBACK_DIR, MIG_DIR } from "./helpers/pgReplica.js";
import { ethiopianToGregorianKey } from "../src/utils/ethiopianCalendar.js";

// The Results-structure lifecycle against the production schema (every migration replayed in PGlite —
// nothing here touches the school's Supabase project): a structure with saved results cannot be
// deleted, an empty draft never protects one, historical results are read-only, and applying a
// structure to grade x semester combinations touches exactly the combinations asked for.
const MIGRATION = "20260930000000_result_structure_delete_guard.sql";
const Y19 = "00000000-0000-4000-8000-0000000c0019"; // 2019 E.C. / 2026-27
const Y20 = "00000000-0000-4000-8000-0000000c0020"; // 2020 E.C. / 2027-28
let db;

beforeAll(async () => { db = await bootReplica(); await seed(db); }, 240000);
afterAll(async () => { await db?.close?.(); });

const COMPS = JSON.stringify([{ name: "Midterm", weight: 40, kind: "TEST" }, { name: "Final", weight: 60, kind: "NON_TEST" }]);
const COMPS_B = JSON.stringify([{ name: "Quiz", weight: 30, kind: "NON_TEST" }, { name: "Exam", weight: 70, kind: "TEST" }]);

async function years(s) {
  const a = ethiopianToGregorianKey(2019, 1, 1), b = ethiopianToGregorianKey(2019, 10, 30);
  const c = ethiopianToGregorianKey(2020, 1, 1), d = ethiopianToGregorianKey(2020, 10, 30);
  const ins = (id, s0, e0, cur) => `insert into public.academic_years (id, gc_label, ec_label, year_start, year_end, sem1_start, sem1_end, break_days, sem2_start, sem2_end, is_current)
    values ('${id}', 'x', 'x', '${s0}', '${e0}', '${s0}', '${s0}', 15, '${e0}', '${e0}', ${cur})`;
  for (const q of [ins(Y19, a, b, true), ins(Y20, c, d, false)]) { const r = await s.admin(q); expect(r.ok, r.msg).toBe(true); }
}
const save = (s, who, year, sem, grade, comps = COMPS) => s.run(who, "select public.save_result_configuration($1, $2::semester, $3, $4::jsonb) r", [year, sem, grade, comps]);
const del = (s, who, year, sem, grade) => s.run(who, "select public.delete_result_configuration($1, $2::semester, $3) r", [year, sem, grade]);
const impact = async (s, year, sem, grade) => (await s.run("OWNER", "select public.result_configuration_delete_impact($1, $2::semester, $3) r", [year, sem, grade])).rows[0].r;
const cfgRows = async (s, year, sem, grade) => (await s.admin("select id, status, version from public.result_configurations where academic_year_id = $1 and semester = $2::semester and grade = $3 order by version", [year, sem, grade])).rows;
async function subject(s) { return (await s.admin("insert into public.subjects (name) values ('Math') on conflict (name) do update set name = 'Math' returning id")).rows[0].id; }
async function makeResult(s, studentId, classId, subj, year, sem = "S1") {
  const r = await s.admin("insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, $4::semester, $5) returning id, configuration_id", [studentId, classId, subj, sem, year]);
  expect(r.ok, r.msg).toBe(true);
  return r.rows[0];
}
async function score(s, resultId, cfgId, name = "Final", value = 30) {
  const a = (await s.admin("select id from public.result_assessment_components where configuration_id = $1 and name = $2", [cfgId, name])).rows[0].id;
  const r = await s.admin("insert into public.result_components (result_id, assessment_id, score, max) values ($1, $2, $3, 100) returning id", [resultId, a, value]);
  expect(r.ok, r.msg).toBe(true);
  return a;
}
const count = async (s, sql, params) => Number((await s.admin(sql, params)).rows[0].n);

describe("delete is blocked while saved results exist (enforced in the database)", () => {
  it("a saved (scored) result blocks the delete: structure, result, student and enrollment all remain, the error names the student", async () => {
    await inTx(db, async (s) => {
      await years(s);
      expect((await save(s, "OWNER", Y19, "S2", "Grade 1")).ok).toBe(true);
      const cfg = (await cfgRows(s, Y19, "S2", "Grade 1"))[0];
      const subj = await subject(s);
      const res = await makeResult(s, F.S1, F.CLASS1, subj, Y19, "S2");
      await score(s, res.id, cfg.id);
      await s.admin("insert into public.enrollments (student_id, academic_year_id, grade, section, class_id, status, enrollment_date) values ($1, $2, 'Grade 1', 'A', $3, 'ACTIVE', current_date)", [F.S1, Y19, F.CLASS1]);

      const out = await del(s, "OWNER", Y19, "S2", "Grade 1");
      expect(out.ok).toBe(false);
      expect(out.msg).toMatch(/Cannot delete this assessment structure/);
      expect(out.msg).toMatch(/Grade 1 — Semester 2/);
      expect(out.msg).toMatch(/1 student has saved results under it: Ann One/);

      expect(await cfgRows(s, Y19, "S2", "Grade 1")).toEqual([{ id: cfg.id, status: "ACTIVE", version: 1 }]);
      expect(await count(s, "select count(*) n from public.results where id = $1 and configuration_id = $2", [res.id, cfg.id])).toBe(1);
      expect(await count(s, "select count(*) n from public.result_components where result_id = $1", [res.id])).toBe(1);
      expect(await count(s, "select count(*) n from public.students where id = $1", [F.S1])).toBe(1);
      expect(await count(s, "select count(*) n from public.enrollments where student_id = $1", [F.S1])).toBe(1);
      expect(await count(s, "select count(*) n from public.result_configuration_audit where action = 'DELETED'")).toBe(0);
    });
  });

  it("with several students the error reports the exact count, and the impact lists each of them", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 2");
      const cfg = (await cfgRows(s, Y19, "S1", "Grade 2"))[0];
      const subj = await subject(s);
      // second student in the same class
      await s.admin("insert into public.students (id,student_id,first_name,last_name,grade,section,class_id,admission_date) values ($1,'PUSH-9','Cy','Nine','Grade 2','A',$2,current_date)", ["00000000-0000-4000-8000-000000000209", F.CLASS2]);
      for (const sid of [F.S2, "00000000-0000-4000-8000-000000000209"]) { const r = await makeResult(s, sid, F.CLASS2, subj, Y19); await score(s, r.id, cfg.id); }
      const out = await del(s, "OWNER", Y19, "S1", "Grade 2");
      expect(out.ok).toBe(false);
      expect(out.msg).toMatch(/2 students have saved results under it/);
      const imp = await impact(s, Y19, "S1", "Grade 2");
      expect(imp.canDelete).toBe(false);
      expect(imp.savedStudentCount).toBe(2);
      expect(imp.students.map((x) => x.name)).toEqual(["Ben Two", "Cy Nine"]);
      expect(imp.students.every((x) => x.status === "DRAFT" && x.subject === "Math")).toBe(true);
    });
  });

  it("a published result with no scores, and an evidence-only result, both count as saved", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      await save(s, "OWNER", Y19, "S2", "Grade 1");
      const subj = await subject(s);
      const c1 = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const c2 = (await cfgRows(s, Y19, "S2", "Grade 1"))[0];
      const pub = await makeResult(s, F.S1, F.CLASS1, subj, Y19, "S1");
      await s.admin("update public.results set publish_status = 'PUBLISHED' where id = $1", [pub.id]);
      expect((await del(s, "OWNER", Y19, "S1", "Grade 1")).ok).toBe(false);

      const ev = await makeResult(s, F.S1, F.CLASS1, subj, Y19, "S2");
      const testAssessment = (await s.admin("select id from public.result_assessment_components where configuration_id = $1 and name = 'Midterm'", [c2.id])).rows[0].id;
      const e = await s.admin("insert into public.result_evidence (result_id, student_id, semester, academic_year_id, assessment_id, file_url) values ($1, $2, 'S2', $3, $4, 'x/y.png')", [ev.id, F.S1, Y19, testAssessment]);
      expect(e.ok, e.msg).toBe(true);
      const out = await del(s, "OWNER", Y19, "S2", "Grade 1");
      expect(out.ok).toBe(false);
      expect(out.msg).toMatch(/1 student has saved results/);
      expect(c1.id).not.toBe(c2.id);
    });
  });

  it("the check runs inside the delete itself: a score saved after the page last looked still blocks it (stale UI / race)", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const cfg = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const subj = await subject(s);
      const res = await makeResult(s, F.S1, F.CLASS1, subj, Y19);
      expect((await impact(s, Y19, "S1", "Grade 1")).canDelete).toBe(true); // what the page saw
      await score(s, res.id, cfg.id); // another user saves a result before the delete lands
      const out = await del(s, "OWNER", Y19, "S1", "Grade 1");
      expect(out.ok).toBe(false);
      expect(out.msg).toMatch(/1 student has saved results/);
      expect((await cfgRows(s, Y19, "S1", "Grade 1")).length).toBe(1);
    });
  });

  it("even a direct table delete cannot remove a structure that results still point at (foreign key backstop)", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const cfg = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      const r = await s.admin("delete from public.result_configurations where id = $1", [cfg.id]);
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/foreign key|violates/i);
    });
  });

  it("only the Owner / Educational Director can delete or even ask for the impact", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      for (const who of ["TEACHER", "PARENT", "FINANCE"]) {
        expect((await del(s, who, Y19, "S1", "Grade 1")).ok).toBe(false);
        expect((await s.run(who, "select public.result_configuration_delete_impact($1, 'S1'::semester, 'Grade 1')", [Y19])).ok).toBe(false);
      }
      expect((await cfgRows(s, Y19, "S1", "Grade 1")).length).toBe(1);
    });
  });
});

describe("drafts vs saved results", () => {
  it("an empty draft does not protect the structure: it is deleted, the draft row is DETACHED (kept), the student and audit are intact", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const subj = await subject(s);
      const res = await makeResult(s, F.S1, F.CLASS1, subj, Y19);
      await s.admin("insert into public.result_audit_log (result_id, student_id, class_id, subject_id, semester, action) values ($1, $2, $3, $4, 'S1', 'COMPONENT_UPDATED')", [res.id, F.S1, F.CLASS1, subj]);
      expect((await impact(s, Y19, "S1", "Grade 1"))).toMatchObject({ canDelete: true, savedStudentCount: 0, emptyDraftCount: 1 });

      const out = await del(s, "OWNER", Y19, "S1", "Grade 1");
      expect(out.ok, out.msg).toBe(true);
      expect(out.rows[0].r).toMatchObject({ outcome: "DELETED", detachedEmptyDrafts: 1 });
      expect((await cfgRows(s, Y19, "S1", "Grade 1")).length).toBe(0);
      const row = (await s.admin("select configuration_id, publish_status from public.results where id = $1", [res.id])).rows[0];
      expect(row).toEqual({ configuration_id: null, publish_status: "DRAFT" });
      expect(await count(s, "select count(*) n from public.students where id = $1", [F.S1])).toBe(1);
      expect(await count(s, "select count(*) n from public.result_audit_log where result_id = $1", [res.id])).toBe(1);
      expect(await count(s, "select count(*) n from public.result_configuration_audit where action = 'DELETED'")).toBe(1);
    });
  });

  it("a draft that already holds a score is data, not a draft to discard: it blocks the delete", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const cfg = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const res = await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      await score(s, res.id, cfg.id);
      expect((await del(s, "OWNER", Y19, "S1", "Grade 1")).ok).toBe(false);
      expect((await s.admin("select publish_status from public.results where id = $1", [res.id])).rows[0].publish_status).toBe("DRAFT");
    });
  });

  it("a detached empty draft re-pins to the NEW structure on its first score — never to the deleted one", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const res = await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      await del(s, "OWNER", Y19, "S1", "Grade 1");
      // no structure: nothing can be recorded
      const rejected = await s.admin("insert into public.result_components (result_id, assessment_id, score, max) values ($1, gen_random_uuid(), 10, 100)", [res.id]);
      expect(rejected.ok).toBe(false);

      await save(s, "OWNER", Y19, "S1", "Grade 1", COMPS_B);
      const fresh = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      await score(s, res.id, fresh.id, "Exam", 55);
      expect((await s.admin("select configuration_id from public.results where id = $1", [res.id])).rows[0].configuration_id).toBe(fresh.id);
    });
  });

  it("an empty draft still pinned to an old closed structure (data from before this change) re-pins to the active one", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const old = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const res = await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      // legacy "archive": structure closed, empty row left pointing at it
      await s.admin("update public.result_configurations set status = 'SUPERSEDED' where id = $1", [old.id]);
      const blocked = await s.admin("insert into public.result_components (result_id, assessment_id, score, max) select $1, id, 10, 100 from public.result_assessment_components where configuration_id = $2 limit 1", [res.id, old.id]);
      expect(blocked.ok).toBe(false);
      expect(blocked.msg).toMatch(/RESULT_CONFIG_MISSING/);
      await save(s, "OWNER", Y19, "S1", "Grade 1", COMPS_B);
      const fresh = (await cfgRows(s, Y19, "S1", "Grade 1")).find((c) => c.status === "ACTIVE");
      await score(s, res.id, fresh.id, "Quiz", 20);
      expect((await s.admin("select configuration_id from public.results where id = $1", [res.id])).rows[0].configuration_id).toBe(fresh.id);
    });
  });
});

describe("historical results", () => {
  it("a saved result under a closed structure with no active successor is read-only in the database", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const old = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const res = await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      const assessment = await score(s, res.id, old.id, "Final", 40);
      await s.admin("update public.result_configurations set status = 'SUPERSEDED' where id = $1", [old.id]); // legacy archived delete
      const edit = await s.admin("update public.result_components set score = 55 where result_id = $1 and assessment_id = $2", [res.id, assessment]);
      expect(edit.ok).toBe(false);
      expect(edit.msg).toMatch(/RESULT_CONFIG_CLOSED/);
      expect(Number((await s.admin("select score from public.result_components where result_id = $1", [res.id])).rows[0].score)).toBe(40); // still readable, untouched
    });
  });

  it("a result under an EARLIER VERSION (an active successor exists) keeps working — versions are unchanged", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const v1 = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const res = await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      const assessment = await score(s, res.id, v1.id, "Final", 40);
      const bumped = await save(s, "OWNER", Y19, "S1", "Grade 1", COMPS_B);
      expect(bumped.rows[0].r).toMatchObject({ action: "NEW_VERSION", version: 2 });
      const rows = await cfgRows(s, Y19, "S1", "Grade 1");
      expect(rows.map((r) => [r.version, r.status])).toEqual([[1, "SUPERSEDED"], [2, "ACTIVE"]]);
      const edit = await s.admin("update public.result_components set score = 45 where result_id = $1 and assessment_id = $2", [res.id, assessment]);
      expect(edit.ok, edit.msg).toBe(true);
      // and the result stays on v1
      expect((await s.admin("select configuration_id from public.results where id = $1", [res.id])).rows[0].configuration_id).toBe(v1.id);
    });
  });
});

describe("applying a structure to grade x semester combinations", () => {
  const pgArray = (xs) => `{${xs.map((x) => `"${x}"`).join(",")}}`;
  const bulk = (s, year, sems, grades, comps = COMPS) => s.run("OWNER", "select public.save_result_configuration_bulk($1, $2::semester[], $3::text[], $4::jsonb) r", [year, pgArray(sems), pgArray(grades), comps]);
  const active = async (s, year) => (await s.admin("select grade, semester::text sem from public.result_configurations where academic_year_id = $1 and status = 'ACTIVE' order by grade, semester", [year])).rows.map((r) => `${r.grade}|${r.sem}`);

  it("all grades x all semesters creates each combination exactly once; repeating it changes nothing", async () => {
    await inTx(db, async (s) => {
      await years(s);
      const first = await bulk(s, Y19, ["S1", "S2"], ["Grade 1", "Grade 2"]);
      expect(first.ok, first.msg).toBe(true);
      expect(first.rows[0].r.map((r) => r.action)).toEqual(["CREATED", "CREATED", "CREATED", "CREATED"]);
      expect(await active(s, Y19)).toEqual(["Grade 1|S1", "Grade 1|S2", "Grade 2|S1", "Grade 2|S2"]);
      const again = await bulk(s, Y19, ["S2", "S1", "S1"], ["Grade 2", "Grade 1", "Grade 1"]);
      expect(again.rows[0].r.map((r) => r.action)).toEqual(["UNCHANGED", "UNCHANGED", "UNCHANGED", "UNCHANGED"]);
      expect(await count(s, "select count(*) n from public.result_configurations where academic_year_id = $1", [Y19])).toBe(4);
    });
  });

  it("Grade 1 + Semester 1 only creates that one combination; Semester 2 and other grades are untouched", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await bulk(s, Y19, ["S1", "S2"], ["Grade 1", "Grade 2"]);
      await bulk(s, Y19, ["S1"], ["Grade 1"], COMPS_B);
      const weights = async (grade, sem) => (await s.admin("select a.name from public.result_configurations c join public.result_assessment_components a on a.configuration_id = c.id where c.academic_year_id = $1 and c.grade = $2 and c.semester = $3::semester and c.status = 'ACTIVE' order by a.sort_order", [Y19, grade, sem])).rows.map((r) => r.name);
      expect(await weights("Grade 1", "S1")).toEqual(["Quiz", "Exam"]);
      expect(await weights("Grade 1", "S2")).toEqual(["Midterm", "Final"]);
      expect(await weights("Grade 2", "S1")).toEqual(["Midterm", "Final"]);
      expect(await weights("Grade 2", "S2")).toEqual(["Midterm", "Final"]);
    });
  });

  it("Grade 1 + all semesters affects Grade 1 Semester 1 and 2 only", async () => {
    await inTx(db, async (s) => {
      await years(s);
      const out = await bulk(s, Y19, ["S1", "S2"], ["Grade 1"]);
      expect(out.rows[0].r.map((r) => `${r.grade}|${r.semester}`)).toEqual(["Grade 1|S1", "Grade 1|S2"]);
      expect(await active(s, Y19)).toEqual(["Grade 1|S1", "Grade 1|S2"]);
    });
  });

  it("an all-or-nothing apply: one invalid grade rejects every combination", async () => {
    await inTx(db, async (s) => {
      await years(s);
      const out = await bulk(s, Y19, ["S1", "S2"], ["Grade 1", "Grade 99"]);
      expect(out.ok).toBe(false);
      expect(await active(s, Y19)).toEqual([]);
    });
  });

  it("academic years are isolated: the same Grade 1 / Semester 1 structure exists per year, and deleting one year's leaves the other's", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      await save(s, "OWNER", Y20, "S1", "Grade 1", COMPS_B);
      const a = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const b = (await cfgRows(s, Y20, "S1", "Grade 1"))[0];
      expect(a.id).not.toBe(b.id);
      await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19); // Y19 has a (still empty) result row
      expect((await del(s, "OWNER", Y20, "S1", "Grade 1")).ok).toBe(true);
      expect((await cfgRows(s, Y19, "S1", "Grade 1")).length).toBe(1);
      expect((await cfgRows(s, Y20, "S1", "Grade 1")).length).toBe(0);
      expect((await impact(s, Y19, "S1", "Grade 1")).emptyDraftCount).toBe(1);
      // the database allows at most one ACTIVE structure per year + semester + grade
      const dup = await s.admin("insert into public.result_configurations (academic_year_id, semester, grade, version, status) values ($1, 'S1', 'Grade 1', 9, 'ACTIVE')", [Y19]);
      expect(dup.ok).toBe(false);
    });
  });
});

describe("rollback", () => {
  it("restores the previous archive-on-delete behaviour, drops what it added, and the migration re-applies", async () => {
    await inTx(db, async (s) => {
      await years(s);
      await s.as("BACKEND");
      await db.exec(readSql(ROLLBACK_DIR, "20260930000000_rollback.sql"));
      expect((await s.admin("select to_regprocedure('public.result_has_recorded_data(uuid)') p")).rows[0].p).toBeNull();
      expect((await s.admin("select to_regprocedure('public.result_configuration_delete_impact(uuid, semester, text)') p")).rows[0].p).toBeNull();
      await save(s, "OWNER", Y19, "S1", "Grade 1");
      const cfg = (await cfgRows(s, Y19, "S1", "Grade 1"))[0];
      const res = await makeResult(s, F.S1, F.CLASS1, await subject(s), Y19);
      await score(s, res.id, cfg.id);
      const out = await del(s, "OWNER", Y19, "S1", "Grade 1");
      expect(out.ok, out.msg).toBe(true);
      expect(out.rows[0].r.outcome).toBe("ARCHIVED");
      await s.as("BACKEND");
      await db.exec(readSql(MIG_DIR, MIGRATION));
      expect((await s.admin("select to_regprocedure('public.result_has_recorded_data(uuid)') p")).rows[0].p).not.toBeNull();
    });
  });
});
