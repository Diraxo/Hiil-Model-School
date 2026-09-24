// Runs the REAL resultEvidenceService against an in-memory fake of the Supabase client (table
// `result_evidence` + Storage bucket), so ordering / multi-page / removal behaviour is exercised
// through the actual service code. RLS and storage policies are database-side and are NOT covered here.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ rows: [], objects: new Set(), seq: 0, score: null }));

vi.mock("../src/lib/supabaseClient", () => {
  const table = () => {
    const filters = [];
    let op = "select";
    let payload = null;
    let single = false;
    const run = () => {
      const match = (r) => filters.every(([k, v]) => r[k] === v);
      if (op === "insert") {
        const row = { id: `e${++store.seq}`, uploaded_at: new Date().toISOString(), ...payload };
        store.rows.push(row);
        return { data: row, error: null };
      }
      if (op === "delete") {
        store.rows = store.rows.filter((r) => !match(r));
        return { data: null, error: null };
      }
      if (op === "update") {
        store.rows.filter(match).forEach((r) => Object.assign(r, payload));
        return { data: store.rows.find(match), error: null };
      }
      const data = store.rows.filter(match).sort((a, b) => a.page_order - b.page_order);
      return { data: single ? data[0] : data, error: null };
    };
    const q = {
      select() { return q; },
      insert(p) { op = "insert"; payload = p; return q; },
      update(p) { op = "update"; payload = p; return q; },
      delete() { op = "delete"; return q; },
      eq(k, v) { filters.push([k, v]); return q; },
      order() { return q; },
      single() { single = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return {
    supabase: {
      from: () => table(),
      storage: {
        from: () => ({
          upload: async (path) => { store.objects.add(path); return { error: null }; },
          remove: async (paths) => { paths.forEach((p) => store.objects.delete(p)); return { error: null }; },
          createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
        }),
      },
    },
  };
});

import { createResultEvidenceService, validateEvidenceFile, sanitizeEvidenceFileName } from "../src/services/resultEvidenceService";

const png = (name) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
let svc;
beforeEach(() => {
  store.rows = [];
  store.objects = new Set();
  store.seq = 0;
  svc = createResultEvidenceService();
});

const addN = async (n, resultId = "r1", assessmentId = "a1") => {
  for (let i = 1; i <= n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await svc.add({ resultId, assessmentId, file: png(`page-${i}.png`) });
  }
};

describe("multi-image Test evidence", () => {
  it("H: one image is stored, linked to the result + component", async () => {
    const row = await svc.add({ resultId: "r1", assessmentId: "a1", file: png("p1.png") });
    expect(row).toMatchObject({ resultId: "r1", assessmentId: "a1", order: 0, fileType: "image" });
    expect(store.objects.size).toBe(1);
    expect(store.objects.values().next().value.startsWith("r1/a1/")).toBe(true);
  });
  it("I/J/K: 2, 6 and 12 images all persist - there is no artificial page cap", async () => {
    for (const n of [2, 6, 12]) {
      store.rows = [];
      store.objects = new Set();
      // eslint-disable-next-line no-await-in-loop
      await addN(n);
      // eslint-disable-next-line no-await-in-loop
      const list = await svc.list();
      expect(list).toHaveLength(n);
      expect(store.objects.size).toBe(n);
    }
  });
  it("O: order is deterministic - pages come back 0..n-1 in the order they were added", async () => {
    await addN(6);
    const list = await svc.list();
    expect(list.map((e) => e.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(list.map((e) => e.fileName)).toEqual(["page-1.png", "page-2.png", "page-3.png", "page-4.png", "page-5.png", "page-6.png"]);
  });
  it("each component keeps its own pages (no cross-component/result mixing)", async () => {
    await addN(3, "r1", "a1");
    await addN(2, "r1", "a2");
    await addN(4, "r2", "a1");
    const list = await svc.list();
    const count = (r, a) => list.filter((e) => e.resultId === r && e.assessmentId === a).length;
    expect([count("r1", "a1"), count("r1", "a2"), count("r2", "a1")]).toEqual([3, 2, 4]);
  });
  it("removing one page keeps the others, and the next add continues after the highest order", async () => {
    await addN(3);
    const [, page2] = await svc.list();
    await svc.remove(page2);
    const left = await svc.list();
    expect(left.map((e) => e.fileName)).toEqual(["page-1.png", "page-3.png"]);
    expect(store.objects.size).toBe(2);
    const next = await svc.add({ resultId: "r1", assessmentId: "a1", file: png("page-4.png") });
    expect(next.order).toBe(3);
  });
  it("adding evidence never touches a score (evidence is its own table)", async () => {
    store.score = 15;
    await addN(6);
    expect(store.score).toBe(15);
  });
  it("rejects unsupported types and oversize files before any upload", async () => {
    expect(validateEvidenceFile(new File(["x"], "a.gif", { type: "image/gif" }))).toMatch(/Unsupported/);
    expect(validateEvidenceFile(null)).toMatch(/Choose a file/);
    const big = new File([new Uint8Array(1)], "b.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    expect(validateEvidenceFile(big)).toMatch(/too large/);
    await expect(svc.add({ resultId: "r1", assessmentId: "a1", file: new File(["x"], "a.gif", { type: "image/gif" }) })).rejects.toThrow(/Unsupported/);
    expect(store.objects.size).toBe(0);
  });
  it("object keys cannot escape the result folder", () => {
    expect(sanitizeEvidenceFileName("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeEvidenceFileName("a\\b\\c d.JPG")).toBe("c-d.jpg");
  });
  it("signedUrls maps every page path", async () => {
    await addN(2);
    const list = await svc.list();
    const urls = await svc.signedUrls(list.map((e) => e.storagePath));
    expect(urls.size).toBe(2);
  });
});
