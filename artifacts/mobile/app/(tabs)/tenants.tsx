import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput } from "react-native";
import { useListTenants, getListTenantsQueryKey, Tenant } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function TenantsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: tenants, isLoading, isFetching, refetch } = useListTenants(
    { search },
    { query: { queryKey: getListTenantsQueryKey({ search }) } }
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return colors.success;
      case "inactive": return colors.warning;
      case "evicted": return colors.destructive;
      default: return colors.mutedForeground;
    }
  };

  const renderItem = ({ item }: { item: Tenant }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/tenant-detail?id=${item.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontSize: 18, fontWeight: "bold" }}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>{item.name}</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{item.propertyName} • Unit {item.unitNumber}</Text>
          </View>
        </View>
        <View style={[styles.badge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
          <Text style={[styles.badgeText, { color: getStatusColor(item.status) }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      
      <View style={styles.cardFooter}>
        <View style={styles.contactRow}>
          <Feather name="phone" size={14} color={colors.mutedForeground} />
          <Text style={[styles.contactText, { color: colors.foreground }]}>{item.phone}</Text>
        </View>
        <Text style={[styles.rentText, { color: colors.accent }]}>
          ₹{item.rentAmount.toLocaleString("en-IN")}/mo
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Tenants</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/tenant-add")}
        >
          <Feather name="user-plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Feather name="search" size={20} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.input, color: colors.text }]}
          placeholder="Search tenants..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={tenants || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Feather name="users" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No tenants found</Text>
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
  searchContainer: { paddingHorizontal: 20, marginBottom: 10, position: "relative", justifyContent: "center" },
  searchIcon: { position: "absolute", left: 32, zIndex: 1 },
  searchInput: { height: 44, borderRadius: 8, paddingLeft: 40, paddingRight: 16, fontSize: 16 },
  listContent: { padding: 20, paddingBottom: 100 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  avatarContainer: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  subtitle: { fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactText: { fontSize: 14 },
  rentText: { fontSize: 16, fontWeight: "bold" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 16 },
});