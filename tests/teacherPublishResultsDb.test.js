// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootReplica, inTx, seed, U, F } from "./helpers/pgReplica.js";

// Results publication policy against the production schema (every migration replayed in PGlite —
// nothing here touches the school's Supabase project): the ASSIGNED teacher publishes their exact
// class + subject pair, nobody else's; Owner/Director keep full control; a parent sees a result (and
// its evidence) as soon as it is published, never while it is a draft.
const Y = "00000000-0000-4000-8000-0000000c0031";
const COMPS = JSON.stringify([{ name: "Midterm", weight: 40, kind: "TEST" }, { name: "Final", weight: 60, kind: "NON_TEST" }]);
let db;

beforeAll(async () => { db = await bootReplica(); await seed(db); }, 240000);
afterAll(async () => { await db?.close?.(); });

const ok = (r) => { expect(r.ok, r.msg).toBe(true); return r; };
const one = async (s, sql, p) => (await s.admin(sql, p)).rows[0];

// A running semester that contains today, configs for Grade 1 + Grade 2, Math + English, and the
// assignments: TEACHER = Grade1-Math + Grade2-Math, TEACHER2 = Grade1-English. (unique(class, subject))
async function world(s) {
  ok(await s.admin(`insert into public.academic_years (id, gc_label, ec_label, year_start, year_end, sem1_start, sem1_end, break_days, sem2_start, sem2_end, is_current)
    values ($1, 'x', 'x', current_date - 60, current_date + 300, current_date - 60, current_date + 90, 15, current_date + 105, current_date + 300, true)`, [Y]));
  for (const g of ["Grade 1", "Grade 2"]) ok(await s.run("OWNER", "select public.save_result_configuration($1, 'S1'::semester, $2, $3::jsonb) r", [Y, g, COMPS]));
  const math = (await one(s, "insert into public.subjects (name) values ('Math') on conflict (name) do update set name='Math' returning id")).id;
  const eng = (await one(s, "insert into public.subjects (name) values ('English') on conflict (name) do update set name='English' returning id")).id;
  for (const [t, c, sub] of [[U.TEACHER, F.CLASS1, math], [U.TEACHER, F.CLASS2, math], [U.TEACHER2, F.CLASS1, eng]])
    ok(await s.admin("insert into public.teacher_assignments (teacher_id, class_id, subject_id) values ($1, $2, $3)", [t, c, sub]));
  return { math, eng };
}
async function draft(s, { student, cls, subject, evidence = true }) {
  const r = await one(s, "insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1', $4) returning id, configuration_id", [student, cls, subject, Y]);
  const tests = (await s.admin("select id, name from public.result_assessment_components where configuration_id = $1 order by sort_order", [r.configuration_id])).rows;
  for (const a of tests) ok(await s.admin("insert into public.result_components (result_id, assessment_id, score, max) values ($1, $2, 20, 100)", [r.id, a.id]));
  if (evidence) ok(await s.admin("insert into public.result_evidence (result_id, student_id, semester, academic_year_id, assessment_id, file_url, storage_path) values ($1, $2, 'S1', $3, $4, 'x', $5)", [r.id, student, Y, tests[0].id, `${r.id}/${tests[0].id}/p.png`]));
  return r.id;
}
const status = async (s, id) => (await one(s, "select publish_status st from public.results where id = $1", [id])).st;
const publish = (s, who, id) => s.run(who, "update public.results set publish_status = 'PUBLISHED', published_at = now(), published_by = $2 where id = $1 and publish_status = 'DRAFT' returning id", [id, U[who]]);

describe("teacher publication is limited to the exact assigned class + subject pair", () => {
  it("publishes Grade 1 Math AND Grade 2 Math (both assigned), stamping who and when — and only DRAFT rows", async () => {
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const g1 = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
      const g2 = await draft(s, { student: F.S2, cls: F.CLASS2, subject: math });
      const out = await publish(s, "TEACHER", g1);
      expect(out.rows.length).toBe(1);
      expect(await status(s, g1)).toBe("PUBLISHED");
      const stamped = await one(s, "select published_by, published_at from public.results where id = $1", [g1]);
      expect(stamped.published_by).toBe(U.TEACHER);
      expect(stamped.published_at).toBeTruthy();
      expect((await publish(s, "TEACHER", g2)).rows.length).toBe(1);
      expect(await status(s, g2)).toBe("PUBLISHED");
      // re-publishing an already published row is a no-op
      expect((await publish(s, "TEACHER", g1)).rows.length).toBe(0);
    });
  });

  it("cannot publish a subject in the same class that belongs to another teacher, nor a pair they do not hold", async () => {
    await inTx(db, async (s) => {
      const { math, eng } = await world(s);
      const g1Eng = await draft(s, { student: F.S1, cls: F.CLASS1, subject: eng });   // TEACHER2's pair
      const g2Eng = await draft(s, { student: F.S2, cls: F.CLASS2, subject: eng });   // nobody's pair
      // TEACHER holds Grade1-Math and Grade2-Math: English in either grade is NOT theirs (no class x subject product)
      expect((await publish(s, "TEACHER", g1Eng)).rows.length).toBe(0);
      expect((await publish(s, "TEACHER", g2Eng)).rows.length).toBe(0);
      expect(await status(s, g1Eng)).toBe("DRAFT");
      expect(await status(s, g2Eng)).toBe("DRAFT");
      // and TEACHER2 cannot publish TEACHER's Grade 1 Math
      const g1Math = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
      expect((await publish(s, "TEACHER2", g1Math)).rows.length).toBe(0);
      expect(await status(s, g1Math)).toBe("DRAFT");
      // while each can publish their own
      expect((await publish(s, "TEACHER2", g1Eng)).rows.length).toBe(1);
    });
  });

  it("cannot ADD a result for a pair they are not assigned, but can for their own", async () => {
    await inTx(db, async (s) => {
      const { math, eng } = await world(s);
      const add = (who, cls, subject, student) => s.run(who, "insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1', $4) returning id", [student, cls, subject, Y]);
      expect((await add("TEACHER", F.CLASS1, math, F.S1)).ok).toBe(true);
      expect((await add("TEACHER", F.CLASS1, eng, F.S1)).ok).toBe(false);
      expect((await add("TEACHER", F.CLASS2, eng, F.S2)).ok).toBe(false);
      expect((await add("TEACHER", F.CLASS2, math, F.S2)).ok).toBe(true);
    });
  });

  it("the existing evidence rule still applies to a teacher: no test evidence, no publication", async () => {
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const id = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math, evidence: false });
      const out = await publish(s, "TEACHER", id);
      expect(out.ok).toBe(false);
      expect(out.msg).toMatch(/EVIDENCE_REQUIRED/);
      expect(await status(s, id)).toBe("DRAFT");
    });
  });

  it("a teacher can only do DRAFT -> PUBLISHED: no lock, unlock, un-publish, forged stamps or identity changes", async () => {
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const id = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
      const other = await draft(s, { student: F.S2, cls: F.CLASS2, subject: math });
      const upd = (sql, p) => s.run("TEACHER", sql, p);
      // straight to LOCKED
      expect((await upd("update public.results set publish_status = 'LOCKED' where id = $1", [id])).ok).toBe(false);
      // forged publication stamps while staying draft
      expect((await upd("update public.results set published_by = $2 where id = $1", [id, U.OWNER])).ok).toBe(false);
      // re-pointing the row at a class / student / subject they don't hold
      expect((await upd("update public.results set class_id = $2 where id = $1", [id, F.CLASS2])).ok).toBe(false);
      expect((await upd("update public.results set student_id = $2 where id = $1", [id, F.S2])).ok).toBe(false);
      expect(await status(s, id)).toBe("DRAFT");
      expect((await publish(s, "TEACHER", id)).ok).toBe(true);
      // published -> draft / locked / unlock override are Owner/Director only
      expect((await upd("update public.results set publish_status = 'DRAFT' where id = $1", [id])).ok).toBe(false);
      expect((await upd("update public.results set publish_status = 'LOCKED', locked_at = now() where id = $1", [id])).ok).toBe(false);
      expect((await upd("update public.results set auto_lock_override = '{\"reason\":\"x\"}'::jsonb where id = $1", [id])).ok).toBe(false);
      expect(await status(s, id)).toBe("PUBLISHED");
      expect(await status(s, other)).toBe("DRAFT");
    });
  });

  it("Owner and Educational Director still publish, lock and unlock anything; Finance and Parent cannot publish or even see Results", async () => {
    await inTx(db, async (s) => {
      const { eng } = await world(s);
      const a = await draft(s, { student: F.S1, cls: F.CLASS1, subject: eng });
      const b = await draft(s, { student: F.S2, cls: F.CLASS2, subject: eng });
      expect((await publish(s, "FINANCE", a)).rows?.length ?? 0).toBe(0);
      expect((await publish(s, "PARENT", a)).rows?.length ?? 0).toBe(0);
      expect((await s.run("FINANCE", "select id from public.results")).rows.length).toBe(0);
      expect((await publish(s, "OWNER", a)).rows.length).toBe(1);
      expect((await publish(s, "ADMIN", b)).rows.length).toBe(1);
      expect((await s.run("ADMIN", "update public.results set publish_status = 'LOCKED', locked_at = now(), locked_by = $2 where id = $1 returning id", [a, U.ADMIN])).rows.length).toBe(1);
      expect((await s.run("OWNER", "update public.results set publish_status = 'PUBLISHED', locked_at = null, locked_by = null where id = $1 returning id", [a])).rows.length).toBe(1);
    });
  });
});

describe("what a parent sees follows publication — no per-image share step", () => {
  it("draft is invisible (result, scores, evidence); publishing shows all three at once; another child's result stays hidden", async () => {
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const mine = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });   // PARENT's child
      const theirs = await draft(s, { student: F.S2, cls: F.CLASS2, subject: math }); // PARENT2's child
      const seen = async () => ({
        results: (await s.run("PARENT", "select id from public.results")).rows.map((r) => r.id),
        comps: (await s.run("PARENT", "select id from public.result_components")).rows.length,
        evidence: (await s.run("PARENT", "select id from public.result_evidence")).rows.length,
      });
      expect(await seen()).toEqual({ results: [], comps: 0, evidence: 0 });

      // the teacher publishes; NO share flag is ever set
      expect((await publish(s, "TEACHER", mine)).rows.length).toBe(1);
      expect((await s.admin("select count(*) n from public.result_components where shared_with_parents")).rows[0].n).toBe(0);
      const after = await seen();
      expect(after.results).toEqual([mine]);
      expect(after.comps).toBe(2);
      expect(after.evidence).toBe(1);
      expect(after.results).not.toContain(theirs);

      // the parent still cannot change anything
      expect((await s.run("PARENT", "update public.results set publish_status = 'DRAFT' where id = $1 returning id", [mine])).rows?.length ?? 0).toBe(0);
      expect((await s.run("PARENT", "update public.result_components set score = 100 where result_id = $1 returning id", [mine])).rows?.length ?? 0).toBe(0);
      expect((await s.run("PARENT", "delete from public.result_evidence where result_id = $1 returning id", [mine])).rows?.length ?? 0).toBe(0);
    });
  });

  it("evidence files in the private bucket follow the same rule (draft hidden, published visible, other parent denied)", async () => {
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const id = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
      await s.admin("grant select on storage.objects, storage.buckets to authenticated");
      const ev = await one(s, "select storage_path p from public.result_evidence where result_id = $1", [id]);
      await s.admin("insert into storage.buckets (id, name, public) values ('result-evidence', 'result-evidence', false) on conflict do nothing");
      ok(await s.admin("insert into storage.objects (bucket_id, name) values ('result-evidence', $1)", [ev.p]));
      const visible = async (who) => (await s.run(who, "select name from storage.objects where bucket_id = 'result-evidence'")).rows.length;
      expect(await visible("PARENT")).toBe(0);
      expect(await visible("TEACHER")).toBe(1);
      expect(await visible("TEACHER2")).toBe(0); // holds a different pair in that class
      await publish(s, "TEACHER", id);
      expect(await visible("PARENT")).toBe(1);
      expect(await visible("PARENT2")).toBe(0);
      expect(await visible("FINANCE")).toBe(0);
      expect((await s.admin("select public from storage.buckets where id = 'result-evidence'")).rows[0].public).toBe(false);
    });
  });
});

describe("notification on publish: unread, only to the parents of published students, only by an authorised publisher", () => {
  const call = (s, who, cls, subject, students) => s.run(who, "select public.notify_results_published($1, $2, 'S1'::semester, $3, $4::uuid[], 'Results published — Math', 'Ready', null) n", [cls, subject, Y, students]);

  it("the assigned teacher's publish notifies the child's parent (unread, RESULT); repeating it adds nothing", async () => {
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const mine = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
      await draft(s, { student: F.S2, cls: F.CLASS2, subject: math }); // stays a draft
      await publish(s, "TEACHER", mine);
      const first = await call(s, "TEACHER", F.CLASS1, math, [F.S1, F.S2]);
      expect(first.ok, first.msg).toBe(true);
      expect(first.rows[0].n).toBe(1);
      const rows = (await s.admin("select user_id, read, type, navigation from public.notifications")).rows;
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({ user_id: U.PARENT, read: false, type: "RESULT" });
      expect(rows[0].navigation).toMatchObject({ page: "exams", studentId: F.S1 });
      expect((await call(s, "TEACHER", F.CLASS1, math, [F.S1])).rows[0].n).toBe(0);
      expect((await s.admin("select count(*) n from public.notifications")).rows[0].n).toBe(1);
    });
  });

  it("refuses a teacher for a pair they don't hold, plus parent and finance; Owner/Director are allowed", async () => {
    await inTx(db, async (s) => {
      const { math, eng } = await world(s);
      await draft(s, { student: F.S1, cls: F.CLASS1, subject: eng });
      expect((await call(s, "TEACHER", F.CLASS1, eng, [F.S1])).ok).toBe(false);
      expect((await call(s, "TEACHER2", F.CLASS1, math, [F.S1])).ok).toBe(false);
      expect((await call(s, "PARENT", F.CLASS1, math, [F.S1])).ok).toBe(false);
      expect((await call(s, "FINANCE", F.CLASS1, math, [F.S1])).ok).toBe(false);
      expect((await call(s, "ADMIN", F.CLASS1, math, [F.S1])).ok).toBe(true);
      expect((await call(s, "OWNER", F.CLASS1, math, [F.S1])).ok).toBe(true);
    });
  });
});

describe("the rollback restores Owner/Director-only publication", () => {
  it("after the rollback a teacher can no longer publish, the Owner still can, and parents need the share flag again", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sql = fs.readFileSync(path.resolve(__dirname, "../supabase/rollbacks/20260930010000_rollback.sql"), "utf8").split("\r\n").join("\n");
    await inTx(db, async (s) => {
      const { math } = await world(s);
      const id = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
      await s.admin("reset role");
      await db.exec(sql);
      expect((await publish(s, "TEACHER", id)).rows.length).toBe(0);
      expect(await status(s, id)).toBe("DRAFT");
      expect((await publish(s, "OWNER", id)).rows.length).toBe(1);
      expect((await s.run("PARENT", "select id from public.result_evidence")).rows.length).toBe(0); // published but not shared
    });
  });
});

describe("live updates", () => {
  it("result_evidence streams over Realtime next to results, result_components and notifications", async () => {
    const r = await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'");
    const tables = r.rows.map((x) => x.tablename);
    for (const t of ["results", "result_components", "result_evidence", "notifications"]) expect(tables).toContain(t);
  });
});

describe("an emptied published result follows the new structure", () => {
  const COMPS2 = JSON.stringify([{ name: "Quiz", weight: 20, kind: "NON_TEST" }, { name: "Final", weight: 80, kind: "TEST" }]);
  async function superseded(s) {
    const { math } = await world(s);
    const id = await draft(s, { student: F.S1, cls: F.CLASS1, subject: math });
    ok(await s.run("OWNER", "update public.results set publish_status = 'PUBLISHED' where id = $1 returning id", [id]));
    ok(await s.run("OWNER", "select public.save_result_configuration($1, 'S1'::semester, 'Grade 1', $2::jsonb) r", [Y, COMPS2])); // v2 active, v1 superseded
    return id;
  }
  const cfgOf = async (s, id) => (await one(s, "select c.version v, r.publish_status st, r.published_at pa, r.publish_notified_at pn from public.results r join public.result_configurations c on c.id = r.configuration_id where r.id = $1", [id]));

  it("scores and images removed -> the next score lands on the ACTIVE structure and the result is a Draft again", async () => {
    await inTx(db, async (s) => {
      const id = await superseded(s);
      await s.admin("delete from public.result_evidence where result_id = $1", [id]);
      await s.admin("update public.result_components set score = null where result_id = $1", [id]);
      expect((await cfgOf(s, id)).v).toBe(1);
      const quiz = (await one(s, "select a.id from public.result_assessment_components a join public.result_configurations c on c.id = a.configuration_id where c.version = 2 and c.grade = 'Grade 1' and a.name = 'Quiz'")).id;
      ok(await s.run("OWNER", "insert into public.result_components (result_id, assessment_id, score, max) values ($1, $2, 15, 20)", [id, quiz]));
      const after = await cfgOf(s, id);
      expect(after.v).toBe(2);
      expect(after.st).toBe("DRAFT");
      expect(after.pa).toBeNull();
      expect(after.pn).toBeNull();
    });
  });

  it("a published result that still has a score (or an image) is NOT moved: it keeps its structure and stays published", async () => {
    await inTx(db, async (s) => {
      const id = await superseded(s);
      const quiz = (await one(s, "select a.id from public.result_assessment_components a join public.result_configurations c on c.id = a.configuration_id where c.version = 2 and c.grade = 'Grade 1' and a.name = 'Quiz'")).id;
      const out = await s.run("OWNER", "insert into public.result_components (result_id, assessment_id, score, max) values ($1, $2, 15, 20)", [id, quiz]);
      expect(out.ok).toBe(false); // the old structure's assessments only, as before
      expect((await cfgOf(s, id)).v).toBe(1);
      expect((await cfgOf(s, id)).st).toBe("PUBLISHED");
    });
  });

  it("a LOCKED result is never re-pinned, even when empty", async () => {
    await inTx(db, async (s) => {
      const id = await superseded(s);
      await s.admin("delete from public.result_evidence where result_id = $1", [id]);
      await s.admin("update public.result_components set score = null where result_id = $1", [id]);
      await s.admin("update public.results set publish_status = 'LOCKED', locked_at = now() where id = $1", [id]);
      const target = (await one(s, "select id from public.result_configurations where version = 2 and grade = 'Grade 1'")).id;
      const out = await s.run("OWNER", "update public.results set configuration_id = $2 where id = $1", [id, target]);
      expect(out.ok).toBe(false);
      expect((await cfgOf(s, id)).v).toBe(1);
    });
  });
});
