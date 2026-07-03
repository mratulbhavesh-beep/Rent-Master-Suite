import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import {
  useListPayments,
  getListPaymentsQueryKey,
  useListProperties,
  Payment,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import {
  buildReceiptHTML,
  getReceiptNo,
  printReceiptPDF,
  downloadReceiptPDF,
  shareReceiptPDF,
} from "@/utils/receiptPdf";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const METHOD_ICONS: Record<string, string> = {
  cash: "dollar-sign",
  bank_transfer: "credit-card",
  upi: "smartphone",
  cheque: "file-text",
  online: "globe",
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "partial", label: "Partial" },
  { key: "pending", label: "Pending" },
  { key: "overdue", label: "Overdue" },
];

export default function PaymentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear] = useState(now.getFullYear());
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const businessName =
    (user as any)?.company?.trim() || (user as any)?.name || "Gemini Rent Manager";
  const ownerName = (user as any)?.name || "Property Manager";

  const monthStr = selectedMonth.toString();
  const {
    data: allPayments,
    isLoading,
    isFetching,
    refetch,
  } = useListPayments(
    { month: monthStr },
    { query: { queryKey: getListPaymentsQueryKey({ month: monthStr }) } }
  );

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const { data: properties } = useListProperties({});

  const filteredPayments = useMemo(() => {
    let result = allPayments || [];
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.tenantName?.toLowerCase().includes(q) ||
          p.propertyName?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (propertyFilter !== null) {
      result = result.filter((p) => p.propertyId === propertyFilter);
    }
    return result;
  }, [allPayments, searchText, statusFilter, propertyFilter]);

  const stats = useMemo(() => {
    const payments = allPayments || [];
    const collected = payments
      .filter((p) => p.status === "paid" || p.status === "partial")
      .reduce((s, p) => s + Number(p.amount), 0);
    const paid = payments.filter((p) => p.status === "paid").length;
    const partial = payments.filter((p) => p.status === "partial").length;
    const pending = payments.filter((p) => p.status === "pending").length;
    const overdue = payments.filter((p) => p.status === "overdue").length;
    return { collected, paid, partial, pending, overdue, total: payments.length };
  }, [allPayments]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid": return colors.success;
      case "partial": return colors.warning;
      case "pending": return colors.primary;
      case "overdue": return colors.destructive;
      default: return colors.mutedForeground;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "paid": return "PAID";
      case "partial": return "PARTIAL";
      case "pending": return "PENDING";
      case "overdue": return "OVERDUE";
      default: return status.toUpperCase();
    }
  };

  // ── Per-payment receipt actions ──────────────────────────────────────────
  const handlePaymentAction = async (
    action: "download" | "print" | "share",
    payment: Payment
  ) => {
    const key = `${payment.id}-${action}`;
    if (busyKey !== null) return;
    setBusyKey(key);
    const html = buildReceiptHTML(payment as any, 0, businessName, ownerName);
    const receiptNo = getReceiptNo(payment);
    try {
      if (action === "print") await printReceiptPDF(html);
      else if (action === "download") await downloadReceiptPDF(html, receiptNo);
      else await shareReceiptPDF(html, receiptNo);
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (!msg.toLowerCase().includes("cancel")) {
        Alert.alert("Error", msg || "Could not process request.");
      }
    } finally {
      setBusyKey(null);
    }
  };

  // ── Card render ──────────────────────────────────────────────────────────
  const renderPayment = ({ item }: { item: Payment }) => {
    const sc = getStatusColor(item.status);
    const dateLabel = new Date(item.paymentDate).toLocaleDateString("en-IN", {
      day: "numeric", month: "short",
    });
    const methodIcon = (METHOD_ICONS[item.method] || "dollar-sign") as any;
    const isItemBusy = (suffix: string) =>
      busyKey === `${item.id}-${suffix}`;
    const anyBusy = busyKey !== null;

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {/* ── Tappable top → View Receipt ── */}
        <TouchableOpacity
          style={styles.cardTop}
          onPress={() => router.push(`/payment-receipt?id=${item.id}` as any)}
          activeOpacity={0.7}
        >
          <View style={styles.cardLeft}>
            <Text style={[styles.tenantName, { color: colors.cardForeground }]}>
              {item.tenantName}
            </Text>
            <Text style={[styles.propertyName, { color: colors.mutedForeground }]}>
              {item.propertyName}
              {(item as any).unitNumber ? ` · Unit ${(item as any).unitNumber}` : ""}
            </Text>
          </View>
          <View style={styles.cardRight}>
            <Text style={[styles.amount, { color: colors.foreground }]}>
              ₹{Number(item.amount).toLocaleString("en-IN")}
            </Text>
            <View style={[styles.badge, { backgroundColor: `${sc}20` }]}>
              <Text style={[styles.badgeText, { color: sc }]}>
                {getStatusLabel(item.status)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Meta row: method + date ── */}
        <View
          style={[
            styles.cardMeta,
            { borderTopColor: colors.border },
          ]}
        >
          <View style={styles.methodRow}>
            <Feather name={methodIcon} size={12} color={colors.mutedForeground} />
            <Text style={[styles.methodText, { color: colors.mutedForeground }]}>
              {item.method.replace(/_/g, " ")}
            </Text>
          </View>
          <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
            {dateLabel}
          </Text>
        </View>

        {/* ── 4 receipt action buttons ── */}
        <View
          style={[styles.cardActions, { borderTopColor: colors.border }]}
        >
          {/* View Receipt */}
          <TouchableOpacity
            style={[styles.cardActionBtn, { borderColor: `${colors.primary}25` }]}
            onPress={() => router.push(`/payment-receipt?id=${item.id}` as any)}
            disabled={anyBusy}
          >
            <Feather name="eye" size={13} color={colors.primary} />
            <Text style={[styles.cardActionText, { color: colors.primary }]}>
              View
            </Text>
          </TouchableOpacity>

          {/* Download PDF */}
          <TouchableOpacity
            style={[styles.cardActionBtn, { borderColor: `${colors.primary}25` }]}
            onPress={() => handlePaymentAction("download", item)}
            disabled={anyBusy}
          >
            {isItemBusy("download") ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ width: 13, height: 13 }} />
            ) : (
              <Feather name="download" size={13} color={colors.primary} />
            )}
            <Text style={[styles.cardActionText, { color: colors.primary }]}>
              Download
            </Text>
          </TouchableOpacity>

          {/* Print */}
          <TouchableOpacity
            style={[styles.cardActionBtn, { borderColor: `${colors.primary}25` }]}
            onPress={() => handlePaymentAction("print", item)}
            disabled={anyBusy}
          >
            {isItemBusy("print") ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ width: 13, height: 13 }} />
            ) : (
              <Feather name="printer" size={13} color={colors.primary} />
            )}
            <Text style={[styles.cardActionText, { color: colors.primary }]}>
              Print
            </Text>
          </TouchableOpacity>

          {/* Share PDF */}
          <TouchableOpacity
            style={[
              styles.cardActionBtn,
              styles.cardActionBtnShare,
              { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => handlePaymentAction("share", item)}
            disabled={anyBusy}
          >
            {isItemBusy("share") ? (
              <ActivityIndicator size="small" color="#fff" style={{ width: 13, height: 13 }} />
            ) : (
              <Feather name="share-2" size={13} color="#fff" />
            )}
            <Text style={[styles.cardActionText, { color: "#fff" }]}>
              Share
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Payments
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {selectedYear}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/payment-add")}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      {/* Month tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.monthScroll}
      >
        {MONTHS.map((m, i) => {
          const mn = i + 1;
          const isSelected = mn === selectedMonth;
          return (
            <TouchableOpacity
              key={m}
              style={[
                styles.monthTab,
                isSelected && { backgroundColor: colors.primary },
                !isSelected && {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => setSelectedMonth(mn)}
            >
              <Text
                style={[
                  styles.monthTabText,
                  {
                    color: isSelected
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {m}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Search bar */}
      <View
        style={[
          styles.searchRow,
          { backgroundColor: colors.input, borderColor: colors.border },
        ]}
      >
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search tenant or property…"
          placeholderTextColor={colors.mutedForeground}
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status + property filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterChip,
                active && { backgroundColor: colors.primary },
              ]}
              onPress={() => setStatusFilter(f.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color: active
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View
          style={{
            width: 1,
            height: 24,
            backgroundColor: colors.border,
            marginHorizontal: 4,
            alignSelf: "center",
          }}
        />
        {(properties || []).map((prop) => {
          const active = propertyFilter === prop.id;
          return (
            <TouchableOpacity
              key={prop.id}
              style={[
                styles.filterChip,
                active && { backgroundColor: colors.primary },
              ]}
              onPress={() => setPropertyFilter(active ? null : prop.id)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color: active
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {prop.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Stats row */}
      <View
        style={[
          styles.statsRow,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.success }]}>
            ₹{stats.collected.toLocaleString("en-IN")}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Collected
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.success }]}>
            {stats.paid}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Paid
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.warning }]}>
            {stats.partial}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Partial
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.destructive }]}>
            {stats.overdue + stats.pending}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Due
          </Text>
        </View>
      </View>

      {/* Payment list */}
      <FlatList
        data={filteredPayments}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderPayment}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Feather name="inbox" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {searchText || statusFilter !== "all" || propertyFilter
                  ? "No matching payments"
                  : `No payments in ${MONTHS[selectedMonth - 1]}`}
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {searchText || statusFilter !== "all" || propertyFilter
                  ? "Try adjusting your filters"
                  : "Tap + to record a payment"}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 22, fontWeight: "bold" },
  headerSub: { fontSize: 13, marginTop: 1 },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
  },
  monthScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  monthTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
  },
  monthTabText: { fontSize: 13, fontWeight: "600" },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "800" },
  statLabel: { fontSize: 10, marginTop: 2, fontWeight: "500" },
  statDivider: { width: 1, marginHorizontal: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  /* Card */
  card: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
  },
  cardLeft: { flex: 1, marginRight: 12 },
  cardRight: { alignItems: "flex-end", gap: 6 },
  tenantName: { fontSize: 15, fontWeight: "600", marginBottom: 3 },
  propertyName: { fontSize: 12 },
  amount: { fontSize: 18, fontWeight: "800" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  methodRow: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  methodText: { fontSize: 12, textTransform: "capitalize" },
  dateText: { fontSize: 12 },

  /* Action buttons row */
  cardActions: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  cardActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardActionBtnShare: { borderWidth: 0 },
  cardActionText: { fontSize: 11, fontWeight: "700" },

  empty: { alignItems: "center", paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyText: { fontSize: 14 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  filterScroll: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
    flexDirection: "row",
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterChipText: { fontSize: 12, fontWeight: "600" },
});
