import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from "react-native";
import { useGetYearlyReport, getGetYearlyReportQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: report, isLoading, isFetching, refetch } = useGetYearlyReport(
    { year }, 
    { query: { queryKey: getGetYearlyReportQueryKey({ year }) } }
  );

  const formatCurrencyCompact = (amount: number) => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
    return `₹${amount}`;
  };

  const formatCurrency = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

  // Find max value for chart scaling
  const maxBarValue = report?.monthlyBreakdown ? 
    Math.max(...report.monthlyBreakdown.map(m => Math.max(m.income, m.expenses))) : 100;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Financial Reports</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView 
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <View style={styles.yearSelector}>
          <TouchableOpacity onPress={() => setYear(y => y - 1)} style={styles.yearBtn}>
            <Feather name="chevron-left" size={24} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.yearText, { color: colors.foreground }]}>{year}</Text>
          <TouchableOpacity onPress={() => setYear(y => y + 1)} style={styles.yearBtn} disabled={year >= currentYear}>
            <Feather name="chevron-right" size={24} color={year >= currentYear ? colors.mutedForeground : colors.primary} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : report ? (
          <>
            <View style={styles.summaryCards}>
              <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Income</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>{formatCurrency(report.totalIncome)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Expenses</Text>
                <Text style={[styles.summaryValue, { color: colors.destructive }]}>{formatCurrency(report.totalExpenses)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, width: "100%", marginTop: 12 }]}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Net Profit</Text>
                <Text style={[styles.summaryValue, { color: report.netProfit >= 0 ? colors.success : colors.destructive, fontSize: 28 }]}>
                  {formatCurrency(report.netProfit)}
                </Text>
              </View>
            </View>

            <View style={[styles.chartContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.chartTitle, { color: colors.foreground }]}>Monthly Breakdown</Text>
              
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendColor, { backgroundColor: colors.success }]} />
                  <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Income</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendColor, { backgroundColor: colors.destructive }]} />
                  <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Expenses</Text>
                </View>
              </View>

              <View style={styles.chartWrapper}>
                {report.monthlyBreakdown.map((monthData, index) => {
                  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  const incomeHeight = maxBarValue > 0 ? (monthData.income / maxBarValue) * 150 : 0;
                  const expenseHeight = maxBarValue > 0 ? (monthData.expenses / maxBarValue) * 150 : 0;
                  
                  return (
                    <View key={index} style={styles.barGroup}>
                      <View style={styles.barsContainer}>
                        <View style={[styles.bar, { height: Math.max(incomeHeight, 2), backgroundColor: colors.success }]} />
                        <View style={[styles.bar, { height: Math.max(expenseHeight, 2), backgroundColor: colors.destructive }]} />
                      </View>
                      <Text style={[styles.monthLabel, { color: colors.mutedForeground }]}>{monthNames[monthData.month - 1]}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Text style={{ color: colors.mutedForeground }}>Failed to load report data</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 16, paddingBottom: 40 },
  yearSelector: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginBottom: 24, gap: 16 },
  yearBtn: { padding: 8 },
  yearText: { fontSize: 24, fontWeight: "bold" },
  summaryCards: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 24 },
  summaryCard: { width: "48%", padding: 16, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  summaryLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  summaryValue: { fontSize: 20, fontWeight: "bold" },
  
  chartContainer: { padding: 16, borderRadius: 16, borderWidth: 1 },
  chartTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 16 },
  legend: { flexDirection: "row", gap: 16, marginBottom: 24 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendColor: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, fontWeight: "500" },
  
  chartWrapper: { flexDirection: "row", justifyContent: "space-between", height: 180, alignItems: "flex-end", paddingTop: 10 },
  barGroup: { alignItems: "center", width: "7.5%" },
  barsContainer: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 150 },
  bar: { width: 8, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  monthLabel: { fontSize: 10, marginTop: 8 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
});