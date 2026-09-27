// Replays EVERY migration in supabase/migrations (in order) into an in-memory Postgres (PGlite) behind a
// minimal Supabase-shaped stub. Nothing here touches the school's Supabase project.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const MIG_DIR = path.resolve(__dirname, "../../supabase/migrations");
export const ROLLBACK_DIR = path.resolve(__dirname, "../../supabase/rollbacks");

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text, raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create publication supabase_realtime;
grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export const readSql = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8").split("\r\n").join("\n").replace(/create extension if not exists pgcrypto;/i, "");
export const migrationFiles = () => fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

export async function bootReplica() {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of migrationFiles()) await db.exec(readSql(MIG_DIR, f));
  return db;
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const U = { OWNER: id(1), ADMIN: id(2), FINANCE: id(3), TEACHER: id(4), PARENT: id(5), PARENT2: id(6), TEACHER2: id(7) };
const ROLE = { OWNER: "OWNER", ADMIN: "ADMIN", FINANCE: "FINANCE", TEACHER: "TEACHER", PARENT: "PARENT", PARENT2: "PARENT", TEACHER2: "TEACHER" };
export const F = { CLASS1: id(101), CLASS2: id(102), S1: id(201), S2: id(202) };

export async function seed(db) {
  for (const [k, uid] of Object.entries(U)) {
    await db.query("insert into auth.users(id,email,encrypted_password) values ($1,$2,'x')", [uid, `${k.toLowerCase()}@x.test`]);
    await db.query("insert into public.profiles(id,role,full_name,email,status) values ($1,$2,$3,$4,'ACTIVE')", [uid, ROLE[k], `${k} Person`, `${k.toLowerCase()}@x.test`]);
  }
  await db.exec(`
    set session_replication_role = replica;
    insert into public.classes (id,grade,section,head_teacher_id) values ('${F.CLASS1}','Grade 1','A','${U.TEACHER}'), ('${F.CLASS2}','Grade 2','A','${U.TEACHER2}');
    insert into public.students (id,student_id,first_name,last_name,grade,section,class_id,admission_date) values
      ('${F.S1}','PUSH-1','Ann','One','Grade 1','A','${F.CLASS1}',current_date), ('${F.S2}','PUSH-2','Ben','Two','Grade 2','A','${F.CLASS2}',current_date);
    insert into public.parent_students (parent_id,student_id) values ('${U.PARENT}','${F.S1}'), ('${U.PARENT2}','${F.S2}');
    set session_replication_role = origin;
  `);
}

/** Runs statements as a Supabase persona (JWT claims + role); each call in a savepoint so a failure never poisons the transaction. */
export class Session {
  constructor(db) { this.db = db; }
  async as(who) {
    await this.db.exec("reset role");
    const claims = who === "ANON" ? '{"role":"anon"}' : who === "BACKEND" ? "" : JSON.stringify({ sub: U[who], role: "authenticated" });
    await this.db.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    if (who === "ANON") await this.db.exec("set role anon");
    else if (who !== "BACKEND") await this.db.exec("set role authenticated");
  }
  async run(who, sql, params = []) {
    await this.as(who);
    await this.db.exec("savepoint sp");
    try { const r = await this.db.query(sql, params); await this.db.exec("release savepoint sp"); return { ok: true, rows: r.rows, affected: r.affectedRows }; }
    catch (e) { await this.db.exec("rollback to savepoint sp"); return { ok: false, msg: String(e.message) }; }
  }
  admin(sql, params = []) { return this.run("BACKEND", sql, params); }
}

/** Runs `fn` in a transaction that is always rolled back, so tests never see each other's writes. */
export async function inTx(db, fn) {
  await db.exec("begin");
  try { return await fn(new Session(db)); } finally { await db.exec("rollback").catch(() => {}); await db.exec("reset role").catch(() => {}); }
}
