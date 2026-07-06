import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, Switch, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Modal, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface NotifSettings {
  rentDue3d: boolean;
  rentDueToday: boolean;
  rentOverdue: boolean;
  paymentReceived: boolean;
  leaseExpiry: boolean;
  leaseRenewal: boolean;
  rentEscalation: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

interface PushLog {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  type: string;
  billingPeriod: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  rent_due_3d: "Rent Due (3 Days)",
  rent_due_today: "Due Today",
  rent_overdue: "Overdue",
  payment_received: "Payment Received",
  lease_expiry_60d: "Lease Expiry (60d)",
  lease_expiry_30d: "Lease Expiry (30d)",
  lease_expiry_7d: "Lease Expiry (7d)",
  lease_renewal: "Lease Renewal",
  rent_escalation: "Rent Escalation",
};

const TYPE_ICONS: Record<string, string> = {
  rent_due_3d: "clock",
  rent_due_today: "calendar",
  rent_due_today2: "calendar",
  rent_overdue: "alert-triangle",
  payment_received: "check-circle",
  lease_expiry_60d: "file-text",
  lease_expiry_30d: "file-text",
  lease_expiry_7d: "file-text",
  lease_renewal: "refresh-cw",
  rent_escalation: "trending-up",
};

// 30-minute time slots 00:00 → 23:30
const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const DEFAULT: NotifSettings = {
  rentDue3d: true,
  rentDueToday: true,
  rentOverdue: true,
  paymentReceived: true,
  leaseExpiry: true,
  leaseRenewal: true,
  rentEscalation: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

function formatLogDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatLogTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [settings, setSettings] = useState<NotifSettings>(DEFAULT);
  const [logs, setLogs] = useState<PushLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timePicker, setTimePicker] = useState<"start" | "end" | null>(null);

  const getToken = async () => AsyncStorage.getItem("auth_token");

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [sResp, lResp] = await Promise.all([
        fetch(`${BASE_URL}/api/notification-settings`, { headers }),
        fetch(`${BASE_URL}/api/push-notification-logs?limit=30`, { headers }),
      ]);
      if (sResp.ok) {
        const d = await sResp.json();
        setSettings({
          rentDue3d: d.rentDue3d ?? true,
          rentDueToday: d.rentDueToday ?? true,
          rentOverdue: d.rentOverdue ?? true,
          paymentReceived: d.paymentReceived ?? true,
          leaseExpiry: d.leaseExpiry ?? true,
          leaseRenewal: d.leaseRenewal ?? true,
          rentEscalation: d.rentEscalation ?? true,
          quietHoursEnabled: d.quietHoursEnabled ?? false,
          quietHoursStart: d.quietHoursStart ?? "22:00",
          quietHoursEnd: d.quietHoursEnd ?? "08:00",
        });
      }
      if (lResp.ok) {
        setLogs(await lResp.json());
      }
    } catch {
      // use defaults silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (key: keyof NotifSettings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${BASE_URL}/api/notification-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      });
      if (resp.ok) {
        Alert.alert("Saved", "Notification settings updated.");
      } else {
        Alert.alert("Error", "Failed to save. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const NOTIF_ROWS: { key: keyof NotifSettings; label: string; desc: string; icon: string }[] = [
    { key: "rentDue3d", label: "Rent Due Reminder", desc: "3 days before the due date", icon: "clock" },
    { key: "rentDueToday", label: "Due Today", desc: "On the rent due date", icon: "calendar" },
    { key: "rentOverdue", label: "Overdue Reminder", desc: "After grace period expires", icon: "alert-triangle" },
    { key: "paymentReceived", label: "Payment Received", desc: "When a payment is recorded", icon: "check-circle" },
    { key: "leaseExpiry", label: "Lease Expiry", desc: "7, 30, 60 days before expiry", icon: "file-text" },
    { key: "leaseRenewal", label: "Lease Renewal", desc: "Before renewal date", icon: "refresh-cw" },
    { key: "rentEscalation", label: "Rent Escalation", desc: "Before escalation is due", icon: "trending-up" },
  ];

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: colors.primary }]}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.saveBtnText}>Save</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Notification Types ────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTIFICATION TYPES</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {NOTIF_ROWS.map((row, idx) => (
            <View
              key={row.key}
              style={[
                styles.toggleRow,
                idx < NOTIF_ROWS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
            >
              <View style={[styles.iconBadge, { backgroundColor: colors.secondary }]}>
                <Feather name={row.icon as any} size={18} color={colors.primary} />
              </View>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{row.label}</Text>
                <Text style={[styles.toggleDesc, { color: colors.mutedForeground }]}>{row.desc}</Text>
              </View>
              <Switch
                value={settings[row.key] as boolean}
                onValueChange={() => toggle(row.key)}
                trackColor={{ false: colors.border, true: `${colors.primary}60` }}
                thumbColor={settings[row.key] ? colors.primary : colors.mutedForeground}
              />
            </View>
          ))}
        </View>

        {/* ── Quiet Hours ───────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>QUIET HOURS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Master toggle */}
          <View style={[styles.toggleRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
            <View style={[styles.iconBadge, { backgroundColor: colors.secondary }]}>
              <Feather name="moon" size={18} color={colors.primary} />
            </View>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Enable Quiet Hours</Text>
              <Text style={[styles.toggleDesc, { color: colors.mutedForeground }]}>No notifications during this window</Text>
            </View>
            <Switch
              value={settings.quietHoursEnabled}
              onValueChange={() => toggle("quietHoursEnabled")}
              trackColor={{ false: colors.border, true: `${colors.primary}60` }}
              thumbColor={settings.quietHoursEnabled ? colors.primary : colors.mutedForeground}
            />
          </View>

          {/* Time pickers (only when enabled) */}
          {settings.quietHoursEnabled && (
            <>
              <TouchableOpacity
                style={[styles.timeRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                onPress={() => setTimePicker("start")}
              >
                <View style={[styles.iconBadge, { backgroundColor: colors.secondary }]}>
                  <Feather name="sun" size={18} color={colors.primary} />
                </View>
                <Text style={[styles.timeLabel, { color: colors.foreground }]}>Start Time</Text>
                <View style={[styles.timeBadge, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.timeValue, { color: colors.primary }]}>{settings.quietHoursStart}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.timeRow} onPress={() => setTimePicker("end")}>
                <View style={[styles.iconBadge, { backgroundColor: colors.secondary }]}>
                  <Feather name="sunrise" size={18} color={colors.primary} />
                </View>
                <Text style={[styles.timeLabel, { color: colors.foreground }]}>End Time</Text>
                <View style={[styles.timeBadge, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.timeValue, { color: colors.primary }]}>{settings.quietHoursEnd}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            </>
          )}

          {settings.quietHoursEnabled && (
            <View style={[styles.quietNote, { backgroundColor: `${colors.warning}10`, borderTopColor: colors.border }]}>
              <Feather name="info" size={13} color={colors.warning} />
              <Text style={[styles.quietNoteText, { color: colors.warning }]}>
                Times are in UTC. Currently {new Date().toUTCString().slice(17, 22)} UTC.
              </Text>
            </View>
          )}
        </View>

        {/* ── Push History / Audit ──────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PUSH HISTORY</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {logs.length === 0 ? (
            <View style={styles.emptyHistory}>
              <Feather name="bell-off" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyHistoryText, { color: colors.mutedForeground }]}>No notifications sent yet</Text>
            </View>
          ) : (
            logs.map((log, idx) => (
              <View
                key={log.id}
                style={[
                  styles.logRow,
                  idx < logs.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                ]}
              >
                <View style={[
                  styles.logStatusDot,
                  { backgroundColor: log.status === "sent" ? colors.success : colors.destructive },
                ]} />
                <View style={styles.logInfo}>
                  <View style={styles.logTopRow}>
                    <Text style={[styles.logType, { color: colors.foreground }]}>
                      {TYPE_LABELS[log.type] ?? log.type}
                    </Text>
                    <Text style={[styles.logStatus, {
                      color: log.status === "sent" ? colors.success : colors.destructive,
                    }]}>
                      {log.status.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.logTenant, { color: colors.mutedForeground }]}>
                    {log.tenantName ?? "—"}
                  </Text>
                  <Text style={[styles.logDate, { color: colors.mutedForeground }]}>
                    {formatLogDate(log.sentAt)} · {formatLogTime(log.sentAt)}
                  </Text>
                  {log.errorMessage && (
                    <Text style={[styles.logError, { color: colors.destructive }]}>{log.errorMessage}</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Time Picker Modal ──────────────────────────────────────── */}
      <Modal
        visible={timePicker !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setTimePicker(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.pickerHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              {timePicker === "start" ? "Quiet Hours Start" : "Quiet Hours End"}
            </Text>
            <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
              {TIME_SLOTS.map(t => {
                const selected = timePicker === "start"
                  ? settings.quietHoursStart === t
                  : settings.quietHoursEnd === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.pickerItem,
                      { borderBottomColor: colors.border },
                      selected && { backgroundColor: `${colors.primary}12` },
                    ]}
                    onPress={() => {
                      setSettings(prev => ({
                        ...prev,
                        [timePicker === "start" ? "quietHoursStart" : "quietHoursEnd"]: t,
                      }));
                      setTimePicker(null);
                    }}
                  >
                    <Text style={[styles.pickerItemText, {
                      color: selected ? colors.primary : colors.foreground,
                      fontWeight: selected ? "700" : "400",
                    }]}>
                      {t}
                    </Text>
                    {selected && <Feather name="check" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.pickerCancel, { borderTopColor: colors.border }]}
              onPress={() => setTimePicker(null)}
            >
              <Text style={[styles.pickerCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "700", marginLeft: 12 },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  content: { padding: 20, gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  toggleInfo: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: "500" },
  toggleDesc: { fontSize: 12, marginTop: 1 },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  timeLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  timeBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
  },
  timeValue: { fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  quietNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quietNoteText: { fontSize: 12, flex: 1 },
  emptyHistory: {
    alignItems: "center",
    paddingVertical: 36,
    gap: 10,
  },
  emptyHistoryText: { fontSize: 14 },
  logRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  logStatusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  logInfo: { flex: 1 },
  logTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  logType: { fontSize: 14, fontWeight: "600", flex: 1 },
  logStatus: { fontSize: 11, fontWeight: "700" },
  logTenant: { fontSize: 13, marginBottom: 2 },
  logDate: { fontSize: 12 },
  logError: { fontSize: 11, marginTop: 2 },
  // Time picker modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "60%",
    ...Platform.select({
      android: { elevation: 24 },
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12 },
    }),
  },
  pickerHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 12,
    marginBottom: 16,
  },
  pickerTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", paddingBottom: 12, paddingHorizontal: 20 },
  pickerScroll: { maxHeight: 320 },
  pickerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerItemText: { fontSize: 16 },
  pickerCancel: {
    borderTopWidth: 1,
    padding: 16,
    alignItems: "center",
  },
  pickerCancelText: { fontSize: 16, fontWeight: "500" },
});
