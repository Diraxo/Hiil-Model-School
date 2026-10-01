import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// Captures a DOM node exactly as it renders on screen and saves it as a downloaded PDF file —
// used by the Payslip and Cash Receipt Voucher "Download" buttons in place of window.print(),
// which only opens the browser's print dialog rather than actually downloading a file.
async function downloadElementAsPdf(element, filename) {
  if (!element) return;
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const imgData = canvas.toDataURL("image/png");
  const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
  doc.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  doc.save(filename);
}

// Captures a DOM node and saves it as a PDF page sized to true physical A4 (210×297mm), regardless
// of the capture resolution — unlike downloadElementAsPdf (unit "px"), which bakes html2canvas's
// pixel scale factor into the page's physical size, so opening/printing it at 100% comes out
// oversized. Only correct when `element` is itself laid out at the A4 aspect ratio (as the Report
// Card page is), since the captured image is stretched to exactly fill 210×297mm.
async function downloadElementAsA4Pdf(element, filename) {
  if (!element) return;
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const imgData = canvas.toDataURL("image/png");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.addImage(imgData, "PNG", 0, 0, 210, 297);
  doc.save(filename);
}

// Receipt voucher: the PDF page is the receipt's true physical size (CSS px @96dpi -> mm), not a
// px-unit page (which bakes html2canvas's 2x scale in) and not A4. The clone is laid out at the
// fixed print width so the download doesn't depend on how wide the modal happens to be.
const RECEIPT_WIDTH_PX = 736; // 720px voucher + 8px wrapper padding each side
const PX_TO_MM = 25.4 / 96;
async function downloadReceiptAsPdf(element, filename) {
  if (!element) return;
  const canvas = await html2canvas(element, {
    scale: 3,
    backgroundColor: "#ffffff",
    useCORS: true,
    windowWidth: 1200,
    onclone: (doc, el) => { el.style.width = `${RECEIPT_WIDTH_PX}px`; el.style.maxWidth = "none"; },
  });
  const wMm = (canvas.width / 3) * PX_TO_MM;
  const hMm = (canvas.height / 3) * PX_TO_MM;
  const doc = new jsPDF({ orientation: wMm >= hMm ? "landscape" : "portrait", unit: "mm", format: [wMm, hMm] });
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wMm, hMm);
  doc.save(filename);
}

export { downloadReceiptAsPdf, downloadElementAsPdf, downloadElementAsA4Pdf };
