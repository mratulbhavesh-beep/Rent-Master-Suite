import React, { useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import {
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListTenants, getListTenantsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: summary, isLoading, isFetching, refetch } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });

  const { data: allTenants = [] } = useListTenants(
    {},
    { query: { queryKey: getListTenantsQueryKey() } }
  );

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const onRefresh = async () => { await refetch(); };

  const formatCurrency = (amount: number = 0) => `₹${amount.toLocaleString("en-IN")}`;

  const top5DueTenants = [...allTenants]
    .filter(t => ((t as any).balanceDue ?? 0) > 0)
    .sort((a, b) => ((b as any).balanceDue ?? 0) - ((a as any).balanceDue ?? 0))
    .slice(0, 5);

  const SummaryCard = ({ title, value, icon, iconFamily = "Feather", color, onPress }: any) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: `${color}15` }]}>
        {iconFamily === "MaterialIcons" ? (
          <MaterialIcons name={icon} size={24} color={color} />
        ) : (
          <Feather name={icon} size={24} color={color} />
        )}
      </View>
      <Text style={[styles.cardValue, { color: colors.cardForeground }]}>{value}</Text>
      <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Dashboard</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.grid}>
          <SummaryCard title="Today's Collection" value={formatCurrency(summary?.todayCollection)} icon="sun" color={colors.success} onPress={() => router.push("/payments")} />
          <SummaryCard title="This Month" value={formatCurrency(summary?.monthlyIncome)} icon="trending-up" color={colors.primary} onPress={() => router.push("/reports")} />
          <SummaryCard title="Total Outstanding" value={formatCurrency(summary?.overdueRents)} icon="alert-circle" color={colors.destructive} onPress={() => router.push("/payments")} />
          <SummaryCard title="Rent Due (Month)" value={formatCurrency(summary?.rentDueThisMonth)} icon="calendar" color={colors.warning} onPress={() => router.push("/payments")} />
          <SummaryCard title="Total Properties" value={summary?.totalProperties || 0} icon="home" color={colors.accent} onPress={() => router.push("/properties")} />
          <SummaryCard title="Active Tenants" value={summary?.totalTenants || 0} icon="users" color={colors.tint} onPress={() => router.push("/tenants")} />
          <SummaryCard title="Maintenance" value={summary?.pendingMaintenance || 0} icon="tool" color={colors.mutedForeground} onPress={() => router.push("/maintenance")} />
          <SummaryCard title="Occupancy Rate" value={`${summary?.occupancyPercentage ?? 0}%`} icon="percent" color={colors.primary} onPress={() => router.push("/properties")} />
          <SummaryCard title="Collection Rate" value={`${summary?.collectionRate ?? 0}%`} icon="bar-chart-2" color={colors.success} onPress={() => router.push("/reports")} />
          <SummaryCard title="Vacant Units" value={summary?.totalVacantUnits ?? 0} icon="grid" color={colors.warning} onPress={() => router.push("/properties")} />
        </View>

        {top5DueTenants.length > 0 && (
          <View style={[styles.dueSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.dueSectionHeader}>
              <Text style={[styles.dueSectionTitle, { color: colors.foreground }]}>🔴 Top Due Tenants</Text>
              <TouchableOpacity onPress={() => router.push("/tenants")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See All</Text>
              </TouchableOpacity>
            </View>
            {top5DueTenants.map((tenant, idx) => (
              <View
                key={tenant.id}
                style={[
                  styles.dueRow,
                  { borderTopColor: colors.border, borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth },
                ]}
              >
                <View style={styles.dueLeft}>
                  <View style={[styles.dueRank, { backgroundColor: `${colors.destructive}18` }]}>
                    <Text style={[styles.dueRankText, { color: colors.destructive }]}>#{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dueName, { color: colors.foreground }]} numberOfLines={1}>{tenant.name}</Text>
                    <Text style={[styles.dueUnit, { color: colors.mutedForeground }]}>
                      {(tenant as any).unitNumber ? `Unit ${(tenant as any).unitNumber}` : "—"}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.dueAmount, { color: colors.destructive }]}>
                  {formatCurrency((tenant as any).balanceDue ?? 0)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: "bold" },
  scrollContent: { padding: 16, paddingBottom: 100 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 24 },
  card: { width: "47%", padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 0 },
  iconContainer: { width: 48, height: 48, borderRadius: 24, justifyContent: "center", alignItems: "center", marginBottom: 12 },
  cardValue: { fontSize: 22, fontWeight: "bold", marginBottom: 4 },
  cardTitle: { fontSize: 13, fontWeight: "500" },
  dueSection: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 8 },
  dueSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  dueSectionTitle: { fontSize: 17, fontWeight: "bold" },
  seeAll: { fontSize: 14, fontWeight: "600" },
  dueRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  dueLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, marginRight: 8 },
  dueRank: { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center" },
  dueRankText: { fontSize: 11, fontWeight: "bold" },
  dueName: { fontSize: 14, fontWeight: "600" },
  dueUnit: { fontSize: 12, marginTop: 1 },
  dueAmount: { fontSize: 15, fontWeight: "bold" },
});
