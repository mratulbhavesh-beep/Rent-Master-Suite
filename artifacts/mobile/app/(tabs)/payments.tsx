import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from "react-native";
import { useListPayments, getListPaymentsQueryKey, Payment } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function PaymentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const currentMonth = new Date().getMonth() + 1;
  const [filterMonth, setFilterMonth] = useState<string>(currentMonth.toString());

  const { data: payments, isLoading, isFetching, refetch } = useListPayments(
    { month: filterMonth },
    { query: { queryKey: getListPaymentsQueryKey({ month: filterMonth }) } }
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid": return colors.success;
      case "pending": return colors.warning;
      case "partial": return colors.primary;
      case "overdue": return colors.destructive;
      default: return colors.mutedForeground;
    }
  };

  const getMethodIcon = (method: string) => {
    switch (method) {
      case "cash": return "banknote";
      case "bank_transfer": return "columns";
      case "upi": return "smartphone";
      case "cheque": return "file-text";
      case "online": return "credit-card";
      default: return "dollar-sign";
    }
  };

  const renderItem = ({ item }: { item: Payment }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/payment-receipt?id=${item.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.tenantName, { color: colors.cardForeground }]}>{item.tenantName}</Text>
          <Text style={[styles.propertyName, { color: colors.mutedForeground }]}>{item.propertyName}</Text>
        </View>
        <Text style={[styles.amount, { color: colors.foreground }]}>₹{item.amount.toLocaleString("en-IN")}</Text>
      </View>
      
      <View style={styles.cardFooter}>
        <View style={styles.footerInfo}>
          <View style={[styles.badge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
            <Text style={[styles.badgeText, { color: getStatusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
          <View style={styles.methodInfo}>
            <Feather name={getMethodIcon(item.method) as any} size={14} color={colors.mutedForeground} />
            <Text style={[styles.methodText, { color: colors.mutedForeground }]}>
              {item.method.replace('_', ' ')}
            </Text>
          </View>
        </View>
        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
          {new Date(item.paymentDate).toLocaleDateString("en-IN", { day: 'numeric', month: 'short' })}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Payments</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/payment-add")}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={payments || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="payment" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No payments recorded</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: "bold" },
  addButton: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  listContent: { padding: 20, paddingBottom: 100 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  tenantName: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  propertyName: { fontSize: 13 },
  amount: { fontSize: 18, fontWeight: "bold" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  footerInfo: { flexDirection: "row", alignItems: "center", gap: 12 },
  methodInfo: { flexDirection: "row", alignItems: "center", gap: 4 },
  methodText: { fontSize: 12, textTransform: "capitalize" },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  dateText: { fontSize: 13 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 16 },
});