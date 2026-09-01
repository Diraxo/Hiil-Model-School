// Phase 4 (Fees / Payments / Expenses): real Supabase-backed expense service.
//
// expenses.total_amount is derived by the recalc_expense_total() trigger from expense_items --
// the client never sends a total. Header + all line items are written in ONE transaction via
// SECURITY DEFINER RPCs, with recorded_by stamped from auth.uid() server-side:
//   create_expense(date, method, items, purchased_by, note, receipt_image_url, receipt_name, receipt_type)
//   update_expense(id, ...)      -- replaces header + full item set
//   delete_expense(id)           -- cascades expense_items
//
// Receipts live in the private `expense-receipts` bucket (20260902020000), path
// `<expense_id>/<filename>`, Owner/Finance only. receipt_image_url stores the object path;
// the UI reads a short-lived signed URL.
//
// RLS (20260825190000 L1283-1301): expenses / expense_items SELECT+INSERT+UPDATE+DELETE
// Owner/Finance. The RPCs re-check Owner/Finance internally.
import { supabase } from "../lib/supabaseClient";

const BUCKET = "expense-receipts";
const ts = (v) => (v ? new Date(v).getTime() : null);
const num = (v) => (v == null ? null : Number(v));

function inferType(name = "") {
  return /\.pdf$/i.test(name) ? "pdf" : "image";
}

function mapItem(r) {
  return {
    id: r.id,
    itemName: r.item_name,
    quantity: num(r.quantity) || 0,
    unitPrice: num(r.unit_price) || 0,
    lineTotal: num(r.line_total) || 0,
  };
}

function mapExpense(r) {
  return {
    id: r.id,
    expenseNo: r.expense_no,
    date: r.date,
    totalAmount: num(r.total_amount) || 0,
    method: r.method,
    purchasedBy: r.purchased_by || "",
    note: r.note || "",
    receiptStoragePath: r.receipt_image_url || null,
    receiptImage: null, // filled with a signed URL by DataContext
    receiptName: r.receipt_name || null,
    receiptType: r.receipt_type || null,
    recordedBy: r.recorded_by || null,
    createdAt: ts(r.created_at),
    items: (r.expense_items || []).map(mapItem).sort((a, b) => a.itemName.localeCompare(b.itemName)),
  };
}

const rpcItems = (items) =>
  (Array.isArray(items) ? items : []).map((it) => ({
    item_name: (it.itemName || "").trim(),
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unitPrice) || 0,
  }));

export function createExpenseService() {
  return {
    async list() {
      const { data, error } = await supabase
        .from("expenses")
        .select("*, expense_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapExpense);
    },

    async create({ date, method, purchasedBy, note, items, receiptImageUrl, receiptName, receiptType }) {
      const { data, error } = await supabase.rpc("create_expense", {
        p_date: date,
        p_method: (method || "").trim(),
        p_items: rpcItems(items),
        p_purchased_by: purchasedBy || null,
        p_note: note || null,
        p_receipt_image_url: receiptImageUrl || null,
        p_receipt_name: receiptName || null,
        p_receipt_type: receiptType || null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { id: row.id, expenseNo: row.expense_no };
    },

    async update(id, { date, method, purchasedBy, note, items, receiptImageUrl, receiptName, receiptType }) {
      const { error } = await supabase.rpc("update_expense", {
        p_id: id,
        p_date: date,
        p_method: (method || "").trim(),
        p_items: rpcItems(items),
        p_purchased_by: purchasedBy || null,
        p_note: note || null,
        p_receipt_image_url: receiptImageUrl || null,
        p_receipt_name: receiptName || null,
        p_receipt_type: receiptType || null,
      });
      if (error) throw error;
    },

    async remove(id) {
      const { error } = await supabase.rpc("delete_expense", { p_id: id });
      if (error) throw error;
    },

    /* ---------- receipt Storage ---------- */
    async uploadReceipt(expenseId, file) {
      const safe = (file.name || "receipt").replace(/[^\w.\- ]+/g, "_");
      const path = `${expenseId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      return { path, name: file.name || safe, type: inferType(file.name) };
    },
    async removeReceiptObject(path) {
      if (!path) return;
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) throw error;
    },
    async signedUrls(paths) {
      const map = new Map();
      const unique = [...new Set((paths || []).filter(Boolean))];
      await Promise.all(
        unique.map(async (p) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(p, 3600);
          if (data?.signedUrl) map.set(p, data.signedUrl);
        })
      );
      return map;
    },
  };
}
