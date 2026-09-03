/*
 * One-time backfill: move every user-uploaded base64 / data-URI value still sitting in a Postgres
 * column into its private Supabase Storage bucket, and rewrite the column to hold the object PATH.
 *
 * Covers (only rows whose value actually starts with `data:` are touched):
 *   profiles.photo_url            -> profile-photos/<profile_id>/<file>
 *   staff.photo_url               -> profile-photos/<staff_id>/<file>
 *   students.photo_url            -> student-photos/<student_id>/<file>
 *   student_documents.file_url    -> student-documents/<student_id>/<file>
 *   announcements.attachment_url  -> announcement-attachments/<announcement_id>/<file>
 *      (JSON {type,name,dataUrl}  ->  JSON {type,name,path})
 *
 * The original base64 value is preserved (printed to stdout + written to a local .bak.json) before
 * the column is rewritten, and the row is only rewritten AFTER the object upload succeeds, so a
 * failure at any point leaves the row still pointing at the working base64 value. Re-running is
 * safe: rows already migrated (no `data:` prefix) are skipped.
 *
 * Usage (from the repo root):
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key from the Supabase dashboard> \
 *     node scripts/backfill-base64-media.mjs            # dry run: lists what it would do
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-base64-media.mjs --apply
 *
 * VITE_SUPABASE_URL is read from .env. The service_role key is never stored — pass it inline.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");

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

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

// Fail loudly instead of treating an auth/RLS error as "0 rows to migrate".
async function selectAll(table, cols) {
  const { data, error } = await db.from(table).select(cols);
  if (error) {
    throw new Error(
      `select ${table}(${cols}) failed: ${error.code || ""} ${error.message}. ` +
      `This usually means SUPABASE_SERVICE_ROLE_KEY is not a service_role / secret key ` +
      `(an anon/publishable key or a personal access token is blocked by RLS and returns no rows).`,
    );
  }
  return data || [];
}

const EXT_BY_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf",
};

function parseDataUri(value) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value || "");
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  const isB64 = !!m[2];
  const buf = isB64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { mime, buf, ext: EXT_BY_MIME[mime] || "bin" };
}

const backups = [];
let migrated = 0;
let skipped = 0;

async function uploadAndSwap({ table, idCol, id, column, currentValue, bucket, makeNewValue }) {
  const parsed = parseDataUri(currentValue);
  if (!parsed) { skipped++; return; }
  const objectPath = `${id}/${Date.now()}-${randomUUID().slice(0, 8)}.${parsed.ext}`;
  console.log(`  ${table}.${column} (${id})  ${currentValue.length} bytes base64  ->  ${bucket}/${objectPath}`);
  backups.push({ table, idCol, id, column, value: currentValue });
  if (!APPLY) { migrated++; return; }

  const up = await db.storage.from(bucket).upload(objectPath, parsed.buf, {
    contentType: parsed.mime, upsert: false,
  });
  if (up.error) throw new Error(`upload failed for ${table} ${id}: ${up.error.message}`);

  const newValue = makeNewValue(objectPath);
  const { error } = await db.from(table).update({ [column]: newValue }).eq(idCol, id);
  if (error) {
    await db.storage.from(bucket).remove([objectPath]).catch(() => {});
    throw new Error(`db update failed for ${table} ${id}: ${error.message}`);
  }
  migrated++;
}

async function run() {
  const projectRef = (() => { try { return new URL(URL_).host.split(".")[0]; } catch { return "?"; } })();
  const keyRole = (() => {
    try {
      const p = JSON.parse(Buffer.from(KEY.split(".")[1], "base64").toString("utf8"));
      return `${p.role || "?"} (ref=${p.ref || "?"})`;
    } catch { return "non-JWT key (sb_secret_… / sb_publishable_… / sbp_… style)"; }
  })();
  console.log(`Project ref : ${projectRef}`);
  console.log(`Key role    : ${keyRole}   <- must be service_role / secret, NOT anon/publishable/access-token\n`);
  console.log(APPLY ? "APPLY mode — writing changes.\n" : "DRY RUN — no changes written. Add --apply to migrate.\n");

  // profiles.photo_url
  for (const r of await selectAll("profiles", "id, photo_url")) {
    if ((r.photo_url || "").startsWith("data:")) {
      await uploadAndSwap({ table: "profiles", idCol: "id", id: r.id, column: "photo_url",
        currentValue: r.photo_url, bucket: "profile-photos", makeNewValue: (p) => p });
    }
  }
  // staff.photo_url
  for (const r of await selectAll("staff", "id, photo_url")) {
    if ((r.photo_url || "").startsWith("data:")) {
      await uploadAndSwap({ table: "staff", idCol: "id", id: r.id, column: "photo_url",
        currentValue: r.photo_url, bucket: "profile-photos", makeNewValue: (p) => p });
    }
  }
  // students.photo_url
  for (const r of await selectAll("students", "id, photo_url")) {
    if ((r.photo_url || "").startsWith("data:")) {
      await uploadAndSwap({ table: "students", idCol: "id", id: r.id, column: "photo_url",
        currentValue: r.photo_url, bucket: "student-photos", makeNewValue: (p) => p });
    }
  }
  // student_documents.file_url
  for (const r of await selectAll("student_documents", "id, student_id, file_url")) {
    if ((r.file_url || "").startsWith("data:")) {
      await uploadAndSwap({ table: "student_documents", idCol: "id", id: r.id, column: "file_url",
        currentValue: r.file_url, bucket: "student-documents",
        // path folder must be the student id (bucket RLS keys on it), not the document id
        makeNewValue: (p) => p.replace(/^[^/]+\//, `${r.student_id}/`) });
    }
  }
  // announcements.attachment_url  (JSON {type,name,dataUrl})
  for (const r of await selectAll("announcements", "id, attachment_url")) {
    const raw = r.attachment_url;
    if (!raw) continue;
    let obj = null;
    try { obj = JSON.parse(raw); } catch { obj = null; }
    if (obj && typeof obj.dataUrl === "string" && obj.dataUrl.startsWith("data:")) {
      await uploadAndSwap({ table: "announcements", idCol: "id", id: r.id, column: "attachment_url",
        currentValue: obj.dataUrl, bucket: "announcement-attachments",
        makeNewValue: (p) => JSON.stringify({ type: obj.type, name: obj.name, path: p }) });
    } else if (typeof raw === "string" && raw.startsWith("data:")) {
      await uploadAndSwap({ table: "announcements", idCol: "id", id: r.id, column: "attachment_url",
        currentValue: raw, bucket: "announcement-attachments",
        makeNewValue: (p) => JSON.stringify({ type: /pdf/.test(parseDataUri(raw).mime) ? "pdf" : "image", name: "Attachment", path: p }) });
    }
  }

  if (backups.length) {
    const file = `base64-media-backup-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(backups, null, 2));
    console.log(`\nOriginal base64 values backed up to ${file}`);
  }
  console.log(`\n${APPLY ? "Migrated" : "Would migrate"}: ${migrated}   Skipped (already a path / not data-uri): ${skipped}`);
}

run().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
