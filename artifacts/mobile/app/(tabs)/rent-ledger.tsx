import React, { useState, useMemo, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import {
  useListTenants, getListTenantsQueryKey,
  useListPayments, getListPaymentsQueryKey,
  useListProperties, getListPropertiesQueryKey,
  Payment,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

type StatusFilter = "all" | "paid" | "partial" | "due";

type TenantWithBalance = {
  id: number;
  name: string;
  phone: string;
  propertyId: number;
  propertyName: string | null;
  unitNumber: string;
  rentAmount: number;
  leaseStart: string;
  leaseEnd: string;
  status: string;
  monthsElapsed: number;
  totalExpected: number;
  totalPaid: number;
  balanceDue: number;
  currentMonthDue: number;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getLedgerStatus(
  tenant: TenantWithBalance,
  allPayments: Payment[],
  filterMonth: number | null,
  filterYear: number
): "paid" | "partial" | "due" {
  if (filterMonth === null) {
    const due = tenant.currentMonthDue ?? 0;
    if (due === 0) return "paid";
    if (due < tenant.rentAmount) return "partial";
    return "due";
  }
  const mp = allPayments.filter(
    p => p.tenantId === tenant.id && p.month === filterMonth && p.year === filterYear
  );
  const paid = mp.reduce((s, p) => s + Number(p.amount), 0);
  if (paid >= tenant.rentAmount) return "paid";
  if (paid > 0) return "partial";
  return "due";
}

function getLastPaymentDate(tenantId: number, allPayments: Payment[]): string | null {
  const pmts = allPayments.filter(p => p.tenantId === tenantId);
  if (!pmts.length) return null;
  return pmts.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())[0].paymentDate;
}

function getMonthPaid(tenantId: number, allPayments: Payment[], month: number, year: number): number {
  return allPayments
    .filter(p => p.tenantId === tenantId && p.month === month && p.year === year)
    .reduce((s, p) => s + Number(p.amount), 0);
}

const STATUS_CONFIG = {
  paid: { label: "Paid", bg: "#dcfce7", text: "#16a34a" },
  partial: { label: "Partial", bg: "#fef9c3", text: "#ca8a04" },
  due: { label: "Due", bg: "#fee2e2", text: "#dc2626" },
};

export default function RentLedgerTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());

  const { data: rawTenants, isLoading: tenantsLoading, refetch: refetchTenants } = useListTenants(
    {},
    { query: { queryKey: getListTenantsQueryKey() } }
  );
  const { data: allPayments, isLoading: paymentsLoading, refetch: refetchPayments } = useListPayments(
    {},
    { query: { queryKey: getListPaymentsQueryKey() } }
  );
  const { data: properties } = useListProperties(
    {},
    { query: { queryKey: getListPropertiesQueryKey() } }
  );

  const isLoading = tenantsLoading || paymentsLoading;
  const tenants = (rawTenants as unknown as TenantWithBalance[]) ?? [];
  const payments = (allPayments as Payment[]) ?? [];

  useFocusEffect(useCallback(() => {
    refetchTenants();
    refetchPayments();
  }, [refetchTenants, refetchPayments]));

  const navigateMonth = (dir: -1 | 1) => {
    if (filterMonth === null) {
      const now = new Date();
      setFilterMonth(now.getMonth() + 1);
      setFilterYear(now.getFullYear());
      return;
    }
    let m = filterMonth + dir;
    let y = filterYear;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setFilterMonth(m);
    setFilterYear(y);
  };

  const filteredTenants = useMemo(() => {
    let list = tenants;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(s) ||
        (t.propertyName ?? "").toLowerCase().includes(s) ||
        t.unitNumber.toLowerCase().includes(s) ||
        t.phone.includes(s)
      );
    }
    if (selectedPropertyId !== null) {
      list = list.filter(t => t.propertyId === selectedPropertyId);
    }
    if (statusFilter !== "all") {
      list = list.filter(t => getLedgerStatus(t, payments, filterMonth, filterYear) === statusFilter);
    }
    return list;
  }, [tenants, payments, search, selectedPropertyId, statusFilter, filterMonth, filterYear]);

  const paidCount = tenants.filter(t => getLedgerStatus(t, payments, filterMonth, filterYear) === "paid").length;
  const partialCount = tenants.filter(t => getLedgerStatus(t, payments, filterMonth, filterYear) === "partial").length;
  const dueCount = tenants.filter(t => getLedgerStatus(t, payments, filterMonth, filterYear) === "due").length;

  const renderTenantCard = ({ item }: { item: TenantWithBalance }) => {
    const ls = getLedgerStatus(item, payments, filterMonth, filterYear);
    const sc = STATUS_CONFIG[ls];
    const lastPayDate = getLastPaymentDate(item.id, payments);
    const advanceBalance = Math.max(0, item.totalPaid - item.totalExpected);
    const dueBalance = Math.max(0, item.totalExpected - item.totalPaid);

    let paidThisFilter: number | null = null;
    if (filterMonth !== null) {
      paidThisFilter = getMonthPaid(item.id, payments, filterMonth, filterYear);
    }

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/rent-ledger-detail?id=${item.id}` as any)}
        activeOpacity={0.78}
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.primaryForeground, fontWeight: "bold", fontSize: 18 }}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.nameBlock}>
              <Text style={[styles.tenantName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.tenantSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {item.propertyName ?? "—"} · Unit {item.unitNumber}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
          </View>
        </View>

        <View style={[styles.metricsRow, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
          <View style={styles.metric}>
            <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Monthly</Text>
            <Text style={[styles.metricVal, { color: colors.foreground }]}>
              ₹{Math.round(item.rentAmount).toLocaleString("en-IN")}
            </Text>
          </View>
          <View style={[styles.metric, styles.metricCenter, { borderLeftColor: colors.border, borderRightColor: colors.border }]}>
            <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>
              {filterMonth !== null ? `${MONTHS[filterMonth - 1]} Paid` : "Total Paid"}
            </Text>
            <Text style={[styles.metricVal, { color: colors.success }]}>
              ₹{Math.round(filterMonth !== null ? (paidThisFilter ?? 0) : item.totalPaid).toLocaleString("en-IN")}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>
              {advanceBalance > 0 ? "Advance" : "Balance"}
            </Text>
            <Text style={[styles.metricVal, { color: advanceBalance > 0 ? colors.success : dueBalance > 0 ? colors.destructive : colors.mutedForeground }]}>
              {advanceBalance > 0
                ? `+₹${Math.round(advanceBalance).toLocaleString("en-IN")}`
                : dueBalance > 0
                  ? `-₹${Math.round(dueBalance).toLocaleString("en-IN")}`
                  : "Nil"}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Feather name="calendar" size={12} color={colors.mutedForeground} />
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              {lastPayDate
                ? `Last paid ${new Date(lastPayDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                : "No payments yet"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={[styles.footerText, { color: colors.primary }]}>View Ledger</Text>
            <Feather name="chevron-right" size={14} color={colors.primary} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header — tab style (no back button) */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Rent Ledger</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {filteredTenants.length} tenant{filteredTenants.length !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Payments shortcut */}
        <TouchableOpacity
          style={[styles.paymentsBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}
          onPress={() => router.push("/payments")}
        >
          <Feather name="credit-card" size={15} color={colors.primary} />
          <Text style={[styles.paymentsBtnText, { color: colors.primary }]}>Payments</Text>
        </TouchableOpacity>
      </View>

      {/* Status summary badges */}
      <View style={[styles.badgesRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {([
          { label: "Paid",    count: paidCount,    bg: "#dcfce7", text: "#15803d", icon: "check-circle" as const },
          { label: "Partial", count: partialCount, bg: "#fef9c3", text: "#a16207", icon: "alert-circle" as const },
          { label: "Due",     count: dueCount,     bg: "#fee2e2", text: "#b91c1c", icon: "x-circle" as const },
        ]).map(b => (
          <View key={b.label} style={[styles.badge, { backgroundColor: b.bg }]}>
            <Feather name={b.icon} size={14} color={b.text} />
            <Text style={[styles.badgeLabel, { color: b.text }]}>{b.label}</Text>
            <Text style={[styles.badgeCount, { color: b.text }]}>{b.count}</Text>
          </View>
        ))}
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: colors.input, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search tenant, property, unit..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Month / Year navigator */}
      <View style={[styles.monthNav, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity style={styles.monthBtn} onPress={() => navigateMonth(-1)}>
          <Feather name="chevron-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity onLongPress={() => setFilterMonth(null)} onPress={() => {
          if (filterMonth === null) navigateMonth(1);
        }}>
          <Text style={[styles.monthLabel, { color: colors.foreground }]}>
            {filterMonth === null ? "All Months" : `${MONTHS[filterMonth - 1]} ${filterYear}`}
          </Text>
          {filterMonth !== null && (
            <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: "center" }}>
              Hold to reset
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.monthBtn} onPress={() => navigateMonth(1)}>
          <Feather name="chevron-right" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Property filter chips */}
      {(properties ?? []).length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipContent}
        >
          <TouchableOpacity
            style={[styles.chip, { backgroundColor: selectedPropertyId === null ? colors.primary : colors.card, borderColor: selectedPropertyId === null ? colors.primary : colors.border }]}
            onPress={() => setSelectedPropertyId(null)}
          >
            <Text style={[styles.chipText, { color: selectedPropertyId === null ? colors.primaryForeground : colors.foreground }]}>
              All Properties
            </Text>
          </TouchableOpacity>
          {(properties ?? []).map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.chip, { backgroundColor: selectedPropertyId === p.id ? colors.primary : colors.card, borderColor: selectedPropertyId === p.id ? colors.primary : colors.border }]}
              onPress={() => setSelectedPropertyId(p.id)}
            >
              <Text style={[styles.chipText, { color: selectedPropertyId === p.id ? colors.primaryForeground : colors.foreground }]} numberOfLines={1}>
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Status filter */}
      <View style={styles.statusRow}>
        {(["all", "paid", "partial", "due"] as StatusFilter[]).map(s => {
          const active = statusFilter === s;
          const sc = s !== "all" ? STATUS_CONFIG[s] : null;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.statusChip, {
                backgroundColor: active ? (sc?.bg ?? colors.primary) : colors.card,
                borderColor: active ? (sc?.text ?? colors.primary) : colors.border,
                borderWidth: 1.5,
              }]}
              onPress={() => setStatusFilter(s)}
            >
              <Text style={[styles.statusChipText, { color: active ? (sc?.text ?? colors.primaryForeground) : colors.mutedForeground }]}>
                {s === "all" ? "All" : STATUS_CONFIG[s].label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Loading ledger...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTenants}
          keyExtractor={item => item.id.toString()}
          renderItem={renderTenantCard}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => { refetchTenants(); refetchPayments(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="book-open" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Tenants Found</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search || selectedPropertyId || statusFilter !== "all"
                  ? "Try adjusting your filters"
                  : "Add tenants from the Tenants tab to get started"}
              </Text>
            </View>
          }
        />
      )}
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
  },
  headerTitle: { fontSize: 22, fontWeight: "bold" },
  headerSub: { fontSize: 12 },
  badgesRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 24,
  },
  badgeLabel: { fontSize: 13, fontWeight: "600" },
  badgeCount: { fontSize: 16, fontWeight: "800" },
  paymentsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  paymentsBtnText: { fontSize: 12, fontWeight: "700" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  monthBtn: { width: 44, height: 36, justifyContent: "center", alignItems: "center" },
  monthLabel: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  chipScroll: { flexGrow: 0, marginBottom: 4 },
  chipContent: { paddingHorizontal: 16, gap: 8, flexDirection: "row", paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },
  statusRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 4 },
  statusChip: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  statusChipText: { fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 16, paddingBottom: 100, paddingTop: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    paddingBottom: 12,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  nameBlock: { flex: 1 },
  tenantName: { fontSize: 16, fontWeight: "700" },
  tenantSub: { fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: "800" },
  metricsRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metric: { flex: 1, paddingVertical: 10, paddingHorizontal: 14 },
  metricCenter: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  metricLbl: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", marginBottom: 3 },
  metricVal: { fontSize: 15, fontWeight: "700" },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  footerText: { fontSize: 12 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyText: { fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
});
