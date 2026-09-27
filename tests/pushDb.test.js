// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootReplica, inTx, seed, readSql, U, ROLLBACK_DIR, MIG_DIR } from "./helpers/pgReplica.js";

// Push-notification database security, run against the production schema (every migration replayed in
// PGlite). Covers device ownership, notification history RLS, the server-stamped actor, and that recipients
// can only ever come from the authorization-checked notify_* RPCs.
const MIGRATION = "20260927000000_push_devices_actor_delivery.sql";
const tok = (n) => `fcm-web-token-${n}`.padEnd(64, "x");
let db;

const register = (s, who, token, device, version = "pwa-standalone") =>
  s.run(who, "select public.register_device_token($1, 'web', $2, $3)", [token, device, version]);
const deviceRows = async (s) => (await s.admin("select user_id, device_id, token, platform, enabled from public.device_tokens order by created_at, device_id")).rows;
const denied = (r) => !r.ok && /permission denied|row-level security/i.test(r.msg);

async function announce(s, who, audience) {
  const r = await s.run(who, "insert into public.announcements (title, message, audience, priority) values ('School update','m',$1::jsonb,'Normal') returning id", [JSON.stringify(audience)]);
  expect(r.ok, r.msg).toBe(true);
  return r.rows[0].id;
}
const dispatch = (s, who, id) => s.run(who, "select public.notify_announcement($1::uuid, 'New announcement', 'School update', '{\"page\":\"announcements\"}'::jsonb) n", [id]);
const recipients = async (s, annId) => (await s.admin("select user_id, actor_user_id from public.notifications where announcement_id = $1::uuid order by user_id", [annId])).rows;

beforeAll(async () => { db = await bootReplica(); await seed(db); }, 240000);
afterAll(async () => { await db?.close?.(); });

describe("device registration ownership (RLS + SECURITY DEFINER RPC)", () => {
  it("own device registration works and is owned by the authenticated caller", async () => {
    await inTx(db, async (s) => {
      expect((await register(s, "PARENT", tok("p1"), "device-parent-1")).ok).toBe(true);
      const rows = await deviceRows(s);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: U.PARENT, platform: "web", enabled: true });
    });
  });

  it("the RPCs take NO user id argument: ownership can only come from the session", async () => {
    const r = await db.query("select proname, pg_get_function_arguments(oid) args from pg_proc where proname in ('register_device_token','unregister_device_token','set_device_push_enabled')");
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) expect(row.args).not.toMatch(/user|owner|actor|recipient|role/i);
  });

  it("another user cannot register against someone else: each caller only ever creates rows for themselves", async () => {
    await inTx(db, async (s) => {
      await register(s, "PARENT", tok("p1"), "device-parent-1");
      await register(s, "PARENT2", tok("p2"), "device-parent-2");
      const byUser = Object.fromEntries((await deviceRows(s)).map((r) => [r.device_id, r.user_id]));
      expect(byUser).toEqual({ "device-parent-1": U.PARENT, "device-parent-2": U.PARENT2 });
    });
  });

  it("clients cannot read, write or delete device rows directly (no policies + privileges revoked)", async () => {
    await inTx(db, async (s) => {
      await register(s, "PARENT", tok("p1"), "device-parent-1");
      for (const who of ["PARENT", "PARENT2", "ANON"]) {
        expect(denied(await s.run(who, "select * from public.device_tokens")), `${who} select`).toBe(true);
        expect(denied(await s.run(who, "insert into public.device_tokens(user_id,device_id,token,platform) values ($1,'12345678',$2,'web')", [U.PARENT, tok("evil")])), `${who} insert`).toBe(true);
        expect(denied(await s.run(who, "delete from public.device_tokens")), `${who} delete`).toBe(true);
        expect(denied(await s.run(who, "update public.device_tokens set user_id = $1", [U.PARENT2])), `${who} update`).toBe(true);
      }
      expect(await deviceRows(s)).toHaveLength(1);
    });
  });

  it("another user cannot delete or disable my device through the RPCs", async () => {
    await inTx(db, async (s) => {
      await register(s, "PARENT", tok("p1"), "device-parent-1");
      await s.run("PARENT2", "select public.unregister_device_token('device-parent-1')");
      await s.run("PARENT2", "select public.set_device_push_enabled('device-parent-1', false)");
      expect(await deviceRows(s)).toEqual([expect.objectContaining({ user_id: U.PARENT, enabled: true })]);
      await s.run("PARENT", "select public.set_device_push_enabled('device-parent-1', false)");
      expect((await deviceRows(s))[0].enabled).toBe(false);
      await s.run("PARENT", "select public.unregister_device_token('device-parent-1')");
      expect(await deviceRows(s)).toHaveLength(0);
    });
  });

  it("repeated registration updates in place (token rotation) and re-enables; multiple devices per user are kept", async () => {
    await inTx(db, async (s) => {
      await register(s, "PARENT", tok("a"), "device-iphone-1");
      await s.run("PARENT", "select public.set_device_push_enabled('device-iphone-1', false)");
      await register(s, "PARENT", tok("a-rotated"), "device-iphone-1");
      await register(s, "PARENT", tok("b"), "device-android-1");
      const rows = await deviceRows(s);
      expect(rows.map((r) => r.device_id).sort()).toEqual(["device-android-1", "device-iphone-1"]);
      expect(rows.find((r) => r.device_id === "device-iphone-1")).toMatchObject({ token: tok("a-rotated"), enabled: true });
    });
  });

  it("a shared phone changing hands: the token moves to the new user and the previous owner stops receiving there", async () => {
    await inTx(db, async (s) => {
      await register(s, "PARENT", tok("shared"), "device-shared-1");
      await register(s, "PARENT2", tok("shared"), "device-shared-1");
      expect(await deviceRows(s)).toEqual([expect.objectContaining({ user_id: U.PARENT2, token: tok("shared") })]);
    });
  });

  it("anonymous callers and inactive accounts cannot register", async () => {
    await inTx(db, async (s) => {
      expect((await register(s, "ANON", tok("x"), "device-anon-1")).ok).toBe(false);
      await s.admin("update public.profiles set status = 'SUSPENDED' where id = $1", [U.PARENT2]);
      const r = await register(s, "PARENT2", tok("y"), "device-susp-1");
      expect(r.ok).toBe(false);
      expect(r.msg).toMatch(/account not active/);
    });
  });

  it("the delivery ledger is invisible to every client role", async () => {
    await inTx(db, async (s) => {
      for (const who of ["PARENT", "ADMIN", "OWNER", "ANON"]) {
        expect(denied(await s.run(who, "select * from public.push_deliveries")), who).toBe(true);
      }
    });
  });
});

describe("notification history: RLS, actor stamping and recipient authorization", () => {
  it("an announcement reaches ONLY its audience, records the real actor, and the actor is stamped server-side", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "GRADE", grade: "Grade 1" });
      expect((await dispatch(s, "ADMIN", id)).rows[0].n).toBe(1);
      expect(await recipients(s, id)).toEqual([{ user_id: U.PARENT, actor_user_id: U.ADMIN }]); // not PARENT2, not staff
    });
  });

  it("dispatch is idempotent: a retry creates no duplicate history rows", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "ALL_PARENTS" });
      expect((await dispatch(s, "ADMIN", id)).rows[0].n).toBe(2);
      expect((await dispatch(s, "ADMIN", id)).rows[0].n).toBe(0);
      expect(await recipients(s, id)).toHaveLength(2);
    });
  });

  it("Finance scope is unchanged: Finance can reach parents but not 'everyone'", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "FINANCE", { type: "ALL_PARENTS" });
      expect((await dispatch(s, "FINANCE", id)).ok).toBe(true);
      expect((await recipients(s, id)).map((r) => r.user_id).sort()).toEqual([U.PARENT, U.PARENT2].sort());
      const bad = await s.run("FINANCE", "insert into public.announcements (title, audience) values ('x', '{\"type\":\"ALL\"}')");
      expect(bad.ok).toBe(false);
    });
  });

  it("Owner scope: an Owner announcement to teachers reaches only teachers", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "OWNER", { type: "ALL_TEACHERS" });
      await dispatch(s, "OWNER", id);
      expect((await recipients(s, id)).map((r) => r.user_id).sort()).toEqual([U.TEACHER, U.TEACHER2].sort());
    });
  });

  it("recipients cannot be chosen by a client: only the announcement's author/admin may dispatch, and only to its stored audience", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "GRADE", grade: "Grade 1" });
      for (const who of ["PARENT", "PARENT2", "TEACHER", "FINANCE"]) {
        const r = await dispatch(s, who, id);
        expect(r.ok, `${who} dispatched someone else's announcement`).toBe(false);
      }
      expect(await recipients(s, id)).toHaveLength(0);
      // ...and nobody can create a notification row for an arbitrary user_id directly.
      for (const who of ["PARENT", "TEACHER", "ADMIN", "OWNER", "ANON"]) {
        const r = await s.run(who, "insert into public.notifications (user_id, title, type) values ($1, 'spam', 'ANNOUNCEMENT')", [U.PARENT2]);
        expect(denied(r), `${who} inserted a notification`).toBe(true);
      }
      // A teacher / parent cannot author an announcement to spawn one either.
      expect((await s.run("TEACHER", "insert into public.announcements (title, audience) values ('x','{\"type\":\"ALL\"}')")).ok).toBe(false);
    });
  });

  it("own notification history is readable; another user's is not (parent isolation)", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "ALL_PARENTS" });
      await dispatch(s, "ADMIN", id);
      const mine = await s.run("PARENT", "select user_id, actor_user_id, type, created_at, announcement_id, read from public.notifications");
      expect(mine.rows).toHaveLength(1);
      expect(mine.rows[0]).toMatchObject({ user_id: U.PARENT, actor_user_id: U.ADMIN, type: "ANNOUNCEMENT", announcement_id: id, read: false });
      expect(mine.rows[0].created_at).toBeTruthy();
      expect((await s.run("PARENT2", "select * from public.notifications where user_id = $1", [U.PARENT])).rows).toHaveLength(0);
      expect((await s.run("TEACHER", "select * from public.notifications")).rows).toHaveLength(0);
      const anon = await s.run("ANON", "select * from public.notifications");
      expect(anon.ok ? anon.rows.length : 0).toBe(0); // denied outright or filtered to nothing by RLS
    });
  });

  it("own read state can be updated; another user's cannot", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "ALL_PARENTS" });
      await dispatch(s, "ADMIN", id);
      const other = await s.run("PARENT2", "update public.notifications set read = true where user_id = $1 returning id", [U.PARENT]);
      expect(other.rows ?? []).toHaveLength(0);
      const own = await s.run("PARENT", "update public.notifications set read = true returning id");
      expect(own.rows).toHaveLength(1);
      expect((await s.admin("select read from public.notifications where user_id = $1", [U.PARENT])).rows[0].read).toBe(true);
      expect((await s.admin("select read from public.notifications where user_id = $1", [U.PARENT2])).rows[0].read).toBe(false);
    });
  });

  it("the recipient can change ONLY the read flag: title, recipient and actor cannot be rewritten", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "ALL_PARENTS" });
      await dispatch(s, "ADMIN", id);
      for (const set of ["title = 'hacked'", `user_id = '${U.PARENT2}'`, `actor_user_id = '${U.OWNER}'`, "message = 'x'", "navigation = '{}'::jsonb"]) {
        const r = await s.run("PARENT", `update public.notifications set ${set}`);
        expect(r.ok, set).toBe(false);
        expect(r.msg, set).toMatch(/Only the read flag/);
      }
    });
  });

  it("the actor is always the authenticated caller: a system insert has no actor and a self-notification shows none", async () => {
    await inTx(db, async (s) => {
      const sys = await s.admin("insert into public.notifications (user_id, title, type, actor_user_id) values ($1, 'system', 'ANNOUNCEMENT', $2) returning actor_user_id", [U.PARENT, U.OWNER]);
      expect(sys.rows[0].actor_user_id).toBeNull(); // a claimed actor is overwritten by auth.uid() (NULL for the backend)
      const id = await announce(s, "ADMIN", { type: "USER", userId: U.ADMIN });
      await dispatch(s, "ADMIN", id);
      expect((await recipients(s, id))).toEqual([{ user_id: U.ADMIN, actor_user_id: null }]);
    });
  });

  it("deleting an actor's profile keeps the notification (actor becomes null; history is not lost)", async () => {
    await inTx(db, async (s) => {
      const id = await announce(s, "ADMIN", { type: "ALL_PARENTS" });
      await dispatch(s, "ADMIN", id);
      // The FK's ON DELETE SET NULL fires the update guard: it must allow a change TO null.
      const del = await s.admin("delete from public.profiles where id = $1", [U.ADMIN]);
      expect(del.ok, del.msg).toBe(true);
      expect(await recipients(s, id)).toHaveLength(2); // history survives
      expect((await recipients(s, id)).every((x) => x.actor_user_id === null)).toBe(true);
    });
  });
});

describe("migration hygiene", () => {
  it("the rollback removes everything and restores the original guard; the migration re-applies cleanly", async () => {
    const d = await bootReplica();
    await d.exec(readSql(ROLLBACK_DIR, "20260927000000_rollback.sql"));
    const gone = await d.query("select to_regclass('public.device_tokens') t, to_regclass('public.push_deliveries') p, (select count(*)::int from information_schema.columns where table_name='notifications' and column_name='actor_user_id') c");
    expect(gone.rows[0]).toMatchObject({ t: null, p: null, c: 0 });
    await d.exec(readSql(MIG_DIR, MIGRATION));
    expect((await d.query("select to_regclass('public.device_tokens') t")).rows[0].t).toBe("device_tokens");
    await d.close();
  }, 240000);

  it("never stores a private credential in a migration", () => {
    const sql = fs.readFileSync(path.join(MIG_DIR, MIGRATION), "utf8");
    expect(sql).not.toMatch(/BEGIN (RSA )?PRIVATE KEY|private_key|client_email|firebase-adminsdk/i);
  });
});
