import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

const ACTION_COLORS: Record<string, string> = {
  login: "#3b82f6",
  register: "#8b5cf6",
  create: "#22c55e",
  update: "#f59e0b",
  delete: "#ef4444",
  payment: "#10b981",
  revision: "#6366f1",
  backup: "#14b8a6",
  restore: "#f97316",
  send: "#0ea5e9",
  default: "#94a3b8",
};

const ACTION_ICONS: Record<string, string> = {
  login: "log-in",
  register: "user-plus",
  create: "plus-circle",
  update: "edit-2",
  delete: "trash-2",
  payment: "credit-card",
  revision: "refresh-cw",
  backup: "archive",
  restore: "rotate-ccw",
  send: "send",
  default: "activity",
};

interface ActivityLog {
  id: number;
  userId: number | null;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  description: string;
  oldData: unknown;
  newData: unknown;
  propertyId: number | null;
  ipAddress: string | null;
  createdAt: string;
}

interface LogsResponse {
  logs: ActivityLog[];
  total: number;
  page: number;
  pageSize: number;
}

const ENTITY_FILTERS = ["all", "user", "payment", "property", "tenant", "revision", "backup", "message_template", "reminder"];
const ACTION_FILTERS = ["all", "login", "register", "create", "update", "delete", "payment", "revision", "backup", "restore", "send"];

export default function ActivityLogScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useAuth();

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchLogs = useCallback(async (pageNum: number, reset = false) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: "30" });
      if (filterEntity !== "all") params.set("entity", filterEntity);
      if (filterAction !== "all") params.set("action", filterAction);
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);

      const res = await fetch(`${API_BASE}/activity-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: LogsResponse = await res.json();
      setLogs(prev => reset ? data.logs : [...prev, ...data.logs]);
      setTotal(data.total);
      setHasMore(data.logs.length === 30);
    } catch {
      Alert.alert("Error", "Failed to load activity logs");
    } finally {
      setLoading(false);
    }
  }, [token, filterEntity, filterAction, fromDate, toDate]);

  useFocusEffect(useCallback(() => {
    setPage(1);
    setLogs([]);
    fetchLogs(1, true);
  }, [fetchLogs]));

  const loadMore = () => {
    if (!loading && hasMore) {
      const next = page + 1;
      setPage(next);
      fetchLogs(next);
    }
  };

  const applyFilters = () => {
    setPage(1);
    setLogs([]);
    fetchLogs(1, true);
  };

  const handleDelete = (id: number) => {
    if (user?.role !== "admin") return;
    Alert.alert("Delete Log Entry", "Remove this log entry permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await fetch(`${API_BASE}/activity-logs/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
          setLogs(prev => prev.filter(l => l.id !== id));
          setTotal(prev => prev - 1);
        },
      },
    ]);
  };

  const handleClearAll = () => {
    if (user?.role !== "admin") return;
    Alert.alert("Clear All Logs", "This will permanently delete all activity logs. Continue?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear All", style: "destructive",
        onPress: async () => {
          await fetch(`${API_BASE}/activity-logs`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
          setLogs([]);
          setTotal(0);
        },
      },
    ]);
  };

  const accentColor = (action: string) => ACTION_COLORS[action] ?? ACTION_COLORS.default;
  const iconName = (action: string): keyof typeof Feather.glyphMap =>
    (ACTION_ICONS[action] ?? ACTION_ICONS.default) as keyof typeof Feather.glyphMap;

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const renderItem = ({ item }: { item: ActivityLog }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.actionBadge, { backgroundColor: accentColor(item.action) + "20" }]}>
          <Feather name={iconName(item.action)} size={13} color={accentColor(item.action)} />
          <Text style={[styles.actionText, { color: accentColor(item.action) }]}>{item.action.toUpperCase()}</Text>
        </View>
        <Text style={[styles.entityChip, { color: colors.mutedForeground, borderColor: colors.border }]}>{item.entity}</Text>
        {user?.role === "admin" && (
          <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.delBtn}>
            <Feather name="trash-2" size={14} color="#ef4444" />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.description, { color: colors.foreground }]}>{item.description}</Text>
      <View style={styles.metaRow}>
        <Feather name="user" size={11} color={colors.mutedForeground} />
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.userEmail ?? "System"}</Text>
        <Feather name="clock" size={11} color={colors.mutedForeground} style={{ marginLeft: 10 }} />
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{fmtDateTime(item.createdAt)}</Text>
      </View>
      {item.ipAddress ? (
        <Text style={[styles.ip, { color: colors.mutedForeground }]}>IP: {item.ipAddress}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Activity Log</Text>
        <Text style={[styles.totalBadge, { color: colors.mutedForeground }]}>{total} entries</Text>
        {user?.role === "admin" && (
          <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
            <Feather name="trash" size={18} color="#ef4444" />
          </TouchableOpacity>
        )}
      </View>

      {/* Filters */}
      <View style={[styles.filterBox, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={ENTITY_FILTERS}
            keyExtractor={i => i}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => { setFilterEntity(item); setTimeout(applyFilters, 0); }}
                style={[styles.chip, { borderColor: filterEntity === item ? colors.primary : colors.border, backgroundColor: filterEntity === item ? colors.primary + "15" : "transparent" }]}
              >
                <Text style={[styles.chipText, { color: filterEntity === item ? colors.primary : colors.mutedForeground }]}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={ACTION_FILTERS}
            keyExtractor={i => i}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => { setFilterAction(item); setTimeout(applyFilters, 0); }}
                style={[styles.chip, { borderColor: filterAction === item ? colors.primary : colors.border, backgroundColor: filterAction === item ? colors.primary + "15" : "transparent" }]}
              >
                <Text style={[styles.chipText, { color: filterAction === item ? colors.primary : colors.mutedForeground }]}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.dateInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="From (YYYY-MM-DD)"
            placeholderTextColor={colors.mutedForeground}
            value={fromDate}
            onChangeText={setFromDate}
          />
          <TextInput
            style={[styles.dateInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="To (YYYY-MM-DD)"
            placeholderTextColor={colors.mutedForeground}
            value={toDate}
            onChangeText={setToDate}
          />
          <TouchableOpacity onPress={applyFilters} style={[styles.applyBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.applyBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && logs.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="activity" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No activity logs found</Text>
            </View>
          }
          ListFooterComponent={loading && logs.length > 0 ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700", flex: 1 },
  totalBadge: { fontSize: 12 },
  clearBtn: { padding: 6 },
  filterBox: { borderBottomWidth: 1, paddingVertical: 8 },
  filterRow: { paddingHorizontal: 12, marginBottom: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: 1, marginRight: 6 },
  chipText: { fontSize: 11, fontWeight: "600" },
  dateRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, alignItems: "center", marginTop: 4 },
  dateInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12 },
  applyBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  applyBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  actionBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  actionText: { fontSize: 11, fontWeight: "700" },
  entityChip: { fontSize: 11, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  delBtn: { marginLeft: "auto" as any, padding: 4 },
  description: { fontSize: 13, fontWeight: "500", marginBottom: 6, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontSize: 11 },
  ip: { fontSize: 10, marginTop: 4 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15 },
});
