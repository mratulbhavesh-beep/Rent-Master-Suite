import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
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
import { fmtDate } from "@/utils/dateFormat";
import {
  buildReceiptHTML,
  getReceiptNo,
  printReceiptPDF,
  downloadReceiptPDF,
  shareReceiptPDF,
} from "@/utils/receiptPdf";
import { confirmAction } from "@/utils/confirm";

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

  const businessName =
    (user as any)?.company?.trim() || (user as any)?.name || "Gemini Rent Manager";
  const ownerName = (user as any)?.name || "Property Manager";

  const getHTML = () => buildReceiptHTML(payment, tenantRentAmount, businessName, ownerName);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handlePrint = async () => {
    if (!payment) return;
    setPrintLoading(true);
    try {
      await printReceiptPDF(getHTML());
    } catch {
      Alert.alert("Error", "Could not open print dialog.");
    } finally {
      setPrintLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!payment) return;
    setDownloadLoading(true);
    try {
      await downloadReceiptPDF(getHTML(), getReceiptNo(payment));
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (!msg.toLowerCase().includes("cancel")) {
        Alert.alert("Download Failed", msg || "Could not save the PDF.");
      }
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleShare = async () => {
    if (!payment) return;
    setShareLoading(true);
    try {
      await shareReceiptPDF(getHTML(), getReceiptNo(payment));
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not share receipt.");
    } finally {
      setShareLoading(false);
    }
  };

  const handleDeletePayment = () => {
    if (!payment) return;
    const msg = `Delete this payment of ₹${Number(payment.amount).toLocaleString("en-IN")}? This cannot be undone.`;
    confirmAction("Delete Payment", msg, () =>
      deleteMutation.mutate(
        { id: payment.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
            if (payment.tenantId) {
              queryClient.invalidateQueries({
                queryKey: getGetTenantQueryKey(payment.tenantId),
              });
            }
            router.back();
          },
          onError: (err: any) =>
            Alert.alert(
              "Error",
              err?.response?.data?.error || "Failed to delete payment"
            ),
        }
      )
    );
  };

  // ── Loading / error states ─────────────────────────────────────────────
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

  // ── Derived display values ────────────────────────────────────────────────
  const dateStr = fmtDate(payment.paymentDate);
  const monthLabel = new Date(payment.year, payment.month - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
  const methodLabel = (payment.method ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
  const receiptNo = getReceiptNo(payment);
  const statusColor =
    payment.status === "paid"
      ? colors.success
      : payment.status === "partial"
      ? colors.warning
      : colors.destructive;
  const anyLoading = printLoading || downloadLoading || shareLoading;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Payment Receipt
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {receiptNo}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={handlePrint}
          disabled={anyLoading}
        >
          {printLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="printer" size={20} color={colors.foreground} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Receipt Card ── */}
        <View
          style={[
            styles.receiptCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {/* Letterhead */}
          <View style={[styles.letterhead, { backgroundColor: colors.primary }]}>
            <View style={styles.letterheadLeft}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoInitials}>
                  {businessName
                    .split(" ")
                    .map((w: string) => w[0] ?? "")
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bizName} numberOfLines={1}>
                  {businessName}
                </Text>
                <Text style={styles.bizSub}>Property Management</Text>
              </View>
            </View>
            <View style={styles.letterheadRight}>
              <Text style={styles.rcptLabel}>RECEIPT</Text>
              <Text style={styles.rcptNo}>{receiptNo}</Text>
            </View>
          </View>

          {/* Amount hero */}
          <View style={styles.amountHero}>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: `${statusColor}18` },
              ]}
            >
              <Feather
                name={
                  payment.status === "paid"
                    ? "check-circle"
                    : payment.status === "partial"
                    ? "clock"
                    : "alert-circle"
                }
                size={13}
                color={statusColor}
              />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {payment.status?.toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.amountBig, { color: colors.foreground }]}>
              ₹{paidAmount.toLocaleString("en-IN")}
            </Text>
            <Text style={[styles.amountSub, { color: colors.mutedForeground }]}>
              Rent for {monthLabel}
            </Text>
          </View>

          <View style={[styles.dashedLine, { borderColor: colors.border }]} />

          {/* Bill to */}
          <View style={styles.sectionPad}>
            <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
              BILLED TO
            </Text>
            <Text style={[styles.tenantName, { color: colors.foreground }]}>
              {payment.tenantName || "—"}
            </Text>
            <Text style={[styles.tenantSub, { color: colors.mutedForeground }]}>
              {payment.propertyName || ""}
              {(payment as any).unitNumber
                ? ` · Unit ${(payment as any).unitNumber}`
                : ""}
            </Text>
          </View>

          <View style={[styles.solidLine, { backgroundColor: colors.border }]} />

          {/* Detail rows */}
          <View style={styles.sectionPad}>
            <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
              PAYMENT DETAILS
            </Text>
            {[
              { label: "Receipt No.", value: receiptNo, mono: true },
              { label: "Payment Date", value: dateStr },
              { label: "Rent Period", value: monthLabel },
              { label: "Payment Mode", value: methodLabel },
              ...(tenantRentAmount > 0
                ? [
                    {
                      label: "Monthly Rent",
                      value: `₹${tenantRentAmount.toLocaleString("en-IN")}`,
                    },
                  ]
                : []),
              ...((payment as any).unitNumber
                ? [{ label: "Unit", value: (payment as any).unitNumber }]
                : []),
              ...(payment.notes ? [{ label: "Notes", value: payment.notes }] : []),
            ].map((row) => (
              <View key={row.label} style={styles.detailRow}>
                <Text
                  style={[styles.detailLabel, { color: colors.mutedForeground }]}
                >
                  {row.label}
                </Text>
                <Text
                  style={[
                    styles.detailValue,
                    { color: colors.foreground },
                    row.mono && styles.monoText,
                  ]}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          {/* Advance / Due */}
          {tenantRentAmount > 0 && (
            <>
              <View
                style={[styles.solidLine, { backgroundColor: colors.border }]}
              />
              <View style={styles.sectionPad}>
                <View
                  style={[
                    styles.balanceBox,
                    {
                      backgroundColor: isAdvance
                        ? `${colors.success}12`
                        : isDue
                        ? `${colors.destructive}10`
                        : `${colors.success}12`,
                      borderColor: isAdvance
                        ? `${colors.success}30`
                        : isDue
                        ? `${colors.destructive}25`
                        : `${colors.success}30`,
                    },
                  ]}
                >
                  <View style={styles.balanceLeft}>
                    <Feather
                      name={
                        isAdvance
                          ? "trending-up"
                          : isDue
                          ? "trending-down"
                          : "check-circle"
                      }
                      size={16}
                      color={
                        isAdvance
                          ? colors.success
                          : isDue
                          ? colors.destructive
                          : colors.success
                      }
                    />
                    <Text
                      style={[
                        styles.balanceLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Balance After Payment
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.balanceAmount,
                      {
                        color: isAdvance
                          ? colors.success
                          : isDue
                          ? colors.destructive
                          : colors.success,
                      },
                    ]}
                  >
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
              <Text
                style={[styles.sectionMeta, { color: colors.mutedForeground }]}
              >
                AUTHORIZED SIGNATURE
              </Text>
              <View
                style={[
                  styles.sigLine,
                  { borderBottomColor: colors.border },
                ]}
              />
              <Text style={[styles.sigName, { color: colors.foreground }]}>
                {ownerName}
              </Text>
              <Text style={[styles.sigTitle, { color: colors.mutedForeground }]}>
                Property Owner / Manager
              </Text>
            </View>
            {/* QR placeholder grid */}
            <View
              style={[
                styles.qrBlock,
                {
                  borderColor: colors.border,
                  backgroundColor: `${colors.primary}06`,
                },
              ]}
            >
              <View style={styles.qrGrid}>
                {Array.from({ length: 25 }).map((_, i) => {
                  const row = Math.floor(i / 5);
                  const col = i % 5;
                  const dark =
                    (row === 0 && col <= 3) ||
                    (row === 3 && col <= 3) ||
                    (col === 0 && row <= 3) ||
                    (col === 3 && row <= 3) ||
                    (row === 1 && (col === 1 || col === 2)) ||
                    i === 12 ||
                    i === 18 ||
                    i === 22;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.qrCell,
                        {
                          backgroundColor: dark
                            ? colors.primary
                            : "transparent",
                        },
                      ]}
                    />
                  );
                })}
              </View>
              <Text style={[styles.qrLabel, { color: colors.mutedForeground }]}>
                Scan to verify
              </Text>
            </View>
          </View>

          {/* Footer */}
          <View
            style={[
              styles.receiptFooter,
              { borderTopColor: colors.border },
            ]}
          >
            <Text style={[styles.footerMain, { color: colors.foreground }]}>
              Thank you for your payment!
            </Text>
            <Text
              style={[styles.footerSub, { color: colors.mutedForeground }]}
            >
              Please retain this receipt for your records.
            </Text>
            <Text
              style={[styles.footerBrand, { color: colors.mutedForeground }]}
            >
              🏠 GEMINI RENT MANAGER
            </Text>
          </View>
        </View>

        {/* ── 3 PDF action buttons ── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={handleDownload}
            disabled={anyLoading}
          >
            {downloadLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="download" size={18} color={colors.primary} />
            )}
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>
              Download
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={handlePrint}
            disabled={anyLoading}
          >
            {printLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="printer" size={18} color={colors.primary} />
            )}
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>
              Print
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={handleShare}
            disabled={anyLoading}
          >
            {shareLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="share-2" size={18} color="#fff" />
            )}
            <Text style={[styles.actionBtnText, { color: "#fff" }]}>
              Share PDF
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Secondary actions ── */}
        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            {
              backgroundColor: `${colors.primary}10`,
              borderColor: `${colors.primary}30`,
            },
          ]}
          onPress={() =>
            router.push(`/payment-edit?id=${payment.id}` as any)
          }
          disabled={deleteMutation.isPending || anyLoading}
        >
          <Feather name="edit-2" size={17} color={colors.primary} />
          <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
            Edit Payment
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            {
              backgroundColor: `${colors.destructive}10`,
              borderColor: `${colors.destructive}25`,
            },
          ]}
          onPress={handleDeletePayment}
          disabled={deleteMutation.isPending || anyLoading}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Feather name="trash-2" size={17} color={colors.destructive} />
          )}
          <Text style={[styles.secondaryBtnText, { color: colors.destructive }]}>
            Delete Payment
          </Text>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
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
  iconBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "800" },
  headerSub: { fontSize: 11, fontFamily: "monospace", marginTop: 1 },

  scroll: { padding: 16, gap: 12 },

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

  letterhead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    gap: 12,
  },
  letterheadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  logoInitials: { fontSize: 17, fontWeight: "900", color: "#fff" },
  bizName: { fontSize: 14, fontWeight: "800", color: "#fff", flex: 1 },
  bizSub: { fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 1 },
  letterheadRight: { alignItems: "flex-end" },
  rcptLabel: {
    fontSize: 9,
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 2,
    fontWeight: "700",
  },
  rcptNo: {
    fontSize: 12,
    color: "#fff",
    fontFamily: "monospace",
    fontWeight: "700",
    marginTop: 3,
  },

  amountHero: {
    alignItems: "center",
    paddingVertical: 26,
    paddingHorizontal: 20,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 10,
  },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  amountBig: {
    fontSize: 46,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 52,
  },
  amountSub: { fontSize: 13, marginTop: 5 },

  dashedLine: {
    borderTopWidth: 1.5,
    borderStyle: "dashed",
    marginHorizontal: 16,
    marginVertical: 4,
  },
  solidLine: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  sectionPad: { padding: 16 },
  sectionMeta: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  tenantName: { fontSize: 18, fontWeight: "800" },
  tenantSub: { fontSize: 13, marginTop: 3 },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.04)",
  },
  detailLabel: { fontSize: 13, fontWeight: "500", flex: 1 },
  detailValue: { fontSize: 13, fontWeight: "700", textAlign: "right", flex: 1.4 },
  monoText: { fontFamily: "monospace", fontSize: 12 },

  balanceBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  balanceLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  balanceLabel: { fontSize: 13, fontWeight: "600" },
  balanceAmount: { fontSize: 14, fontWeight: "800" },

  bottomRow: {
    flexDirection: "row",
    gap: 16,
    padding: 16,
    alignItems: "flex-end",
  },
  sigBlock: { flex: 1 },
  sigLine: { height: 52, borderBottomWidth: 1.5, marginBottom: 8 },
  sigName: { fontSize: 13, fontWeight: "800" },
  sigTitle: { fontSize: 11, marginTop: 2 },

  qrBlock: {
    width: 80,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    gap: 5,
  },
  qrGrid: {
    width: 56,
    height: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 1.5,
  },
  qrCell: { width: 8.8, height: 8.8, borderRadius: 1.5 },
  qrLabel: { fontSize: 9, textAlign: "center", letterSpacing: 0.3 },

  receiptFooter: {
    alignItems: "center",
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  footerMain: { fontSize: 14, fontWeight: "700" },
  footerSub: { fontSize: 11 },
  footerBrand: { fontSize: 9, letterSpacing: 1.5, marginTop: 6 },

  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: "700" },

  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" },

  doneBtn: {
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  doneBtnText: { fontSize: 16, fontWeight: "800" },
});
