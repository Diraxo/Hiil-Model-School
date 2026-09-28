// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bootReplica, inTx, seed, readSql, U, F, ROLLBACK_DIR, MIG_DIR } from "./helpers/pgReplica.js";
import { ethiopianMonthsCoveredBy, ethiopianToGregorianKey } from "../src/utils/ethiopianCalendar.js";

// The academic year as the central scope of the system, against the production schema (every
// migration replayed in PGlite). Nothing here touches the school's Supabase project.
const MIGRATION = "20260929000000_academic_year_central_scope.sql";
const Y18 = "00000000-0000-4000-8000-0000000b0018"; // 2018 E.C. / 2025-26 — history
const Y19 = "00000000-0000-4000-8000-0000000b0019"; // 2019 E.C. / 2026-27 — the operational year
const Y20 = "00000000-0000-4000-8000-0000000b0020"; // 2020 E.C. / 2027-28 — being set up
let db;

beforeAll(async () => { db = await bootReplica(); await seed(db); }, 240000);
afterAll(async () => { await db?.close?.(); });

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };

const yearSql = (id, start, end, sem1s, sem1e, sem2s, sem2e, { cur = false, closed = false } = {}) =>
  `insert into public.academic_years (id, gc_label, ec_label, year_start, year_end, sem1_start, sem1_end, break_days, sem2_start, sem2_end, is_current, closed_at)
   values ('${id}', 'x', 'x', '${start}', '${end}', '${sem1s}', '${sem1e}', 15, '${sem2s}', '${sem2e}', ${cur}, ${closed ? "now()" : "null"})`;

// 2018 (closed history) + 2019 (current), Meskerem 1 .. Sene 30 each; both students enrolled in 2018,
// and in 2019 (S1 promoted to Grade 2).
async function history(s, { enroll19 = true } = {}) {
  const a = ethiopianToGregorianKey(2018, 1, 1), b = ethiopianToGregorianKey(2018, 10, 30);
  const c = ethiopianToGregorianKey(2019, 1, 1), d = ethiopianToGregorianKey(2019, 10, 30);
  // 2018 is filled in while it is still open, then closed (a closed year rejects new enrollments)
  expect((await s.admin(yearSql(Y18, a, b, a, "2026-01-19", "2026-02-04", b))).ok).toBe(true);
  for (const sid of [F.S1, F.S2]) {
    const r = await s.admin("insert into public.enrollments (student_id, academic_year_id, grade, section, class_id, status, enrollment_date) values ($1, $2, 'Grade 1', 'A', $3, 'ACTIVE', current_date)", [sid, Y18, F.CLASS1]);
    expect(r.ok, r.msg).toBe(true);
  }
  expect((await s.admin("update public.academic_years set closed_at = now() where id = $1", [Y18])).ok).toBe(true);
  expect((await s.admin(yearSql(Y19, c, d, c, "2027-01-19", "2027-02-04", d, { cur: true }))).ok).toBe(true);
  if (enroll19) {
    for (const sid of [F.S1, F.S2]) {
      const r = await s.admin("insert into public.enrollments (student_id, academic_year_id, grade, section, class_id, status, enrollment_date) values ($1, $2, 'Grade 2', 'A', $3, 'ACTIVE', current_date)", [sid, Y19, F.CLASS2]);
      expect(r.ok, r.msg).toBe(true);
    }
    await s.admin("update public.students set grade = 'Grade 2', class_id = $1 where id in ($2, $3)", [F.CLASS2, F.S1, F.S2]);
  }
}
async function upcoming20(s) {
  const e = ethiopianToGregorianKey(2020, 1, 1), f = ethiopianToGregorianKey(2020, 10, 30);
  const r = await s.admin(yearSql(Y20, e, f, e, "2028-01-19", "2028-02-04", f));
  expect(r.ok, r.msg).toBe(true);
}
const one = async (s, sql, params) => (await s.admin(sql, params)).rows[0];
const flags = async (s) => (await s.admin("select id, is_current, closed_at is not null closed from public.academic_years order by year_start")).rows;

describe("billing periods are Ethiopian months", () => {
  const months = async (s, a, b) => (await s.admin("select to_char(m, 'YYYY-MM') m from public.academic_year_billing_months($1::date, $2::date) m order by m", [a, b])).rows.map((r) => r.m);

  it("Meskerem 1 -> Sene 30 is exactly 10 months; a stray Hamle 1 end does not add an 11th (Hamle 20 does)", async () => {
    await inTx(db, async (s) => {
      const start = ethiopianToGregorianKey(2019, 1, 1), sene30 = ethiopianToGregorianKey(2019, 10, 30), hamle1 = ethiopianToGregorianKey(2019, 11, 1);
      expect(start).toBe("2026-09-11");
      expect(sene30).toBe("2027-07-07");
      expect(await months(s, start, sene30)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
      expect(await months(s, start, hamle1)).toHaveLength(10);              // 1 day of Hamle is not a billing month
      expect((await months(s, start, ethiopianToGregorianKey(2019, 11, 20))).at(-1)).toBe("2027-07"); // 20 days is
    });
  });

  it("a year that starts on 1 Sept (Nehasse 26 / Pagumen) never bills Nehasse or Pagumen — no previous-year month", async () => {
    await inTx(db, async (s) => {
      const m = await months(s, "2026-09-01", "2027-07-07");
      expect(m[0]).toBe("2026-09");   // Meskerem 2019, not Nehasse 2018
      expect(m).toHaveLength(10);
    });
  });

  it("the SQL and the JS rules agree on every start/end over two Ethiopian years", async () => {
    await inTx(db, async (s) => {
      const pad = (n) => String(n).padStart(2, "0");
      const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      let checked = 0;
      for (let dayOffset = 0; dayOffset < 730; dayOffset += 9) {
        for (const span of [40, 150, 300, 330]) {
          const start = new Date(2025, 8, 1 + dayOffset), end = new Date(2025, 8, 1 + dayOffset + span);
          const js = ethiopianMonthsCoveredBy(key(start), key(end)).map((m) => m.monthKey);
          const sql = await months(s, key(start), key(end));
          expect(sql, `${key(start)} .. ${key(end)}`).toEqual(js);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(300);
    });
  });
});

describe("only one current academic year", () => {
  it("a second current row is refused by the partial unique index", async () => {
    await inTx(db, async (s) => {
      await history(s, { enroll19: false });
      const r = await s.admin(yearSql(Y20, "2027-09-12", "2028-07-07", "2027-09-12", "2028-01-19", "2028-02-04", "2028-07-07", { cur: true }));
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/unique|duplicate/i);
    });
  });

  it("nobody can flip is_current with a plain UPDATE — not even the owner; only set_current_academic_year can", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      for (const who of ["OWNER", "ADMIN"]) {
        const r = await s.run(who, "update public.academic_years set is_current = true where id = $1", [Y20]);
        expect(r.ok, who).toBe(false);
        expect(r.msg).toMatch(/set_current_academic_year/);
      }
      const c = await s.run("OWNER", "update public.academic_years set closed_at = null where id = $1", [Y18]);
      expect(c.ok).toBe(false);
      expect((await flags(s)).filter((f) => f.is_current).map((f) => f.id)).toEqual([Y19]);
    });
  });

  it("only the Owner or Educational Director can switch years", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      for (const who of ["TEACHER", "PARENT", "FINANCE", "ANON"]) {
        const r = await s.run(who, "select public.set_current_academic_year($1, null, true)", [Y20]);
        expect(r.ok, who).toBe(false);
      }
      expect((await flags(s)).filter((f) => f.is_current).map((f) => f.id)).toEqual([Y19]);
    });
  });

  it("activating the next year is atomic: exactly one current, the old one is closed (not deleted), and it is audited", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      // both students are on the 2019 roll and have no decision for 2020 yet
      const blocked = await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20]);
      expect(blocked.ok).toBe(false);
      expect(blocked.msg).toMatch(/2 student\(s\) have no decision/);
      expect((await flags(s)).filter((f) => f.is_current).map((f) => f.id)).toEqual([Y19]); // nothing half-applied

      expect((await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20])).ok).toBe(true);
      expect((await s.run("ADMIN", "select public.mark_student_not_returning($1, $2, 'Moved abroad')", [F.S2, Y20])).ok).toBe(true);
      const r = await s.run("OWNER", "select public.set_current_academic_year($1) r", [Y20]);
      expect(r.ok, r.msg).toBe(true);
      expect(r.rows[0].r).toMatchObject({ changed: true, reopened: false });

      const f = await flags(s);
      expect(f.filter((x) => x.is_current).map((x) => x.id)).toEqual([Y20]);
      expect(f.find((x) => x.id === Y19).closed).toBe(true);   // previous / closed
      expect(f.find((x) => x.id === Y18).closed).toBe(true);   // history is still there
      expect(f).toHaveLength(3);
      const audit = await s.run("OWNER", "select action from public.academic_year_audit where academic_year_id = $1 order by at", [Y20]);
      expect(audit.rows.map((a) => a.action)).toContain("ACTIVATED");
    });
  });

  it("a year whose dates cover more than one school year can't be made current", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await s.admin("alter table public.academic_years disable trigger academic_years_validate_span");
      await s.admin(yearSql(Y20, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08"));
      await s.admin("alter table public.academic_years enable trigger academic_years_validate_span");
      const r = await s.run("OWNER", "select public.set_current_academic_year($1, null, true)", [Y20]);
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/more than one school year/);
    });
  });
});

describe("student enrollment across years (a student is permanent; an enrollment belongs to a year)", () => {
  it("registering keeps the student, adds a second enrollment, and leaves the previous one untouched", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const before = (await s.admin("select * from public.enrollments where academic_year_id = $1 order by student_id", [Y19])).rows;
      const students = (await one(s, "select count(*)::int n from public.students")).n;
      const r = await s.run("OWNER", "select * from public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      expect(r.ok, r.msg).toBe(true);
      expect(r.rows[0]).toMatchObject({ academic_year_id: Y20, grade: "Grade 3", status: "ACTIVE" });
      expect((await one(s, "select count(*)::int n from public.students")).n).toBe(students);
      expect((await one(s, "select count(*)::int n from public.enrollments where student_id = $1", [F.S1])).n).toBe(3); // 2018, 2019, 2020
      expect((await s.admin("select * from public.enrollments where academic_year_id = $1 order by student_id", [Y19])).rows).toEqual(before);
      // the students table (the current roll) is untouched by registering into an UPCOMING year
      expect((await one(s, "select grade from public.students where id = $1", [F.S1])).grade).toBe("Grade 2");
    });
  });

  it("'Not returning' never deletes the student or any earlier enrollment; no 2020 enrollment is created", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const enrollBefore = (await s.admin("select * from public.enrollments where student_id = $1 order by academic_year_id", [F.S2])).rows;
      const r = await s.run("OWNER", "select * from public.mark_student_not_returning($1, $2, 'Family relocated')", [F.S2, Y20]);
      expect(r.ok, r.msg).toBe(true);
      expect(r.rows[0]).toMatchObject({ decision: "NOT_RETURNING", reason: "Family relocated" });
      expect((await one(s, "select count(*)::int n from public.students where id = $1", [F.S2])).n).toBe(1);
      expect((await s.admin("select * from public.enrollments where student_id = $1 order by academic_year_id", [F.S2])).rows).toEqual(enrollBefore);
      expect((await one(s, "select count(*)::int n from public.enrollments where student_id = $1 and academic_year_id = $2", [F.S2, Y20])).n).toBe(0);
    });
  });

  it("'Not returning' is refused for a year that is already running, and for a student who is already registered", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const cur = await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S1, Y19]);
      expect(cur.ok).toBe(false);
      expect(cur.msg).toMatch(/already running/);
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      const dup = await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S1, Y20]);
      expect(dup.ok).toBe(false);
      expect(dup.msg).toMatch(/already registered/);
    });
  });

  it("a student who returns later is found and registered again — no duplicate person, the old decision no longer stands", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      const r = await s.run("OWNER", "select * from public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S2, Y20]);
      expect(r.ok, r.msg).toBe(true);
      expect((await one(s, "select count(*)::int n from public.students where first_name = 'Ben'")).n).toBe(1);
      expect((await one(s, "select count(*)::int n from public.student_year_decisions where student_id = $1", [F.S2])).n).toBe(0);
      expect((await one(s, "select count(*)::int n from public.enrollments where student_id = $1", [F.S2])).n).toBe(3);
      // registering twice is idempotent (no second row)
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 4', 'A')", [F.S2, Y20]);
      expect((await one(s, "select count(*)::int n, max(grade) g from public.enrollments where student_id = $1 and academic_year_id = $2", [F.S2, Y20]))).toEqual({ n: 1, g: "Grade 4" });
    });
  });

  it("the roster follows the activated year — and switching years back and forth is lossless", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      const roll = async () => (await s.admin("select id, grade, status, class_id from public.students order by student_id")).rows;
      const at19 = await roll();
      expect(at19.map((r) => r.grade)).toEqual(["Grade 2", "Grade 2"]);

      expect((await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20])).ok).toBe(true);
      const at20 = await roll();
      expect(at20.find((r) => r.id === F.S1)).toMatchObject({ grade: "Grade 3", status: "ACTIVE", class_id: null }); // no Grade 3 class exists: not left in last year's class
      expect(at20.find((r) => r.id === F.S2)).toMatchObject({ status: "ARCHIVED" }); // not on the 2020 roll — still in the database

      // reopening 2019 needs a reason...
      const noReason = await s.run("OWNER", "select public.set_current_academic_year($1)", [Y19]);
      expect(noReason.ok).toBe(false);
      expect(noReason.msg).toMatch(/needs a reason/);
      // ...and with one, works and is audited
      const back = await s.run("OWNER", "select public.set_current_academic_year($1, 'Audit review of 2019 results') r", [Y19]);
      expect(back.ok, back.msg).toBe(true);
      expect(back.rows[0].r).toMatchObject({ changed: true, reopened: true });
      expect(await roll()).toEqual(at19);
      expect((await flags(s)).filter((f) => f.is_current).map((f) => f.id)).toEqual([Y19]);
      const ev = (await s.admin("select action, reason from public.academic_year_audit where academic_year_id = $1 and action = 'REOPENED'", [Y19])).rows;
      expect(ev).toEqual([{ action: "REOPENED", reason: "Audit review of 2019 results" }]);

      // and forward again: the new year's roll is restored exactly
      expect((await s.run("OWNER", "select public.set_current_academic_year($1, 'Resume 2020')", [Y20])).ok).toBe(true);
      expect(await roll()).toEqual(at20);
    });
  });

  it("only owner/admin can register or record decisions; a teacher or parent cannot, and cannot read decisions", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      for (const who of ["TEACHER", "PARENT", "FINANCE"]) {
        const reg = await s.run(who, "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
        expect(reg.ok, who).toBe(false);
        const nr = await s.run(who, "select public.mark_student_not_returning($1, $2, 'x')", [F.S1, Y20]);
        expect(nr.ok, who).toBe(false);
      }
      for (const who of ["TEACHER", "PARENT"]) {
        const rows = await s.run(who, "select * from public.student_year_decisions");
        expect(rows.rows ?? []).toEqual([]);
      }
      expect((await s.run("ADMIN", "select * from public.student_year_decisions")).rows).toHaveLength(1);
    });
  });
});

describe("teacher assignments: the closing year keeps who taught what", () => {
  async function assign(s) {
    const subj = (await s.admin("insert into public.subjects (name) values ('Math') returning id")).rows[0].id;
    const r = await s.admin("insert into public.teacher_assignments (teacher_id, subject_id, class_id) values ($1, $2, $3)", [U.TEACHER, subj, F.CLASS2]);
    expect(r.ok, r.msg).toBe(true);
    return subj;
  }
  const activate20 = async (s) => {
    await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
    await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
    const r = await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20]);
    expect(r.ok, r.msg).toBe(true);
  };
  const snap = async (s, yearId) => (await s.admin("select teacher_id, teacher_name, class_id from public.academic_year_teacher_assignments where academic_year_id = $1", [yearId])).rows;

  it("closing a year snapshots the assignments; later reassignment doesn't touch the snapshot", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const subj = await assign(s);
      await activate20(s);
      expect(await snap(s, Y19)).toEqual([{ teacher_id: U.TEACHER, teacher_name: "TEACHER Person", class_id: F.CLASS2 }]);
      // next year the class is handed to another teacher — 2019's record still says who taught it then
      await s.admin("update public.teacher_assignments set teacher_id = $1 where subject_id = $2", [U.TEACHER2, subj]);
      expect((await snap(s, Y19)).map((r) => r.teacher_id)).toEqual([U.TEACHER]);
      expect(await snap(s, Y20)).toEqual([]); // the current year has no snapshot yet: it IS the live table
    });
  });

  it("everyone signed in can read the history; nobody can write it", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      await assign(s);
      await activate20(s);
      for (const who of ["TEACHER", "PARENT", "OWNER"]) {
        expect((await s.run(who, "select * from public.academic_year_teacher_assignments")).rows).toHaveLength(1);
      }
      const w = await s.run("OWNER", "insert into public.academic_year_teacher_assignments (academic_year_id, class_id) values ($1, $2)", [Y19, F.CLASS1]);
      expect(w.ok).toBe(false);
      expect((await s.run("OWNER", "delete from public.academic_year_teacher_assignments")).ok).toBe(false);
      expect((await s.run("ANON", "select * from public.academic_year_teacher_assignments")).ok).toBe(false);
    });
  });

  it("reopening and re-closing a year refreshes its snapshot instead of duplicating it", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const subj = await assign(s);
      await activate20(s);
      await s.admin("update public.teacher_assignments set teacher_id = $1 where subject_id = $2", [U.TEACHER2, subj]);
      expect((await s.run("OWNER", "select public.set_current_academic_year($1, 'Correct 2019')", [Y19])).ok).toBe(true);
      expect((await s.run("OWNER", "select public.set_current_academic_year($1, 'Back to 2020')", [Y20])).ok).toBe(true);
      // 2020 closed in between and 2019 closed again: 2019's snapshot now reflects the assignments at THAT close
      expect((await snap(s, Y19)).map((r) => r.teacher_id)).toEqual([U.TEACHER2]);
    });
  });
});

describe("fees are scoped to the academic year and to enrollment", () => {
  async function feeSetup(s) {
    const ft = (await s.admin("insert into public.fee_types (name, category) values ('School Fee', 'TUITION') returning id")).rows[0].id;
    const sched = (yearId) => s.admin("insert into public.fee_schedules (fee_type_id, academic_year_id, unit_amount, unit_months, units_per_year) values ($1, $2, 1000, 1, 10) returning id", [ft, yearId]);
    return { ft, sched };
  }
  const rollout = async (s, id) => {
    expect((await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [id])).ok).toBe(true);
    const m = await s.run("OWNER", "select public.materialize_obligations_for_schedule($1, null, 'YEAR_ROLLOUT') n", [id]);
    expect(m.ok, m.msg).toBe(true);
    return m.rows[0].n;
  };

  it("the 2019 schedule bills exactly Meskerem..Sene (10 months) and only enrolled students", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const { sched } = await feeSetup(s);
      const id19 = (await sched(Y19)).rows[0].id;
      await rollout(s, id19);
      const months = (await s.admin("select to_char(period_month, 'YYYY-MM') m from public.fee_installments where fee_schedule_id = $1 order by period_month", [id19])).rows.map((r) => r.m);
      expect(months).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
      expect((await one(s, "select count(*)::int n from public.student_fee_obligations")).n).toBe(20); // 2 students x 10 months
    });
  });

  it("a student marked not-returning is never billed for the new year; a registered one is", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      const { sched } = await feeSetup(s);
      const id20 = (await sched(Y20)).rows[0].id;
      await rollout(s, id20);
      const per = (await s.admin(
        `select o.student_id, count(*)::int n from public.student_fee_obligations o
           join public.fee_installments fi on fi.id = o.fee_installment_id where fi.fee_schedule_id = $1 group by 1`, [id20])).rows;
      expect(per).toEqual([{ student_id: F.S1, n: 10 }]);
    });
  });

  it("a student who joins mid-year is billed from their joining month, never for the months before it", async () => {
    await inTx(db, async (s) => {
      // a year that is running NOW: it began ~4 months ago and runs ~6 more
      const start = shift(-125), end = shift(180);
      expect((await s.admin(yearSql(Y19, start, end, start, shift(-5), shift(10), end, { cur: true }))).ok).toBe(true);
      const { sched } = await feeSetup(s);
      const id = (await sched(Y19)).rows[0].id;
      expect((await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [id])).ok).toBe(true);
      const total = (await one(s, "select count(*)::int n from public.fee_installments where fee_schedule_id = $1", [id])).n;
      expect(total).toBeGreaterThan(6);
      // S1 joins today, mid-year
      const r = await s.run("OWNER", "select * from public.register_student_for_year($1, $2, 'Grade 1', 'A')", [F.S1, Y19]);
      expect(r.ok, r.msg).toBe(true);
      const owed = (await s.admin(
        `select to_char(fi.period_month, 'YYYY-MM') m from public.student_fee_obligations o
           join public.fee_installments fi on fi.id = o.fee_installment_id where o.student_id = $1 and fi.fee_schedule_id = $2 order by fi.period_month`, [F.S1, id])).rows.map((x) => x.m);
      const thisMonth = shift(0).slice(0, 7);
      expect(owed.length).toBeGreaterThan(0);
      expect(owed.length).toBeLessThan(total);
      expect(owed.every((m) => m >= thisMonth)).toBe(true);
      expect(owed[0]).toBe(thisMonth);
    });
  });

  it("a payment stays in its own year: another year's balances and receipts don't change when a new year is created and activated", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const { sched } = await feeSetup(s);
      const id19 = (await sched(Y19)).rows[0].id;
      await rollout(s, id19);
      const inst = (await one(s, "select id from public.fee_installments where fee_schedule_id = $1 and to_char(period_month,'YYYY-MM') = '2026-10'", [id19])).id;
      const pay = await s.run("OWNER", "select * from public.record_payment_batch($1::jsonb, 'Cash', current_date, null, $2)", [JSON.stringify([{ student_id: F.S1, installment_id: inst, amount: 400 }]), U.OWNER]);
      expect(pay.ok, pay.msg).toBe(true);
      const snapshot = async () => (await s.admin(
        `select fs.academic_year_id y, count(pa.id)::int allocs, coalesce(sum(pa.amount),0)::int paid
           from public.fee_schedules fs join public.fee_installments fi on fi.fee_schedule_id = fs.id
           join public.student_fee_obligations o on o.fee_installment_id = fi.id
           left join public.payment_allocations pa on pa.obligation_id = o.id group by 1`)).rows;
      const before = await snapshot();
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      expect((await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20])).ok).toBe(true);
      expect(await snapshot()).toEqual(before);
      expect(before).toEqual([{ y: Y19, allocs: 1, paid: 400 }]);
    });
  });
});

describe("a closed academic year is read-only history", () => {
  async function closedWithFees(s) {
    await history(s);
    await upcoming20(s);
    const ft = (await s.admin("insert into public.fee_types (name, category) values ('School Fee', 'TUITION') returning id")).rows[0].id;
    const sched = (await s.admin("insert into public.fee_schedules (fee_type_id, academic_year_id, unit_amount, unit_months, units_per_year) values ($1, $2, 1000, 1, 10) returning id", [ft, Y19])).rows[0].id;
    await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [sched]);
    await s.run("OWNER", "select public.materialize_obligations_for_schedule($1, null, 'YEAR_ROLLOUT')", [sched]);
    await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
    await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
    expect((await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20])).ok).toBe(true);
    const inst = (await one(s, "select id from public.fee_installments where fee_schedule_id = $1 and to_char(period_month,'YYYY-MM') = '2026-11'", [sched])).id;
    return { sched, inst };
  }

  // The results tables carry their own (older) structure/lock guards; they are switched off here so the
  // fixture rows can be written and it is the academic-year guard that is under test.
  const isolateYearGuard = async (s) => {
    for (const [t, g] of [["results", "results_before_insert_guard"], ["results", "results_update_guard"], ["result_components", "result_components_write_guard"]]) {
      await s.admin(`alter table public.${t} disable trigger ${g}`);
    }
  };

  it("enrollments, results and fee schedules of a closed year cannot be written — even by the owner", async () => {
    await inTx(db, async (s) => {
      const { sched } = await closedWithFees(s);
      await isolateYearGuard(s);
      const upd = await s.run("OWNER", "update public.enrollments set grade = 'Grade 9' where student_id = $1 and academic_year_id = $2", [F.S1, Y19]);
      expect(upd.ok).toBe(false);
      expect(upd.msg).toMatch(/closed \(read-only\)/);
      const ins = await s.run("OWNER", "insert into public.enrollments (student_id, academic_year_id, grade, status, enrollment_date) values ($1, $2, 'Grade 1', 'ACTIVE', current_date)", [F.S1, Y18]);
      expect(ins.ok).toBe(false);
      const subj = (await s.admin("insert into public.subjects (name) values ('Math') returning id")).rows[0].id;
      const res = await s.admin("insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1', $4)", [F.S1, F.CLASS2, subj, Y19]);
      expect(res.ok).toBe(false);
      expect(res.msg).toMatch(/Results cannot be changed/);
      const fs = await s.run("OWNER", "update public.fee_schedules set unit_amount = 5 where id = $1", [sched]);
      expect(fs.ok).toBe(false);
      expect(fs.msg).toMatch(/Fee schedules cannot be changed/);
      // the current year is unaffected
      const okRes = await s.admin("insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1', $4)", [F.S1, F.CLASS2, subj, Y20]);
      expect(okRes.ok, okRes.msg).toBe(true);
    });
  });

  it("result component scores of a closed year are read-only too", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await isolateYearGuard(s);
      const subj = (await s.admin("insert into public.subjects (name) values ('Math') returning id")).rows[0].id;
      // entered while the year was still open...
      await s.admin("update public.academic_years set closed_at = null where id = $1", [Y18]);
      const made = await s.admin("insert into public.results (student_id, class_id, subject_id, semester, academic_year_id) values ($1, $2, $3, 'S1', $4) returning id", [F.S1, F.CLASS1, subj, Y18]);
      expect(made.ok, made.msg).toBe(true);
      const rid = made.rows[0].id;
      const comp = await s.admin("insert into public.result_components (result_id, component, score, max) values ($1, 'midterm1', 40, 50) returning id", [rid]);
      expect(comp.ok, comp.msg).toBe(true);
      await s.admin("update public.academic_years set closed_at = now() where id = $1", [Y18]);
      // ...then the year closes: the score can no longer be edited or added to
      const edit = await s.admin("update public.result_components set score = 50 where result_id = $1", [rid]);
      expect(edit.ok).toBe(false);
      expect(edit.msg).toMatch(/Results cannot be changed/);
      const add = await s.admin("insert into public.result_components (result_id, component, score, max) values ($1, 'midterm2', 5, 10)", [rid]);
      expect(add.ok).toBe(false);
    });
  });

  it("academic_year_id can never be moved from one year to another on a year-scoped row", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const r = await s.run("OWNER", "update public.enrollments set academic_year_id = $1 where student_id = $2 and academic_year_id = $3", [Y20, F.S1, Y19]);
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/cannot be changed/);
    });
  });

  it("a payment into a closed year is refused; only the owner, with a reason, can record a historical one — and it is audited", async () => {
    await inTx(db, async (s) => {
      const { inst } = await closedWithFees(s);
      const lines = JSON.stringify([{ student_id: F.S1, installment_id: inst, amount: 300 }]);
      const plain = await s.run("OWNER", "select * from public.record_payment_batch($1::jsonb, 'Cash', current_date, null, $2)", [lines, U.OWNER]);
      expect(plain.ok).toBe(false);
      expect(plain.msg).toMatch(/closed \(read-only\)/);
      expect((await one(s, "select count(*)::int n from public.payments")).n).toBe(0);

      const finance = await s.run("FINANCE", "select * from public.record_historical_payment_batch($1::jsonb, 'Cash', current_date, null, $2, 'late arrears')", [lines, U.FINANCE]);
      expect(finance.ok).toBe(false);
      const noReason = await s.run("OWNER", "select * from public.record_historical_payment_batch($1::jsonb, 'Cash', current_date, null, $2, '  ')", [lines, U.OWNER]);
      expect(noReason.ok).toBe(false);
      expect(noReason.msg).toMatch(/reason is required/);

      const ok = await s.run("OWNER", "select * from public.record_historical_payment_batch($1::jsonb, 'Cash', current_date, null, $2, 'Arrears collected after year end')", [lines, U.OWNER]);
      expect(ok.ok, ok.msg).toBe(true);
      const alloc = await one(s, "select fs.academic_year_id y from public.payment_allocations pa join public.student_fee_obligations o on o.id = pa.obligation_id join public.fee_installments fi on fi.id = o.fee_installment_id join public.fee_schedules fs on fs.id = fi.fee_schedule_id");
      expect(alloc.y).toBe(Y19); // it went into ITS year, not the current one
      const audit = (await s.admin("select action, reason from public.academic_year_audit where action = 'HISTORICAL_PAYMENT'")).rows;
      expect(audit).toEqual([{ action: "HISTORICAL_PAYMENT", reason: "Arrears collected after year end" }]);
      // the override is scoped to that one call: a plain payment afterwards is refused again
      expect((await s.run("OWNER", "select * from public.record_payment_batch($1::jsonb, 'Cash', current_date, null, $2)", [lines, U.OWNER])).ok).toBe(false);
    });
  });

  it("the calendar of a closed year can't be edited by a signed-in user (only reopening it allows that)", async () => {
    await inTx(db, async (s) => {
      await history(s);
      const r = await s.run("OWNER", "update public.academic_years set sem1_end = '2026-01-25' where id = $1", [Y18]);
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/closed \(read-only\): its calendar/);
      // an upcoming year's calendar is editable, and a backend session (the owner-run repair script) is unaffected
      await upcoming20(s);
      expect((await s.run("OWNER", "update public.academic_years set break_days = 20 where id = $1", [Y20])).ok).toBe(true);
      expect((await s.admin("update public.academic_years set sem1_end = '2026-01-25' where id = $1", [Y18])).ok).toBe(true);
    });
  });

  it("attendance recorded in a closed year stays where it was, and can't be added to it", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      // recorded while 2018 was running (the calendar trigger is bypassed for the fixture, as in the seed)
      await s.admin("set session_replication_role = replica");
      expect((await s.admin("insert into public.attendance (student_id, class_id, date, status) values ($1, $2, '2025-10-06', 'Present')", [F.S1, F.CLASS1])).ok).toBe(true);
      await s.admin("set session_replication_role = origin");
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      expect((await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20])).ok).toBe(true);
      const inYear = async (y) => (await one(s, "select count(*)::int n from public.attendance a join public.academic_years y on a.date between y.year_start and y.year_end where y.id = $1", [y])).n;
      expect(await inYear(Y18)).toBe(1);
      expect(await inYear(Y19)).toBe(0);
      expect(await inYear(Y20)).toBe(0);
      // a new mark for a date in a previous year is refused by the calendar guard
      const late = await s.admin("insert into public.attendance (student_id, class_id, date, status) values ($1, $2, '2025-10-07', 'Present')", [F.S1, F.CLASS1]);
      expect(late.ok).toBe(false);
      expect(late.msg).toMatch(/not started yet|read-only|ended/i);
    });
  });
});

describe("payroll periods come from the academic year and the person's employment", () => {
  async function staff(s, employmentDate, endDate = null) {
    const st = await s.admin("insert into public.staff (name, position, employment_date, salary, employment_status, employment_end_date) values ('Tigist', 'Teacher', $1, 10000, $2::employment_status, $3) returning id",
      [employmentDate, endDate ? "ENDED" : "ACTIVE", endDate]);
    expect(st.ok, st.msg).toBe(true);
    return st.rows[0].id;
  }
  const payroll = (s, staffId, month, who = "OWNER") =>
    s.run(who, "select * from public.record_payroll_payment($1, 5000, 'Cash', $2, current_date, null, 0, 0, 0, $3)", [staffId, month, U[who]]);

  it("a month inside the year is accepted; Hamle (after Sene 30) is not a payroll period", async () => {
    await inTx(db, async (s) => {
      await history(s);
      const st = await staff(s, "2025-01-15");
      expect((await payroll(s, st, "2026-11")).ok).toBe(true);
      expect((await payroll(s, st, "2027-06")).ok).toBe(true);   // Sene 2019
      const hamle = await payroll(s, st, "2027-07");
      expect(hamle.ok).toBe(false);
      expect(hamle.msg).toMatch(/not part of any academic year/);
    });
  });

  it("a teacher who joins mid-year is not owed the months before they joined", async () => {
    await inTx(db, async (s) => {
      await history(s);
      const st = await staff(s, "2027-03-05");                    // joined in Megabit
      for (const early of ["2026-09", "2026-12", "2027-02"]) {
        const r = await payroll(s, st, early);
        expect(r.ok, early).toBe(false);
        expect(r.msg).toMatch(/payroll starts from their first month/);
      }
      expect((await payroll(s, st, "2027-03")).ok).toBe(true);    // the month they joined counts
      expect((await payroll(s, st, "2027-05")).ok).toBe(true);
    });
  });

  it("joining on the 29th still includes that month (the existing payroll policy), but not the month before", async () => {
    await inTx(db, async (s) => {
      await history(s);
      const st = await staff(s, "2026-12-29");
      expect((await payroll(s, st, "2026-12")).ok).toBe(true);
      expect((await payroll(s, st, "2026-11")).ok).toBe(false);
    });
  });

  it("no payroll after employment ended", async () => {
    await inTx(db, async (s) => {
      await history(s);
      const st = await staff(s, "2025-01-15", "2027-01-20");
      expect((await payroll(s, st, "2027-01")).ok).toBe(true);
      const after = await payroll(s, st, "2027-02");
      expect(after.ok).toBe(false);
      expect(after.msg).toMatch(/employment ended/);
    });
  });

  it("payroll for a closed year needs the owner's reasoned, audited historical adjustment", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      const st = await staff(s, "2025-01-15");
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      await s.run("OWNER", "select public.mark_student_not_returning($1, $2, 'x')", [F.S2, Y20]);
      expect((await s.run("OWNER", "select public.set_current_academic_year($1)", [Y20])).ok).toBe(true);
      const plain = await payroll(s, st, "2026-11");
      expect(plain.ok).toBe(false);
      expect(plain.msg).toMatch(/closed \(read-only\)/);
      const hist = await s.run("OWNER", "select * from public.record_historical_payroll_payment($1, 5000, 'Cash', '2026-11', current_date, null, 0, 0, $2, 'Unpaid November salary')", [st, U.OWNER]);
      expect(hist.ok, hist.msg).toBe(true);
      expect((await s.admin("select reason from public.academic_year_audit where action = 'HISTORICAL_PAYROLL'")).rows).toEqual([{ reason: "Unpaid November salary" }]);
      expect((await payroll(s, st, "2026-11")).ok).toBe(false);   // override does not linger
      // the new year's own months work
      expect((await payroll(s, st, "2027-10")).ok).toBe(true);
    });
  });
});

describe("audit trail + access control", () => {
  it("creating a year and changing its dates are audited with the old and new dates", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      expect((await s.run("OWNER", "update public.academic_years set sem1_end = '2028-01-25' where id = $1", [Y20])).ok).toBe(true);
      const ev = (await s.admin("select action, details from public.academic_year_audit where academic_year_id = $1 order by at, action", [Y20])).rows;
      expect(ev.map((e) => e.action).sort()).toEqual(["CALENDAR_UPDATED", "CREATED"]);
      const upd = ev.find((e) => e.action === "CALENDAR_UPDATED").details;
      expect(upd.old.sem1_end).toBe("2028-01-19");
      expect(upd.new.sem1_end).toBe("2028-01-25");
    });
  });

  it("teachers and parents can read academic years but not the audit trail; nobody can write the audit directly", async () => {
    await inTx(db, async (s) => {
      await history(s);
      expect((await s.run("TEACHER", "select id from public.academic_years")).rows.length).toBe(2);
      expect((await s.run("PARENT", "select id from public.academic_years")).rows.length).toBe(2);
      for (const who of ["TEACHER", "PARENT"]) expect((await s.run(who, "select * from public.academic_year_audit")).rows ?? []).toEqual([]);
      const w = await s.run("OWNER", "insert into public.academic_year_audit (action) values ('FORGED')");
      expect(w.ok).toBe(false);
    });
  });

  it("year-mutating helper functions are not callable by signed-in users", async () => {
    await inTx(db, async (s) => {
      await history(s);
      for (const who of ["OWNER", "TEACHER"]) {
        const r = await s.run(who, "select public.sync_students_to_academic_year($1)", [Y18]);
        expect(r.ok, who).toBe(false);
        const a = await s.run(who, "select public.write_academic_year_audit($1, 'X', null, null)", [Y18]);
        expect(a.ok, who).toBe(false);
      }
    });
  });
});

describe("owner-run diagnostic (supabase/manual/diagnose_academic_year_dates.sql, read-only)", () => {
  const script = () => fs.readFileSync(path.resolve(__dirname, "../supabase/manual/diagnose_academic_year_dates.sql"), "utf8").split("\r\n").join("\n");
  const badRow = async (s) => {
    await s.admin("alter table public.academic_years disable trigger academic_years_validate_span");
    await s.admin(yearSql(Y19, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08", { cur: true }));
    await s.admin("alter table public.academic_years enable trigger academic_years_validate_span");
  };
  // exec() returns one result per statement; the last one is the verdict helper
  const run = async (s) => { await s.as("BACKEND"); return db.exec(script()); };

  it("runs on the production schema, changes nothing, and flags the inconsistent row", async () => {
    await inTx(db, async (s) => {
      await badRow(s);
      const before = (await s.admin("select count(*)::int n from public.academic_years")).rows[0].n;
      const results = await run(s);
      const rows = results[0].rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ is_current: true, span_days: 665 });
      expect(rows[0].dates_check).toMatch(/INCONSISTENT/);
      expect(rows[0].closed_at).toBeNull();
      // the verdict helper: nothing recorded before Meskerem 1, 2019 -> safe to move the start
      const verdict = results[results.length - 1].rows[0];
      expect(verdict).toMatchObject({ attendance_before_2026_09_01: 0, installments_before_2026_09_01: 0, payments_dated_before_2026_09_01: 0, payroll_before_2026_09: 0 });
      expect((await s.admin("select count(*)::int n from public.academic_years")).rows[0].n).toBe(before);
    });
  });

  it("the verdict helper counts 2018-era history so a person knows the row must be SPLIT, not shifted", async () => {
    await inTx(db, async (s) => {
      await badRow(s);
      await s.admin("set session_replication_role = replica");
      await s.admin("insert into public.attendance (student_id, class_id, date, status) values ($1, $2, '2025-10-06', 'Present')", [F.S1, F.CLASS1]);
      await s.admin("set session_replication_role = origin");
      const results = await run(s);
      expect(results[results.length - 1].rows[0].attendance_before_2026_09_01).toBe(1);
    });
  });

  it("reports every section: enrollments, attendance, fees, results, payroll", async () => {
    await inTx(db, async (s) => {
      await history(s);
      const results = await run(s);
      const heads = results.map((r) => (r.fields || []).map((f) => f.name).join(","));
      for (const needle of ["enrollments", "attendance_rows", "fee_schedules", "posted_payments", "voided_payments", "billed_month", "results", "payroll_payments", "salary_advances", "active_students_without_current_year_enrollment", "attendance_outside_every_year"]) {
        expect(heads.some((h) => h.includes(needle)), needle).toBe(true);
      }
    });
  });
});

describe("migration hygiene", () => {
  it("is idempotent (applies twice)", async () => {
    await inTx(db, async () => {
      await db.exec(readSql(MIG_DIR, MIGRATION));
      await db.exec(readSql(MIG_DIR, MIGRATION));
    });
  });

  it("the rollback removes every object it added, keeps all data, restores the old fee RPC bodies, and the migration re-applies cleanly", async () => {
    await inTx(db, async (s) => {
      await history(s);
      await upcoming20(s);
      await s.run("OWNER", "select public.register_student_for_year($1, $2, 'Grade 3', 'A')", [F.S1, Y20]);
      const enrollments = (await one(s, "select count(*)::int n from public.enrollments")).n;
      const students = (await one(s, "select count(*)::int n from public.students")).n;
      await s.as("BACKEND"); // DDL runs as the migration owner, not the last persona
      await db.exec(readSql(ROLLBACK_DIR, "20260929000000_rollback.sql"));
      const objects = (await s.admin(
        `select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                   and p.proname in ('set_current_academic_year','register_student_for_year','mark_student_not_returning','academic_year_billing_months',
                                     'academic_year_is_writable','guard_payroll_period','record_historical_payment_batch','sync_students_to_academic_year')) fns,
                (select count(*)::int from pg_trigger where tgname like '%\\_year\\_guard' or tgname like '%period\\_guard' or tgname like 'academic\\_years\\_%\\_changes' or tgname = 'academic_years_lifecycle_guard') trg,
                (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name in ('academic_year_audit','student_year_decisions','academic_year_teacher_assignments')) tbl,
                (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'academic_years' and column_name in ('closed_at','closed_by')) cols`)).rows[0];
      expect(objects).toEqual({ fns: 0, trg: 0, tbl: 0, cols: 0 });
      expect((await one(s, "select count(*)::int n from public.enrollments")).n).toBe(enrollments); // no data deleted
      expect((await one(s, "select count(*)::int n from public.students")).n).toBe(students);
      // the previous (Gregorian-month) fee generation is back: a Sep 11 -> Jul 7 year gives 11 months again
      const ft = (await s.admin("insert into public.fee_types (name, category) values ('School Fee', 'TUITION') returning id")).rows[0].id;
      const sched = (await s.admin("insert into public.fee_schedules (fee_type_id, academic_year_id, unit_amount, unit_months, units_per_year) values ($1, $2, 1000, 1, 10) returning id", [ft, Y19])).rows[0].id;
      const g = await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [sched]);
      expect(g.ok, g.msg).toBe(true);
      expect(g.rows).toHaveLength(11);
      // and the migration goes straight back on
      await s.as("BACKEND");
      await db.exec(readSql(MIG_DIR, MIGRATION));
      expect((await one(s, "select count(*)::int n from public.academic_year_audit")).n).toBeGreaterThanOrEqual(0);
    });
  });

  it("backfill: an active student with no current-year enrollment gets one; closed_at is set on ended non-current years", async () => {
    await inTx(db, async (s) => {
      // pre-migration shape: current year + an ended old year, one student without any enrollment
      const a = ethiopianToGregorianKey(2018, 1, 1), b = ethiopianToGregorianKey(2018, 10, 30);
      const c = ethiopianToGregorianKey(2019, 1, 1), d = ethiopianToGregorianKey(2019, 10, 30);
      await s.admin(yearSql(Y18, a, b, a, "2026-01-19", "2026-02-04", b));
      await s.admin(yearSql(Y19, c, d, c, "2027-01-19", "2027-02-04", d, { cur: true }));
      await db.exec(readSql(MIG_DIR, MIGRATION));
      expect((await one(s, "select count(*)::int n from public.enrollments where academic_year_id = $1", [Y19])).n).toBe(2);
      expect((await one(s, "select closed_at is not null c from public.academic_years where id = $1", [Y18])).c).toBe(true);
      expect((await one(s, "select closed_at is null c from public.academic_years where id = $1", [Y19])).c).toBe(true);
    });
  });
});
