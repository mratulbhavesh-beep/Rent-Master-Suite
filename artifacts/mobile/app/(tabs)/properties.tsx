import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput } from "react-native";
import { useListProperties, getListPropertiesQueryKey, Property } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

export default function PropertiesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: properties, isLoading, isFetching, refetch } = useListProperties(
    { search },
    { query: { queryKey: getListPropertiesQueryKey({ search }) } }
  );

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const formatCurrency = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available": return colors.success;
      case "occupied": return colors.primary;
      case "maintenance": return colors.warning;
      default: return colors.mutedForeground;
    }
  };

  const renderItem = ({ item }: { item: Property }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/property-detail?id=${item.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>{item.name}</Text>
        <View style={[styles.badge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
          <Text style={[styles.badgeText, { color: getStatusColor(item.status) }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      
      <Text style={[styles.address, { color: colors.mutedForeground }]} numberOfLines={1}>
        <Feather name="map-pin" size={14} /> {item.address}
      </Text>
      
      <View style={styles.cardFooter}>
        <View style={styles.footerItem}>
          <Feather name="home" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.foreground }]}>{item.type}</Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="users" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.foreground }]}>
            {(item as any).occupiedUnits ?? 0}/{item.totalUnits}
          </Text>
        </View>
        <Text style={[styles.rentText, { color: colors.accent }]}>
          {formatCurrency(item.rentAmount)}/mo
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Properties</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/property-add")}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Feather name="search" size={20} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.input, color: colors.text }]}
          placeholder="Search properties..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={properties || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Feather name="home" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No properties found</Text>
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: "600", flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  address: { fontSize: 14, marginBottom: 16 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerText: { fontSize: 14, fontWeight: "500" },
  rentText: { fontSize: 16, fontWeight: "bold" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 16 },
});