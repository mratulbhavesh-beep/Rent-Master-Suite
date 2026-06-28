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
import { useGetPayment, getGetPaymentQueryKey, useGetTenant, useDeletePayment, getListPaymentsQueryKey, getGetDashboardSummaryQueryKey, getListTenantsQueryKey, getGetTenantQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

function buildReceiptHTML(payment: any, remainingBalance?: number): string {
  const dateStr = new Date(payment.paymentDate).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const monthLabel = new Date(payment.year, payment.month - 1).toLocaleString(
    "default",
    { month: "long", year: "numeric" }
  );
  const methodLabel = payment.method.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  const statusColor = payment.status === "paid" ? "#22c55e" : payment.status === "partial" ? "#f59e0b" : "#ef4444";
  const balColor = remainingBalance != null && remainingBalance > 0 ? "#ef4444" : "#22c55e";
  const balLabel = remainingBalance != null && remainingBalance > 0
    ? `₹${Math.round(remainingBalance).toLocaleString("en-IN")} outstanding`
    : "All paid up";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, Arial, sans-serif; background: #f8fafc; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 24px; }
  .receipt { background: white; border-radius: 16px; padding: 36px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { text-align: center; margin-bottom: 28px; }
  .brand { font-size: 13px; font-weight: 700; color: #1B4F8A; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
  .check-circle { width: 64px; height: 64px; background: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 12px auto; font-size: 32px; line-height: 64px; text-align: center; }
  .amount { font-size: 40px; font-weight: 800; color: #0f172a; margin: 8px 0 4px; }
  .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; background: ${statusColor}20; color: ${statusColor}; text-transform: uppercase; }
  .divider { height: 1px; background: #e2e8f0; margin: 20px 0; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .row-label { font-size: 13px; color: #64748b; font-weight: 500; }
  .row-value { font-size: 14px; color: #0f172a; font-weight: 600; text-align: right; max-width: 60%; }
  .receipt-no { font-family: monospace; font-size: 13px; color: #1B4F8A; }
  .balance-box { background: ${balColor}0f; border: 1px solid ${balColor}30; border-radius: 10px; padding: 12px 16px; margin: 16px 0; display: flex; justify-content: space-between; align-items: center; }
  .balance-label { font-size: 12px; color: #64748b; }
  .balance-value { font-size: 14px; font-weight: 700; color: ${balColor}; }
  .sig-section { margin-top: 28px; }
  .sig-title { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 48px; }
  .sig-line { border-top: 1px solid #cbd5e1; padding-top: 6px; }
  .sig-name { font-size: 12px; color: #0f172a; font-weight: 600; }
  .sig-sub { font-size: 10px; color: #94a3b8; }
  .footer { text-align: center; margin-top: 24px; }
  .footer-text { font-size: 11px; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; }
  .watermark { font-size: 10px; color: #cbd5e1; margin-top: 4px; }
  @media print { body { padding: 0; } .receipt { box-shadow: none; border: 1px solid #e2e8f0; } }
</style>
</head>
<body>
<div class="receipt">
  <div class="header">
    <div class="brand">🏠 Gemini Rent Manager</div>
    <div class="check-circle">✓</div>
    <div class="amount">₹${Number(payment.amount).toLocaleString("en-IN")}</div>
    <div class="status-badge">${payment.status.toUpperCase()}</div>
  </div>
  <div class="divider"></div>
  <div class="row"><span class="row-label">Receipt No.</span><span class="row-value receipt-no">${payment.receiptNumber || `REC-${String(payment.id).padStart(6, "0")}`}</span></div>
  <div class="row"><span class="row-label">Date</span><span class="row-value">${dateStr}</span></div>
  <div class="row"><span class="row-label">Tenant</span><span class="row-value">${payment.tenantName || "—"}</span></div>
  <div class="row"><span class="row-label">Property</span><span class="row-value">${payment.propertyName || "—"}</span></div>
  ${payment.unitNumber ? `<div class="row"><span class="row-label">Unit</span><span class="row-value">${payment.unitNumber}</span></div>` : ""}
  <div class="row"><span class="row-label">For Month</span><span class="row-value">${monthLabel}</span></div>
  <div class="row"><span class="row-label">Payment Method</span><span class="row-value">${methodLabel}</span></div>
  ${payment.notes ? `<div class="row"><span class="row-label">Notes</span><span class="row-value">${payment.notes}</span></div>` : ""}
  ${remainingBalance != null ? `
  <div class="balance-box">
    <span class="balance-label">Balance After This Payment</span>
    <span class="balance-value">${balLabel}</span>
  </div>` : ""}
  <div class="divider"></div>
  <div class="sig-section">
    <div class="sig-title">Authorized Signature</div>
    <div class="sig-line">
      <div class="sig-name">Property Owner / Manager</div>
      <div class="sig-sub">Gemini Rent Manager</div>
    </div>
  </div>
  <div class="footer">
    <div class="footer-text">Thank you for your payment</div>
    <div class="watermark">Generated by Gemini Rent Manager</div>
  </div>
</div>
</body>
</html>`;
}

export default function PaymentReceiptScreen() {
  const { id } = useLocalSearchParams();
  const paymentId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [shareLoading, setShareLoading] = useState(false);

  const queryClient = useQueryClient();
  const deleteMutation = useDeletePayment();

  const { data: payment, isLoading } = useGetPayment(paymentId, {
    query: { queryKey: getGetPaymentQueryKey(paymentId), enabled: !!paymentId },
  });

  const { data: tenantData } = useGetTenant(payment?.tenantId ?? 0, {
    query: { queryKey: getGetTenantQueryKey(payment?.tenantId ?? 0), enabled: !!payment?.tenantId },
  });
  const remainingBalance: number | undefined = payment?.tenantId && tenantData
    ? ((tenantData as any).balanceDue ?? undefined)
    : undefined;

  const handleDeletePayment = () => {
    if (!payment) return;
    const msg = `Delete this payment of ₹${Number(payment.amount).toLocaleString("en-IN")}? This cannot be undone.`;
    const doDelete = () => {
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
          onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to delete payment"),
        }
      );
    };
    if (Platform.OS === "web") {
      if (window.confirm(msg)) doDelete();
    } else {
      Alert.alert("Delete Payment", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const handleShare = async () => {
    if (!payment) return;
    setShareLoading(true);
    try {
      const html = buildReceiptHTML(payment, remainingBalance);
      if (Platform.OS === "web") {
        // On web: open print dialog
        await Print.printAsync({ html });
      } else {
        // On native: generate PDF and open system share sheet (includes WhatsApp)
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/pdf",
            dialogTitle: "Share Rent Receipt",
            UTI: "com.adobe.pdf",
          });
        } else {
          Alert.alert("Sharing not available on this device");
        }
      }
    } catch (err: any) {
      Alert.alert("Error", "Could not generate receipt: " + (err?.message || "unknown error"));
    } finally {
      setShareLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!payment) return;
    setShareLoading(true);
    try {
      await Print.printAsync({ html: buildReceiptHTML(payment, remainingBalance) });
    } catch {
      Alert.alert("Error", "Could not open print dialog");
    } finally {
      setShareLoading(false);
    }
  };

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
        <Text style={[styles.notFoundText, { color: colors.mutedForeground }]}>
          Payment not found
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dateStr = new Date(payment.paymentDate).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const monthLabel = new Date(payment.year, payment.month - 1).toLocaleString(
    "default",
    { month: "long", year: "numeric" }
  );
  const methodLabel = payment.method
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const statusColor =
    payment.status === "paid"
      ? colors.success
      : payment.status === "partial"
      ? colors.warning
      : colors.destructive;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Receipt</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handlePrint}
            disabled={shareLoading}
          >
            <Feather name="printer" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.shareBtn, { backgroundColor: colors.primary }]}
            onPress={handleShare}
            disabled={shareLoading}
          >
            {shareLoading ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="share-2" size={14} color={colors.primaryForeground} />
                <Text style={[styles.shareBtnText, { color: colors.primaryForeground }]}>
                  Share
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Receipt Card */}
        <View
          style={[
            styles.receiptCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {/* Top section */}
          <View style={styles.receiptTop}>
            <View
              style={[
                styles.checkCircle,
                { backgroundColor: `${statusColor}20` },
              ]}
            >
              <Feather
                name={
                  payment.status === "paid"
                    ? "check"
                    : payment.status === "partial"
                    ? "clock"
                    : "alert-circle"
                }
                size={28}
                color={statusColor}
              />
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: `${statusColor}20` },
              ]}
            >
              <Text style={[styles.statusText, { color: statusColor }]}>
                {payment.status.toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.amountText, { color: colors.foreground }]}>
              ₹{Number(payment.amount).toLocaleString("en-IN")}
            </Text>
            <Text style={[styles.monthText, { color: colors.mutedForeground }]}>
              Rent for {monthLabel}
            </Text>
          </View>

          {/* Dashed separator */}
          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          {/* Receipt rows */}
          {[
            {
              label: "Receipt No.",
              value: payment.receiptNumber || `REC-${String(payment.id).padStart(6, "0")}`,
              mono: true,
            },
            { label: "Payment Date", value: dateStr },
            { label: "Tenant", value: payment.tenantName || "—" },
            { label: "Property", value: payment.propertyName || "—" },
            { label: "Method", value: methodLabel },
            ...(payment.notes ? [{ label: "Notes", value: payment.notes }] : []),
          ].map((row) => (
            <View key={row.label} style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: colors.mutedForeground }]}>
                {row.label}
              </Text>
              <Text
                style={[
                  styles.receiptValue,
                  { color: colors.foreground },
                  row.mono && styles.monoText,
                ]}
              >
                {row.value}
              </Text>
            </View>
          ))}

          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          {/* Footer */}
          <View style={styles.receiptFooter}>
            <Feather name="shield" size={16} color={colors.primary} />
            <Text style={[styles.brandText, { color: colors.primary }]}>
              GEMINI RENT MANAGER
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={handlePrint}
            disabled={shareLoading || deleteMutation.isPending}
          >
            <Feather name="printer" size={18} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>
              Print / PDF
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#25D366", borderColor: "#25D366" }]}
            onPress={handleShare}
            disabled={shareLoading || deleteMutation.isPending}
          >
            {shareLoading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Feather name="share-2" size={18} color="white" />
                <Text style={[styles.actionBtnText, { color: "white" }]}>
                  Share
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.actionBtn,
            {
              backgroundColor: `${colors.primary}10`,
              borderColor: `${colors.primary}40`,
              marginBottom: 12,
            },
          ]}
          onPress={() => router.push(`/payment-edit?id=${payment.id}` as any)}
          disabled={deleteMutation.isPending || shareLoading}
        >
          <Feather name="edit-2" size={18} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>
            Edit Payment
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionBtn,
            {
              backgroundColor: `${colors.destructive}12`,
              borderColor: `${colors.destructive}40`,
              marginBottom: 12,
            },
          ]}
          onPress={handleDeletePayment}
          disabled={deleteMutation.isPending || shareLoading}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <>
              <Feather name="trash-2" size={18} color={colors.destructive} />
              <Text style={[styles.actionBtnText, { color: colors.destructive }]}>
                Delete Payment
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>
            Done
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
  notFoundText: { fontSize: 16, marginTop: 8 },
  backLink: { padding: 8 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  shareBtnText: { fontSize: 13, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 40 },
  receiptCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  receiptTop: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 24 },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  statusBadge: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20, marginBottom: 12 },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  amountText: { fontSize: 42, fontWeight: "800", letterSpacing: -1 },
  monthText: { fontSize: 13, marginTop: 4 },
  dashedLine: {
    borderTopWidth: 1,
    borderStyle: "dashed",
    marginVertical: 4,
    marginHorizontal: 20,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  receiptLabel: { fontSize: 13, fontWeight: "500", flex: 1 },
  receiptValue: { fontSize: 13, fontWeight: "600", textAlign: "right", flex: 1.5 },
  monoText: { fontFamily: "monospace", fontSize: 12 },
  receiptFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  brandText: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  actions: { flexDirection: "row", gap: 12, marginBottom: 16 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: "700" },
  doneBtn: {
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  doneBtnText: { fontSize: 16, fontWeight: "bold" },
});
