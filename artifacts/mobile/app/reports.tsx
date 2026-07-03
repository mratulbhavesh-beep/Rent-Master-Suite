import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import {
  useGetYearlyReport, getGetYearlyReportQueryKey,
  useGetMonthlyReport, getGetMonthlyReportQueryKey,
  useListPayments, getListPaymentsQueryKey,
  useListTenants, getListTenantsQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { downloadPDF } from "@/utils/receiptPdf";

type ReportTab = "yearly" | "monthly" | "property" | "due";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [activeTab, setActiveTab] = useState<ReportTab>("yearly");
  const [year, setYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [exporting, setExporting] = useState(false);

  const { data: yearlyReport, isLoading: yearlyLoading, isFetching: yearlyFetching, refetch: refetchYearly } =
    useGetYearlyReport({ year }, { query: { queryKey: getGetYearlyReportQueryKey({ year }) } });

  const { data: monthlyReport, isLoading: monthlyLoading, refetch: refetchMonthly } =
    useGetMonthlyReport(
      { year, month: selectedMonth },
      { query: { queryKey: getGetMonthlyReportQueryKey({ year, month: selectedMonth }), enabled: activeTab === "monthly" } }
    );

  const { data: allPayments = [], isLoading: paymentsLoading } =
    useListPayments({}, { query: { queryKey: getListPaymentsQueryKey({}), enabled: activeTab === "property" } });

  const { data: allTenants = [], isLoading: tenantsLoading } =
    useListTenants({}, { query: { queryKey: getListTenantsQueryKey(), enabled: activeTab === "due" } });

  const propertyIncome = useMemo(() => {
    const map = new Map<string, number>();
    allPayments
      .filter(p => p.year === year && (p.status === "paid" || p.status === "partial"))
      .forEach(p => {
        const name = (p as any).propertyName || "General";
        map.set(name, (map.get(name) ?? 0) + parseFloat(String(p.amount)));
      });
    return Array.from(map.entries())
      .map(([name, income]) => ({ name, income }))
      .sort((a, b) => b.income - a.income);
  }, [allPayments, year]);

  const dueTenants = useMemo(() => {
    return [...allTenants]
      .filter(t => ((t as any).balanceDue ?? 0) > 0)
      .sort((a, b) => ((b as any).balanceDue ?? 0) - ((a as any).balanceDue ?? 0));
  }, [allTenants]);

  const maxBarValue = yearlyReport?.monthlyBreakdown
    ? Math.max(...yearlyReport.monthlyBreakdown.map(m => Math.max(m.income, m.expenses)), 1)
    : 100;
  const maxPropertyIncome = propertyIncome.length ? Math.max(...propertyIncome.map(p => p.income), 1) : 1;

  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const fmtCompact = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${Math.round(n)}`;
  };

  const htmlBase = (title: string, body: string) => `
    <!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 22px; color: #1a237e; margin-bottom: 4px; }
      p { color: #666; font-size: 13px; margin: 0 0 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th { background: #1a237e; color: #fff; padding: 10px 12px; text-align: left; }
      td { padding: 9px 12px; border-bottom: 1px solid #eee; }
      tr:nth-child(even) td { background: #f5f5f5; }
      .green { color: #2e7d32; font-weight: bold; }
      .red { color: #c62828; font-weight: bold; }
      .summary { display: flex; gap: 16px; margin-bottom: 24px; }
      .scard { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
      .scard-label { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 6px; }
      .scard-value { font-size: 18px; font-weight: bold; }
    </style></head><body>
    <h1>${title}</h1>
    <p>Generated on ${now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
    ${body}
    </body></html>`;

  const exportPDF = async () => {
    setExporting(true);
    try {
      let html = "";
      let fileName = "Report.pdf";

      if (activeTab === "yearly" && yearlyReport) {
        const rows = yearlyReport.monthlyBreakdown
          .map(m => `<tr><td>${MONTH_FULL[m.month - 1]}</td><td class="green">${fmt(m.income)}</td><td class="red">${fmt(m.expenses)}</td><td class="${m.netProfit >= 0 ? "green" : "red"}">${fmt(m.netProfit)}</td></tr>`)
          .join("");
        html = htmlBase(`Yearly Report — ${year}`,
          `<div class="summary">
            <div class="scard"><div class="scard-label">Total Income</div><div class="scard-value green">${fmt(yearlyReport.totalIncome)}</div></div>
            <div class="scard"><div class="scard-label">Total Expenses</div><div class="scard-value red">${fmt(yearlyReport.totalExpenses)}</div></div>
            <div class="scard"><div class="scard-label">Net Profit</div><div class="scard-value ${yearlyReport.netProfit >= 0 ? "green" : "red"}">${fmt(yearlyReport.netProfit)}</div></div>
          </div>
          <table><thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net Profit</th></tr></thead><tbody>${rows}</tbody></table>`
        );
        fileName = `YearlyReport_${year}.pdf`;
      } else if (activeTab === "monthly" && monthlyReport) {
        const rows = (monthlyReport.payments || [])
          .filter(p => p.status === "paid" || p.status === "partial")
          .map(p => `<tr><td>${(p as any).tenantName || "—"}</td><td>${(p as any).propertyName || "—"}</td><td class="green">${fmt(parseFloat(String(p.amount)))}</td><td>${new Date((p as any).paymentDate || p.createdAt).toLocaleDateString("en-IN")}</td></tr>`)
          .join("");
        html = htmlBase(`Monthly Report — ${MONTH_FULL[selectedMonth - 1]} ${year}`,
          `<div class="summary">
            <div class="scard"><div class="scard-label">Income</div><div class="scard-value green">${fmt(monthlyReport.totalIncome)}</div></div>
            <div class="scard"><div class="scard-label">Expenses</div><div class="scard-value red">${fmt(monthlyReport.totalExpenses)}</div></div>
            <div class="scard"><div class="scard-label">Net Profit</div><div class="scard-value ${monthlyReport.netProfit >= 0 ? "green" : "red"}">${fmt(monthlyReport.netProfit)}</div></div>
          </div>
          <table><thead><tr><th>Tenant</th><th>Property</th><th>Amount</th><th>Date</th></tr></thead><tbody>${rows || "<tr><td colspan='4' style='text-align:center;color:#888'>No payments</td></tr>"}</tbody></table>`
        );
        fileName = `MonthlyReport_${MONTH_FULL[selectedMonth - 1]}_${year}.pdf`;
      } else if (activeTab === "property") {
        const rows = propertyIncome
          .map(p => `<tr><td>${p.name}</td><td class="green">${fmt(p.income)}</td></tr>`)
          .join("");
        html = htmlBase(`Property-wise Income — ${year}`,
          `<table><thead><tr><th>Property</th><th>Total Income</th></tr></thead><tbody>${rows || "<tr><td colspan='2' style='text-align:center;color:#888'>No data</td></tr>"}</tbody></table>`
        );
        fileName = `PropertyIncome_${year}.pdf`;
      } else if (activeTab === "due") {
        const rows = dueTenants
          .map(t => `<tr><td>${t.name}</td><td>${(t as any).unitNumber ? `Unit ${(t as any).unitNumber}` : "—"}</td><td class="red">${fmt((t as any).balanceDue ?? 0)}</td></tr>`)
          .join("");
        html = htmlBase("Due Collection Report",
          `<table><thead><tr><th>Tenant</th><th>Unit</th><th>Amount Due</th></tr></thead><tbody>${rows || "<tr><td colspan='3' style='text-align:center;color:#888'>No dues</td></tr>"}</tbody></table>`
        );
        fileName = `DueCollection_${year}.pdf`;
      } else {
        Alert.alert("No Data", "Please wait for data to load before exporting.");
        return;
      }

      await downloadPDF(html, fileName);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (!msg.includes("cancel")) {
        Alert.alert("Error", "Failed to export PDF.");
      }
    } finally {
      setExporting(false);
    }
  };

  const isCurrentLoading =
    activeTab === "yearly" ? yearlyLoading :
    activeTab === "monthly" ? monthlyLoading :
    activeTab === "property" ? paymentsLoading :
    tenantsLoading;

  const onRefresh = () => {
    if (activeTab === "yearly") refetchYearly();
    else if (activeTab === "monthly") refetchMonthly();
  };

  const currentFetching = activeTab === "yearly" ? yearlyFetching : false;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Financial Reports</Text>
        <TouchableOpacity style={styles.iconButton} onPress={exportPDF} disabled={exporting}>
          {exporting
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Feather name="download" size={22} color={colors.primary} />
          }
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(["yearly", "monthly", "property", "due"] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.mutedForeground }]}>
              {tab === "yearly" ? "Yearly" : tab === "monthly" ? "Monthly" : tab === "property" ? "By Property" : "Due"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={currentFetching && !isCurrentLoading} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* ── YEARLY TAB ── */}
        {activeTab === "yearly" && (
          <>
            <View style={styles.yearSelector}>
              <TouchableOpacity onPress={() => setYear(y => y - 1)} style={styles.yearBtn}>
                <Feather name="chevron-left" size={24} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.yearText, { color: colors.foreground }]}>{year}</Text>
              <TouchableOpacity onPress={() => setYear(y => y + 1)} style={styles.yearBtn} disabled={year >= currentYear}>
                <Feather name="chevron-right" size={24} color={year >= currentYear ? colors.mutedForeground : colors.primary} />
              </TouchableOpacity>
            </View>

            {yearlyLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : yearlyReport ? (
              <>
                <View style={styles.summaryCards}>
                  <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Income</Text>
                    <Text style={[styles.summaryValue, { color: colors.success }]}>{fmt(yearlyReport.totalIncome)}</Text>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Expenses</Text>
                    <Text style={[styles.summaryValue, { color: colors.destructive }]}>{fmt(yearlyReport.totalExpenses)}</Text>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, width: "100%", marginTop: 12 }]}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Net Profit</Text>
                    <Text style={[styles.summaryValue, { color: yearlyReport.netProfit >= 0 ? colors.success : colors.destructive, fontSize: 28 }]}>
                      {fmt(yearlyReport.netProfit)}
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
                    {yearlyReport.monthlyBreakdown.map((monthData, index) => {
                      const incomeHeight = maxBarValue > 0 ? (monthData.income / maxBarValue) * 150 : 0;
                      const expenseHeight = maxBarValue > 0 ? (monthData.expenses / maxBarValue) * 150 : 0;
                      return (
                        <View key={index} style={styles.barGroup}>
                          <View style={styles.barsContainer}>
                            <View style={[styles.bar, { height: Math.max(incomeHeight, 2), backgroundColor: colors.success }]} />
                            <View style={[styles.bar, { height: Math.max(expenseHeight, 2), backgroundColor: colors.destructive }]} />
                          </View>
                          <Text style={[styles.monthLabel, { color: colors.mutedForeground }]}>{MONTH_NAMES[monthData.month - 1]}</Text>
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
          </>
        )}

        {/* ── MONTHLY TAB ── */}
        {activeTab === "monthly" && (
          <>
            <View style={styles.yearSelector}>
              <TouchableOpacity onPress={() => setYear(y => y - 1)} style={styles.yearBtn}>
                <Feather name="chevron-left" size={20} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.yearText, { color: colors.foreground, fontSize: 18 }]}>{year}</Text>
              <TouchableOpacity onPress={() => setYear(y => y + 1)} style={styles.yearBtn} disabled={year >= currentYear}>
                <Feather name="chevron-right" size={20} color={year >= currentYear ? colors.mutedForeground : colors.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll} contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}>
              {MONTH_NAMES.map((mn, i) => {
                const m = i + 1;
                const active = selectedMonth === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.monthChip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
                    onPress={() => setSelectedMonth(m)}
                  >
                    <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontSize: 13, fontWeight: "600" }}>{mn}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {monthlyLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : monthlyReport ? (
              <>
                <View style={styles.summaryCards}>
                  <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Income</Text>
                    <Text style={[styles.summaryValue, { color: colors.success }]}>{fmt(monthlyReport.totalIncome)}</Text>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Expenses</Text>
                    <Text style={[styles.summaryValue, { color: colors.destructive }]}>{fmt(monthlyReport.totalExpenses)}</Text>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, width: "100%", marginTop: 12 }]}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Net Profit</Text>
                    <Text style={[styles.summaryValue, { color: monthlyReport.netProfit >= 0 ? colors.success : colors.destructive, fontSize: 26 }]}>
                      {fmt(monthlyReport.netProfit)}
                    </Text>
                  </View>
                </View>

                {monthlyReport.payments && monthlyReport.payments.filter(p => p.status === "paid" || p.status === "partial").length > 0 && (
                  <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.listCardTitle, { color: colors.foreground }]}>Payments Received</Text>
                    {monthlyReport.payments
                      .filter(p => p.status === "paid" || p.status === "partial")
                      .map((p, i) => (
                        <View key={i} style={[styles.listRow, { borderTopColor: colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.listRowTitle, { color: colors.foreground }]} numberOfLines={1}>{(p as any).tenantName || "—"}</Text>
                            <Text style={[styles.listRowSub, { color: colors.mutedForeground }]}>{(p as any).propertyName || "—"}</Text>
                          </View>
                          <Text style={[styles.listRowAmt, { color: colors.success }]}>{fmt(parseFloat(String(p.amount)))}</Text>
                        </View>
                      ))}
                  </View>
                )}

                {monthlyReport.expenses && monthlyReport.expenses.length > 0 && (
                  <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.listCardTitle, { color: colors.foreground }]}>Expenses</Text>
                    {monthlyReport.expenses.map((e, i) => (
                      <View key={i} style={[styles.listRow, { borderTopColor: colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.listRowTitle, { color: colors.foreground }]} numberOfLines={1}>{e.title}</Text>
                          <Text style={[styles.listRowSub, { color: colors.mutedForeground }]}>{e.category}</Text>
                        </View>
                        <Text style={[styles.listRowAmt, { color: colors.destructive }]}>{fmt(parseFloat(String(e.amount)))}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {(!monthlyReport.payments?.length && !monthlyReport.expenses?.length) && (
                  <View style={styles.emptyState}>
                    <Feather name="inbox" size={40} color={colors.mutedForeground} />
                    <Text style={[{ color: colors.mutedForeground, marginTop: 12 }]}>No transactions in {MONTH_FULL[selectedMonth - 1]}</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.emptyState}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          </>
        )}

        {/* ── BY PROPERTY TAB ── */}
        {activeTab === "property" && (
          <>
            <View style={styles.yearSelector}>
              <TouchableOpacity onPress={() => setYear(y => y - 1)} style={styles.yearBtn}>
                <Feather name="chevron-left" size={24} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.yearText, { color: colors.foreground }]}>{year}</Text>
              <TouchableOpacity onPress={() => setYear(y => y + 1)} style={styles.yearBtn} disabled={year >= currentYear}>
                <Feather name="chevron-right" size={24} color={year >= currentYear ? colors.mutedForeground : colors.primary} />
              </TouchableOpacity>
            </View>

            {paymentsLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : propertyIncome.length > 0 ? (
              <>
                <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.listCardTitle, { color: colors.foreground }]}>Income by Property — {year}</Text>
                  {propertyIncome.map((p, i) => {
                    const barW = maxPropertyIncome > 0 ? (p.income / maxPropertyIncome) * 100 : 0;
                    return (
                      <View key={i} style={[styles.propRow, { borderTopColor: colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}>
                        <View style={styles.propRowTop}>
                          <Text style={[styles.propName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                          <Text style={[styles.propIncome, { color: colors.success }]}>{fmtCompact(p.income)}</Text>
                        </View>
                        <View style={[styles.propBarBg, { backgroundColor: `${colors.success}20` }]}>
                          <View style={[styles.propBar, { width: `${barW}%`, backgroundColor: colors.success }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>

                <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, width: "100%", marginTop: 8 }]}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Collected ({year})</Text>
                  <Text style={[styles.summaryValue, { color: colors.success, fontSize: 26 }]}>
                    {fmt(propertyIncome.reduce((s, p) => s + p.income, 0))}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.emptyState}>
                <Feather name="home" size={40} color={colors.mutedForeground} />
                <Text style={[{ color: colors.mutedForeground, marginTop: 12 }]}>No payment data for {year}</Text>
              </View>
            )}
          </>
        )}

        {/* ── DUE COLLECTION TAB ── */}
        {activeTab === "due" && (
          <>
            {tenantsLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : dueTenants.length > 0 ? (
              <>
                <View style={[styles.summaryCard, { backgroundColor: `${colors.destructive}10`, borderColor: `${colors.destructive}40`, width: "100%", marginBottom: 16 }]}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Outstanding</Text>
                  <Text style={[styles.summaryValue, { color: colors.destructive, fontSize: 26 }]}>
                    {fmt(dueTenants.reduce((s, t) => s + ((t as any).balanceDue ?? 0), 0))}
                  </Text>
                  <Text style={[{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }]}>{dueTenants.length} tenant{dueTenants.length > 1 ? "s" : ""} with outstanding balance</Text>
                </View>

                <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.listCardTitle, { color: colors.foreground }]}>Due Collection</Text>
                  {dueTenants.map((t, i) => (
                    <View key={t.id} style={[styles.listRow, { borderTopColor: colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}>
                      <View style={[styles.dueRank, { backgroundColor: `${colors.destructive}15` }]}>
                        <Text style={[styles.dueRankText, { color: colors.destructive }]}>#{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.listRowTitle, { color: colors.foreground }]} numberOfLines={1}>{t.name}</Text>
                        <Text style={[styles.listRowSub, { color: colors.mutedForeground }]}>
                          {(t as any).unitNumber ? `Unit ${(t as any).unitNumber}` : "—"}
                        </Text>
                      </View>
                      <Text style={[styles.listRowAmt, { color: colors.destructive }]}>{fmt((t as any).balanceDue ?? 0)}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.emptyState}>
                <Feather name="check-circle" size={48} color={colors.success} />
                <Text style={[{ color: colors.success, marginTop: 12, fontSize: 16, fontWeight: "600" }]}>All Clear!</Text>
                <Text style={[{ color: colors.mutedForeground, marginTop: 4 }]}>No outstanding dues</Text>
              </View>
            )}
          </>
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
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 13, fontWeight: "600" },
  content: { padding: 16, paddingBottom: 60 },
  yearSelector: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginBottom: 16, gap: 16 },
  yearBtn: { padding: 8 },
  yearText: { fontSize: 24, fontWeight: "bold" },
  monthScroll: { marginBottom: 16 },
  monthChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  summaryCards: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 16 },
  summaryCard: { width: "48%", padding: 16, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  summaryLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  summaryValue: { fontSize: 20, fontWeight: "bold" },
  chartContainer: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
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
  listCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  listCardTitle: { fontSize: 16, fontWeight: "bold", marginBottom: 12 },
  listRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  listRowTitle: { fontSize: 14, fontWeight: "600" },
  listRowSub: { fontSize: 12, marginTop: 1 },
  listRowAmt: { fontSize: 15, fontWeight: "bold" },
  propRow: { paddingVertical: 10 },
  propRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  propName: { fontSize: 14, fontWeight: "600", flex: 1, marginRight: 8 },
  propIncome: { fontSize: 14, fontWeight: "bold" },
  propBarBg: { height: 8, borderRadius: 4, overflow: "hidden" },
  propBar: { height: 8, borderRadius: 4 },
  dueRank: { width: 28, height: 28, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  dueRankText: { fontSize: 11, fontWeight: "bold" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
});
