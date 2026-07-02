import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  useListBackups,
  useCreateBackup,
  useRestoreBackup,
  useDeleteBackup,
  BackupMeta,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListBackupsQueryKey } from "@workspace/api-client-react";

type Schedule = "off" | "daily" | "weekly" | "monthly";

const SCHEDULE_KEY = "backup_schedule";
const LAST_AUTO_BACKUP_KEY = "last_auto_backup_ts";

const SCHEDULE_OPTIONS: { value: Schedule; label: string; desc: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: "off", label: "Off", desc: "No automatic backups", icon: "x-circle" },
  { value: "daily", label: "Daily", desc: "Every 24 hours", icon: "sunrise" },
  { value: "weekly", label: "Weekly", desc: "Every 7 days", icon: "calendar" },
  { value: "monthly", label: "Monthly", desc: "Every 30 days", icon: "archive" },
];

const SCHEDULE_INTERVAL_MS: Record<Schedule, number> = {
  off: Infinity,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function BackupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [schedule, setSchedule] = useState<Schedule>("off");
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  const { data: backups = [], isLoading, refetch } = useListBackups();
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const deleteBackup = useDeleteBackup();

  // Load schedule preference and check auto-backup timing
  useEffect(() => {
    (async () => {
      const saved = (await AsyncStorage.getItem(SCHEDULE_KEY)) as Schedule | null;
      if (saved) setSchedule(saved);

      const lastTs = await AsyncStorage.getItem(LAST_AUTO_BACKUP_KEY);
      if (lastTs) {
        const elapsed = Date.now() - Number(lastTs);
        const interval = SCHEDULE_INTERVAL_MS[saved ?? "off"];
        if (saved && saved !== "off" && elapsed > interval) {
          setShowReminder(true);
        }
      } else if (!lastTs && (saved ?? "off") !== "off") {
        setShowReminder(true);
      }

      // Show nudge if no backups at all (loaded after list)
    })();
  }, []);

  // Show reminder if backups list is empty
  useEffect(() => {
    if (!isLoading && backups.length === 0) {
      setShowReminder(true);
    }
  }, [isLoading, backups.length]);

  const handleScheduleChange = async (value: Schedule) => {
    setSchedule(value);
    await AsyncStorage.setItem(SCHEDULE_KEY, value);
  };

  const handleCreateBackup = useCallback(async (label?: string) => {
    setCreating(true);
    try {
      await createBackup.mutateAsync({ data: { label } });
      await AsyncStorage.setItem(LAST_AUTO_BACKUP_KEY, String(Date.now()));
      await queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey() });
      setShowReminder(false);
      Alert.alert("Backup Created", "Your data has been backed up successfully.");
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Backup failed.";
      Alert.alert("Backup Failed", msg);
    } finally {
      setCreating(false);
    }
  }, [createBackup, queryClient]);

  const handleRestore = useCallback((backup: BackupMeta) => {
    Alert.alert(
      "Restore Backup",
      `Are you sure you want to restore from:\n\n"${backup.label}"\n${formatDate(backup.createdAt)}\n\n⚠️ This will permanently replace all your current data with the backup data. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setRestoringId(backup.id);
            try {
              const result = await restoreBackup.mutateAsync({ id: backup.id });
              await queryClient.invalidateQueries();
              Alert.alert("Restore Complete", result.message ?? "Data restored successfully.");
            } catch (e: any) {
              const msg = e?.response?.data?.error ?? e?.message ?? "Restore failed.";
              Alert.alert("Restore Failed", msg);
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  }, [restoreBackup, queryClient]);

  const handleDelete = useCallback((backup: BackupMeta) => {
    Alert.alert(
      "Delete Backup",
      `Delete "${backup.label}"?\n\nThis action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(backup.id);
            try {
              await deleteBackup.mutateAsync({ id: backup.id });
              await queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey() });
            } catch (e: any) {
              Alert.alert("Error", e?.response?.data?.error ?? "Could not delete backup.");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }, [deleteBackup, queryClient]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const latestBackup = backups.length > 0 ? backups[backups.length - 1] : null;
  const daysSinceBackup = latestBackup
    ? Math.floor((Date.now() - new Date(latestBackup.createdAt).getTime()) / 86400000)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Backup & Restore</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {backups.length} backup{backups.length !== 1 ? "s" : ""} stored
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: colors.primary }, creating && { opacity: 0.7 }]}
          onPress={() => handleCreateBackup()}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="upload-cloud" size={15} color="#fff" />
              <Text style={styles.createBtnText}>Backup</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Reminder Banner */}
        {showReminder && (
          <TouchableOpacity
            style={[styles.reminderBanner, { backgroundColor: `${colors.warning}18`, borderColor: `${colors.warning}40` }]}
            onPress={() => handleCreateBackup()}
            activeOpacity={0.8}
          >
            <View style={[styles.reminderIcon, { backgroundColor: `${colors.warning}25` }]}>
              <Feather name="alert-triangle" size={18} color={colors.warning} />
            </View>
            <View style={styles.reminderText}>
              <Text style={[styles.reminderTitle, { color: colors.warning }]}>
                {backups.length === 0 ? "No backups found" : "Backup overdue"}
              </Text>
              <Text style={[styles.reminderDesc, { color: colors.mutedForeground }]}>
                {backups.length === 0
                  ? "Create your first backup to keep your data safe"
                  : `Last backup was ${daysSinceBackup} day${daysSinceBackup !== 1 ? "s" : ""} ago — tap to back up now`}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.warning} />
          </TouchableOpacity>
        )}

        {/* Status Card */}
        <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, {
              backgroundColor: backups.length > 0 && (daysSinceBackup ?? 99) <= 7
                ? colors.success
                : backups.length > 0
                ? colors.warning
                : colors.destructive,
            }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>
                {backups.length === 0
                  ? "No backups yet"
                  : (daysSinceBackup ?? 0) <= 1
                  ? "Up to date"
                  : (daysSinceBackup ?? 0) <= 7
                  ? "Recent backup"
                  : "Backup needed"}
              </Text>
              <Text style={[styles.statusDesc, { color: colors.mutedForeground }]}>
                {latestBackup
                  ? `Last backup: ${formatDate(latestBackup.createdAt)} at ${formatTime(latestBackup.createdAt)}`
                  : "Tap Backup to protect your data"}
              </Text>
            </View>
            {latestBackup && (
              <Text style={[styles.statusAgo, { color: colors.mutedForeground }]}>
                {timeAgo(latestBackup.createdAt)}
              </Text>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{backups.length}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Backups</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {latestBackup ? formatBytes(latestBackup.sizeBytes) : "—"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Latest Size</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {schedule === "off" ? "Off" : schedule.charAt(0).toUpperCase() + schedule.slice(1)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Auto Schedule</Text>
            </View>
          </View>
        </View>

        {/* Auto Backup Schedule */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Auto Backup Schedule</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {SCHEDULE_OPTIONS.map((opt, i) => {
            const isSelected = schedule === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.scheduleRow,
                  { borderBottomColor: colors.border },
                  i === SCHEDULE_OPTIONS.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => handleScheduleChange(opt.value)}
                activeOpacity={0.7}
              >
                <View style={[styles.scheduleIcon, {
                  backgroundColor: isSelected ? `${colors.primary}20` : `${colors.muted}60`,
                }]}>
                  <Feather name={opt.icon} size={16} color={isSelected ? colors.primary : colors.mutedForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.scheduleLabel, { color: colors.foreground }]}>{opt.label}</Text>
                  <Text style={[styles.scheduleDesc, { color: colors.mutedForeground }]}>{opt.desc}</Text>
                </View>
                <View style={[
                  styles.radioOuter,
                  { borderColor: isSelected ? colors.primary : colors.border },
                ]}>
                  {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Backup History */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Backup History</Text>

        {isLoading ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading backups…</Text>
          </View>
        ) : backups.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: `${colors.primary}15` }]}>
              <Feather name="database" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No backups yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Create your first backup to keep your properties, tenants, payments, and all business data safe.
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              onPress={() => handleCreateBackup()}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="upload-cloud" size={16} color="#fff" />
                  <Text style={styles.emptyBtnText}>Create First Backup</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[...backups].reverse().map((backup, idx) => {
              const isRestoring = restoringId === backup.id;
              const isDeleting = deletingId === backup.id;
              const isNewest = idx === 0;
              return (
                <View
                  key={backup.id}
                  style={[
                    styles.backupRow,
                    { borderBottomColor: colors.border },
                    idx === backups.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <View style={[styles.backupIconWrap, {
                    backgroundColor: isNewest ? `${colors.primary}18` : `${colors.muted}50`,
                  }]}>
                    <Feather name="database" size={18} color={isNewest ? colors.primary : colors.mutedForeground} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.backupLabelRow}>
                      <Text style={[styles.backupLabel, { color: colors.foreground }]} numberOfLines={1}>
                        {backup.label}
                      </Text>
                      {isNewest && (
                        <View style={[styles.latestBadge, { backgroundColor: `${colors.success}20` }]}>
                          <Text style={[styles.latestBadgeText, { color: colors.success }]}>Latest</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.backupMeta, { color: colors.mutedForeground }]}>
                      {formatDate(backup.createdAt)} · {formatTime(backup.createdAt)}
                    </Text>
                    <Text style={[styles.backupSize, { color: colors.mutedForeground }]}>
                      {formatBytes(backup.sizeBytes)}
                    </Text>
                  </View>
                  <View style={styles.backupActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: `${colors.primary}15` }]}
                      onPress={() => handleRestore(backup)}
                      disabled={isRestoring || isDeleting}
                    >
                      {isRestoring ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather name="rotate-ccw" size={15} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: `${colors.destructive}15` }]}
                      onPress={() => handleDelete(backup)}
                      disabled={isRestoring || isDeleting}
                    >
                      {isDeleting ? (
                        <ActivityIndicator size="small" color={colors.destructive} />
                      ) : (
                        <Feather name="trash-2" size={15} color={colors.destructive} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Info note */}
        <View style={[styles.infoNote, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}20` }]}>
          <Feather name="info" size={14} color={colors.primary} />
          <Text style={[styles.infoNoteText, { color: colors.mutedForeground }]}>
            Backups include all properties, tenants, rent payments, expenses, loans, and maintenance records.
            Profile photos and document files are not included in the backup.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  backBtn: { width: 38, height: 38, justifyContent: "center", alignItems: "center" },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  headerSub: { fontSize: 12 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 10,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  scroll: { padding: 20, gap: 10 },

  reminderBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 2,
  },
  reminderIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  reminderText: { flex: 1 },
  reminderTitle: { fontSize: 14, fontWeight: "700" },
  reminderDesc: { fontSize: 12, marginTop: 2 },

  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTitle: { fontSize: 15, fontWeight: "700" },
  statusDesc: { fontSize: 12, marginTop: 2 },
  statusAgo: { fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth },
  statsRow: { flexDirection: "row" },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 11, textAlign: "center" },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36, alignSelf: "center" },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 6,
    marginBottom: 2,
    marginLeft: 4,
  },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },

  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleIcon: { width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  scheduleLabel: { fontSize: 15, fontWeight: "600" },
  scheduleDesc: { fontSize: 12, marginTop: 1 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, justifyContent: "center", alignItems: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5 },

  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 10,
  },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  backupRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backupIconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  backupLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  backupLabel: { fontSize: 14, fontWeight: "600", flex: 1 },
  latestBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  latestBadgeText: { fontSize: 10, fontWeight: "700" },
  backupMeta: { fontSize: 12 },
  backupSize: { fontSize: 11, marginTop: 1 },
  backupActions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: "center", alignItems: "center" },

  infoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  infoNoteText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
