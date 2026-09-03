/*
 * READ-ONLY diagnostic for backfill-base64-media.mjs returning 0 rows.
 *
 * Prints ONLY: table, row id, student_id code, whether the value starts with "data:",
 * the data-uri scheme prefix (up to the first comma), the value length, and result counts.
 * It NEVER prints base64 payloads, keys, or any secret.
 *
 * Usage (from repo root, in the shell where SUPABASE_SERVICE_ROLE_KEY is set):
 *   node scripts/diag-base64-media.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function envFromDotenv(key) {
  try {
    const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const m = txt.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

const URL_ = process.env.VITE_SUPABASE_URL || envFromDotenv("VITE_SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Need VITE_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (env var).");
  process.exit(1);
}

// Show which project + key kind, without revealing values.
const projectRef = (() => { try { return new URL(URL_).host.split(".")[0]; } catch { return "?"; } })();
function jwtRole(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    return `${payload.role || "?"} (ref=${payload.ref || "?"})`;
  } catch {
    return "non-JWT key (sb_secret_… publishable/secret style)";
  }
}
console.log(`Supabase project ref : ${projectRef}`);
console.log(`Service key claims   : ${jwtRole(KEY)}`);
console.log("");

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

function describe(v) {
  if (v == null) return { starts: "(null)", scheme: "-", len: 0 };
  const s = String(v);
  const head = s.slice(0, 40);
  const scheme = s.startsWith("data:") ? s.slice(0, Math.min(s.indexOf(",") + 1 || 30, 60)) : JSON.stringify(head);
  return {
    starts: s.startsWith("data:") ? "data:" : `${JSON.stringify(s.slice(0, 12))}…`,
    scheme,
    len: s.length,
  };
}

async function dumpTable(table, cols, label = table) {
  const { data, error, count } = await db
    .from(table)
    .select(cols, { count: "exact" });
  console.log(`=== ${label} — select("${cols}") ===`);
  if (error) {
    console.log(`  ERROR: ${error.code || ""} ${error.message}`);
    console.log(`  details: ${error.details || "-"} | hint: ${error.hint || "-"}`);
    return;
  }
  console.log(`  rows returned: ${data.length}  (exact count: ${count})`);
  const valueCol = cols.split(",").map((c) => c.trim()).find((c) => /url$/.test(c));
  let dataUri = 0;
  for (const r of data) {
    const d = describe(r[valueCol]);
    const idBits = [r.id, r.student_id ? `code=${r.student_id}` : null].filter(Boolean).join(" ");
    if (d.starts === "data:") dataUri++;
    console.log(`  - ${idBits} | ${valueCol}: starts=${d.starts} len=${d.len} scheme=${d.scheme}`);
  }
  console.log(`  -> ${valueCol} values starting with "data:": ${dataUri}`);
  console.log("");
}

async function main() {
  await dumpTable("students", "id, student_id, photo_url");
  await dumpTable("profiles", "id, photo_url");
  await dumpTable("staff", "id, photo_url");
  await dumpTable("student_documents", "id, student_id, file_url");
  await dumpTable("announcements", "id, attachment_url");

  // Targeted: the row the audit named.
  const { data: t, error: te } = await db
    .from("students")
    .select("id, student_id, photo_url")
    .eq("student_id", "TMA-2026-00001");
  console.log("=== targeted students where student_id = 'TMA-2026-00001' ===");
  if (te) console.log(`  ERROR: ${te.message}`);
  else if (!t.length) console.log("  NO ROW with that student_id code");
  else for (const r of t) {
    const d = describe(r.photo_url);
    console.log(`  id=${r.id} code=${r.student_id} photo_url starts=${d.starts} len=${d.len} scheme=${d.scheme}`);
  }
  console.log("");

  // Storage: what is actually in the student-photos bucket right now.
  const { data: objs, error: oe } = await db.storage.from("student-photos").list("", { limit: 100 });
  console.log("=== storage: student-photos bucket, root listing ===");
  if (oe) console.log(`  ERROR: ${oe.message}`);
  else {
    console.log(`  entries: ${objs.length}`);
    for (const o of objs) console.log(`  - ${o.name}${o.id ? " (file)" : " (folder)"}`);
  }
  console.log("");

  const { data: buckets, error: be } = await db.storage.listBuckets();
  console.log("=== storage: buckets ===");
  if (be) console.log(`  ERROR: ${be.message}`);
  else for (const b of buckets) console.log(`  - ${b.name} public=${b.public}`);
  console.log("");

  // ---- Verify the already-migrated TMA-2026-00001 photo resolves end-to-end ----
  const { data: srow } = await db
    .from("students").select("id, photo_url").eq("student_id", "TMA-2026-00001").single();
  const path = srow?.photo_url;
  console.log("=== verify: TMA-2026-00001 photo path ===");
  console.log(`  photo_url                : ${path}`);
  console.log(`  is data: URI             : ${String(path).startsWith("data:")}`);
  const folder = String(path).split("/")[0];
  const leaf = String(path).split("/").slice(1).join("/");
  console.log(`  folder == student.id     : ${folder === srow?.id}  (folder=${folder})`);
  console.log(`  leaf matches convention  : ${/^\d{10,}-[a-z0-9]{6,}/i.test(leaf)}  (leaf=${leaf})`);

  const { data: inFolder, error: ife } = await db.storage.from("student-photos").list(folder, { limit: 50 });
  console.log(`  objects in folder        : ${ife ? "ERROR " + ife.message : inFolder.map((o) => `${o.name} [${o.metadata?.mimetype || "?"}, ${o.metadata?.size ?? "?"}B]`).join(", ")}`);
  const objExists = !ife && inFolder.some((o) => o.name === leaf);
  console.log(`  path resolves to an object: ${objExists}`);

  const { data: signed, error: se } = await db.storage.from("student-photos").createSignedUrl(path, 60);
  console.log(`  createSignedUrl          : ${se ? "ERROR " + se.message : "ok"}`);
  if (signed?.signedUrl) {
    try {
      const res = await fetch(signed.signedUrl);
      const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
      console.log(`  signed URL GET           : HTTP ${res.status}  content-type=${res.headers.get("content-type")}  bytes=${bytes}`);
    } catch (e) {
      console.log(`  signed URL GET           : fetch failed ${e.message}`);
    }
    // Prove the bucket is private: hit the public object URL, expect 400/403/404.
    const pub = `${URL_}/storage/v1/object/public/student-photos/${path}`;
    try {
      const pr = await fetch(pub);
      console.log(`  public URL (want denied) : HTTP ${pr.status}`);
    } catch (e) {
      console.log(`  public URL               : fetch failed ${e.message}`);
    }
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
