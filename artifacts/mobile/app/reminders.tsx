import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Switch,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

interface Template {
  id: number;
  name: string;
  type: string;
  body: string;
  variables: string[];
  isActive: boolean;
  updatedAt: string;
}

interface ReminderLog {
  id: number;
  tenantId: number;
  type: string;
  phone: string | null;
  message: string | null;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  reminder_3days: "3-Day Advance",
  reminder_due: "Due Date",
  reminder_overdue: "Overdue",
  receipt_whatsapp: "Receipt",
};

const STATUS_COLORS: Record<string, string> = {
  sent: "#22c55e",
  failed: "#ef4444",
  pending: "#f59e0b",
};

export default function RemindersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "logs">("templates");
  const [running, setRunning] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [tRes, lRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/reminders/templates`, { headers: h }),
        fetch(`${API_BASE}/reminders/logs`, { headers: h }),
        fetch(`${API_BASE}/reminders/configured`, { headers: h }),
      ]);
      setTemplates(await tRes.json());
      setLogs(await lRes.json());
      const cfg = await cRes.json();
      setConfigured(cfg.configured);
    } catch {
      Alert.alert("Error", "Failed to load reminder data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const startEdit = (t: Template) => {
    setEditId(t.id);
    setEditBody(t.body);
    setEditName(t.name);
  };

  const saveTemplate = async () => {
    if (!editId || !token) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/reminders/templates/${editId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, body: editBody }),
      });
      const updated = await res.json();
      setTemplates(prev => prev.map(t => t.id === editId ? { ...t, ...updated } : t));
      setEditId(null);
      Alert.alert("Saved", "Template updated successfully.");
    } catch {
      Alert.alert("Error", "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: Template) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/reminders/templates/${t.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      const updated = await res.json();
      setTemplates(prev => prev.map(tp => tp.id === t.id ? { ...tp, ...updated } : tp));
    } catch {
      Alert.alert("Error", "Failed to update template");
    }
  };

  const runNow = async () => {
    if (!token) return;
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/reminders/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      Alert.alert("Done", `${data.sent ?? 0} reminder(s) sent.`);
      fetchAll();
    } catch {
      Alert.alert("Error", "Failed to run reminders");
    } finally {
      setRunning(false);
    }
  };

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>WhatsApp Reminders</Text>
        <TouchableOpacity onPress={runNow} disabled={running} style={[styles.runBtn, { backgroundColor: "#22c55e20" }]}>
          {running ? <ActivityIndicator size="small" color="#22c55e" /> : <Feather name="play" size={18} color="#22c55e" />}
        </TouchableOpacity>
      </View>

      {/* Twilio status */}
      <View style={[styles.statusBanner, { backgroundColor: configured ? "#22c55e15" : "#f59e0b15", borderColor: configured ? "#22c55e40" : "#f59e0b40" }]}>
        <Feather name={configured ? "check-circle" : "alert-triangle"} size={14} color={configured ? "#22c55e" : "#f59e0b"} />
        <Text style={[styles.statusText, { color: configured ? "#22c55e" : "#f59e0b" }]}>
          {configured ? "Twilio configured — WhatsApp reminders active" : "Twilio not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to enable"}
        </Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {(["templates", "logs"] as const).map(tab => (
          <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.mutedForeground }]}>
              {tab === "templates" ? "Message Templates" : `Send Log (${logs.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}>
          {activeTab === "templates" ? (
            templates.map(t => (
              <View key={t.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={[styles.templateType, { color: colors.primary }]}>{TYPE_LABELS[t.type] ?? t.type}</Text>
                    {editId === t.id ? (
                      <TextInput
                        style={[styles.nameInput, { color: colors.foreground, borderColor: colors.border }]}
                        value={editName}
                        onChangeText={setEditName}
                      />
                    ) : (
                      <Text style={[styles.templateName, { color: colors.foreground }]}>{t.name}</Text>
                    )}
                  </View>
                  <Switch
                    value={t.isActive}
                    onValueChange={() => toggleActive(t)}
                    trackColor={{ false: colors.border, true: colors.primary + "60" }}
                    thumbColor={t.isActive ? colors.primary : colors.mutedForeground}
                  />
                </View>

                {editId === t.id ? (
                  <>
                    <TextInput
                      style={[styles.bodyInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={editBody}
                      onChangeText={setEditBody}
                      multiline
                      numberOfLines={6}
                      textAlignVertical="top"
                    />
                    <View style={styles.vars}>
                      <Text style={[styles.varsLabel, { color: colors.mutedForeground }]}>Available variables:</Text>
                      <Text style={[styles.varsList, { color: colors.primary }]}>{t.variables.map(v => `{{${v}}}`).join("  ")}</Text>
                    </View>
                    <View style={styles.editBtns}>
                      <TouchableOpacity onPress={() => setEditId(null)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
                        <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={saveTemplate} disabled={saving} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
                        {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[styles.bodyPreview, { color: colors.mutedForeground }]}>{t.body}</Text>
                    <TouchableOpacity onPress={() => startEdit(t)} style={[styles.editBtn, { borderColor: colors.border }]}>
                      <Feather name="edit-2" size={14} color={colors.primary} />
                      <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit Template</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ))
          ) : (
            logs.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="message-circle" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No reminders sent yet</Text>
              </View>
            ) : (
              logs.map(l => (
                <View key={l.id} style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.logHeader}>
                    <Text style={[styles.logType, { color: colors.foreground }]}>{TYPE_LABELS[l.type] ?? l.type}</Text>
                    <View style={[styles.statusPill, { backgroundColor: (STATUS_COLORS[l.status] ?? "#94a3b8") + "20" }]}>
                      <Text style={[styles.statusText2, { color: STATUS_COLORS[l.status] ?? "#94a3b8" }]}>{l.status.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={[styles.logPhone, { color: colors.mutedForeground }]}>{l.phone ?? "—"}</Text>
                  {l.error ? <Text style={styles.errorText}>{l.error}</Text> : null}
                  <Text style={[styles.logDate, { color: colors.mutedForeground }]}>
                    {l.sentAt ? fmtDateTime(l.sentAt) : fmtDateTime(l.createdAt)}
                  </Text>
                </View>
              ))
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700", flex: 1 },
  runBtn: { padding: 8, borderRadius: 8 },
  statusBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  statusText: { fontSize: 12, flex: 1, lineHeight: 18 },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { fontSize: 13, fontWeight: "600" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  templateType: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  templateName: { fontSize: 15, fontWeight: "600" },
  nameInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, marginTop: 4 },
  bodyPreview: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
  bodyInput: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13, lineHeight: 20, minHeight: 120, marginBottom: 10 },
  vars: { marginBottom: 12 },
  varsLabel: { fontSize: 11, marginBottom: 4 },
  varsList: { fontSize: 12, fontFamily: "monospace" },
  editBtns: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  cancelBtnText: { fontSize: 13, fontWeight: "600" },
  saveBtn: { borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" },
  editBtnText: { fontSize: 13, fontWeight: "600" },
  logCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  logType: { fontSize: 13, fontWeight: "600" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText2: { fontSize: 10, fontWeight: "700" },
  logPhone: { fontSize: 12, marginBottom: 2 },
  errorText: { fontSize: 11, color: "#ef4444", marginBottom: 2 },
  logDate: { fontSize: 11 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15 },
});
