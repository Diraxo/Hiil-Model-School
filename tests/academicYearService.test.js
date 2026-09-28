import { beforeEach, describe, expect, it, vi } from "vitest";

// The client side of the atomic year switch and re-enrollment RPCs, including how it behaves BEFORE migration
// 20260929000000 is applied (the app must keep working until the owner applies it).
const h = vi.hoisted(() => ({ rpc: null, calls: [], tableResult: {} }));

vi.mock("../src/lib/supabaseClient", () => {
  const from = (table) => {
    const rec = { table, ops: [] };
    h.calls.push(rec);
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") return (res) => res(h.tableResult[table] || { data: [], error: null });
        return (...args) => { rec.ops.push([prop, ...args]); return builder; };
      },
    });
    return builder;
  };
  return { supabase: { from, rpc: (...a) => h.rpc(...a) } };
});

import { createAcademicYearService, isMissingDbObject } from "../src/services/academicYearService";

const svc = createAcademicYearService();
beforeEach(() => { h.calls.length = 0; h.tableResult = {}; h.rpc = vi.fn(async () => ({ data: { changed: true, archived: 2 }, error: null })); });

describe("setCurrent (atomic, audited)", () => {
  it("calls the server action with the reason and the undecided override, and returns what it reports", async () => {
    const res = await svc.setCurrent("y20", { reason: "Audit", allowUndecided: true });
    expect(h.rpc).toHaveBeenCalledWith("set_current_academic_year", { p_year_id: "y20", p_reason: "Audit", p_allow_undecided: true });
    expect(res).toMatchObject({ changed: true, archived: 2, legacy: false });
    expect(h.calls).toEqual([]);                        // no loose table updates
  });
  it("defaults: no reason, no override", async () => {
    await svc.setCurrent("y20");
    expect(h.rpc).toHaveBeenCalledWith("set_current_academic_year", { p_year_id: "y20", p_reason: null, p_allow_undecided: false });
  });
  it("a real server error (e.g. 'needs a reason') is thrown as-is, not papered over by the legacy path", async () => {
    h.rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "Reopening a closed academic year needs a reason." } }));
    await expect(svc.setCurrent("y18")).rejects.toMatchObject({ message: "Reopening a closed academic year needs a reason." });
    expect(h.calls).toEqual([]);
  });
  it("before the migration (function missing) it falls back to the previous two-step switch", async () => {
    h.rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.set_current_academic_year" } }));
    const res = await svc.setCurrent("y20", { updatedBy: "u1" });
    expect(res).toMatchObject({ changed: true, legacy: true });
    expect(h.calls.map((c) => c.table)).toEqual(["academic_years", "academic_years"]);
    expect(h.calls[0].ops).toContainEqual(["update", { is_current: false, updated_by: "u1" }]);
    expect(h.calls[0].ops).toContainEqual(["eq", "is_current", true]);
    expect(h.calls[1].ops).toContainEqual(["update", { is_current: true, updated_by: "u1" }]);
    expect(h.calls[1].ops).toContainEqual(["eq", "id", "y20"]);
  });
});

describe("re-enrollment actions", () => {
  it("registerStudent registers an EXISTING student for the chosen year (one person, one enrollment per year)", async () => {
    await svc.registerStudent({ studentId: "s1", yearId: "y20", grade: "Grade 3", section: "A" });
    expect(h.rpc).toHaveBeenCalledWith("register_student_for_year", { p_student_id: "s1", p_year_id: "y20", p_grade: "Grade 3", p_section: "A" });
  });
  it("markNotReturning only records a decision", async () => {
    await svc.markNotReturning({ studentId: "s2", yearId: "y20", reason: "Moved" });
    expect(h.rpc).toHaveBeenCalledWith("mark_student_not_returning", { p_student_id: "s2", p_year_id: "y20", p_reason: "Moved" });
    expect(h.calls).toEqual([]);                        // no direct table write, and above all no delete
  });
  it("server errors surface", async () => {
    h.rpc = vi.fn(async () => ({ data: null, error: { message: "Only the Owner or Educational Director may register students for an academic year" } }));
    await expect(svc.registerStudent({ studentId: "s1", yearId: "y20", grade: "Grade 3" })).rejects.toMatchObject({ message: expect.stringMatching(/Only the Owner/) });
  });
});

describe("decisions and audit reads", () => {
  it("map rows to the shapes the UI reads", async () => {
    h.tableResult.student_year_decisions = { data: [{ id: "d1", student_id: "s2", academic_year_id: "y20", decision: "NOT_RETURNING", reason: null, decided_by: "u1", decided_at: "2027-01-01T00:00:00Z" }], error: null };
    h.tableResult.academic_year_audit = { data: [{ id: "a1", academic_year_id: "y20", action: "ACTIVATED", actor_id: "u1", actor_name: "Owner", reason: null, details: { archived: 1 }, at: "2027-09-01T00:00:00Z" }], error: null };
    expect(await svc.listDecisions()).toEqual([{ id: "d1", studentId: "s2", academicYearId: "y20", decision: "NOT_RETURNING", reason: "", decidedBy: "u1", decidedAt: Date.parse("2027-01-01T00:00:00Z") }]);
    const audit = await svc.listAudit();
    expect(audit[0]).toMatchObject({ id: "a1", action: "ACTIVATED", actorName: "Owner", details: { archived: 1 } });
  });
  it("are simply empty before the migration (missing table), never an error", async () => {
    h.tableResult.student_year_decisions = { data: null, error: { code: "42P01", message: 'relation "public.student_year_decisions" does not exist' } };
    h.tableResult.academic_year_audit = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.academic_year_audit' in the schema cache" } };
    expect(await svc.listDecisions()).toEqual([]);
    expect(await svc.listAudit()).toEqual([]);
  });
  it("any other read error still throws", async () => {
    h.tableResult.student_year_decisions = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(svc.listDecisions()).rejects.toMatchObject({ message: "permission denied" });
  });
});

describe("list maps the lifecycle columns", () => {
  it("closedAt is null for a current/upcoming year and a timestamp for a closed one; absent column stays undefined", async () => {
    const row = { id: "y", gc_label: "g", ec_label: "e", year_start: "2026-09-11", year_end: "2027-07-07", sem1_start: "a", sem1_end: "b", break_days: 15, sem2_start: "c", sem2_end: "d", result_finalization_grace_days: 15, is_current: false };
    h.tableResult.academic_years = { data: [{ ...row, id: "closed", closed_at: "2026-09-12T00:00:00Z", closed_by: "u1" }, { ...row, id: "open", closed_at: null }, { ...row, id: "legacy" }], error: null };
    const [closed, open, legacy] = await svc.list();
    expect(closed).toMatchObject({ closedAt: "2026-09-12T00:00:00Z", closedBy: "u1" });
    expect(open.closedAt).toBeNull();
    expect(legacy.closedAt).toBeUndefined();       // pre-migration row: status is inferred from dates
  });
});

describe("isMissingDbObject", () => {
  it("recognises the ways Supabase reports a function / table that isn't there", () => {
    for (const e of [{ code: "PGRST202" }, { code: "PGRST205" }, { code: "42883" }, { code: "42P01" }, { message: "Could not find the function public.x in the schema cache" }, { message: 'relation "x" does not exist' }]) {
      expect(isMissingDbObject(e)).toBe(true);
    }
    for (const e of [null, { code: "42501", message: "permission denied" }, { message: "Only the Owner may do that" }]) expect(isMissingDbObject(e)).toBe(false);
  });
});
