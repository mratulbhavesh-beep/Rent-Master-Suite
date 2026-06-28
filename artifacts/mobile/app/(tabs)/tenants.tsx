import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { useListTenants, getListTenantsQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

type TenantWithBalance = {
  id: number;
  name: string;
  email: string;
  phone: string;
  propertyName: string | null;
  unitNumber: string;
  rentAmount: number;
  status: string;
  leaseStart: string;
  leaseEnd: string;
  monthsElapsed: number;
  totalExpected: number;
  totalPaid: number;
  balanceDue: number;
};

export default function TenantsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: tenants, isLoading, isFetching, refetch } = useListTenants(
    { search },
    { query: { queryKey: getListTenantsQueryKey({ search }) } }
  );

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return colors.success;
      case "inactive": return colors.warning;
      case "evicted": return colors.destructive;
      default: return colors.mutedForeground;
    }
  };

  const renderItem = ({ item }: { item: TenantWithBalance }) => {
    const hasDue = (item.balanceDue ?? 0) > 0;
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/tenant-detail?id=${item.id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.primaryForeground, fontSize: 18, fontWeight: "bold" }}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.tenantInfo}>
              <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>{item.name}</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {item.propertyName} • Unit {item.unitNumber}
              </Text>
            </View>
          </View>
          <View style={[styles.badge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
            <Text style={[styles.badgeText, { color: getStatusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          <View style={styles.contactRow}>
            <Feather name="phone" size={13} color={colors.mutedForeground} />
            <Text style={[styles.contactText, { color: colors.mutedForeground }]}>{item.phone}</Text>
          </View>
          <View style={styles.rightRow}>
            <Text style={[styles.rentText, { color: colors.accent }]}>
              ₹{item.rentAmount.toLocaleString("en-IN")}/mo
            </Text>
            {hasDue && (
              <View style={[styles.dueBadge, { backgroundColor: `${colors.destructive}15` }]}>
                <Feather name="alert-circle" size={10} color={colors.destructive} />
                <Text style={[styles.dueText, { color: colors.destructive }]}>
                  Due ₹{Math.round(item.balanceDue).toLocaleString("en-IN")}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Tenants</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/tenant-add")}
          activeOpacity={0.8}
        >
          <Feather name="user-plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: colors.input }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search by name, email or phone..."
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

      <FlatList
        data={(tenants as unknown as TenantWithBalance[]) || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
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
            <View style={styles.emptyState}>
              <Feather name="users" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {search ? "No tenants found" : "No tenants yet"}
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search ? "Try a different search" : "Tap + to add your first tenant"}
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: "bold" },
  addButton: { width: 42, height: 42, borderRadius: 21, justifyContent: "center", alignItems: "center" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 14, overflow: "hidden" },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    paddingBottom: 12,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  tenantInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  subtitle: { fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  contactText: { fontSize: 13 },
  rightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rentText: { fontSize: 14, fontWeight: "700" },
  dueBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dueText: { fontSize: 11, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyText: { fontSize: 14 },
});
