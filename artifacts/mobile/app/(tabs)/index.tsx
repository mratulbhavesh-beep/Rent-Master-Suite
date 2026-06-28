import React, { useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
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

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const onRefresh = async () => {
    await refetch();
  };

  const formatCurrency = (amount: number = 0) => {
    return `₹${amount.toLocaleString("en-IN")}`;
  };

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
          <SummaryCard 
            title="Monthly Income" 
            value={formatCurrency(summary?.monthlyIncome)} 
            icon="trending-up" 
            color={colors.success}
            onPress={() => router.push("/reports")}
          />
          <SummaryCard 
            title="Overdue Rents" 
            value={formatCurrency(summary?.overdueRents)} 
            icon="alert-circle" 
            color={colors.destructive}
            onPress={() => router.push("/payments")}
          />
          <SummaryCard 
            title="Total Properties" 
            value={summary?.totalProperties || 0} 
            icon="home" 
            color={colors.primary}
            onPress={() => router.push("/properties")}
          />
          <SummaryCard 
            title="Active Tenants" 
            value={summary?.totalTenants || 0} 
            icon="users" 
            color={colors.accent}
            onPress={() => router.push("/tenants")}
          />
          <SummaryCard 
            title="Pending Maintenance" 
            value={summary?.pendingMaintenance || 0} 
            icon="tool" 
            color={colors.warning}
            onPress={() => router.push("/maintenance")}
          />
          <SummaryCard 
            title="Rent Due" 
            value={formatCurrency(summary?.rentDueThisMonth)} 
            icon="calendar" 
            color={colors.tint}
            onPress={() => router.push("/payments")}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: "bold" },
  scrollContent: { padding: 16, paddingBottom: 100 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 16 },
  card: {
    width: "47%",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  cardValue: { fontSize: 22, fontWeight: "bold", marginBottom: 4 },
  cardTitle: { fontSize: 13, fontWeight: "500" },
});