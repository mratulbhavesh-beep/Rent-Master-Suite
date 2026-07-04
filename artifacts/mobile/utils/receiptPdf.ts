import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { Platform, Alert } from "react-native";
import { fmtDate } from "./dateFormat";

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC PDF OPERATIONS
// These are the single source of truth for Download / Print / Share behaviour.
// Every screen in the app should use these (or the receipt-specific wrappers).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open the native system print dialog (Android/iOS) or browser print dialog (web).
 * This is always the correct behaviour for a Print button — no platform guard needed.
 */
export async function printPDF(html: string): Promise<void> {
  await Print.printAsync({ html });
}

/**
 * Save the HTML as a PDF file to the device.
 *
 * • Web  → shows "PDF download is available in the Android app." and returns.
 *          Does NOT open the print dialog.
 * • Android native → prompts the user to pick a folder, then saves the PDF there.
 * • iOS native → saves to the Files app (app Documents directory).
 */
export async function downloadPDF(html: string, fileName: string): Promise<void> {
  if (Platform.OS === "web") {
    Alert.alert(
      "Download Unavailable",
      "PDF download is available in the Android app."
    );
    return;
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const tempFile = new FileSystem.File(uri);

  if (Platform.OS === "android") {
    const pickedDir = await FileSystem.Directory.pickDirectoryAsync();
    if (!pickedDir) return; // user cancelled the folder picker — silently abort
    const bytes = await tempFile.bytes();
    const destFile = pickedDir.createFile(fileName, "application/pdf");
    destFile.write(bytes);
    Alert.alert("Downloaded", `"${fileName}" saved to your selected folder.`);
  } else {
    // iOS — copy to app's Documents directory
    const destFile = new FileSystem.File(FileSystem.Paths.document, fileName);
    await tempFile.copy(destFile);
    Alert.alert(
      "Saved",
      `"${fileName}" saved to the Files app. You can access it from Files → On My iPhone.`
    );
  }
}

/**
 * Share the HTML as a PDF using the native share sheet.
 *
 * • Web  → shows "PDF sharing is available in the Android app." and returns.
 * • Native → generates a temp PDF and opens the OS share dialog.
 */
export async function sharePDF(html: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === "web") {
    Alert.alert(
      "Share Unavailable",
      "PDF sharing is available in the Android app."
    );
    return;
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert("Not Available", "Sharing is not available on this device.");
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle,
    UTI: "com.adobe.pdf",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RECEIPT HTML BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function qrPlaceholder(receiptNo: string): string {
  const cell = (dark: boolean) =>
    `<td style="width:5px;height:5px;background:${dark ? "#1B4F8A" : "#f1f5f9"};"></td>`;
  const rows = [
    [1,1,1,1,1,1,1,0,0],
    [1,0,0,0,0,0,1,0,1],
    [1,0,1,1,1,0,1,0,0],
    [1,0,1,1,1,0,1,0,1],
    [1,0,1,1,1,0,1,0,0],
    [1,0,0,0,0,0,1,0,1],
    [1,1,1,1,1,1,1,0,1],
    [0,0,0,0,0,0,0,0,0],
    [1,0,1,1,0,1,0,1,1],
  ];
  const tableRows = rows
    .map(r => `<tr>${r.map(v => cell(v === 1)).join("")}</tr>`)
    .join("");
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <table style="border-collapse:collapse;border-spacing:0;">${tableRows}</table>
      <div style="font-size:9px;color:#64748b;letter-spacing:0.5px;text-align:center;">SCAN TO VERIFY</div>
      <div style="font-size:8px;color:#94a3b8;font-family:monospace;">${receiptNo}</div>
    </div>`;
}

export function buildReceiptHTML(
  payment: any,
  tenantRentAmount: number,
  businessName: string,
  ownerName: string
): string {
  const paid = parseFloat(String(payment.amount ?? 0));
  const rent = tenantRentAmount;
  const diff = paid - rent;
  const isAdvance = rent > 0 && diff > 0;
  const isDue = rent > 0 && diff < 0;

  const advanceColor = isAdvance ? "#16a34a" : isDue ? "#dc2626" : "#16a34a";
  const advanceBg = isAdvance ? "#f0fdf4" : isDue ? "#fef2f2" : "#f0fdf4";
  const advanceBorder = isAdvance ? "#bbf7d0" : isDue ? "#fecaca" : "#bbf7d0";
  const advanceLabel = isAdvance
    ? `Advance: ₹${Math.abs(diff).toLocaleString("en-IN")}`
    : isDue
    ? `Balance Due: ₹${Math.abs(diff).toLocaleString("en-IN")}`
    : "Fully Settled ✓";

  const statusColor =
    payment.status === "paid" ? "#16a34a" : payment.status === "partial" ? "#d97706" : "#dc2626";
  const statusBg =
    payment.status === "paid" ? "#f0fdf4" : payment.status === "partial" ? "#fffbeb" : "#fef2f2";

  const dateStr = fmtDate(payment.paymentDate);
  const monthLabel = new Date(payment.year, payment.month - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
  const methodLabel = (payment.method ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
  const receiptNo = getReceiptNo(payment);
  const initials = businessName
    .split(" ").map((w: string) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "GR";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rent Receipt – ${receiptNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,'Segoe UI',Arial,sans-serif; background:#f1f5f9; display:flex; justify-content:center; align-items:flex-start; min-height:100vh; padding:28px 16px; }
  .page { width:100%; max-width:520px; }
  .letterhead { background:linear-gradient(135deg,#1B4F8A 0%,#0f3460 100%); border-radius:18px 18px 0 0; padding:28px 28px 20px; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .biz-left { display:flex; align-items:center; gap:14px; }
  .logo-circle { width:52px; height:52px; border-radius:14px; background:rgba(255,255,255,0.18); border:2px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:900; color:#fff; flex-shrink:0; }
  .biz-name { font-size:16px; font-weight:800; color:#fff; line-height:1.2; }
  .biz-sub { font-size:11px; color:rgba(255,255,255,0.65); margin-top:3px; }
  .receipt-badge { text-align:right; flex-shrink:0; }
  .receipt-title { font-size:10px; font-weight:800; color:rgba(255,255,255,0.7); letter-spacing:2px; text-transform:uppercase; }
  .receipt-no { font-size:13px; font-weight:700; color:#fff; font-family:'Courier New',monospace; margin-top:4px; background:rgba(255,255,255,0.12); padding:4px 10px; border-radius:6px; }
  .receipt-date { font-size:11px; color:rgba(255,255,255,0.6); margin-top:5px; }
  .card { background:#fff; border-radius:0 0 18px 18px; border:1px solid #e2e8f0; border-top:none; padding:0 0 24px; overflow:hidden; }
  .amount-hero { background:linear-gradient(180deg,#f8fafc 0%,#fff 100%); padding:28px 28px 20px; text-align:center; border-bottom:1px dashed #cbd5e1; }
  .status-pill { display:inline-block; padding:4px 14px; border-radius:20px; font-size:10px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; background:${statusBg}; color:${statusColor}; border:1px solid ${statusColor}40; margin-bottom:10px; }
  .amount-big { font-size:48px; font-weight:900; color:#0f172a; line-height:1; letter-spacing:-2px; }
  .amount-label { font-size:13px; color:#64748b; margin-top:5px; }
  .bill-to { padding:18px 28px 0; }
  .bill-to-label { font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px; }
  .tenant-name { font-size:17px; font-weight:800; color:#0f172a; }
  .tenant-sub { font-size:13px; color:#475569; margin-top:3px; }
  .details { padding:18px 28px 0; }
  .section-label { font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:10px; }
  .detail-row { display:flex; justify-content:space-between; align-items:flex-start; padding:9px 0; border-bottom:1px solid #f1f5f9; }
  .detail-row:last-child { border-bottom:none; }
  .detail-label { font-size:13px; color:#64748b; font-weight:500; }
  .detail-value { font-size:13px; color:#0f172a; font-weight:700; text-align:right; max-width:55%; }
  .mono { font-family:'Courier New',monospace; font-size:12px; color:#1B4F8A; }
  .balance-box { margin:18px 28px 0; background:${advanceBg}; border:1.5px solid ${advanceBorder}; border-radius:12px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; }
  .balance-left { font-size:12px; color:#64748b; font-weight:600; }
  .balance-right { font-size:15px; font-weight:800; color:${advanceColor}; }
  .dashed { border-top:1.5px dashed #cbd5e1; margin:22px 28px; }
  .bottom-row { padding:0 28px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px; }
  .sig-block { flex:1; }
  .sig-area { height:52px; border-bottom:1.5px solid #cbd5e1; margin-bottom:8px; }
  .sig-name { font-size:13px; font-weight:700; color:#0f172a; }
  .sig-title { font-size:11px; color:#94a3b8; margin-top:2px; }
  .sig-label { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
  .qr-block { flex-shrink:0; text-align:center; }
  .footer { text-align:center; padding:18px 28px 4px; }
  .footer-main { font-size:12px; color:#475569; font-weight:600; margin-bottom:4px; }
  .footer-sub { font-size:10px; color:#94a3b8; }
  .footer-brand { margin-top:14px; padding-top:12px; border-top:1px solid #f1f5f9; font-size:10px; color:#cbd5e1; letter-spacing:1.5px; text-transform:uppercase; }
  @media print { body { background:#fff; padding:0; } .letterhead { border-radius:0; } .card { border-radius:0; } }
</style>
</head>
<body>
<div class="page">
  <div class="letterhead">
    <div class="biz-left">
      <div class="logo-circle">${initials}</div>
      <div><div class="biz-name">${businessName}</div><div class="biz-sub">Property Management</div></div>
    </div>
    <div class="receipt-badge">
      <div class="receipt-title">Rent Receipt</div>
      <div class="receipt-no">${receiptNo}</div>
      <div class="receipt-date">${dateStr}</div>
    </div>
  </div>
  <div class="card">
    <div class="amount-hero">
      <div class="status-pill">${(payment.status ?? "paid").toUpperCase()}</div>
      <div class="amount-big">₹${paid.toLocaleString("en-IN")}</div>
      <div class="amount-label">Rent for ${monthLabel}</div>
    </div>
    <div class="bill-to">
      <div class="bill-to-label">Billed To</div>
      <div class="tenant-name">${payment.tenantName ?? "—"}</div>
      <div class="tenant-sub">${payment.propertyName ?? ""}${payment.unitNumber ? ` · Unit ${payment.unitNumber}` : ""}</div>
    </div>
    <div class="details">
      <div style="margin-top:18px;"></div>
      <div class="section-label">Payment Details</div>
      <div class="detail-row"><span class="detail-label">Receipt Number</span><span class="detail-value mono">${receiptNo}</span></div>
      <div class="detail-row"><span class="detail-label">Payment Date</span><span class="detail-value">${dateStr}</span></div>
      <div class="detail-row"><span class="detail-label">Rent Period</span><span class="detail-value">${monthLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Payment Mode</span><span class="detail-value">${methodLabel}</span></div>
      ${rent > 0 ? `<div class="detail-row"><span class="detail-label">Monthly Rent</span><span class="detail-value">₹${rent.toLocaleString("en-IN")}</span></div>` : ""}
      ${payment.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${payment.notes}</span></div>` : ""}
    </div>
    ${rent > 0 ? `<div class="balance-box"><span class="balance-left">Balance After This Payment</span><span class="balance-right">${advanceLabel}</span></div>` : ""}
    <div class="dashed"></div>
    <div class="bottom-row">
      <div class="sig-block">
        <div class="sig-label">Authorized Signature</div>
        <div class="sig-area"></div>
        <div class="sig-name">${ownerName}</div>
        <div class="sig-title">Property Owner / Manager</div>
      </div>
      <div class="qr-block">${qrPlaceholder(receiptNo)}</div>
    </div>
    <div class="footer">
      <div class="footer-main">Thank you for your payment!</div>
      <div class="footer-sub">Please retain this receipt for your records.</div>
      <div class="footer-brand">Generated by Gemini Rent Manager</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

export function getReceiptNo(payment: any): string {
  return payment.receiptNumber || `RCP-${String(payment.id).padStart(6, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECEIPT-SPECIFIC WRAPPERS
// Thin wrappers that derive the correct filename / dialog title and delegate
// to the generic functions above.
// ─────────────────────────────────────────────────────────────────────────────

export async function printReceiptPDF(html: string): Promise<void> {
  return printPDF(html);
}

export async function downloadReceiptPDF(
  html: string,
  receiptNo: string
): Promise<void> {
  return downloadPDF(html, `Receipt-${receiptNo}.pdf`);
}

export async function shareReceiptPDF(
  html: string,
  receiptNo: string
): Promise<void> {
  return sharePDF(html, `Share Receipt – ${receiptNo}`);
}
