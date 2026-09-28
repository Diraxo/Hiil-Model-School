// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootReplica, inTx, seed, readSql, U, F, ROLLBACK_DIR, MIG_DIR } from "./helpers/pgReplica.js";

// Academic year -> billing period -> obligation -> payment, against the production schema (every
// migration replayed in PGlite). Nothing here touches the school's Supabase project.
const MIGRATION = "20260928000000_academic_year_billing_period_guards.sql";
const Y_OLD = "00000000-0000-4000-8000-0000000a0001"; // 2018 E.C. / 2025-26
const Y_NEW = "00000000-0000-4000-8000-0000000a0002"; // 2019 E.C. / 2026-27
const Y_BAD = "00000000-0000-4000-8000-0000000a0003"; // the inconsistent row: start left in 2025
let db;

beforeAll(async () => { db = await bootReplica(); await seed(db); }, 240000);
afterAll(async () => { await db?.close?.(); });

const yearSql = (id, start, end, sem1s, sem1e, sem2s, sem2e, cur = false) =>
  `insert into public.academic_years (id, gc_label, ec_label, year_start, year_end, sem1_start, sem1_end, break_days, sem2_start, sem2_end, is_current)
   values ('${id}', 'x', 'x', '${start}', '${end}', '${sem1s}', '${sem1e}', 15, '${sem2s}', '${sem2e}', ${cur})`;

// Fees are billed only to students ENROLLED in the schedule's year, so the fixtures enroll them.
async function enroll(s, yearId, studentIds = [F.S1, F.S2]) {
  for (const sid of studentIds) {
    const r = await s.admin("insert into public.enrollments (student_id, academic_year_id, grade, section, status, enrollment_date) values ($1, $2, 'Grade 1', 'A', 'ACTIVE', current_date)", [sid, yearId]);
    expect(r.ok, r.msg).toBe(true);
  }
}
async function twoYears(s) {
  expect((await s.admin(yearSql(Y_OLD, "2025-09-11", "2026-06-30", "2025-09-11", "2026-01-20", "2026-02-05", "2026-06-30"))).ok).toBe(true);
  expect((await s.admin(yearSql(Y_NEW, "2026-09-11", "2027-06-30", "2026-09-14", "2027-01-20", "2027-02-05", "2027-06-30", true))).ok).toBe(true);
  await enroll(s, Y_OLD);
  await enroll(s, Y_NEW);
}
async function feeSchedule(s, yearId, feeTypeId) {
  const r = await s.admin(
    `insert into public.fee_schedules (fee_type_id, academic_year_id, unit_amount, unit_months, units_per_year) values ($1, $2, 1000, 1, 10) returning id`,
    [feeTypeId, yearId]);
  expect(r.ok, r.msg).toBe(true);
  return r.rows[0].id;
}
async function feeType(s) {
  const r = await s.admin(`insert into public.fee_types (name, category) values ('School Fee', 'TUITION') returning id`);
  expect(r.ok, r.msg).toBe(true);
  return r.rows[0].id;
}
async function rollout(s, scheduleId) {
  const g = await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [scheduleId]);
  expect(g.ok, g.msg).toBe(true);
  const m = await s.run("OWNER", "select public.materialize_obligations_for_schedule($1, null, 'YEAR_ROLLOUT') n", [scheduleId]);
  expect(m.ok, m.msg).toBe(true);
}
const months = async (s, scheduleId) =>
  (await s.admin("select to_char(period_month, 'YYYY-MM') m from public.fee_installments where fee_schedule_id = $1 order by period_month", [scheduleId])).rows.map((r) => r.m);
async function pay(s, scheduleId, ym, amount = 400) {
  const inst = (await s.admin("select id from public.fee_installments where fee_schedule_id = $1 and to_char(period_month,'YYYY-MM') = $2", [scheduleId, ym])).rows[0].id;
  return s.run("OWNER", "select * from public.record_payment_batch($1::jsonb, 'Cash', current_date, null, $2)",
    [JSON.stringify([{ student_id: F.S1, installment_id: inst, amount }]), U.OWNER]);
}

describe("academic_years_validate_span trigger", () => {
  it("accepts a normal school year and rejects one that spans 23 months (start left in 2025)", async () => {
    await inTx(db, async (s) => {
      expect((await s.admin(yearSql(Y_NEW, "2026-09-11", "2027-06-30", "2026-09-14", "2027-01-20", "2027-02-05", "2027-06-30"))).ok).toBe(true);
      const bad = await s.admin(yearSql(Y_BAD, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08"));
      expect(bad.ok).toBe(false);
      expect(bad.msg).toMatch(/at most 13 months/);
    });
  });

  it("rejects re-saving a valid year's dates into the previous year", async () => {
    await inTx(db, async (s) => {
      await twoYears(s);
      const r = await s.run("OWNER", "update public.academic_years set year_start = '2025-09-11' where id = $1", [Y_NEW]);
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/13 months|Semester 1 starts/);
    });
  });

  it("rejects Semester 1 starting most of a year after the academic year does", async () => {
    await inTx(db, async (s) => {
      const r = await s.admin(yearSql(Y_BAD, "2026-09-11", "2027-08-01", "2027-03-01", "2027-05-01", "2027-05-20", "2027-08-01"));
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/Semester 1 starts/);
    });
  });

  it("does not block unrelated writes to an already-inconsistent row (switching the current year still works)", async () => {
    await inTx(db, async (s) => {
      await s.admin("alter table public.academic_years disable trigger academic_years_validate_span");
      expect((await s.admin(yearSql(Y_BAD, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08", true))).ok).toBe(true);
      await s.admin("alter table public.academic_years enable trigger academic_years_validate_span");
      // switching away from the inconsistent current row goes through the atomic RPC, and the span
      // trigger (which only fires on date writes) does not get in its way
      expect((await s.admin(yearSql(Y_NEW, "2026-09-11", "2027-06-30", "2026-09-14", "2027-01-20", "2027-02-05", "2027-06-30"))).ok).toBe(true);
      const r = await s.run("OWNER", "select public.set_current_academic_year($1, null, true)", [Y_NEW]);
      expect(r.ok, r.msg).toBe(true);
      await s.admin("update public.academic_years set closed_at = null where id = $1", [Y_BAD]);
      // ...but re-saving its dates without fixing them is refused
      const again = await s.run("OWNER", "update public.academic_years set year_start = '2025-09-11', year_end = '2027-07-08' where id = $1", [Y_BAD]);
      expect(again.ok).toBe(false);
      // ...and fixing the start date is accepted.
      const fixed = await s.run("OWNER", "update public.academic_years set year_start = '2026-09-11' where id = $1", [Y_BAD]);
      expect(fixed.ok, fixed.msg).toBe(true);
    });
  });
});

describe("billing periods come from the academic year's own dates", () => {
  it("each year only generates the months of its own dates; no cross-year leakage", async () => {
    await inTx(db, async (s) => {
      await twoYears(s);
      const ft = await feeType(s);
      const sOld = await feeSchedule(s, Y_OLD, ft);
      const sNew = await feeSchedule(s, Y_NEW, ft);
      await rollout(s, sOld);
      await rollout(s, sNew);
      expect(await months(s, sNew)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
      expect((await months(s, sOld))[0]).toBe("2025-09");
      expect((await months(s, sOld)).every((m) => m >= "2025-09" && m <= "2026-06")).toBe(true);
      // every obligation belongs to a schedule of exactly one year, and the two years' sets are disjoint
      const rows = (await s.admin(
        `select fs.academic_year_id y, count(*)::int n from public.student_fee_obligations o
           join public.fee_installments fi on fi.id = o.fee_installment_id
           join public.fee_schedules fs on fs.id = fi.fee_schedule_id group by 1`)).rows;
      expect(Object.fromEntries(rows.map((r) => [r.y, r.n]))[Y_NEW]).toBeGreaterThan(0);
      expect(rows.map((r) => r.y).sort()).toEqual([Y_OLD, Y_NEW].sort());
    });
  });

  it("generate_monthly_fee_installments refuses an inconsistent (23-month) year instead of billing both years", async () => {
    await inTx(db, async (s) => {
      await s.admin("alter table public.academic_years disable trigger academic_years_validate_span");
      await s.admin(yearSql(Y_BAD, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08", true));
      await s.admin("alter table public.academic_years enable trigger academic_years_validate_span");
      const ft = await feeType(s);
      const sched = await feeSchedule(s, Y_BAD, ft);
      const r = await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [sched]);
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/more than one school year/);
      expect(await months(s, sched)).toEqual([]);
    });
  });

  it("a payment stays attached to its original academic year, whatever happens to the calendar later", async () => {
    await inTx(db, async (s) => {
      await twoYears(s);
      const ft = await feeType(s);
      const sOld = await feeSchedule(s, Y_OLD, ft);
      const sNew = await feeSchedule(s, Y_NEW, ft);
      await rollout(s, sOld);
      await rollout(s, sNew);
      const p = await pay(s, sOld, "2025-10");
      expect(p.ok, p.msg).toBe(true);
      const yearOf = async () => (await s.admin(
        `select fs.academic_year_id y from public.payment_allocations pa
           join public.student_fee_obligations o on o.id = pa.obligation_id
           join public.fee_installments fi on fi.id = o.fee_installment_id
           join public.fee_schedules fs on fs.id = fi.fee_schedule_id`)).rows.map((r) => r.y);
      expect(await yearOf()).toEqual([Y_OLD]);
      // The new year's dates move; nothing about the old year's payment does.
      expect((await s.run("OWNER", "update public.academic_years set year_start = '2026-09-13', sem1_start = '2026-09-14' where id = $1", [Y_NEW])).ok).toBe(true);
      expect(await yearOf()).toEqual([Y_OLD]);
      expect((await s.admin("select count(*)::int n from public.payments")).rows[0].n).toBe(1);
    });
  });
});

describe("changing an academic year's dates preserves billed history", () => {
  it("months that fall outside the new dates keep their installments, obligations and payments and don't block other edits", async () => {
    await inTx(db, async (s) => {
      await twoYears(s);
      const ft = await feeType(s);
      const sNew = await feeSchedule(s, Y_NEW, ft);
      await rollout(s, sNew);
      expect((await pay(s, sNew, "2026-09")).ok).toBe(true);
      // Year now starts on Tikimt 5 (15 Oct): Meskerem (September 2026) is outside it, but already billed and paid.
      expect((await s.run("OWNER", "update public.academic_years set year_start = '2026-10-15', sem1_start = '2026-10-15' where id = $1", [Y_NEW])).ok).toBe(true);
      const keep = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"].map((m) => `${m}-01`);
      const r = await s.run("OWNER", "select public.set_fee_schedule_billed_months($1, $2::date[])", [sNew, keep]);
      expect(r.ok, r.msg).toBe(true);
      expect((await months(s, sNew))[0]).toBe("2026-09"); // still there
      const counts = (await s.admin(
        `select (select count(*)::int from public.payment_allocations) allocs,
                (select count(*)::int from public.student_fee_obligations o join public.fee_installments fi on fi.id = o.fee_installment_id
                  where fi.fee_schedule_id = $1 and to_char(fi.period_month,'YYYY-MM') = '2026-09') obs`, [sNew])).rows[0];
      expect(counts).toEqual({ allocs: 1, obs: expect.any(Number) });
      expect(counts.obs).toBeGreaterThan(0);
    });
  });

  it("existing protection is unchanged: an in-year month with a payment can't be removed; an unpaid one can", async () => {
    await inTx(db, async (s) => {
      await twoYears(s);
      const ft = await feeType(s);
      const sNew = await feeSchedule(s, Y_NEW, ft);
      await rollout(s, sNew);
      expect((await pay(s, sNew, "2026-10")).ok).toBe(true);
      const all = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"].map((m) => `${m}-01`);
      const withoutPaid = all.filter((m) => m !== "2026-10-01");
      const blocked = await s.run("OWNER", "select public.set_fee_schedule_billed_months($1, $2::date[])", [sNew, withoutPaid]);
      expect(blocked.ok).toBe(false);
      expect(blocked.msg).toMatch(/Cannot remove/);
      const withoutUnpaid = all.filter((m) => m !== "2027-06-01");
      const ok = await s.run("OWNER", "select public.set_fee_schedule_billed_months($1, $2::date[])", [sNew, withoutUnpaid]);
      expect(ok.ok, ok.msg).toBe(true);
      expect(await months(s, sNew)).not.toContain("2027-06");
    });
  });

  it("months outside the year are ignored in the requested set (they can never be added)", async () => {
    await inTx(db, async (s) => {
      await twoYears(s);
      const ft = await feeType(s);
      const sNew = await feeSchedule(s, Y_NEW, ft);
      await rollout(s, sNew);
      const r = await s.run("OWNER", "select public.set_fee_schedule_billed_months($1, $2::date[])", [sNew, ["2025-09-01", "2026-09-01", "2026-10-01"]]);
      expect(r.ok, r.msg).toBe(true);
      expect(await months(s, sNew)).toEqual(["2026-09", "2026-10"]);
    });
  });
});

describe("owner repair script for the inconsistent production row (supabase/manual, not a migration)", () => {
  const script = (id, start, end = "2027-07-07") => fs.readFileSync(path.resolve(__dirname, "../supabase/manual/repair_academic_year_start.sql.template"), "utf8")
    .split("\r\n").join("\n").replaceAll("<<ACADEMIC_YEAR_ID>>", id).replaceAll("<<NEW_YEAR_START>>", start).replaceAll("<<NEW_YEAR_END>>", end);
  const badRow = async (s) => {
    await s.admin("alter table public.academic_years disable trigger academic_years_validate_span");
    await s.admin(yearSql(Y_BAD, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08", true));
    await s.admin("alter table public.academic_years enable trigger academic_years_validate_span");
  };

  it("moves the year to Meskerem 1 .. Sene 30, 2019; it then bills exactly Sep 2026 .. Jun 2027 (10 months) with no 2018 month", async () => {
    await inTx(db, async (s) => {
      await badRow(s);
      await db.exec(script(Y_BAD, "2026-09-11"));
      const row = (await s.admin("select year_start::text ys, year_end::text ye, sem2_end::text s2 from public.academic_years where id = $1", [Y_BAD])).rows[0];
      expect(row).toEqual({ ys: "2026-09-11", ye: "2027-07-07", s2: "2027-07-07" });
      const ft = await feeType(s);
      const sched = await feeSchedule(s, Y_BAD, ft);
      await rollout(s, sched);
      const m = await months(s, sched);
      expect(m).toHaveLength(10);
      expect(m[0]).toBe("2026-09");
      expect(m.at(-1)).toBe("2027-06");
      expect(m.some((x) => x < "2026-09")).toBe(false);
    });
  });

  it("refuses when attendance or payroll exists that the corrected dates would leave outside the year", async () => {
    await inTx(db, async (s) => {
      await badRow(s);
      const st = await s.admin("insert into public.staff (name, position, employment_date, salary) values ('Old Hand', 'Teacher', '2025-01-01', 1000) returning id");
      await s.admin("set session_replication_role = replica");
      await s.admin("insert into public.payroll_payments (staff_id, amount, method, month, date, reference) values ($1, 500, 'Cash', '2025-10', '2025-10-30', 'SAL-OLD-1')", [st.rows[0].id]);
      await s.admin("set session_replication_role = origin");
      await expect(db.exec(script(Y_BAD, "2026-09-11"))).rejects.toThrow(/Refusing: 1 payroll payment/);
    });
  });

  it("refuses (and changes nothing) when fees were billed before the new start: the row also carries the previous year", async () => {
    await inTx(db, async (s) => {
      await badRow(s);
      const ft = await feeType(s);
      const sched = await feeSchedule(s, Y_BAD, ft);
      await s.admin("insert into public.fee_installments (fee_schedule_id, sequence_index, label, due_date, amount, period_month) values ($1, 0, 'Sept 2025', '2025-09-01', 1000, '2025-09-01')", [sched]);
      await expect(db.exec(script(Y_BAD, "2026-09-11"))).rejects.toThrow(/Refusing: 1 fee installment/);
    });
  });

  it("refuses when attendance was recorded in the previous year's part of the row", async () => {
    await inTx(db, async (s) => {
      await badRow(s);
      // recorded back when 2025-26 was running (the attendance calendar trigger is bypassed, as in the seed)
      await s.admin("set session_replication_role = replica");
      const ins = await s.admin("insert into public.attendance (student_id, class_id, date, status) values ($1, $2, '2025-10-06', 'Present')", [F.S1, F.CLASS1]);
      expect(ins.ok, ins.msg).toBe(true);
      await s.admin("set session_replication_role = origin");
      await expect(db.exec(script(Y_BAD, "2026-09-11"))).rejects.toThrow(/Refusing: 1 attendance record/);
    });
  });
});

describe("rollback", () => {
  it("removes the trigger and restores the previous RPC behaviour without touching data", async () => {
    await inTx(db, async (s) => {
      await s.admin("alter table public.academic_years disable trigger academic_years_validate_span");
      await s.admin(yearSql(Y_BAD, "2025-09-11", "2027-07-08", "2026-09-14", "2027-01-20", "2027-02-05", "2027-07-08", true));
      await db.exec(readSql(ROLLBACK_DIR, "20260928000000_rollback.sql"));
      const trg = await s.admin("select count(*)::int n from pg_trigger where tgname = 'academic_years_validate_span'");
      expect(trg.rows[0].n).toBe(0);
      const ft = await feeType(s);
      const sched = await feeSchedule(s, Y_BAD, ft);
      const g = await s.run("OWNER", "select * from public.generate_monthly_fee_installments($1)", [sched]);
      expect(g.ok, g.msg).toBe(true);
      expect((await months(s, sched)).length).toBe(23);
    });
  });

  it("the migration file is idempotent (can be applied twice)", async () => {
    await inTx(db, async () => {
      await db.exec(readSql(MIG_DIR, MIGRATION));
      await db.exec(readSql(MIG_DIR, MIGRATION));
    });
  });
});
