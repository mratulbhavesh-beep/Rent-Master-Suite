import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useGetPayment,
  getGetPaymentQueryKey,
  useGetTenant,
  getGetTenantQueryKey,
  useDeletePayment,
  getListPaymentsQueryKey,
  getGetDashboardSummaryQueryKey,
  getListTenantsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

// ─── QR code placeholder rendered in CSS (future-ready) ─────────────────────
function qrPlaceholder(receiptNo: string): string {
  const cell = (dark: boolean) =>
    `<td style="width:5px;height:5px;background:${dark ? "#1B4F8A" : "#f1f5f9"};"></td>`;
  // 9×9 pattern that looks like a QR code corner
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
  const tableRows = rows.map(r =>
    `<tr>${r.map(v => cell(v === 1)).join("")}</tr>`
  ).join("");
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <table style="border-collapse:collapse;border-spacing:0;">${tableRows}</table>
      <div style="font-size:9px;color:#64748b;letter-spacing:0.5px;text-align:center;">
        SCAN TO VERIFY
      </div>
      <div style="font-size:8px;color:#94a3b8;font-family:monospace;">${receiptNo}</div>
    </div>`;
}

// ─── Professional HTML receipt template ─────────────────────────────────────
function buildReceiptHTML(
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
  const isSettled = rent > 0 && diff === 0;

  const advanceDueColor = isAdvance ? "#16a34a" : isDue ? "#dc2626" : "#16a34a";
  const advanceDueBg = isAdvance ? "#f0fdf4" : isDue ? "#fef2f2" : "#f0fdf4";
  const advanceDueBorder = isAdvance ? "#bbf7d0" : isDue ? "#fecaca" : "#bbf7d0";
  const advanceDueLabel = isAdvance
    ? `Advance: ₹${Math.abs(diff).toLocaleString("en-IN")}`
    : isDue
    ? `Balance Due: ₹${Math.abs(diff).toLocaleString("en-IN")}`
    : "Fully Settled ✓";

  const statusColor =
    payment.status === "paid" ? "#16a34a" : payment.status === "partial" ? "#d97706" : "#dc2626";
  const statusBg =
    payment.status === "paid" ? "#f0fdf4" : payment.status === "partial" ? "#fffbeb" : "#fef2f2";

  const dateStr = new Date(payment.paymentDate).toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const monthLabel = new Date(payment.year, payment.month - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
  const methodLabel = (payment.method ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const receiptNo = payment.receiptNumber || `RCP-${String(payment.id).padStart(6, "0")}`;
  const businessInitials = businessName
    .split(" ").map((w: string) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "GR";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rent Receipt – ${receiptNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
    background: #f1f5f9;
    display: flex; justify-content: center; align-items: flex-start;
    min-height: 100vh; padding: 28px 16px;
  }
  .page { width: 100%; max-width: 520px; }

  /* ── Letterhead ── */
  .letterhead {
    background: linear-gradient(135deg, #1B4F8A 0%, #0f3460 100%);
    border-radius: 18px 18px 0 0;
    padding: 28px 28px 20px;
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  }
  .biz-left { display: flex; align-items: center; gap: 14px; }
  .logo-circle {
    width: 52px; height: 52px; border-radius: 14px;
    background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 900; color: #fff; letter-spacing: -1px;
    flex-shrink: 0;
  }
  .biz-name { font-size: 16px; font-weight: 800; color: #fff; line-height: 1.2; }
  .biz-sub { font-size: 11px; color: rgba(255,255,255,0.65); margin-top: 3px; letter-spacing: 0.3px; }
  .receipt-badge { text-align: right; flex-shrink: 0; }
  .receipt-title {
    font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.7);
    letter-spacing: 2px; text-transform: uppercase;
  }
  .receipt-no {
    font-size: 13px; font-weight: 700; color: #fff;
    font-family: 'Courier New', monospace; margin-top: 4px;
    background: rgba(255,255,255,0.12); padding: 4px 10px; border-radius: 6px;
  }
  .receipt-date { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 5px; }

  /* ── Body card ── */
  .card {
    background: #fff; border-radius: 0 0 18px 18px;
    border: 1px solid #e2e8f0; border-top: none;
    padding: 0 0 24px; overflow: hidden;
  }

  /* ── Amount hero ── */
  .amount-hero {
    background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
    padding: 28px 28px 20px; text-align: center;
    border-bottom: 1px dashed #cbd5e1;
  }
  .status-pill {
    display: inline-block; padding: 4px 14px; border-radius: 20px;
    font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;
    background: ${statusBg}; color: ${statusColor};
    border: 1px solid ${statusColor}40; margin-bottom: 10px;
  }
  .amount-big { font-size: 48px; font-weight: 900; color: #0f172a; line-height: 1; letter-spacing: -2px; }
  .amount-label { font-size: 13px; color: #64748b; margin-top: 5px; }

  /* ── Bill To ── */
  .bill-to { padding: 18px 28px 0; }
  .bill-to-label {
    font-size: 10px; font-weight: 700; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;
  }
  .tenant-name { font-size: 17px; font-weight: 800; color: #0f172a; }
  .tenant-sub { font-size: 13px; color: #475569; margin-top: 3px; }

  /* ── Details table ── */
  .details { padding: 18px 28px 0; }
  .section-label {
    font-size: 10px; font-weight: 700; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px;
  }
  .detail-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 9px 0; border-bottom: 1px solid #f1f5f9;
  }
  .detail-row:last-child { border-bottom: none; }
  .detail-label { font-size: 13px; color: #64748b; font-weight: 500; }
  .detail-value { font-size: 13px; color: #0f172a; font-weight: 700; text-align: right; max-width: 55%; }
  .mono { font-family: 'Courier New', monospace; font-size: 12px; color: #1B4F8A; }

  /* ── Advance / Due ── */
  .balance-box {
    margin: 18px 28px 0;
    background: ${advanceDueBg};
    border: 1.5px solid ${advanceDueBorder};
    border-radius: 12px;
    padding: 14px 18px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .balance-left { font-size: 12px; color: #64748b; font-weight: 600; }
  .balance-right { font-size: 15px; font-weight: 800; color: ${advanceDueColor}; }

  /* ── Separator ── */
  .dashed { border-top: 1.5px dashed #cbd5e1; margin: 22px 28px; }

  /* ── Signature & QR ── */
  .bottom-row { padding: 0 28px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .sig-block { flex: 1; }
  .sig-area { height: 52px; border-bottom: 1.5px solid #cbd5e1; margin-bottom: 8px; }
  .sig-name { font-size: 13px; font-weight: 700; color: #0f172a; }
  .sig-title { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .sig-label {
    font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .qr-block { flex-shrink: 0; text-align: center; }

  /* ── Footer ── */
  .footer { text-align: center; padding: 18px 28px 4px; }
  .footer-main { font-size: 12px; color: #475569; font-weight: 600; margin-bottom: 4px; }
  .footer-sub { font-size: 10px; color: #94a3b8; letter-spacing: 0.5px; }
  .footer-brand {
    margin-top: 14px; padding-top: 12px; border-top: 1px solid #f1f5f9;
    font-size: 10px; color: #cbd5e1; letter-spacing: 1.5px; text-transform: uppercase;
  }

  @media print {
    body { background: #fff; padding: 0; }
    .page { max-width: 100%; }
    .letterhead { border-radius: 0; }
    .card { border-radius: 0; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Letterhead -->
  <div class="letterhead">
    <div class="biz-left">
      <div class="logo-circle">${businessInitials}</div>
      <div>
        <div class="biz-name">${businessName}</div>
        <div class="biz-sub">Property Management</div>
      </div>
    </div>
    <div class="receipt-badge">
      <div class="receipt-title">Rent Receipt</div>
      <div class="receipt-no">${receiptNo}</div>
      <div class="receipt-date">${dateStr}</div>
    </div>
  </div>

  <!-- Card body -->
  <div class="card">

    <!-- Amount hero -->
    <div class="amount-hero">
      <div class="status-pill">${payment.status?.toUpperCase() ?? "PAID"}</div>
      <div class="amount-big">₹${paid.toLocaleString("en-IN")}</div>
      <div class="amount-label">Rent for ${monthLabel}</div>
    </div>

    <!-- Bill To -->
    <div class="bill-to">
      <div class="bill-to-label">Billed To</div>
      <div class="tenant-name">${payment.tenantName ?? "—"}</div>
      <div class="tenant-sub">
        ${payment.propertyName ?? ""}${payment.unitNumber ? ` · Unit ${payment.unitNumber}` : ""}
      </div>
    </div>

    <!-- Details -->
    <div class="details">
      <div style="margin-top:18px;"></div>
      <div class="section-label">Payment Details</div>
      <div class="detail-row">
        <span class="detail-label">Receipt Number</span>
        <span class="detail-value mono">${receiptNo}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Payment Date</span>
        <span class="detail-value">${dateStr}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Rent Period</span>
        <span class="detail-value">${monthLabel}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Payment Mode</span>
        <span class="detail-value">${methodLabel}</span>
      </div>
      ${rent > 0 ? `<div class="detail-row">
        <span class="detail-label">Monthly Rent</span>
        <span class="detail-value">₹${rent.toLocaleString("en-IN")}</span>
      </div>` : ""}
      ${payment.notes ? `<div class="detail-row">
        <span class="detail-label">Notes</span>
        <span class="detail-value">${payment.notes}</span>
      </div>` : ""}
    </div>

    <!-- Advance / Due -->
    ${rent > 0 ? `<div class="balance-box">
      <span class="balance-left">Balance After This Payment</span>
      <span class="balance-right">${advanceDueLabel}</span>
    </div>` : ""}

    <div class="dashed"></div>

    <!-- Signature + QR -->
    <div class="bottom-row">
      <div class="sig-block">
        <div class="sig-label">Authorized Signature</div>
        <div class="sig-area"></div>
        <div class="sig-name">${ownerName}</div>
        <div class="sig-title">Property Owner / Manager</div>
      </div>
      <div class="qr-block">
        ${qrPlaceholder(receiptNo)}
      </div>
    </div>

    <!-- Footer -->
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

// ─── Screen ────────────────────────────────────────────────────────────────
export default function PaymentReceiptScreen() {
  const { id } = useLocalSearchParams();
  const paymentId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [printLoading, setPrintLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  const queryClient = useQueryClient();
  const deleteMutation = useDeletePayment();

  const { data: payment, isLoading } = useGetPayment(paymentId, {
    query: { queryKey: getGetPaymentQueryKey(paymentId), enabled: !!paymentId },
  });

  const { data: tenantData } = useGetTenant(payment?.tenantId ?? 0, {
    query: {
      queryKey: getGetTenantQueryKey(payment?.tenantId ?? 0),
      enabled: !!payment?.tenantId,
    },
  });

  const tenantRentAmount = parseFloat(String((tenantData as any)?.rentAmount ?? 0));
  const paidAmount = parseFloat(String(payment?.amount ?? 0));
  const balanceDiff = tenantRentAmount > 0 ? paidAmount - tenantRentAmount : 0;
  const isAdvance = balanceDiff > 0;
  const isDue = balanceDiff < 0;

  const businessName = (user as any)?.company?.trim() || (user as any)?.name || "Gemini Rent Manager";
  const ownerName = (user as any)?.name || "Property Manager";

  const getReceiptHTML = () =>
    buildReceiptHTML(payment, tenantRentAmount, businessName, ownerName);

  // ── Print
  const handlePrint = async () => {
    if (!payment) return;
    setPrintLoading(true);
    try {
      await Print.printAsync({ html: getReceiptHTML() });
    } catch {
      Alert.alert("Error", "Could not open print dialog.");
    } finally {
      setPrintLoading(false);
    }
  };

  // ── Download PDF
  const handleDownload = async () => {
    if (!payment) return;
    setDownloadLoading(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: getReceiptHTML(), base64: false });
      const receiptNo = payment.receiptNumber || `RCP-${String(payment.id).padStart(6, "0")}`;
      const fileName = `Receipt-${receiptNo}.pdf`;

      if (Platform.OS === "android") {
        const pickedDir = await FileSystem.Directory.pickDirectoryAsync();
        if (!pickedDir) {
          setDownloadLoading(false);
          return;
        }
        const tempFile = new FileSystem.File(uri);
        const destFile = new FileSystem.File(pickedDir, fileName);
        const bytes = await tempFile.bytes();
        destFile.write(bytes);
        Alert.alert("Downloaded", `Receipt saved as "${fileName}"`);
      } else {
        const destFile = new FileSystem.File(FileSystem.Paths.document, fileName);
        const tempFile = new FileSystem.File(uri);
        const bytes = await tempFile.bytes();
        destFile.write(bytes);
        Alert.alert("Saved", `Receipt saved to Files app as "${fileName}"`);
      }
    } catch (err: any) {
      Alert.alert("Download Failed", err?.message ?? "Could not save the PDF.");
    } finally {
      setDownloadLoading(false);
    }
  };

  // ── Share PDF
  const handleShare = async () => {
    if (!payment) return;
    setShareLoading(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: getReceiptHTML(), base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Share Rent Receipt",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Not Available", "Sharing is not available on this device.");
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not share receipt.");
    } finally {
      setShareLoading(false);
    }
  };

  // ── Delete
  const handleDeletePayment = () => {
    if (!payment) return;
    const msg = `Delete this payment of ₹${Number(payment.amount).toLocaleString("en-IN")}? This cannot be undone.`;
    Alert.alert("Delete Payment", msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          deleteMutation.mutate(
            { id: payment.id },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
                queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
                queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
                if (payment.tenantId) {
                  queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(payment.tenantId) });
                }
                router.back();
              },
              onError: (err: any) =>
                Alert.alert("Error", err?.response?.data?.error || "Failed to delete payment"),
            }
          ),
      },
    ]);
  };

  // ─── Loading state ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!payment) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={48} color={colors.mutedForeground} />
        <Text style={[styles.notFoundText, { color: colors.mutedForeground }]}>Payment not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Derived display values ─────────────────────────────────────────────
  const dateStr = new Date(payment.paymentDate).toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const monthLabel = new Date(payment.year, payment.month - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
  const methodLabel = (payment.method ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
  const receiptNo = payment.receiptNumber || `RCP-${String(payment.id).padStart(6, "0")}`;
  const statusColor =
    payment.status === "paid" ? colors.success : payment.status === "partial" ? colors.warning : colors.destructive;
  const anyLoading = printLoading || downloadLoading || shareLoading;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Payment Receipt</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{receiptNo}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.iconBtn} onPress={handlePrint} disabled={anyLoading}>
          {printLoading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Feather name="printer" size={20} color={colors.foreground} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}>

        {/* ── Receipt card (native) ── */}
        <View style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Letterhead strip */}
          <View style={[styles.letterhead, { backgroundColor: colors.primary }]}>
            <View style={styles.letterheadLeft}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoInitials}>
                  {businessName.split(" ").map((w: string) => w[0] ?? "").join("").slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.bizName} numberOfLines={1}>{businessName}</Text>
                <Text style={styles.bizSub}>Property Management</Text>
              </View>
            </View>
            <View style={styles.letterheadRight}>
              <Text style={styles.receiptLabel}>RECEIPT</Text>
              <Text style={styles.receiptNoText}>{receiptNo}</Text>
            </View>
          </View>

          {/* Amount hero */}
          <View style={styles.amountHero}>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
              <Feather
                name={payment.status === "paid" ? "check-circle" : payment.status === "partial" ? "clock" : "alert-circle"}
                size={13} color={statusColor}
              />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {payment.status?.toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.amountBig, { color: colors.foreground }]}>
              ₹{paidAmount.toLocaleString("en-IN")}
            </Text>
            <Text style={[styles.amountSub, { color: colors.mutedForeground }]}>Rent for {monthLabel}</Text>
          </View>

          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          {/* Bill to */}
          <View style={styles.sectionPad}>
            <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>BILLED TO</Text>
            <Text style={[styles.tenantName, { color: colors.foreground }]}>{payment.tenantName || "—"}</Text>
            <Text style={[styles.tenantSub, { color: colors.mutedForeground }]}>
              {payment.propertyName || ""}
              {payment.unitNumber ? ` · Unit ${payment.unitNumber}` : ""}
            </Text>
          </View>

          <View style={[styles.solidLine, { backgroundColor: colors.border }]} />

          {/* Detail rows */}
          <View style={styles.sectionPad}>
            <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>PAYMENT DETAILS</Text>
            {[
              { label: "Receipt No.", value: receiptNo, mono: true },
              { label: "Payment Date", value: dateStr },
              { label: "Rent Period", value: monthLabel },
              { label: "Payment Mode", value: methodLabel },
              ...(tenantRentAmount > 0 ? [{ label: "Monthly Rent", value: `₹${tenantRentAmount.toLocaleString("en-IN")}` }] : []),
              ...(payment.unitNumber ? [{ label: "Unit", value: payment.unitNumber }] : []),
              ...(payment.notes ? [{ label: "Notes", value: payment.notes }] : []),
            ].map(row => (
              <View key={row.label} style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }, row.mono && styles.monoText]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          {/* Advance / Due */}
          {tenantRentAmount > 0 && (
            <>
              <View style={[styles.solidLine, { backgroundColor: colors.border }]} />
              <View style={styles.sectionPad}>
                <View style={[styles.balanceBox, {
                  backgroundColor: isAdvance ? `${colors.success}12` : isDue ? `${colors.destructive}10` : `${colors.success}12`,
                  borderColor: isAdvance ? `${colors.success}30` : isDue ? `${colors.destructive}25` : `${colors.success}30`,
                }]}>
                  <View style={styles.balanceLeft}>
                    <Feather
                      name={isAdvance ? "trending-up" : isDue ? "trending-down" : "check-circle"}
                      size={16}
                      color={isAdvance ? colors.success : isDue ? colors.destructive : colors.success}
                    />
                    <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>
                      Balance After Payment
                    </Text>
                  </View>
                  <Text style={[styles.balanceAmount, {
                    color: isAdvance ? colors.success : isDue ? colors.destructive : colors.success,
                  }]}>
                    {isAdvance
                      ? `+₹${Math.abs(balanceDiff).toLocaleString("en-IN")} Advance`
                      : isDue
                      ? `-₹${Math.abs(balanceDiff).toLocaleString("en-IN")} Due`
                      : "Settled ✓"}
                  </Text>
                </View>
              </View>
            </>
          )}

          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          {/* Signature + QR */}
          <View style={styles.bottomRow}>
            <View style={styles.sigBlock}>
              <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>AUTHORIZED SIGNATURE</Text>
              <View style={[styles.sigLine, { borderBottomColor: colors.border }]} />
              <Text style={[styles.sigName, { color: colors.foreground }]}>{ownerName}</Text>
              <Text style={[styles.sigTitle, { color: colors.mutedForeground }]}>Property Owner / Manager</Text>
            </View>

            {/* QR placeholder */}
            <View style={[styles.qrBlock, { borderColor: colors.border, backgroundColor: `${colors.primary}06` }]}>
              <View style={styles.qrGrid}>
                {Array.from({ length: 25 }).map((_, i) => {
                  const row = Math.floor(i / 5);
                  const col = i % 5;
                  const isDark =
                    (row === 0 && col <= 3) || (row === 3 && col <= 3) ||
                    (col === 0 && row <= 3) || (col === 3 && row <= 3) ||
                    (row === 1 && (col === 1 || col === 2)) ||
                    i === 12 || i === 18 || i === 22;
                  return (
                    <View key={i} style={[
                      styles.qrCell,
                      { backgroundColor: isDark ? colors.primary : "transparent" },
                    ]} />
                  );
                })}
              </View>
              <Text style={[styles.qrLabel, { color: colors.mutedForeground }]}>Scan to verify</Text>
            </View>
          </View>

          {/* Footer */}
          <View style={[styles.receiptFooter, { borderTopColor: colors.border }]}>
            <Text style={[styles.footerMain, { color: colors.foreground }]}>Thank you for your payment!</Text>
            <Text style={[styles.footerSub, { color: colors.mutedForeground }]}>
              Please retain this receipt for your records.
            </Text>
            <Text style={[styles.footerBrand, { color: colors.mutedForeground }]}>
              🏠 GEMINI RENT MANAGER
            </Text>
          </View>
        </View>

        {/* ── 3 Action Buttons ── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleDownload}
            disabled={anyLoading}
          >
            {downloadLoading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name="download" size={18} color={colors.primary} />}
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Download</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handlePrint}
            disabled={anyLoading}
          >
            {printLoading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name="printer" size={18} color={colors.primary} />}
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Print</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={handleShare}
            disabled={anyLoading}
          >
            {shareLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name="share-2" size={18} color="#fff" />}
            <Text style={[styles.actionBtnText, { color: "#fff" }]}>Share PDF</Text>
          </TouchableOpacity>
        </View>

        {/* ── Secondary actions ── */}
        <TouchableOpacity
          style={[styles.secondaryBtn, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` }]}
          onPress={() => router.push(`/payment-edit?id=${payment.id}` as any)}
          disabled={deleteMutation.isPending || anyLoading}
        >
          <Feather name="edit-2" size={17} color={colors.primary} />
          <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Edit Payment</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, { backgroundColor: `${colors.destructive}10`, borderColor: `${colors.destructive}25` }]}
          onPress={handleDeletePayment}
          disabled={deleteMutation.isPending || anyLoading}
        >
          {deleteMutation.isPending
            ? <ActivityIndicator size="small" color={colors.destructive} />
            : <Feather name="trash-2" size={17} color={colors.destructive} />}
          <Text style={[styles.secondaryBtnText, { color: colors.destructive }]}>Delete Payment</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.doneBtnText, { color: "#fff" }]}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
  notFoundText: { fontSize: 16 },
  backLink: { padding: 8 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "800" },
  headerSub: { fontSize: 11, fontFamily: "monospace", marginTop: 1 },

  scroll: { padding: 16, gap: 12 },

  /* Receipt card */
  receiptCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },

  letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, gap: 12 },
  letterheadLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  logoCircle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)",
    justifyContent: "center", alignItems: "center",
  },
  logoInitials: { fontSize: 17, fontWeight: "900", color: "#fff" },
  bizName: { fontSize: 14, fontWeight: "800", color: "#fff", flex: 1 },
  bizSub: { fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 1 },
  letterheadRight: { alignItems: "flex-end" },
  receiptLabel: { fontSize: 9, color: "rgba(255,255,255,0.65)", letterSpacing: 2, fontWeight: "700" },
  receiptNoText: { fontSize: 12, color: "#fff", fontFamily: "monospace", fontWeight: "700", marginTop: 3 },

  amountHero: { alignItems: "center", paddingVertical: 26, paddingHorizontal: 20 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginBottom: 10 },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  amountBig: { fontSize: 46, fontWeight: "900", letterSpacing: -2, lineHeight: 52 },
  amountSub: { fontSize: 13, marginTop: 5 },

  dashedLine: { borderTopWidth: 1.5, borderStyle: "dashed", marginHorizontal: 16, marginVertical: 4 },
  solidLine: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  sectionPad: { padding: 16 },
  sectionMeta: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 },
  tenantName: { fontSize: 18, fontWeight: "800" },
  tenantSub: { fontSize: 13, marginTop: 3 },

  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.04)" },
  detailLabel: { fontSize: 13, fontWeight: "500", flex: 1 },
  detailValue: { fontSize: 13, fontWeight: "700", textAlign: "right", flex: 1.4 },
  monoText: { fontFamily: "monospace", fontSize: 12 },

  balanceBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1 },
  balanceLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  balanceLabel: { fontSize: 13, fontWeight: "600" },
  balanceAmount: { fontSize: 14, fontWeight: "800" },

  bottomRow: { flexDirection: "row", gap: 16, padding: 16, alignItems: "flex-end" },
  sigBlock: { flex: 1 },
  sigLine: { height: 52, borderBottomWidth: 1.5, marginBottom: 8 },
  sigName: { fontSize: 13, fontWeight: "800" },
  sigTitle: { fontSize: 11, marginTop: 2 },

  qrBlock: { width: 80, padding: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", gap: 5 },
  qrGrid: { width: 56, height: 56, flexDirection: "row", flexWrap: "wrap", gap: 1.5 },
  qrCell: { width: 8.8, height: 8.8, borderRadius: 1.5 },
  qrLabel: { fontSize: 9, textAlign: "center", letterSpacing: 0.3 },

  receiptFooter: { alignItems: "center", padding: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  footerMain: { fontSize: 14, fontWeight: "700" },
  footerSub: { fontSize: 11 },
  footerBrand: { fontSize: 9, letterSpacing: 1.5, marginTop: 6 },

  /* Action buttons */
  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: "700" },

  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" },

  doneBtn: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  doneBtnText: { fontSize: 16, fontWeight: "800" },
});
