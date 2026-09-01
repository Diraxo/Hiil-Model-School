import React, { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Logo, Modal } from "./ui";
import cashierSignatureSrc from "../assets/cashier-signature.png";
import { downloadElementAsPdf } from "../utils/pdf";
import { formatMoney } from "../utils/constants";

// Pre-cropped, background-removed cashier signature (src/assets/cashier-signature.png, generated
// from the original scan) — the real ink signature on a transparent background, never a typed
// name standing in for a signature.
function CashierSignatureImage({ height = 44, className = "" }) {
  return (
    <img
      src={cashierSignatureSrc}
      alt="Cashier's signature"
      className={`inline-block align-bottom object-contain pointer-events-none ${className}`}
      style={{ height }}
    />
  );
}

// Mirrors the school's real pre-printed cash receipt voucher pad (bilingual Amharic/English,
// 5 pre-printed payer/student lines, fixed payment-method checkboxes) — a batch of more than 5
// students just keeps numbering past 5 (6, 7, 8, ...) on the same voucher rather than paginating.
// Layout follows the physical pad exactly so a filled-in printout looks like a filled-in pad page.
const VOUCHER_METHODS = [
  { key: "Cash", am: "ካሽ", en: "Cash" },
  { key: "HelloCash", am: "ሄሎካሽ", en: "HelloCash" },
  { key: "E-birr", am: "ኢቢር", en: "E-birr" },
  { key: "Sahay", am: "ሰሃይ", en: "Sahay" },
  { key: "E-sahal", am: "ኢሳሃል", en: "E-sahal" },
  { key: "ACC/Bank", am: "አክ/ባንክ", en: "ACC/Bank" },
  { key: "Others", am: "አተረስ", en: "Others" },
];

function Blank({ value, className = "" }) {
  return <span className={`inline-block min-w-[2rem] border-b border-slate-900 px-1 align-bottom ${className}`}>{value || " "}</span>;
}

function Checkbox({ checked }) {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 border border-slate-900 shrink-0">
      {checked && <span className="w-2.5 h-2.5 bg-slate-900" />}
    </span>
  );
}

// `entries`: { name, grade, feeLines? } rows, one per student — padded to 5 blank pre-printed
// lines when there are fewer, but never truncated when there are more (row 6, 7, 8, ... just
// keep going). `grade` already reads like "Grade 1B" (class label), so it's printed as-is with
// no extra "Grade" caption in front of it. `feeLines` is that student's own non-bus fee lines
// (e.g. "School Fee – Installment 1") printed under their name so a receipt for several children
// shows exactly what each one paid for — kept separate from `busFeeLines` (the dedicated Bus Fee
// line below all the rows) and from the short, generic "Purpose of Payment" summary further down.
// `busFeeLines`: strings like "Ahmed Abdi Hassan — November 2025, December 2025" — one per
// student who actually paid a bus fee in this batch; omitted entirely for a batch with none.
// `method`: must match a VOUCHER_METHODS key to check the right box — anything else (a custom
// payment method added in Settings) checks "Others" and prints the real method name next to it,
// so no payment method is ever silently lost on paper.
function CashReceiptVoucher({
  receiptNo = "",
  date = "",
  entries = [],
  busFeeLines = [],
  purpose = "",
  amount = "",
  amountWords = "",
  method = "Cash",
  copyType = "customer",
  cashierName = "",
  pageLabel = null,
}) {
  const rows = entries.length >= 5 ? entries : [...entries, ...Array(5 - entries.length).fill({ name: "", grade: "", feeLines: [] })];
  const isKnownMethod = VOUCHER_METHODS.slice(0, -1).some((m) => m.key === method);

  return (
    <div className="bg-[#fdf9f0] text-slate-900 font-serif border border-slate-900 p-5 text-[13px] leading-tight max-w-[720px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <Logo size={64} />
        <div className="flex-1 text-center">
          <p className="text-base font-medium">ትልማን ሞደርን አካዳሚ</p>
          <p className="text-3xl font-bold -mt-1">Hiil Model School</p>
          <p className="text-sm mt-1">+251947555500/0947555566 &nbsp; Jigjiga, Ethiopia</p>
          <div className="flex items-center justify-center gap-2 text-sm mt-0.5">
            <span>Tin: 0065997758</span>
            <span className="text-right">
              <span className="block">የገንዘብ መቀቢያ ደረሰኝ</span>
              <span className="block font-semibold underline underline-offset-2">Cash Receipt Voucher</span>
            </span>
          </div>
        </div>
        <div className="text-right shrink-0 w-28">
          <p>ቀን <Blank value={date} className="min-w-[3.5rem]" /></p>
          <p className="font-medium">Date</p>
          <p className="text-xl font-bold mt-1">{receiptNo}</p>
          {pageLabel && <p className="text-[10px] text-slate-500 mt-0.5">{pageLabel}</p>}
        </div>
      </div>

      {/* Received From / student rows */}
      <div className="mt-3 space-y-1.5">
        {rows.map((row, i) => (
          <div key={i}>
            <div className="flex items-baseline gap-2">
              {i === 0 && <span className="shrink-0">የከፋይ ስም</span>}
              {i === 1 && <span className="shrink-0">Received From</span>}
              <span className="shrink-0">{i + 1}.</span>
              <Blank value={row.name} className="flex-1" />
              <Blank value={row.grade} className="w-20 shrink-0 ml-2" />
            </div>
            {row.feeLines && row.feeLines.length > 0 && (
              <div className="pl-5 mt-0.5 text-[11px] font-medium text-slate-700 leading-tight">
                {row.feeLines.map((line, j) => <p key={j}>{line}</p>)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bus fee detail — only the students who actually paid a bus fee this time */}
      {busFeeLines.length > 0 && (
        <div className="mt-2">
          <p className="leading-none">የአውቶብስ ክፍያ</p>
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 font-medium">Bus Fee</span>
            <div className="flex-1 text-sm font-semibold border-b border-slate-900 px-1">
              {busFeeLines.join(";  ")}
            </div>
          </div>
        </div>
      )}

      {/* Purpose of payment */}
      <div className="mt-2">
        <p className="leading-none">የከፈሰበት ምክንያት</p>
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 font-medium">Purpose of Payment</span>
          <Blank value={purpose} className="flex-1 text-sm font-semibold" />
        </div>
      </div>

      {/* Cash amount */}
      <div className="mt-3 flex items-center gap-3">
        <div>
          <p className="leading-none">የገንዘብ</p>
          <p className="font-medium">Cash</p>
        </div>
        <div className="border border-slate-900 flex-1 h-10 flex items-center px-2">
          <span className="text-[10px] leading-none mr-2">ብር<br />Birr</span>
          <span className="text-lg font-semibold">{amount}</span>
        </div>
      </div>

      {/* Amount in words */}
      <div className="mt-2">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0">የገንዘቡ ልክ በቃላት</span>
          <Blank value="" className="flex-1" />
        </div>
        <p className="leading-none mt-0.5">Amount in words</p>
        <Blank value={amountWords} className="block w-full mt-1" />
      </div>

      {/* Method of payment */}
      <div className="mt-3 pt-2 border-t border-slate-900">
        <div className="flex items-start gap-1 mb-1">
          <span className="text-[11px]">የክፍያው ሁኔታ<br /><span className="font-medium not-italic text-[13px]">Method of Payment</span></span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-1">
          {VOUCHER_METHODS.map((m) => (
            <span key={m.key} className="inline-flex items-center gap-1.5">
              <Checkbox checked={m.key === "Others" ? !isKnownMethod : method === m.key} />
              <span className="leading-none">
                <span className="block text-[10px]">{m.am}</span>
                <span className="block text-[12px]">{m.en}{m.key === "Others" && !isKnownMethod && method ? `: ${method}` : ""}</span>
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-slate-900 flex items-end justify-between gap-4 text-[12px]">
        <div className="flex gap-6">
          <p className={copyType === "customer" ? "font-bold" : ""}>1ኛ ኮፒ-ለከፋይ<br />1<sup>st</sup> Copy Customer</p>
          <p className={copyType === "paid" ? "font-bold" : ""}>2ኛ ኮፒ-ለጥራዝ<br />2<sup>nd</sup> Copy Paid</p>
        </div>
        <div className="text-right">
          <p className="leading-none">የገንዘብ ተቀባይ ፊርማ</p>
          <p className="font-medium leading-none mt-0.5">Cashier's Signature</p>
          <div className="flex justify-end mt-1">
            <CashierSignatureImage height={44} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Print-ready wrapper — same open/close/print convention as ReportCardModal so both documents
// behave identically from the user's point of view. `pages` (optional): [{entries, busFeeLines,
// purpose, amount, amountWords}] — normally just one page, since CashReceiptVoucher itself has
// no row cap; kept as an array/pageLabel mechanism in case a future caller ever needs to split a
// batch across several printed vouchers sharing one receiptNo. Without `pages`, falls back to
// rendering the other props as a single voucher (legacy usage).
function CashReceiptModal({ open, onClose, pages, voidedLines = [], allVoided = false, ...voucherProps }) {
  const list = pages && pages.length > 0 ? pages : [{ entries: voucherProps.entries, busFeeLines: voucherProps.busFeeLines, purpose: voucherProps.purpose, amount: voucherProps.amount, amountWords: voucherProps.amountWords }];
  const printRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(printRef.current, `Receipt-${voucherProps.receiptNo || "voucher"}.pdf`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Cash Receipt Voucher — ${voucherProps.receiptNo || ""}`} wide>
      {/* Blocker 4: the printed voucher below is never rewritten — it's the historical record of
          what was actually collected. A void is a separate correction event, surfaced here instead
          of baked into the facsimile, and only the specific line(s) actually voided are listed
          (a void is per payment row, so one receipt can be partially voided). */}
      {voidedLines.length > 0 && (
        <div className={`no-print mb-4 rounded-lg border px-4 py-3 text-sm ${allVoided ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
          <p className={`font-semibold ${allVoided ? "text-red-700" : "text-amber-800"}`}>
            {allVoided ? "This receipt has been VOIDED" : "This receipt includes voided line(s)"}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {voidedLines.map((v, i) => (
              <li key={i} className="text-xs text-slate-700">
                <span className="font-medium">{v.studentName} — {v.description}</span> ({formatMoney(v.amount)}) — voided {new Date(v.voidedAt).toLocaleString()} by {v.voidedBy}
                {v.voidReason ? `: "${v.voidReason}"` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="receipt-print bg-white p-2 space-y-6" ref={printRef}>
        {allVoided && (
          <div className="flex items-center justify-center">
            <span className="text-4xl font-extrabold tracking-widest text-red-600/70 border-4 border-red-600/70 rounded-lg px-6 py-1 -rotate-6 select-none">VOID</span>
          </div>
        )}
        {list.map((page, i) => (
          <CashReceiptVoucher
            key={i}
            {...voucherProps}
            entries={page.entries}
            busFeeLines={page.busFeeLines}
            purpose={page.purpose}
            amount={page.amount}
            amountWords={page.amountWords}
            pageLabel={list.length > 1 ? `Page ${i + 1} of ${list.length}` : null}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-4 no-print">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
        <button onClick={handleDownload} disabled={downloading} className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-60">
          <Printer size={15} /> {downloading ? "Preparing…" : "Download Receipt"}
        </button>
      </div>
    </Modal>
  );
}

export { CashReceiptVoucher, CashReceiptModal };
