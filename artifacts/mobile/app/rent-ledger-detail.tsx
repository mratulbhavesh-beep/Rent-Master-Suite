import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useGetTenant, getGetTenantQueryKey,
  useListPayments, getListPaymentsQueryKey,
  Payment,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

type MonthRow = {
  month: number;
  year: number;
  label: string;
  expected: number;
  paid: number;
  runningBalance: number;
  status: "paid" | "partial" | "pending" | "upcoming";
  payments: Payment[];
};

type ActiveSection = "history" | "timeline" | "receipts";

function buildMonthHistory(
  leaseStart: string,
  rentAmount: number,
  payments: Payment[]
): MonthRow[] {
  const rows: MonthRow[] = [];
  const start = new Date(leaseStart);
  const now = new Date();
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let runningBalance = 0;

  while (current <= todayStart) {
    const m = current.getMonth() + 1;
    const y = current.getFullYear();
    const monthPmts = payments.filter(p => p.month === m && p.year === y);
    const paid = monthPmts.reduce((s, p) => s + Number(p.amount), 0);
    runningBalance += rentAmount - paid;

    let status: MonthRow["status"] = "pending";
    if (paid >= rentAmount) status = "paid";
    else if (paid > 0) status = "partial";

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    rows.push({
      month: m,
      year: y,
      label: `${MONTHS[m - 1]} ${y}`,
      expected: rentAmount,
      paid,
      runningBalance,
      status,
      payments: monthPmts,
    });

    current.setMonth(current.getMonth() + 1);
  }
  return rows.reverse(); // Most recent first
}

function generateLedgerHTML(
  tenantName: string,
  propertyName: string,
  unitNumber: string,
  phone: string,
  rentAmount: number,
  totalExpected: number,
  totalPaid: number,
  balanceDue: number,
  advanceBalance: number,
  leaseStart: string,
  leaseEnd: string,
  monthHistory: MonthRow[],
  payments: Payment[]
): string {
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const monthRows = [...monthHistory].reverse().map(m => {
    const statusLabel = m.status === "paid" ? "✓ Paid" : m.status === "partial" ? "~ Partial" : "✗ Due";
    const statusColor = m.status === "paid" ? "#16a34a" : m.status === "partial" ? "#ca8a04" : "#dc2626";
    const balColor = m.runningBalance > 0 ? "#dc2626" : m.runningBalance < 0 ? "#16a34a" : "#666";
    const balLabel = m.runningBalance === 0 ? "—" : m.runningBalance < 0 ? `Adv ${fmt(Math.abs(m.runningBalance))}` : fmt(m.runningBalance);
    const method = m.payments.map(p => p.method.replace(/_/g, " ")).join(", ") || "—";
    return `
      <tr>
        <td>${m.label}</td>
        <td>${fmt(m.expected)}</td>
        <td style="color: #16a34a; font-weight: 600">${fmt(m.paid)}</td>
        <td style="font-size: 11px; color: #666">${method}</td>
        <td style="color: ${statusColor}; font-weight: 700">${statusLabel}</td>
        <td style="color: ${balColor}; font-weight: 600">${balLabel}</td>
      </tr>`;
  }).join("");

  const receiptRows = [...payments]
    .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())
    .map(p => `
      <tr>
        <td>${p.receiptNumber || "—"}</td>
        <td>${formatDate(p.paymentDate)}</td>
        <td style="color: #16a34a; font-weight: 600">${fmt(Number(p.amount))}</td>
        <td style="font-size: 11px">${p.method.replace(/_/g, " ")}</td>
        <td style="color: ${p.status === "paid" ? "#16a34a" : p.status === "partial" ? "#ca8a04" : "#dc2626"}; font-weight: 600">
          ${p.status.charAt(0).toUpperCase() + p.status.slice(1)}
        </td>
        <td style="font-size: 11px; color: #666">${p.notes || "—"}</td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rent Ledger — ${tenantName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Helvetica, Arial, sans-serif; background: #fff; color: #1a1a2e; font-size: 12px; }
  .page { max-width: 860px; margin: 0 auto; padding: 36px; }
  .letterhead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 2px solid #1a3a5c; padding-bottom: 16px; }
  .brand h1 { font-size: 20px; color: #1a3a5c; margin-bottom: 2px; }
  .brand p { font-size: 11px; color: #888; }
  .doc-info { text-align: right; font-size: 11px; color: #555; line-height: 1.6; }
  .section-title { font-size: 13px; font-weight: 700; color: #1a3a5c; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 10px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  .tenant-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  .tenant-field { background: #f8f9fb; border-radius: 6px; padding: 8px 12px; }
  .field-lbl { font-size: 9px; text-transform: uppercase; color: #888; font-weight: 700; margin-bottom: 2px; }
  .field-val { font-size: 13px; font-weight: 600; color: #1a1a2e; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
  .summary-box { background: #f3f4f6; border-radius: 8px; padding: 12px; text-align: center; }
  .summary-lbl { font-size: 9px; text-transform: uppercase; color: #888; font-weight: 700; }
  .summary-val { font-size: 18px; font-weight: 800; color: #1a3a5c; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #1a3a5c; color: #fff; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
  tr:nth-child(even) td { background: #fafafa; }
  .footer { margin-top: 36px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
<div class="page">
  <div class="letterhead">
    <div class="brand">
      <h1>Gemini Rent Manager</h1>
      <p>Rental Ledger Statement</p>
    </div>
    <div class="doc-info">
      <strong>Generated on:</strong> ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}<br>
      <strong>Lease Period:</strong> ${formatDate(leaseStart)} – ${formatDate(leaseEnd)}
    </div>
  </div>

  <div class="section-title">Tenant Information</div>
  <div class="tenant-grid">
    <div class="tenant-field"><div class="field-lbl">Tenant Name</div><div class="field-val">${tenantName}</div></div>
    <div class="tenant-field"><div class="field-lbl">Property</div><div class="field-val">${propertyName}</div></div>
    <div class="tenant-field"><div class="field-lbl">Unit / Room</div><div class="field-val">${unitNumber}</div></div>
    <div class="tenant-field"><div class="field-lbl">Phone</div><div class="field-val">${phone}</div></div>
    <div class="tenant-field"><div class="field-lbl">Monthly Rent</div><div class="field-val">${fmt(rentAmount)}</div></div>
    <div class="tenant-field"><div class="field-lbl">Lease Start</div><div class="field-val">${formatDate(leaseStart)}</div></div>
  </div>

  <div class="section-title">Financial Summary</div>
  <div class="summary-grid">
    <div class="summary-box"><div class="summary-lbl">Total Expected</div><div class="summary-val">${fmt(totalExpected)}</div></div>
    <div class="summary-box"><div class="summary-lbl">Total Paid</div><div class="summary-val" style="color:#16a34a">${fmt(totalPaid)}</div></div>
    <div class="summary-box"><div class="summary-lbl">Advance Balance</div><div class="summary-val" style="color:#16a34a">${fmt(advanceBalance)}</div></div>
    <div class="summary-box"><div class="summary-lbl">Balance Due</div><div class="summary-val" style="color:${balanceDue > 0 ? '#dc2626' : '#16a34a'}">${fmt(balanceDue)}</div></div>
  </div>

  <div class="section-title">Month-wise Ledger</div>
  <table>
    <thead><tr><th>Month</th><th>Expected</th><th>Paid</th><th>Method</th><th>Status</th><th>Balance</th></tr></thead>
    <tbody>${monthRows || "<tr><td colspan='6' style='text-align:center;color:#999'>No history available</td></tr>"}</tbody>
  </table>

  ${receiptRows ? `
  <div class="section-title">Receipt List</div>
  <table>
    <thead><tr><th>Receipt #</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>${receiptRows}</tbody>
  </table>` : ""}

  <div class="footer">
    This is a computer-generated statement. Generated by Gemini Rent Manager · ${new Date().toLocaleDateString("en-IN")}
  </div>
</div>
</body>
</html>`;
}

export default function RentLedgerDetailScreen() {
  const { id } = useLocalSearchParams();
  const tenantId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeSection, setActiveSection] = useState<ActiveSection>("history");
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const { data: tenant, isLoading: tenantLoading } = useGetTenant(tenantId, {
    query: { queryKey: getGetTenantQueryKey(tenantId), enabled: !!tenantId }
  });
  const { data: payments, isLoading: paymentsLoading } = useListPayments(
    { tenantId },
    { query: { queryKey: getListPaymentsQueryKey({ tenantId }), enabled: !!tenantId } }
  );

  const isLoading = tenantLoading || paymentsLoading;

  const anyTenant = tenant as any;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  const monthHistory = useMemo(() => {
    if (!tenant || !payments) return [];
    return buildMonthHistory(tenant.leaseStart, tenant.rentAmount, payments as Payment[]);
  }, [tenant, payments]);

  const totalPaid = anyTenant?.totalPaid ?? 0;
  const totalExpected = anyTenant?.totalExpected ?? 0;
  const balanceDue = Math.max(0, totalExpected - totalPaid);
  const advanceBalance = Math.max(0, totalPaid - totalExpected);

  const sortedPayments = useMemo(() =>
    [...(payments ?? [])].sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()),
    [payments]
  );

  const handleGeneratePDF = async (): Promise<string | null> => {
    if (!tenant) return null;
    const html = generateLedgerHTML(
      tenant.name,
      anyTenant?.propertyName ?? "—",
      tenant.unitNumber,
      tenant.phone,
      tenant.rentAmount,
      totalExpected,
      totalPaid,
      balanceDue,
      advanceBalance,
      tenant.leaseStart,
      tenant.leaseEnd,
      monthHistory,
      (payments as Payment[]) ?? []
    );
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      return uri;
    } catch {
      Alert.alert("Error", "Failed to generate PDF");
      return null;
    }
  };

  const handlePrint = async () => {
    if (!tenant) return;
    setGeneratingPdf(true);
    const html = generateLedgerHTML(
      tenant.name,
      anyTenant?.propertyName ?? "—",
      tenant.unitNumber,
      tenant.phone,
      tenant.rentAmount,
      totalExpected,
      totalPaid,
      balanceDue,
      advanceBalance,
      tenant.leaseStart,
      tenant.leaseEnd,
      monthHistory,
      (payments as Payment[]) ?? []
    );
    try {
      await Print.printAsync({ html });
    } catch (e) {
      Alert.alert("Error", "Printing failed");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleSharePDF = async () => {
    setGeneratingPdf(true);
    const uri = await handleGeneratePDF();
    if (uri) {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: `Rent Ledger — ${tenant?.name}`,
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Sharing not available", "Sharing is not supported on this device.");
      }
    }
    setGeneratingPdf(false);
  };

  const handleWhatsApp = async () => {
    if (!tenant) return;
    const digits = tenant.phone.replace(/\D/g, "");
    const phone = digits.length === 10 ? `91${digits}` : digits.startsWith("0") ? `91${digits.slice(1)}` : digits;

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const recent = sortedPayments.slice(0, 3).map(p => {
      const m = p.month ? MONTHS[p.month - 1] : "—";
      return `• ${m} ${p.year}: ${fmt(Number(p.amount))} (${p.status})`;
    }).join("\n");

    const msg = [
      `📋 *Rent Ledger Summary*`,
      ``,
      `👤 Tenant: ${tenant.name}`,
      `🏠 Property: ${anyTenant?.propertyName ?? "—"} | Unit ${tenant.unitNumber}`,
      ``,
      `💰 Monthly Rent: ${fmt(tenant.rentAmount)}`,
      `📊 Total Expected: ${fmt(totalExpected)}`,
      `✅ Total Paid: ${fmt(totalPaid)}`,
      advanceBalance > 0 ? `🟢 Advance Balance: ${fmt(advanceBalance)}` : `⚠️ Balance Due: ${fmt(balanceDue)}`,
      ``,
      recent ? `📅 Recent Payments:\n${recent}` : ``,
      ``,
      `_Generated by Gemini Rent Manager_`,
    ].filter(Boolean).join("\n");

    const url = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert("WhatsApp Not Available", "Please ensure WhatsApp is installed and the phone number is valid.")
    );
  };

  // ─── Loading / Not Found ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!tenant) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Tenant not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: colors.primary, marginTop: 12, fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const paidMonths = monthHistory.filter(m => m.status === "paid").length;
  const partialMonths = monthHistory.filter(m => m.status === "partial").length;
  const dueMonths = monthHistory.filter(m => m.status === "pending").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{tenant.name}</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {anyTenant?.propertyName ?? "—"} · Unit {tenant.unitNumber}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: `${colors.primary}15` }]}
            onPress={handlePrint}
            disabled={generatingPdf}
          >
            {generatingPdf ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="printer" size={18} color={colors.primary} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: `${colors.primary}15` }]}
            onPress={handleSharePDF}
            disabled={generatingPdf}
          >
            <Feather name="share-2" size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#25D36615" }]}
            onPress={handleWhatsApp}
          >
            <Feather name="message-circle" size={18} color="#25D366" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Tenant Info */}
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoCardRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.primaryForeground, fontSize: 22, fontWeight: "bold" }}>
                {tenant.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tenantName, { color: colors.foreground }]}>{tenant.name}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Feather name="phone" size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{tenant.phone}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Feather name="calendar" size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                    {new Date(tenant.leaseStart).toLocaleDateString("en-IN", { month: "short", year: "numeric" })} — {new Date(tenant.leaseEnd).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Financial Summary */}
        <View style={styles.summaryGrid}>
          {[
            { label: "Monthly Rent", value: fmt(tenant.rentAmount), color: colors.primary, icon: "home" as const },
            { label: "Total Expected", value: fmt(totalExpected), color: colors.foreground, icon: "trending-up" as const },
            { label: "Total Paid", value: fmt(totalPaid), color: colors.success, icon: "check-circle" as const },
            { label: "Advance", value: fmt(advanceBalance), color: colors.success, icon: "arrow-up-circle" as const },
            { label: "Balance Due", value: fmt(balanceDue), color: balanceDue > 0 ? colors.destructive : colors.success, icon: "alert-circle" as const },
            { label: "Months", value: `${paidMonths}P / ${partialMonths}~ / ${dueMonths}D`, color: colors.foreground, icon: "calendar" as const },
          ].map(box => (
            <View key={box.label} style={[styles.summaryBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <Feather name={box.icon} size={13} color={box.color} />
                <Text style={[styles.summaryLbl, { color: colors.mutedForeground }]}>{box.label}</Text>
              </View>
              <Text style={[styles.summaryVal, { color: box.color }]}>{box.value}</Text>
            </View>
          ))}
        </View>

        {/* Section tabs */}
        <View style={[styles.sectionTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {([
            { key: "history", label: "Month History", icon: "grid" as const },
            { key: "timeline", label: "Timeline", icon: "clock" as const },
            { key: "receipts", label: "Receipts", icon: "file-text" as const },
          ] as { key: ActiveSection; label: string; icon: keyof typeof Feather.glyphMap }[]).map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.sectionTab, activeSection === tab.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
              onPress={() => setActiveSection(tab.key)}
            >
              <Feather name={tab.icon} size={14} color={activeSection === tab.key ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.sectionTabText, { color: activeSection === tab.key ? colors.primary : colors.mutedForeground }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Month History */}
        {activeSection === "history" && (
          <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Table header */}
            <View style={[styles.tableHeader, { backgroundColor: `${colors.primary}10`, borderBottomColor: colors.border }]}>
              <Text style={[styles.thCell, { flex: 1.6, color: colors.primary }]}>Month</Text>
              <Text style={[styles.thCell, { flex: 1.4, color: colors.primary, textAlign: "right" }]}>Expected</Text>
              <Text style={[styles.thCell, { flex: 1.4, color: colors.primary, textAlign: "right" }]}>Paid</Text>
              <Text style={[styles.thCell, { flex: 1, color: colors.primary, textAlign: "center" }]}>Status</Text>
              <Text style={[styles.thCell, { flex: 1.4, color: colors.primary, textAlign: "right" }]}>Balance</Text>
            </View>

            {monthHistory.length === 0 ? (
              <View style={{ padding: 32, alignItems: "center" }}>
                <Feather name="inbox" size={32} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No history available</Text>
              </View>
            ) : monthHistory.map((m, idx) => {
              const isEven = idx % 2 === 0;
              const statusIcon = m.status === "paid" ? "✓" : m.status === "partial" ? "~" : "✗";
              const statusColor = m.status === "paid" ? colors.success : m.status === "partial" ? colors.warning : colors.destructive;
              const balColor = m.runningBalance > 0 ? colors.destructive : m.runningBalance < 0 ? colors.success : colors.mutedForeground;
              const balLabel = m.runningBalance === 0 ? "—" : m.runningBalance < 0 ? `+${fmt(Math.abs(m.runningBalance))}` : fmt(m.runningBalance);
              return (
                <View
                  key={`${m.year}-${m.month}`}
                  style={[
                    styles.tableRow,
                    { backgroundColor: isEven ? `${colors.primary}04` : colors.card, borderBottomColor: colors.border },
                    idx === monthHistory.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <Text style={[styles.tdCell, { flex: 1.6, color: colors.foreground, fontWeight: "600" }]}>{m.label}</Text>
                  <Text style={[styles.tdCell, { flex: 1.4, color: colors.mutedForeground, textAlign: "right" }]}>{fmt(m.expected)}</Text>
                  <Text style={[styles.tdCell, { flex: 1.4, color: colors.success, textAlign: "right", fontWeight: "600" }]}>{fmt(m.paid)}</Text>
                  <Text style={[styles.tdCell, { flex: 1, color: statusColor, textAlign: "center", fontWeight: "800", fontSize: 15 }]}>{statusIcon}</Text>
                  <Text style={[styles.tdCell, { flex: 1.4, color: balColor, textAlign: "right", fontWeight: "600" }]}>{balLabel}</Text>
                </View>
              );
            })}

            {/* Summary row */}
            <View style={[styles.tableRow, { backgroundColor: `${colors.primary}10`, borderTopWidth: 1, borderTopColor: colors.border, borderBottomWidth: 0 }]}>
              <Text style={[styles.tdCell, { flex: 1.6, color: colors.foreground, fontWeight: "800" }]}>TOTAL</Text>
              <Text style={[styles.tdCell, { flex: 1.4, color: colors.primary, textAlign: "right", fontWeight: "700" }]}>{fmt(totalExpected)}</Text>
              <Text style={[styles.tdCell, { flex: 1.4, color: colors.success, textAlign: "right", fontWeight: "700" }]}>{fmt(totalPaid)}</Text>
              <Text style={[styles.tdCell, { flex: 1, textAlign: "center" }]}></Text>
              <Text style={[styles.tdCell, { flex: 1.4, color: balanceDue > 0 ? colors.destructive : colors.success, textAlign: "right", fontWeight: "800" }]}>
                {balanceDue > 0 ? fmt(balanceDue) : `+${fmt(advanceBalance)}`}
              </Text>
            </View>
          </View>
        )}

        {/* Payment Timeline */}
        {activeSection === "timeline" && (
          <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 16 }]}>
            <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
              {sortedPayments.length} Payment{sortedPayments.length !== 1 ? "s" : ""}
            </Text>
            {sortedPayments.length === 0 ? (
              <View style={{ paddingVertical: 32, alignItems: "center" }}>
                <Feather name="inbox" size={32} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No payments recorded</Text>
              </View>
            ) : sortedPayments.map((p, idx) => {
              const isLast = idx === sortedPayments.length - 1;
              const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              const monthLabel = p.month ? `${MONTHS[p.month - 1]} ${p.year}` : "—";
              const statusColor = p.status === "paid" ? colors.success : p.status === "partial" ? colors.warning : colors.destructive;
              return (
                <View key={p.id} style={styles.timelineItem}>
                  <View style={styles.timelineLeft}>
                    <View style={[styles.timelineDot, { backgroundColor: statusColor }]} />
                    {!isLast && <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />}
                  </View>
                  <View style={[styles.timelineCard, { backgroundColor: `${colors.primary}05`, borderColor: colors.border, borderWidth: 1 }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.success }}>
                          {fmt(Number(p.amount))}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                          {monthLabel} · {new Date(p.paymentDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                          {p.method.replace(/_/g, " ")}
                          {p.notes ? ` · ${p.notes}` : ""}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
                        <Text style={{ fontSize: 10, fontWeight: "800", color: statusColor }}>
                          {p.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Receipts */}
        {activeSection === "receipts" && (
          <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 16 }]}>
            <Text style={[styles.sectionHeading, { color: colors.foreground }]}>Receipt List</Text>
            {sortedPayments.length === 0 ? (
              <View style={{ paddingVertical: 32, alignItems: "center" }}>
                <Feather name="file-text" size={32} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>No receipts available</Text>
              </View>
            ) : sortedPayments.map((p, idx) => {
              const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              const monthLabel = p.month ? `${MONTHS[p.month - 1]} ${p.year}` : "—";
              const statusColor = p.status === "paid" ? colors.success : p.status === "partial" ? colors.warning : colors.destructive;
              return (
                <View
                  key={p.id}
                  style={[
                    styles.receiptItem,
                    { borderBottomColor: colors.border },
                    idx === sortedPayments.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <View style={[styles.receiptIcon, { backgroundColor: `${colors.primary}12` }]}>
                    <Feather name="file-text" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>
                      {p.receiptNumber || `RCP-${p.id}`}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                      {monthLabel} · {new Date(p.paymentDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                      {p.method.replace(/_/g, " ")}
                      {p.notes ? ` · ${p.notes}` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: colors.success }}>
                      {fmt(Number(p.amount))}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
                      <Text style={{ fontSize: 9, fontWeight: "800", color: statusColor }}>
                        {p.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.bigActionBtn, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}30` }]}
            onPress={handlePrint}
            disabled={generatingPdf}
          >
            {generatingPdf ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="printer" size={20} color={colors.primary} />
            )}
            <Text style={[styles.bigActionText, { color: colors.primary }]}>Print</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bigActionBtn, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}30` }]}
            onPress={handleSharePDF}
            disabled={generatingPdf}
          >
            <Feather name="download" size={20} color={colors.primary} />
            <Text style={[styles.bigActionText, { color: colors.primary }]}>Download PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bigActionBtn, { backgroundColor: "#25D36615", borderColor: "#25D36630" }]}
            onPress={handleWhatsApp}
          >
            <Feather name="message-circle" size={20} color="#25D366" />
            <Text style={[styles.bigActionText, { color: "#25D366" }]}>WhatsApp</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSub: { fontSize: 12, marginTop: 1 },
  actionBtn: { width: 38, height: 38, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  content: { padding: 16, paddingBottom: 80, gap: 12 },
  infoCard: { borderRadius: 16, borderWidth: 1, padding: 14 },
  infoCardRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, justifyContent: "center", alignItems: "center" },
  tenantName: { fontSize: 18, fontWeight: "700" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  summaryBox: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  summaryLbl: { fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
  summaryVal: { fontSize: 18, fontWeight: "800", marginTop: 4 },
  sectionTabs: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 12,
  },
  sectionTabText: { fontSize: 12, fontWeight: "600" },
  sectionHeading: { fontSize: 15, fontWeight: "700", marginBottom: 14 },
  tableCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thCell: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  tdCell: { fontSize: 13 },
  timelineItem: { flexDirection: "row", gap: 12, marginBottom: 4 },
  timelineLeft: { alignItems: "center", width: 20, paddingTop: 4 },
  timelineDot: { width: 12, height: 12, borderRadius: 6 },
  timelineLine: { flex: 1, width: 2, marginTop: 4 },
  timelineCard: { flex: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  receiptItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  receiptIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  bigActionBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  bigActionText: { fontSize: 12, fontWeight: "700" },
});
