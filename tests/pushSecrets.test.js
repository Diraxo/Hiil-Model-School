// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "test-artifacts"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("Firebase / FCM secret hygiene", () => {
  it("no browser-shipped source (src/, public/, index.html) contains any server credential", () => {
    const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "public")), path.join(ROOT, "index.html")];
    for (const f of files) {
      if (!/\.(js|jsx|ts|tsx|html|json|webmanifest|css)$/.test(f)) continue;
      const txt = fs.readFileSync(f, "utf8");
      expect(txt, f).not.toMatch(/BEGIN (RSA )?PRIVATE KEY|"private_key"|client_email|firebase-adminsdk|FCM_SERVICE_ACCOUNT|PUSH_WEBHOOK_SECRET/);
    }
  });

  it("only PUBLIC Firebase values use the VITE_ prefix (nothing private/secret can reach the bundle)", () => {
    for (const f of [".env.example", ...walk(path.join(ROOT, "src")).map((p) => path.relative(ROOT, p))]) {
      const names = read(f).match(/VITE_[A-Z0-9_]+/g) || [];
      for (const n of names) expect(n, `${f}: ${n}`).not.toMatch(/PRIVATE|SERVICE_ACCOUNT|SERVICE_ROLE|SECRET|ADMIN|VAPID_PRIVATE/);
    }
  });

  it("the service-account JSON is git-ignored and untracked", () => {
    const probe = "hiil-model-school-firebase-adminsdk-fbsvc-abc123.json";
    const ignored = execFileSync("git", ["check-ignore", "-q", probe], { cwd: ROOT, stdio: "pipe" });
    expect(ignored).toBeDefined(); // exit 0 => ignored (execFileSync throws otherwise)
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT }).toString().split("\n");
    expect(tracked.filter((f) => /adminsdk|service-account/i.test(f))).toEqual([]);
  });

  it("the Edge Function reads credentials only from secrets and never logs them", () => {
    const idx = read("supabase", "functions", "push-fanout", "index.ts");
    expect(idx).toMatch(/Deno\.env\.get\("FCM_SERVICE_ACCOUNT"\)/);
    expect(idx).toMatch(/Deno\.env\.get\("PUSH_WEBHOOK_SECRET"\)/);
    expect(idx).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
    // logs are fixed strings + counters: no interpolated secret/token value and no raw error message
    for (const line of idx.split("\n").filter((l) => /console\.(log|error)\(/.test(l))) {
      expect(line).not.toMatch(/\$\{[^}]*(private_key|bearer|secret|token|service)/i);
      expect(line).not.toMatch(/\b(e|err|error)\.message\b/);
    }
    expect(idx).not.toMatch(/fcm\.googleapis\.com\/fcm\/send|legacy/i); // HTTP v1 only
    expect(idx).toMatch(/fcm\.googleapis\.com\/v1\/projects/);
  });

  it("the Firebase SDK is limited to Cloud Messaging (no Auth/Firestore/Analytics/Storage imports)", () => {
    const bad = [];
    for (const f of walk(path.join(ROOT, "src"))) {
      const txt = fs.readFileSync(f, "utf8");
      if (/firebase\/(auth|firestore|database|storage|analytics)/.test(txt)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
